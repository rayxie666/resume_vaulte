import Database from "@tauri-apps/plugin-sql";
import { base64ToBytes, bytesToBase64 } from "./latexCompile";
import type {
  Asset,
  AssetUsage,
  JobCategory,
  ResumeCheckpoint,
  ResumeKind,
  ResumeVersion,
} from "./types";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = Database.load("sqlite:vault.db");
  return dbPromise;
}

const nowSql = "datetime('now')";

export async function listCategories(): Promise<JobCategory[]> {
  const db = await getDb();
  return db.select<JobCategory[]>(
    "SELECT * FROM job_categories ORDER BY updated_at DESC",
  );
}

export async function createCategory(
  name: string,
  jd_text: string,
  icon?: string,
  color?: string,
): Promise<number> {
  const db = await getDb();
  const r = await db.execute(
    "INSERT INTO job_categories (name, jd_text, icon, color) VALUES ($1, $2, $3, $4)",
    [name, jd_text || null, icon || null, color || null],
  );
  return r.lastInsertId as number;
}

export async function updateCategory(
  id: number,
  patch: Partial<Pick<JobCategory, "name" | "jd_text" | "notes" | "icon" | "color">>,
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = $${i++}`);
    values.push(v);
  }
  if (!fields.length) return;
  fields.push(`updated_at = ${nowSql}`);
  values.push(id);
  await db.execute(
    `UPDATE job_categories SET ${fields.join(", ")} WHERE id = $${i}`,
    values,
  );
}

export async function deleteCategory(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM job_categories WHERE id = $1", [id]);
}

export async function getCategory(id: number): Promise<JobCategory | null> {
  const db = await getDb();
  const rows = await db.select<JobCategory[]>(
    "SELECT * FROM job_categories WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export async function getVersion(id: number): Promise<ResumeVersion | null> {
  const db = await getDb();
  const rows = await db.select<ResumeVersion[]>(
    "SELECT * FROM resume_versions WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export async function countVersionsByCategory(): Promise<Record<number, number>> {
  const db = await getDb();
  const rows = await db.select<{ category_id: number; n: number }[]>(
    "SELECT category_id, COUNT(*) as n FROM resume_versions GROUP BY category_id",
  );
  const out: Record<number, number> = {};
  for (const r of rows) out[r.category_id] = r.n;
  return out;
}

export async function listVersions(
  categoryId: number,
): Promise<ResumeVersion[]> {
  const db = await getDb();
  return db.select<ResumeVersion[]>(
    "SELECT * FROM resume_versions WHERE category_id = $1 ORDER BY updated_at DESC",
    [categoryId],
  );
}

export async function createVersion(v: {
  category_id: number;
  name: string;
  kind: ResumeKind;
  content?: string | null;
  file_path?: string | null;
  notes?: string | null;
}): Promise<number> {
  const db = await getDb();
  const r = await db.execute(
    `INSERT INTO resume_versions (category_id, name, kind, content, file_path, notes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      v.category_id,
      v.name,
      v.kind,
      v.content ?? null,
      v.file_path ?? null,
      v.notes ?? null,
    ],
  );
  return r.lastInsertId as number;
}

