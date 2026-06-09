import Database from "@tauri-apps/plugin-sql";
import type {
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
