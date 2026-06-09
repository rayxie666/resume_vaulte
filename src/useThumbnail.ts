import { useEffect, useState } from "react";
import type { ResumeVersion } from "./types";
import { readVaultPdf } from "./vault";
import { renderPdfThumbnail } from "./thumbnail";
import { getThumbnail, setThumbnail, setThumbnailFailure } from "./thumbCache";

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
  throw new Error("kind unsupported for thumbnail");
}

export type ThumbState = "loading" | "ready" | "failed" | "skipped";

// Bump when the rendering pipeline changes so stale failure markers are invalidated.
const THUMB_PIPELINE_VERSION = "v3";

// Only render thumbnails for kinds where the source is already a PDF.
// tsx/latex thumbnails are skipped to keep the version list responsive.
const SUPPORTED_KINDS = new Set<ResumeVersion["kind"]>(["pdf"]);

export function useThumbnail(version: ResumeVersion): {
  url: string | null;
  state: ThumbState;
} {
  const supported = SUPPORTED_KINDS.has(version.kind);
  const signature = `${THUMB_PIPELINE_VERSION}.${version.updated_at}`;
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
