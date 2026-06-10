import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

export async function renderPdfThumbnail(
  bytes: Uint8Array,
  maxDim = 240,
): Promise<string> {
  // pdfjs may mutate the buffer; copy to be safe.
  const buf = new Uint8Array(bytes);
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  const doc = await loadingTask.promise;
  try {
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
    await loadingTask.destroy();
  }
}
