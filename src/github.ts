import { invoke } from "@tauri-apps/api/core";
import type { Asset, JobCategory, ResumeCheckpoint, ResumeVersion } from "./types";
import {
  getAssetByName,
  getAssetBytes,
  getCategory,
  getVersion,
  listAllAssets,
  listAssetsForVersion,
  listCategories,
  listCheckpoints,
  listVersions,
  setCategoryGitKey,
  setVersionGitKey,
} from "./db";
import { readVaultPdf } from "./vault";

export interface GitResult {
  success: boolean;
  log: string;
  needs_pull: boolean;
}

// Sentinel error message for failed pushes that require a pull first; the
// SyncBadge translates it instead of showing raw git stderr.
export const NEEDS_PULL_MESSAGE = "__NEEDS_PULL__";

export function throwGitError(r: GitResult): never {
  throw new Error(r.needs_pull ? NEEDS_PULL_MESSAGE : r.log.slice(-400));
}
export interface GitStatus {
  connected: boolean;
  head: string | null;
  remote: string | null;
}

export interface FileWrite {
  path: string;
  text?: string;
  bytes?: number[]; // serialized as JSON array
}

const K_URL = "rv.git.url";
const K_PAT = "rv.git.pat";
const K_BRANCH = "rv.git.branch";

export interface GitConfig {
  url: string;
  pat: string;
  branch: string;
}

export function loadGitConfig(): GitConfig {
  return {
    url: localStorage.getItem(K_URL) ?? "",
    pat: localStorage.getItem(K_PAT) ?? "",
    branch: localStorage.getItem(K_BRANCH) ?? "main",
  };
}

export function saveGitConfig(cfg: GitConfig): void {
  localStorage.setItem(K_URL, cfg.url);
  localStorage.setItem(K_PAT, cfg.pat);
  localStorage.setItem(K_BRANCH, cfg.branch || "main");
}

export function clearGitConfig(): void {
  localStorage.removeItem(K_URL);
  localStorage.removeItem(K_PAT);
  localStorage.removeItem(K_BRANCH);
  // legacy key, ignore failure
  localStorage.removeItem("rv.git.autosync");
}

export function isGitConnected(): boolean {
  const c = loadGitConfig();
  return c.url.length > 0 && c.pat.length > 0;
}

export async function gitConnect(cfg: GitConfig): Promise<GitResult> {
  return invoke<GitResult>("git_connect", {
    repoUrl: cfg.url,
    pat: cfg.pat,
    branch: cfg.branch || "main",
  });
}

export async function gitDisconnect(): Promise<GitResult> {
  return invoke<GitResult>("git_disconnect");
}

export async function gitStatus(): Promise<GitStatus> {
  return invoke<GitStatus>("git_status");
}

export async function gitApply(
  files: FileWrite[],
  deletes: string[],
  commitMessage: string,
  push: boolean,
): Promise<GitResult> {
  const cfg = loadGitConfig();
  return invoke<GitResult>("git_apply", {
    files,
    deletes,
    commitMessage,
    repoUrl: cfg.url,
    pat: cfg.pat,
    branch: cfg.branch || "main",
    push,
  });
}

// ───── Slug helpers ─────
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

// Remote path identity. Once a row has a git_key its repo path never moves —
// renames only change the display name inside the .json metadata.
export function categorySlug(c: {
  id: number;
  name: string;
  git_key?: string | null;
}): string {
  return c.git_key || `${c.id}-${slugify(c.name)}`;
}

export function versionSlug(v: {
  id: number;
  name: string;
  git_key?: string | null;
}): string {
  return v.git_key || `${v.id}-${slugify(v.name)}`;
}

// Lazy backfill: existing rows get their computed slug persisted as git_key
// the first time they're pushed, matching the paths already on the remote.
export async function ensureCategoryGitKey(c: JobCategory): Promise<void> {
  if (c.git_key) return;
  c.git_key = `${c.id}-${slugify(c.name)}`;
  await setCategoryGitKey(c.id, c.git_key);
}

export async function ensureVersionGitKey(v: ResumeVersion): Promise<void> {
  if (v.git_key) return;
  v.git_key = `${v.id}-${slugify(v.name)}`;
  await setVersionGitKey(v.id, v.git_key);
}

