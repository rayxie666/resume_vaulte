import { invoke } from "@tauri-apps/api/core";
import type { JobCategory, ResumeVersion } from "./types";
import { listCategories, listVersions } from "./db";
import { readVaultPdf } from "./vault";

export interface GitResult {
  success: boolean;
  log: string;
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

export function categorySlug(c: { id: number; name: string }): string {
  return `${c.id}-${slugify(c.name)}`;
}

export function versionSlug(v: { id: number; name: string }): string {
  return `${v.id}-${slugify(v.name)}`;
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

function versionMeta(v: ResumeVersion): string {
  return (
    JSON.stringify(
      {
        id: v.id,
        category_id: v.category_id,
        name: v.name,
        kind: v.kind,
        notes: v.notes,
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
  const out: FileWrite[] = [];
  out.push({ path: versionMetaPath(c, v), text: versionMeta(v) });
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
    }
  }
  return { files: allFiles, index: JSON.stringify(index, null, 2) + "\n" };
}

export async function syncVaultManual(): Promise<GitResult> {
  const { files, index } = await snapshotVault();
  files.push({ path: "vault.json", text: index });
  files.push({
    path: "README.md",
    text:
      "# Resume Vault\n\nThis repository is managed by Resume Vault. " +
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
  const paths = [versionFilePath(category, version), versionMetaPath(category, version)];
  const msg = `Delete ${version.kind} version "${version.name}" (${category.name})`;
  return gitApply([], paths, msg, true);
}

export async function pushDeleteCategory(
  category: JobCategory,
): Promise<GitResult> {
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
