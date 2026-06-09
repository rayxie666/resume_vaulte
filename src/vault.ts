import {
  BaseDirectory,
  mkdir,
  readFile,
  writeFile,
  remove,
  exists,
} from "@tauri-apps/plugin-fs";
import { open, save } from "@tauri-apps/plugin-dialog";

const PDF_DIR = "pdfs";

async function ensurePdfDir(): Promise<void> {
  const has = await exists(PDF_DIR, { baseDir: BaseDirectory.AppData });
  if (!has) await mkdir(PDF_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
}

function randomId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

export async function importPdfFromDialog(): Promise<{
  storedPath: string;
  originalName: string;
} | null> {
  const picked = await open({
    multiple: false,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!picked || typeof picked !== "string") return null;
  await ensurePdfDir();
  const fname = picked.split("/").pop() || "resume.pdf";
  const stored = `${PDF_DIR}/${randomId()}_${fname}`;
  const bytes = await readFile(picked);
  await writeFile(stored, bytes, { baseDir: BaseDirectory.AppData });
  return { storedPath: stored, originalName: fname };
}

export async function readVaultPdf(relPath: string): Promise<Uint8Array> {
  return readFile(relPath, { baseDir: BaseDirectory.AppData });
}

export async function exportFileToDialog(
  bytes: Uint8Array,
  suggestedName: string,
  extension: string,
): Promise<boolean> {
  const target = await save({
    defaultPath: suggestedName,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
  if (!target) return false;
  await writeFile(target, bytes);
  return true;
}

export async function removeVaultFile(relPath: string): Promise<void> {
  try {
    await remove(relPath, { baseDir: BaseDirectory.AppData });
  } catch {
    // ignore missing file
  }
}

export async function savePdfBytes(bytes: Uint8Array, suggestedName: string): Promise<string> {
  await ensurePdfDir();
  const stored = `${PDF_DIR}/${randomId()}_${suggestedName}`;
  await writeFile(stored, bytes, { baseDir: BaseDirectory.AppData });
  return stored;
}