export function versionExtension(v: ResumeVersion): string {
  if (v.kind === "latex") return "tex";
  if (v.kind === "pdf") return "pdf";
  return "txt";
}

export function versionFilePath(
  c: JobCategory,
  v: ResumeVersion,
): string {
  return `categories/${categorySlug(c)}/${versionSlug(v)}.${versionExtension(v)}`;
}

export function versionMetaPath(c: JobCategory, v: ResumeVersion): string {
  return `categories/${categorySlug(c)}/${versionSlug(v)}.json`;
}

export function categoryMetaPath(c: JobCategory): string {
  return `categories/${categorySlug(c)}/_meta.json`;
}

export function versionHistoryPath(c: JobCategory, v: ResumeVersion): string {
  return `categories/${categorySlug(c)}/${versionSlug(v)}.history.json`;
}

// ───── Serialization helpers ─────
function categoryMeta(c: JobCategory): string {
  return (
    JSON.stringify(
      {
        id: c.id,
        name: c.name,
        jd_text: c.jd_text,
        notes: c.notes,
        icon: c.icon,
        color: c.color,
        created_at: c.created_at,
        updated_at: c.updated_at,
      },
      null,
      2,
    ) + "\n"
  );
}

function versionMeta(v: ResumeVersion, assetNames: string[]): string {
  return (
    JSON.stringify(
      {
        id: v.id,
        category_id: v.category_id,
        name: v.name,
        kind: v.kind,
        notes: v.notes,
        assets: assetNames,
        created_at: v.created_at,
        updated_at: v.updated_at,
      },
      null,
      2,
    ) + "\n"
  );
}

export async function versionToFiles(
  c: JobCategory,
  v: ResumeVersion,
): Promise<FileWrite[]> {
  await ensureCategoryGitKey(c);
  await ensureVersionGitKey(v);
  const assetNames = (await listAssetsForVersion(v.id)).map((a) => a.name);
  const out: FileWrite[] = [];
  out.push({ path: versionMetaPath(c, v), text: versionMeta(v, assetNames) });
  if (v.kind === "latex") {
    out.push({ path: versionFilePath(c, v), text: v.content ?? "" });
  } else if (v.kind === "pdf" && v.file_path) {
    const bytes = await readVaultPdf(v.file_path);
    out.push({ path: versionFilePath(c, v), bytes: Array.from(bytes) });
  } else if (v.content) {
    out.push({ path: versionFilePath(c, v), text: v.content });
  }
  return out;
}

// ───── Asset serialization ─────

export const ASSETS_META_PATH = "assets/_meta.json";

export function assetFilePath(name: string): string {
  return `assets/${name}`;
}

// Repo path safety: the name becomes a path segment under assets/.
export function isValidAssetName(name: string): boolean {
  return (
    name.length > 0 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.startsWith(".")
  );
}

export async function assetsMetaFile(): Promise<FileWrite> {
  const all = await listAllAssets();
  const meta: Record<
    string,
    { mime: string | null; size: number; updated_at: string }
  > = {};
  for (const a of all) {
    meta[a.name] = { mime: a.mime, size: a.size, updated_at: a.updated_at };
  }
  return { path: ASSETS_META_PATH, text: JSON.stringify(meta, null, 2) + "\n" };
}

/** null when the asset has no recoverable bytes (legacy pre-b64 rows). */
export async function assetToFile(a: Asset): Promise<FileWrite | null> {
  if (!isValidAssetName(a.name)) return null;
  const bytes = await getAssetBytes(a.id);
  if (!bytes) return null;
  return { path: assetFilePath(a.name), bytes: Array.from(bytes) };
}

// ───── Checkpoint history serialization ─────

function historyJson(cps: ResumeCheckpoint[]): string {
  const sorted = [...cps].sort((a, b) => a.seq - b.seq);
  return (
    JSON.stringify(
      {
        checkpoints: sorted.map((c) => ({
          seq: c.seq,
          note: c.note,
          created_at: c.created_at,
          content: c.content,
        })),
      },
      null,
      2,
    ) + "\n"
  );
}

/** null when the version has no checkpoints — don't create empty files. */
export async function versionHistoryFile(
  c: JobCategory,
  v: ResumeVersion,
): Promise<FileWrite | null> {
  await ensureCategoryGitKey(c);
  await ensureVersionGitKey(v);
  const cps = await listCheckpoints(v.id);
  if (cps.length === 0) return null;
  return { path: versionHistoryPath(c, v), text: historyJson(cps) };
}

