import { invoke } from "@tauri-apps/api/core";
import {
  createCheckpoint,
  deleteAsset,
  getDb,
  linkAssetToVersion,
  upsertAsset,
} from "./db";
import { isValidAssetName, loadGitConfig, slugify } from "./github";
import { base64ToBytes } from "./latexCompile";
import { readVaultPdf, removeVaultFile, savePdfBytes } from "./vault";
import type { JobCategory, ResumeKind, ResumeVersion } from "./types";

export interface GitPullResult {
  success: boolean;
  log: string;
  updated: boolean;
  ahead: number;
  behind: number;
  head: string | null;
}

export interface RepoFile {
  path: string;
  text: string | null;
  bytes_base64: string | null;
}

export async function gitPull(): Promise<GitPullResult> {
  const cfg = loadGitConfig();
  return invoke<GitPullResult>("git_pull", {
    repoUrl: cfg.url,
    pat: cfg.pat,
    branch: cfg.branch || "main",
  });
}

export async function gitRemoteSnapshot(): Promise<RepoFile[]> {
  const cfg = loadGitConfig();
  return invoke<RepoFile[]>("git_remote_snapshot", {
    branch: cfg.branch || "main",
  });
}

export function snapshotHasCategories(files: RepoFile[]): boolean {
  return files.some((f) => /^categories\/[^/]+\/_meta\.json$/.test(f.path));
}

// ───── Parsing: snapshot files → RemoteVault ─────

