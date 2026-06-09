import { invoke } from "@tauri-apps/api/core";

export interface CompileResult {
  success: boolean;
  pdf: number[] | null;
  log: string;
}

export interface CompileAsset {
  name: string;
  bytesBase64: string;
}

export async function compileLatex(
  source: string,
  assets: CompileAsset[] = [],
): Promise<CompileResult> {
  return invoke<CompileResult>("compile_latex", {
    req: { source, assets },
  });
}

export async function isTectonicAvailable(): Promise<boolean> {
  return invoke<boolean>("tectonic_available");
}

export function pdfBytesFromResult(r: CompileResult): Uint8Array | null {
  if (!r.pdf) return null;
  return new Uint8Array(r.pdf);
}

export function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to avoid call-stack issues on large buffers.
  const chunk = 0x8000;
  let s = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