/** Current meta json of a version, with git keys ensured. */
async function versionMetaFileById(versionId: number): Promise<FileWrite | null> {
  const v = await getVersion(versionId);
  if (!v) return null;
  const c = await getCategory(v.category_id);
  if (!c) return null;
  await ensureCategoryGitKey(c);
  await ensureVersionGitKey(v);
  const assetNames = (await listAssetsForVersion(v.id)).map((a) => a.name);
  return { path: versionMetaPath(c, v), text: versionMeta(v, assetNames) };
}

export async function snapshotVault(): Promise<{
  files: FileWrite[];
  index: string;
}> {
  const cats = await listCategories();
  const allFiles: FileWrite[] = [];
  const index: { categories: { slug: string; name: string; id: number }[] } = {
    categories: [],
  };
  for (const c of cats) {
    await ensureCategoryGitKey(c);
    allFiles.push({ path: categoryMetaPath(c), text: categoryMeta(c) });
    index.categories.push({
      id: c.id,
      name: c.name,
      slug: categorySlug(c),
    });
    const versions = await listVersions(c.id);
    for (const v of versions) {
      const vf = await versionToFiles(c, v);
      allFiles.push(...vf);
      if (v.kind !== "pdf") {
        const hf = await versionHistoryFile(c, v);
        if (hf) allFiles.push(hf);
      }
    }
  }
  return { files: allFiles, index: JSON.stringify(index, null, 2) + "\n" };
}

export async function syncVaultManual(): Promise<GitResult> {
  const { files, index } = await snapshotVault();
  for (const a of await listAllAssets()) {
    const f = await assetToFile(a);
    if (f) files.push(f);
  }
  files.push(await assetsMetaFile());
  files.push({ path: "vault.json", text: index });
  files.push({
    path: "README.md",
    text:
      "# Resumimi\n\nThis repository is managed by Resumimi. " +
      "Each `categories/<slug>/` folder is a job category; each `.tex` " +
      "or `.pdf` file is a resume version, with a sibling `.json` for " +
      "metadata. Edits to checkpoint history are tracked as git commits.\n",
  });
  const ts = new Date().toISOString().replace(/[T:]/g, " ").slice(0, 16);
  return gitApply(files, [], `Sync vault at ${ts}`, true);
}

export async function pushCheckpoint(
  category: JobCategory,
  version: ResumeVersion,
  note: string,
  seq: number,
): Promise<GitResult> {
  const files = await versionToFiles(category, version);
  files.push({ path: categoryMetaPath(category), text: categoryMeta(category) });
  // Bring the linked compile assets along so the checkpoint is buildable on
  // any machine; unchanged bytes are a git no-op.
  const linked = await listAssetsForVersion(version.id);
  for (const a of linked) {
    const f = await assetToFile(a);
    if (f) files.push(f);
  }
  if (linked.length > 0) files.push(await assetsMetaFile());
  // History rides along — at this point it already contains the new checkpoint.
  const hf = await versionHistoryFile(category, version);
  if (hf) files.push(hf);
  const cleanNote = (note || "").trim() || "(no note)";
  const msg = `v${seq} ${version.name} (${category.name}): ${cleanNote}`;
  return gitApply(files, [], msg, true);
}

export async function pushNewVersion(
  category: JobCategory,
  version: ResumeVersion,
): Promise<GitResult> {
  const files = await versionToFiles(category, version);
  files.push({ path: categoryMetaPath(category), text: categoryMeta(category) });
  const msg = `Add ${version.kind} version "${version.name}" (${category.name})`;
  return gitApply(files, [], msg, true);
}

export async function pushDeleteVersion(
  category: JobCategory,
  version: ResumeVersion,
): Promise<GitResult> {
  await ensureCategoryGitKey(category);
  await ensureVersionGitKey(version);
  const paths = [
    versionFilePath(category, version),
    versionMetaPath(category, version),
    versionHistoryPath(category, version),
  ];
  const msg = `Delete ${version.kind} version "${version.name}" (${category.name})`;
  return gitApply([], paths, msg, true);
}

export async function pushDeleteCategory(
  category: JobCategory,
): Promise<GitResult> {
  await ensureCategoryGitKey(category);
  const paths = [`categories/${categorySlug(category)}`];
  const msg = `Delete category "${category.name}"`;
  return gitApply([], paths, msg, true);
}