interface RemoteCategoryMeta {
  name: string;
  jd_text: string | null;
  notes: string | null;
  icon: string | null;
  color: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface RemoteVersion {
  key: string; // file stem, e.g. "34-google-v2"
  name: string;
  kind: ResumeKind;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  text: string | null; // .tex / .txt content
  pdfBase64: string | null;
  // Explicit attachment links; null = pre-asset-sync meta (leave links alone).
  assetNames: string[] | null;
}

interface RemoteCategory {
  key: string; // dirname, e.g. "12-swe-backend"
  meta: RemoteCategoryMeta;
  versions: RemoteVersion[];
}

interface RemoteAsset {
  name: string;
  bytesBase64: string;
  mime: string | null;
  updatedAt: string | null; // null = no _meta entry → remote wins arbitration
}

interface RemoteVault {
  categories: RemoteCategory[];
  assets: RemoteAsset[];
  // _meta.json present ⇒ the remote was written by an asset-sync-aware build,
  // so a locally-known asset missing remotely is a real remote deletion.
  hasAssetsMeta: boolean;
  warnings: string[];
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function parseSnapshot(files: RepoFile[]): RemoteVault {
  const warnings: string[] = [];
  interface DirEntry {
    metaText: string | null;
    // stem → partial file contents
    stems: Map<string, { json?: string; tex?: string; txt?: string; pdf?: string }>;
  }
  const dirs = new Map<string, DirEntry>();
  const assetBlobs = new Map<string, string>(); // name → base64
  let assetsMetaText: string | null = null;

  for (const f of files) {
    if (f.path === "vault.json") continue; // index is a hint only; directories win
    if (f.path === "assets/_meta.json") {
      assetsMetaText = f.text;
      continue;
    }
    const am = /^assets\/(.+)$/.exec(f.path);
    if (am) {
      const name = am[1];
      if (name.includes("/")) {
        warnings.push(`${f.path}: subdirectories under assets/ are not supported, skipped`);
        continue;
      }
      if (!isValidAssetName(name)) {
        warnings.push(`${f.path}: illegal asset name, skipped`);
        continue;
      }
      if (f.bytes_base64 == null) {
        warnings.push(`${f.path}: unreadable or larger than 5 MB, skipped`);
        continue;
      }
      assetBlobs.set(name, f.bytes_base64);
      continue;
    }
    const m = /^categories\/([^/]+)\/([^/]+)$/.exec(f.path);
    if (!m) continue; // nested or unrelated paths are user-managed, ignore
    const [, dir, fname] = m;
    if (f.text == null && f.bytes_base64 == null) {
      warnings.push(`${f.path}: unreadable or larger than 30 MB, skipped`);
      continue;
    }
    let entry = dirs.get(dir);
    if (!entry) {
      entry = { metaText: null, stems: new Map() };
      dirs.set(dir, entry);
    }
    if (fname === "_meta.json") {
      entry.metaText = f.text;
      continue;
    }
    const dot = fname.lastIndexOf(".");
    if (dot <= 0) continue;
    const stem = fname.slice(0, dot);
    const ext = fname.slice(dot + 1).toLowerCase();
    const rec = entry.stems.get(stem) ?? {};
    if (ext === "json") rec.json = f.text ?? undefined;
    else if (ext === "tex") rec.tex = f.text ?? undefined;
    else if (ext === "txt") rec.txt = f.text ?? undefined;
    else if (ext === "pdf") rec.pdf = f.bytes_base64 ?? undefined;
    else continue;
    entry.stems.set(stem, rec);
  }

  const categories: RemoteCategory[] = [];
  for (const [dir, entry] of dirs) {
    if (entry.metaText == null) {
      warnings.push(`categories/${dir}: missing _meta.json, directory skipped`);
      continue;
    }
    let metaRaw: Record<string, unknown>;
    try {
      metaRaw = JSON.parse(entry.metaText);
    } catch {
      warnings.push(`categories/${dir}/_meta.json: invalid JSON, directory skipped`);
      continue;
    }
    const name = asStringOrNull(metaRaw.name);
    if (!name) {
      warnings.push(`categories/${dir}/_meta.json: missing name, directory skipped`);
      continue;
    }
    const meta: RemoteCategoryMeta = {
      name,
      jd_text: asStringOrNull(metaRaw.jd_text),
      notes: asStringOrNull(metaRaw.notes),
      icon: asStringOrNull(metaRaw.icon),
      color: asStringOrNull(metaRaw.color),
      created_at: asStringOrNull(metaRaw.created_at),
      updated_at: asStringOrNull(metaRaw.updated_at),
    };

    const versions: RemoteVersion[] = [];
    for (const [stem, rec] of entry.stems) {
      const where = `categories/${dir}/${stem}`;
      if (rec.json == null) {
        warnings.push(`${where}: orphan content without .json metadata, skipped`);
        continue;
      }
      let vRaw: Record<string, unknown>;
      try {
        vRaw = JSON.parse(rec.json);
      } catch {
        warnings.push(`${where}.json: invalid JSON, version skipped`);
        continue;
      }
      const vName = asStringOrNull(vRaw.name);
      const kind = asStringOrNull(vRaw.kind) as ResumeKind | null;
      if (!vName || !kind || !["latex", "pdf", "tsx"].includes(kind)) {
        warnings.push(`${where}.json: missing name/kind, version skipped`);
        continue;
      }
      const rawAssets = vRaw.assets;
      const assetNames = Array.isArray(rawAssets)
        ? rawAssets.filter((n): n is string => typeof n === "string")
        : null;
      const text = kind === "latex" ? rec.tex : kind === "tsx" ? rec.txt : undefined;
      const pdfBase64 = kind === "pdf" ? rec.pdf : undefined;
      if (kind === "pdf" && rec.tex != null) {
        warnings.push(`${where}.tex: ignored, metadata says kind=pdf`);
      }
      if (kind !== "pdf" && rec.pdf != null) {
        warnings.push(`${where}.pdf: ignored, metadata says kind=${kind}`);
      }
      if (text == null && pdfBase64 == null) {
        warnings.push(`${where}: content file missing, version skipped`);
        continue;
      }
      versions.push({
        key: stem,
        name: vName,
        kind,
        notes: asStringOrNull(vRaw.notes),
        created_at: asStringOrNull(vRaw.created_at),
        updated_at: asStringOrNull(vRaw.updated_at),
        text: text ?? null,
        pdfBase64: pdfBase64 ?? null,
        assetNames,
      });
    }
    categories.push({ key: dir, meta, versions });
  }

  // Asset meta index: mime + updated_at per name (older repos have none).
  let assetsMeta: Record<string, { mime?: unknown; updated_at?: unknown }> = {};
  const hasAssetsMeta = assetsMetaText != null;
  if (assetsMetaText != null) {
    try {
      assetsMeta = JSON.parse(assetsMetaText);
    } catch {
      warnings.push("assets/_meta.json: invalid JSON, asset timestamps ignored");
    }
  }
  const assets: RemoteAsset[] = [];
  for (const [name, bytesBase64] of assetBlobs) {
    const m = assetsMeta[name];
    assets.push({
      name,
      bytesBase64,
      mime: m ? asStringOrNull(m.mime) : null,
      updatedAt: m ? asStringOrNull(m.updated_at) : null,
    });
  }

  return { categories, assets, hasAssetsMeta, warnings };
}

// ───── Reconciliation: RemoteVault → SQLite ─────

export interface DeletionCandidate {
  kind: "category" | "version" | "asset";
  label: string;
  apply: () => Promise<void>;
}

export interface PullSummary {
  addedCategories: number;
  addedVersions: number;
  updatedVersions: number;
  skippedLocalNewer: string[]; // "category/version" display names
  backedUpCheckpoints: number;
  addedAssets: number;
  updatedAssets: number;
  skippedAssetsLocalNewer: string[];
  relinkedCount: number; // newly restored version↔asset links
  deletionCandidates: DeletionCandidate[];
  warnings: string[];
}

function nowUtc(): string {
  // Same format as SQLite's datetime('now'): "YYYY-MM-DD HH:MM:SS" in UTC.
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

// DB timestamps are zero-padded UTC strings, so lexicographic order is
// chronological. Equal-but-different is resolved in favour of the remote:
// pulling is an explicit "take the remote" action and the local content is
// checkpoint-protected before any overwrite.
function remoteWins(remote: string | null, local: string): boolean {
  return (remote ?? "") >= local;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function importRemoteVault(files: RepoFile[]): Promise<PullSummary> {
  const vault = parseSnapshot(files);
  const { categories: remoteCats, warnings } = vault;
  const summary: PullSummary = {
    addedCategories: 0,
    addedVersions: 0,
    updatedVersions: 0,
    skippedLocalNewer: [],
    backedUpCheckpoints: 0,
    addedAssets: 0,
    updatedAssets: 0,
    skippedAssetsLocalNewer: [],
    relinkedCount: 0,
    deletionCandidates: [],
    warnings,
  };

  // Assets first: link restoration and post-import compiles need the rows.
  await reconcileAssets(vault, summary);

  const db = await getDb();
  const localCats = await db.select<JobCategory[]>("SELECT * FROM job_categories");
  const localVers = await db.select<ResumeVersion[]>("SELECT * FROM resume_versions");

  const matchedCatIds = new Set<number>();
  const matchedVerIds = new Set<number>();
  // local version id → explicit remote link list (link phase below)
  const assetNamesByVid = new Map<number, string[]>();

  for (const rc of remoteCats) {
    try {
      const localId = await reconcileCategory(rc, localCats, summary);
      if (localId == null) continue;
      matchedCatIds.add(localId);
      for (const rv of rc.versions) {
        try {
          const vid = await reconcileVersion(rc, rv, localId, localVers, summary);
          if (vid != null) {
            matchedVerIds.add(vid);
            if (rv.assetNames) assetNamesByVid.set(vid, rv.assetNames);
          }
        } catch (e) {
          summary.warnings.push(
            `categories/${rc.key}/${rv.key}: import failed: ${String(e)}`,
          );
        }
      }
    } catch (e) {
      summary.warnings.push(`categories/${rc.key}: import failed: ${String(e)}`);
    }
  }

  await restoreAssetLinks(assetNamesByVid, summary);

  collectDeletionCandidates(localCats, localVers, matchedCatIds, matchedVerIds, summary);
  return summary;
}

// ───── Asset reconciliation ─────

interface LocalAssetRow {
  id: number;
  name: string;
  size: number;
  bytes_b64: string | null;
  updated_at: string;
}

async function reconcileAssets(
  vault: RemoteVault,
  summary: PullSummary,
): Promise<void> {
  const db = await getDb();
  const locals = await db.select<LocalAssetRow[]>(
    "SELECT id, name, size, bytes_b64, updated_at FROM assets",
  );
  const localByName = new Map(locals.map((a) => [a.name, a]));
  const remoteNames = new Set<string>();

  for (const ra of vault.assets) {
    remoteNames.add(ra.name);
    try {
      const local = localByName.get(ra.name);
      if (!local) {
        // upsertAsset goes through the bytes_b64 path — never raw number[]
        // BLOB params (see asset-blob-roundtrip spec).
        await upsertAsset(ra.name, base64ToBytes(ra.bytesBase64));
        summary.addedAssets++;
        continue;
      }
      // Size prefilter, then base64 string equality — no decoding needed.
      const sameBytes =
        local.bytes_b64 != null &&
        local.size === base64Size(ra.bytesBase64) &&
        local.bytes_b64 === ra.bytesBase64;
      if (sameBytes) continue;
      // null updatedAt (no _meta entry / old repo) → remote wins, same as the
      // equal-timestamp rule for versions.
      if (ra.updatedAt == null || ra.updatedAt >= local.updated_at) {
        await upsertAsset(ra.name, base64ToBytes(ra.bytesBase64));
        summary.updatedAssets++;
      } else {
        summary.skippedAssetsLocalNewer.push(ra.name);
      }
    } catch (e) {
      summary.warnings.push(`assets/${ra.name}: import failed: ${String(e)}`);
    }
  }

  // Local-only assets are deletions only if the remote runs asset sync at
  // all; otherwise "never synced" is indistinguishable from "deleted".
  if (vault.hasAssetsMeta) {
    for (const local of locals) {
      if (remoteNames.has(local.name)) continue;
      summary.deletionCandidates.push({
        kind: "asset",
        label: local.name,
        apply: async () => {
          await deleteAsset(local.id); // links cascade via FK
        },
      });
    }
  }
}

function base64Size(b64: string): number {
  let pad = 0;
  if (b64.endsWith("==")) pad = 2;
  else if (b64.endsWith("=")) pad = 1;
  return (b64.length / 4) * 3 - pad;
}

async function restoreAssetLinks(
  assetNamesByVid: Map<number, string[]>,
  summary: PullSummary,
): Promise<void> {
  if (assetNamesByVid.size === 0) return;
  const db = await getDb();
  const assets = await db.select<{ id: number; name: string }[]>(
    "SELECT id, name FROM assets",
  );
  const idByName = new Map(assets.map((a) => [a.name, a.id]));
  const links = await db.select<{ version_id: number; asset_id: number }[]>(
    "SELECT version_id, asset_id FROM resume_version_assets",
  );
  const existing = new Set(links.map((l) => `${l.version_id}:${l.asset_id}`));

  for (const [vid, names] of assetNamesByVid) {
    for (const name of names) {
      const aid = idByName.get(name);
      if (aid == null) {
        summary.warnings.push(`linked asset "${name}" not found, link skipped`);
        continue;
      }
      if (existing.has(`${vid}:${aid}`)) continue;
      // Additive only: remote lists never unlink local extras (§5.3).
      await linkAssetToVersion(vid, aid);
      existing.add(`${vid}:${aid}`);
      summary.relinkedCount++;
    }
  }
}

/** Returns the local category id (existing or newly created), or null if skipped. */
async function reconcileCategory(
  rc: RemoteCategory,
  localCats: JobCategory[],
  summary: PullSummary,
): Promise<number | null> {
  const db = await getDb();
  const local =
    localCats.find((c) => c.git_key === rc.key) ??
    localCats.find((c) => !c.git_key && `${c.id}-${slugify(c.name)}` === rc.key);

  if (local && !local.git_key) {
    await db.execute("UPDATE job_categories SET git_key = $1 WHERE id = $2", [
      rc.key,
      local.id,
    ]);
    local.git_key = rc.key;
  }

  const m = rc.meta;
  if (!local) {
    const created = m.created_at ?? m.updated_at ?? nowUtc();
    const updated = m.updated_at ?? created;
    const r = await db.execute(
      `INSERT INTO job_categories (name, jd_text, notes, icon, color, git_key, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [m.name, m.jd_text, m.notes, m.icon, m.color, rc.key, created, updated],
    );
    summary.addedCategories++;
    return r.lastInsertId as number;
  }

  const differs =
    local.name !== m.name ||
    (local.jd_text ?? null) !== m.jd_text ||
    (local.notes ?? null) !== m.notes ||
    (local.icon ?? null) !== m.icon ||
    (local.color ?? null) !== m.color;
  if (differs) {
    if (remoteWins(m.updated_at, local.updated_at)) {
      await db.execute(
        `UPDATE job_categories SET name = $1, jd_text = $2, notes = $3, icon = $4,
           color = $5, updated_at = $6 WHERE id = $7`,
        [
          m.name,
          m.jd_text,
          m.notes,
          m.icon,
          m.color,
          m.updated_at ?? nowUtc(),
          local.id,
        ],
      );
    } else {
      summary.skippedLocalNewer.push(local.name);
    }
  }
  return local.id;
}

/** Returns the matched/created local version id, or null if skipped. */
async function reconcileVersion(
  rc: RemoteCategory,
  rv: RemoteVersion,
  categoryId: number,
  localVers: ResumeVersion[],
  summary: PullSummary,
): Promise<number | null> {
  const db = await getDb();
  const label = `${rc.meta.name}/${rv.name}`;
  const local =
    localVers.find((v) => v.category_id === categoryId && v.git_key === rv.key) ??
    localVers.find(
      (v) =>
        v.category_id === categoryId &&
        !v.git_key &&
        `${v.id}-${slugify(v.name)}` === rv.key,
    );

  if (local && !local.git_key) {
    await db.execute("UPDATE resume_versions SET git_key = $1 WHERE id = $2", [
      rv.key,
      local.id,
    ]);
    local.git_key = rv.key;
  }

  if (!local) {
    let filePath: string | null = null;
    if (rv.kind === "pdf") {
      filePath = await savePdfBytes(base64ToBytes(rv.pdfBase64!), `${rv.key}.pdf`);
    }
    const created = rv.created_at ?? rv.updated_at ?? nowUtc();
    const updated = rv.updated_at ?? created;
    const r = await db.execute(
      `INSERT INTO resume_versions (category_id, name, kind, content, file_path, notes, git_key, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [categoryId, rv.name, rv.kind, rv.text, filePath, rv.notes, rv.key, created, updated],
    );
    summary.addedVersions++;
    return r.lastInsertId as number;
  }

  if (rv.kind === "pdf") {
    const remoteBytes = base64ToBytes(rv.pdfBase64!);
    let localBytes: Uint8Array | null = null;
    if (local.file_path) {
      try {
        localBytes = await readVaultPdf(local.file_path);
      } catch {
        localBytes = null; // missing local file → treat as different
      }
    }
    if (localBytes && bytesEqual(localBytes, remoteBytes)) return local.id;
    if (remoteWins(rv.updated_at, local.updated_at)) {
      const newPath = await savePdfBytes(remoteBytes, `${rv.key}.pdf`);
      await db.execute(
        "UPDATE resume_versions SET file_path = $1, name = $2, notes = $3, updated_at = $4 WHERE id = $5",
        [newPath, rv.name, rv.notes, rv.updated_at ?? nowUtc(), local.id],
      );
      if (local.file_path) await removeVaultFile(local.file_path);
      summary.updatedVersions++;
    } else {
      summary.skippedLocalNewer.push(label);
    }
    return local.id;
  }

  // latex / tsx: textual content
  if ((local.content ?? "") === (rv.text ?? "")) return local.id;
  if (remoteWins(rv.updated_at, local.updated_at)) {
    // Never lose local words: snapshot them as a checkpoint before overwrite.
    await createCheckpoint(local.id, local.content ?? "", "pre-pull backup");
    summary.backedUpCheckpoints++;
    await db.execute(
      "UPDATE resume_versions SET content = $1, name = $2, notes = $3, updated_at = $4 WHERE id = $5",
      [rv.text, rv.name, rv.notes, rv.updated_at ?? nowUtc(), local.id],
    );
    summary.updatedVersions++;
  } else {
    summary.skippedLocalNewer.push(label);
  }
  return local.id;
}

function collectDeletionCandidates(
  localCats: JobCategory[],
  localVers: ResumeVersion[],
  matchedCatIds: Set<number>,
  matchedVerIds: Set<number>,
  summary: PullSummary,
): void {
  for (const c of localCats) {
    // Never-pushed local rows (no git_key) are not deletion candidates.
    if (!c.git_key || matchedCatIds.has(c.id)) continue;
    const versions = localVers.filter((v) => v.category_id === c.id);
    summary.deletionCandidates.push({
      kind: "category",
      label: c.name,
      apply: async () => {
        const db = await getDb();
        for (const v of versions) {
          if (v.kind === "pdf" && v.file_path) await removeVaultFile(v.file_path);
        }
        await db.execute("DELETE FROM job_categories WHERE id = $1", [c.id]);
      },
    });
  }
  for (const v of localVers) {
    if (!v.git_key || matchedVerIds.has(v.id)) continue;
    const cat = localCats.find((c) => c.id === v.category_id);
    // Versions under an unmatched category are covered by the category
    // candidate above (or the category was never pushed — leave alone).
    if (!cat || !matchedCatIds.has(cat.id)) continue;
    summary.deletionCandidates.push({
      kind: "version",
      label: `${cat.name}/${v.name}`,
      apply: async () => {
        const db = await getDb();
        if (v.kind === "pdf" && v.file_path) await removeVaultFile(v.file_path);
        await db.execute("DELETE FROM resume_versions WHERE id = $1", [v.id]);
      },
    });
  }
}