export async function updateVersion(
  id: number,
  patch: Partial<Pick<ResumeVersion, "name" | "content" | "notes">>,
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = $${i++}`);
    values.push(v);
  }
  if (!fields.length) return;
  fields.push(`updated_at = ${nowSql}`);
  values.push(id);
  await db.execute(
    `UPDATE resume_versions SET ${fields.join(", ")} WHERE id = $${i}`,
    values,
  );
}

export async function deleteVersion(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM resume_versions WHERE id = $1", [id]);
}

export async function listAllVersions(): Promise<ResumeVersion[]> {
  const db = await getDb();
  return db.select<ResumeVersion[]>("SELECT * FROM resume_versions");
}

// git_key backfills deliberately skip the updated_at bump: assigning a remote
// path identity is not a content edit and must not affect pull reconciliation.
export async function setCategoryGitKey(id: number, key: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE job_categories SET git_key = $1 WHERE id = $2", [key, id]);
}

export async function setVersionGitKey(id: number, key: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE resume_versions SET git_key = $1 WHERE id = $2", [key, id]);
}

export async function listCheckpoints(
  versionId: number,
): Promise<ResumeCheckpoint[]> {
  const db = await getDb();
  return db.select<ResumeCheckpoint[]>(
    "SELECT * FROM resume_checkpoints WHERE version_id = $1 ORDER BY seq DESC",
    [versionId],
  );
}

export async function createCheckpoint(
  versionId: number,
  content: string,
  note: string | null,
): Promise<number> {
  const db = await getDb();
  const row = await db.select<{ next: number }[]>(
    "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM resume_checkpoints WHERE version_id = $1",
    [versionId],
  );
  const next = row[0]?.next ?? 1;
  const r = await db.execute(
    "INSERT INTO resume_checkpoints (version_id, seq, content, note) VALUES ($1, $2, $3, $4)",
    [versionId, next, content, note],
  );
  return r.lastInsertId as number;
}

export async function deleteCheckpoint(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM resume_checkpoints WHERE id = $1", [id]);
}

// ───── assets (global) + resume_version_assets (junction) ─────

interface AssetBytesRow {
  bytes_b64: string | null;
  bytes: number[] | Uint8Array | null;
}

export async function listAllAssets(): Promise<AssetUsage[]> {
  const db = await getDb();
  return db.select<AssetUsage[]>(
    "SELECT a.id, a.name, a.size, a.mime, a.created_at, a.updated_at, \
            COALESCE((SELECT COUNT(*) FROM resume_version_assets v WHERE v.asset_id = a.id), 0) AS usage_count \
     FROM assets a ORDER BY a.name ASC",
  );
}

export async function listAssetsForVersion(
  versionId: number,
): Promise<Asset[]> {
  const db = await getDb();
  return db.select<Asset[]>(
    "SELECT a.id, a.name, a.size, a.mime, a.created_at, a.updated_at \
     FROM assets a JOIN resume_version_assets v ON v.asset_id = a.id \
     WHERE v.version_id = $1 ORDER BY a.name ASC",
    [versionId],
  );
}

export async function getAssetByName(name: string): Promise<Asset | null> {
  const db = await getDb();
  const rows = await db.select<Asset[]>(
    "SELECT id, name, size, mime, created_at, updated_at FROM assets WHERE name = $1",
    [name],
  );
  return rows[0] ?? null;
}

export async function getAssetBytes(id: number): Promise<Uint8Array | null> {
  const db = await getDb();
  const rows = await db.select<AssetBytesRow[]>(
    "SELECT bytes_b64, bytes FROM assets WHERE id = $1",
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.bytes_b64) return base64ToBytes(row.bytes_b64);
  // Legacy fallback: pre-v8 rows have raw BLOB. tauri-plugin-sql cannot
  // round-trip true binary, so these are likely corrupt and the user must
  // re-upload. Returning the bytes verbatim lets the UI show "size" but
  // compile will fail with a clear "PNG header" error.
  if (!row.bytes) return null;
  if (row.bytes instanceof Uint8Array) return row.bytes;
  return new Uint8Array(row.bytes);
}

function inferMime(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "svg": return "image/svg+xml";
    case "pdf": return "application/pdf";
    case "eps": return "application/postscript";
    default: return null;
  }
}

/// Upsert a global asset by name (replaces bytes if name already exists).
///
/// Stores bytes as base64 in `bytes_b64` to avoid tauri-plugin-sql's broken
/// BLOB binding for `number[]` payloads. The legacy `bytes` BLOB column is
/// kept non-NULL (empty blob) only because pre-v8 schema declared NOT NULL.
export async function upsertAsset(
  name: string,
  bytes: Uint8Array,
): Promise<number> {
  const db = await getDb();
  const b64 = bytesToBase64(bytes);
  await db.execute(
    "INSERT INTO assets (name, bytes, bytes_b64, size, mime) \
     VALUES ($1, x'', $2, $3, $4) \
     ON CONFLICT(name) DO UPDATE SET \
       bytes_b64 = excluded.bytes_b64, \
       size = excluded.size, \
       mime = excluded.mime, \
       updated_at = datetime('now')",
    [name, b64, bytes.length, inferMime(name)],
  );
  const r = await db.select<{ id: number }[]>(
    "SELECT id FROM assets WHERE name = $1",
    [name],
  );
  return r[0]?.id ?? 0;
}

export async function renameAsset(id: number, newName: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE assets SET name = $1, mime = $2, updated_at = datetime('now') WHERE id = $3",
    [newName, inferMime(newName), id],
  );
}

export async function deleteAsset(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM assets WHERE id = $1", [id]);
}

export async function linkAssetToVersion(
  versionId: number,
  assetId: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR IGNORE INTO resume_version_assets (version_id, asset_id) VALUES ($1, $2)",
    [versionId, assetId],
  );
}

export async function unlinkAssetFromVersion(
  versionId: number,
  assetId: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM resume_version_assets WHERE version_id = $1 AND asset_id = $2",
    [versionId, assetId],
  );
}

export async function listVersionIdsForAsset(
  assetId: number,
): Promise<number[]> {
  const db = await getDb();
  const rows = await db.select<{ version_id: number }[]>(
    "SELECT version_id FROM resume_version_assets WHERE asset_id = $1",
    [assetId],
  );
  return rows.map((r) => r.version_id);
}

export async function assetUsageCount(assetId: number): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM resume_version_assets WHERE asset_id = $1",
    [assetId],
  );
  return rows[0]?.n ?? 0;
}
