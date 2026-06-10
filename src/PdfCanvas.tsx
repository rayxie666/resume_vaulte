import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// Worker already registered in src/thumbnail.ts via side-effect import.
import "./thumbnail";

type PDFDocumentProxy = Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;
const RENDER_SCALE_MULT = 1.5; // render at higher pixel density for sharpness

export default function PdfCanvas({ bytes }: { bytes: Uint8Array }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [zoom, setZoom] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    setErr(null);
    setDoc(null);
    (async () => {
      try {
        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
        const d = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy();
          return;
        }
        setDoc(d);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      loadingTask?.destroy().catch(() => {});
    };
  }, [bytes]);

  // Trackpad pinch on macOS / Ctrl+wheel on other platforms.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom((z) => {
        const next = z * Math.pow(0.99, e.deltaY);
        return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keyboard shortcuts: Cmd/Ctrl +/-/0
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setZoom((z) => Math.min(MAX_ZOOM, z * 1.1));
      } else if (e.key === "-") {
        e.preventDefault();
        setZoom((z) => Math.max(MIN_ZOOM, z / 1.1));
      } else if (e.key === "0") {
        e.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pageNumbers = doc
    ? Array.from({ length: doc.numPages }, (_, i) => i + 1)
    : [];

  return (
    <div className="pdf-canvas-root" ref={wrapRef}>
      <div className="zoom-toolbar">
        <button
          className="zoom-btn"
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.1))}
          title="Zoom out"
        >
          −
        </button>
        <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
        <button
          className="zoom-btn"
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.1))}
          title="Zoom in"
        >
          +
        </button>
        <button
          className="zoom-btn"
          onClick={() => setZoom(1)}
          title="Reset"
        >
          1:1
        </button>
      </div>
      <div className="pdf-scroll">
        {err && <div className="pdf-error">{err}</div>}
        {!err &&
          doc &&
          pageNumbers.map((n) => (
            <PdfPage
              key={n}
              doc={doc}
              pageIndex={n}
              zoom={zoom}
            />
          ))}
      </div>
    </div>
  );
}

function PdfPage({
  doc,
  pageIndex,
  zoom,
}: {
  doc: PDFDocumentProxy;
  pageIndex: number;
  zoom: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Snap render scale to discrete steps so we don't re-rasterize on every
  // pinch frame; visual size is then adjusted via CSS scale between snaps.
  const renderScale = snapRenderScale(zoom);
  const cssScale = zoom / renderScale;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageIndex);
        const viewport = page.getViewport({
          scale: renderScale * RENDER_SCALE_MULT,
        });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvasContext: ctx,
          viewport,
          canvas,
        }).promise;
      } catch (e) {
        console.warn("[pdf page render]", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex, renderScale]);

  return (
    <div className="pdf-page-wrap">
      <canvas
        ref={canvasRef}
        className="pdf-page-canvas"
        style={{
          transform: `scale(${cssScale / RENDER_SCALE_MULT})`,
          transformOrigin: "top left",
        }}
      />
    </div>
  );
}

function snapRenderScale(zoom: number): number {
  // Render canvas at coarse steps; CSS scales between them.
  if (zoom <= 0.75) return 0.6;
  if (zoom <= 1.5) return 1;
  if (zoom <= 2.5) return 2;
  return 3;
}