export async function pushDeleteBulk(
  paths: string[],
  summary: string,
): Promise<GitResult> {
  return gitApply([], paths, summary, true);
}

// ───── Metadata-only push triggers (rename / edit) ─────

/**
 * Push a category's _meta.json after a rename/edit. The remote directory name
 * is the git_key and intentionally never moves — only the metadata changes.
 */
export async function pushCategoryMetaUpdate(
  categoryId: number,
  commitMessage: string,
): Promise<GitResult> {
  const c = await getCategory(categoryId);
  if (!c) return { success: true, log: "category gone", needs_pull: false };
  await ensureCategoryGitKey(c);
  return gitApply(
    [{ path: categoryMetaPath(c), text: categoryMeta(c) }],
    [],
    commitMessage,
    true,
  );
}

/** Same for a version's .json — remote file stem stays put on rename. */
export async function pushVersionMetaUpdate(
  versionId: number,
  commitMessage: string,
): Promise<GitResult> {
  const mf = await versionMetaFileById(versionId);
  if (!mf) return { success: true, log: "version gone", needs_pull: false };
  return gitApply([mf], [], commitMessage, true);
}

// ───── Asset push triggers ─────

/**
 * Upload/replace: push the named assets plus the meta index. When the upload
 * happened inside AttachmentsModal the version's meta json rides along (its
 * assets list gained entries).
 */
export async function pushAssetsUpsert(
  names: string[],
  commitMessage: string,
  versionId?: number,
): Promise<GitResult> {
  const files: FileWrite[] = [];
  for (const name of names) {
    if (!isValidAssetName(name)) continue;
    const a = await getAssetByName(name);
    if (!a) continue;
    const f = await assetToFile(a);
    if (f) files.push(f);
  }
  files.push(await assetsMetaFile());
  if (versionId != null) {
    const mf = await versionMetaFileById(versionId);
    if (mf) files.push(mf);
  }
  return gitApply(files, [], commitMessage, true);
}

export async function pushAssetRename(
  oldName: string,
  newName: string,
  affectedVersionIds: number[],
): Promise<GitResult> {
  const files: FileWrite[] = [];
  const a = await getAssetByName(newName);
  if (a) {
    const f = await assetToFile(a);
    if (f) files.push(f);
  }
  files.push(await assetsMetaFile());
  for (const vid of affectedVersionIds) {
    const mf = await versionMetaFileById(vid);
    if (mf) files.push(mf);
  }
  const deletes = isValidAssetName(oldName) ? [assetFilePath(oldName)] : [];
  return gitApply(
    files,
    deletes,
    `Rename asset "${oldName}" → "${newName}"`,
    true,
  );
}

export async function pushAssetDelete(
  name: string,
  affectedVersionIds: number[],
): Promise<GitResult> {
  const files: FileWrite[] = [await assetsMetaFile()];
  for (const vid of affectedVersionIds) {
    const mf = await versionMetaFileById(vid);
    if (mf) files.push(mf);
  }
  const deletes = isValidAssetName(name) ? [assetFilePath(name)] : [];
  return gitApply(files, deletes, `Delete asset "${name}"`, true);
}

/**
 * Re-push a version's checkpoint history after a local deletion. Writes the
 * file even when the list is now empty so the remote shrinks accordingly.
 */
export async function pushHistoryUpdate(
  versionId: number,
  commitMessage: string,
): Promise<GitResult> {
  const v = await getVersion(versionId);
  const c = v ? await getCategory(v.category_id) : null;
  if (!v || !c) return { success: true, log: "version gone", needs_pull: false };
  await ensureCategoryGitKey(c);
  await ensureVersionGitKey(v);
  const cps = await listCheckpoints(v.id);
  const file = { path: versionHistoryPath(c, v), text: historyJson(cps) };
  return gitApply([file], [], commitMessage, true);
}

/** link / unlink only — the version's assets list is part of its meta json. */
export async function pushAttachmentsUpdate(
  versionId: number,
  versionName: string,
): Promise<GitResult> {
  const files: FileWrite[] = [];
  const mf = await versionMetaFileById(versionId);
  if (mf) files.push(mf);
  return gitApply(files, [], `Update attachments of "${versionName}"`, true);
}
