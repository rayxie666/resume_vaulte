// Legacy build on purpose: the modern build of pdfjs-dist 6.x uses
// Map.prototype.getOrInsertComputed, which this app's WKWebView doesn't
// ship yet — every render died with a TypeError. The legacy build
// transpiles such features away.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import PdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs?worker";

export async function renderPdfThumbnail(
  bytes: Uint8Array,
  maxDim = 240,
): Promise<string> {
  // pdfjs may mutate the buffer; copy to be safe.
  const buf = new Uint8Array(bytes);
  // One private worker per render. A shared GlobalWorkerOptions.workerPort
  // breaks here: pdf.js forbids two concurrent documents on one port, and
  // loadingTask.destroy() tears the shared port down for every later call —
  // after the first thumbnail, all renders failed.
  const port = new PdfWorker();
  // pdfjs-dist 6.x ships a broken constructor type (`port?: null`) that
  // contradicts its own @property {Worker} [port] docs — cast around it.
  const worker = new pdfjsLib.PDFWorker({ port: port as unknown as null });
  const loadingTask = pdfjsLib.getDocument({ data: buf, worker });
  try {
    const doc = await loadingTask.promise;
    const page = await doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(maxDim / vp1.width, maxDim / vp1.height);
    // Render at 2x for crispness on hi-DPI displays, then export at logical size.
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const viewport = page.getViewport({ scale: scale * dpr });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // pdfjs 6.x: pass `canvas`; `canvasContext` is legacy and produces
    // warnings when paired with a non-null `canvas`.
    await page.render({ canvas, viewport }).promise;
    return canvas.toDataURL("image/png");
  } finally {
    await loadingTask.destroy().catch(() => undefined);
    worker.destroy();
    port.terminate();
  }
}
