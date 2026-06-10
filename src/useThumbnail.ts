import { useEffect, useState } from "react";
import type { ResumeVersion } from "./types";
import { readVaultPdf } from "./vault";
import { renderPdfThumbnail } from "./thumbnail";
import { getThumbnail, setThumbnail, setThumbnailFailure } from "./thumbCache";
import {
  bytesToBase64,
  compileLatex,
  pdfBytesFromResult,
  type CompileAsset,
} from "./latexCompile";
import { getAssetBytes, getAssetByName, listAssetsForVersion } from "./db";
import { findReferencedAssets } from "./assetScan";

type Job = () => Promise<void>;
let queue: Job[] = [];
let active = 0;
const MAX_CONCURRENT = 2;

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift()!;
    active++;
    job().finally(() => {
      active--;
      pump();
    });
  }
}

function schedule(job: Job) {
  queue.push(job);
  pump();
}

async function fetchPdfBytes(version: ResumeVersion): Promise<Uint8Array> {
  if (version.kind === "pdf" && version.file_path) {
    return readVaultPdf(version.file_path);
  }
  if (version.kind === "latex") {
    const source = version.content ?? "";
    if (!source.trim()) throw new Error("empty latex source");
    // Linked assets ∪ source-referenced assets found in the global library —
    // mirrors the editor's compile bundle so unlinked-but-available images
    // don't fail the thumbnail.
    const rows = await listAssetsForVersion(version.id);
    const byName = new Map(rows.map((a) => [a.name, a]));
    for (const name of findReferencedAssets(source)) {
      if (byName.has(name)) continue;
      const found =
        (await getAssetByName(name)) ??
        (await getAssetByName(`${name}.png`)) ??
        (await getAssetByName(`${name}.jpg`)) ??
        (await getAssetByName(`${name}.pdf`));
      if (found && !byName.has(found.name)) byName.set(found.name, found);
    }
    const assets: CompileAsset[] = [];
    for (const a of byName.values()) {
      const bytes = await getAssetBytes(a.id);
      if (bytes) assets.push({ name: a.name, bytesBase64: bytesToBase64(bytes) });
    }
    const result = await compileLatex(source, assets);
    const pdf = pdfBytesFromResult(result);
    if (!pdf) throw new Error("latex compile failed");
    return pdf;
  }
  throw new Error("kind unsupported for thumbnail");
}

export type ThumbState = "loading" | "ready" | "failed" | "skipped";

// Bump when the rendering pipeline changes so stale failure markers are invalidated.
const THUMB_PIPELINE_VERSION = "v4";

/** Cache signature for a version's thumbnail — shared with the editor, which
 * stores a screenshot of every successful preview render under this key. */
export function thumbSignature(updatedAt: string): string {
  return `${THUMB_PIPELINE_VERSION}.${updatedAt}`;
}

// PDF: read straight from vault. LaTeX: compile on demand, throttled by the
// queue below so a long version list doesn't fan out into many concurrent
// tectonic processes. tsx is still skipped (no compile path).
const SUPPORTED_KINDS = new Set<ResumeVersion["kind"]>(["pdf", "latex"]);

export function useThumbnail(version: ResumeVersion): {
  url: string | null;
  state: ThumbState;
} {
  const supported = SUPPORTED_KINDS.has(version.kind);
  const signature = thumbSignature(version.updated_at);
  const initial = (() => {
    if (!supported) return { url: null, state: "skipped" as const };
    const r = getThumbnail(version.id, signature);
    if (r.status === "hit") return { url: r.dataUrl, state: "ready" as const };
    if (r.status === "fail") return { url: null, state: "failed" as const };
    return { url: null, state: "loading" as const };
  })();
  const [url, setUrl] = useState<string | null>(initial.url);
  const [state, setState] = useState<ThumbState>(initial.state);

  useEffect(() => {
    if (!supported) {
      setUrl(null);
      setState("skipped");
      return;
    }

    const cached = getThumbnail(version.id, signature);
    if (cached.status === "hit") {
      setUrl(cached.dataUrl);
      setState("ready");
      return;
    }
    if (cached.status === "fail") {
      setUrl(null);
      setState("failed");
      return;
    }

    setUrl(null);
    setState("loading");
    let cancelled = false;

    schedule(async () => {
      if (cancelled) return;
      try {
        const bytes = await fetchPdfBytes(version);
        if (cancelled) return;
        const dataUrl = await renderPdfThumbnail(bytes, 240);
        if (cancelled) return;
        setThumbnail(version.id, signature, dataUrl);
        setUrl(dataUrl);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        console.warn(
          `[thumbnail v${version.id} (${version.kind}) "${version.name}"] failed:`,
          err,
        );
        setThumbnailFailure(version.id, signature);
        setState("failed");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    version.id,
    signature,
    version.kind,
    version.content,
    version.file_path,
    supported,
  ]);

  return { url, state };
}
