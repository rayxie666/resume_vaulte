import { invoke } from "@tauri-apps/api/core";

export interface CompileResult {
  success: boolean;
  pdf: number[] | null;
  log: string;
}

export async function compileLatex(source: string): Promise<CompileResult> {
  return invoke<CompileResult>("compile_latex", { source });
}

export async function isTectonicAvailable(): Promise<boolean> {
  return invoke<boolean>("tectonic_available");
}

export function pdfBytesFromResult(r: CompileResult): Uint8Array | null {
  if (!r.pdf) return null;
  return new Uint8Array(r.pdf);
}
