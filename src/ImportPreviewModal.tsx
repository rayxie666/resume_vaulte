// Resume-import preview modal — see spec/2026-06-13-import-to-latex.md §5.
//
// State machine: extracting → analyzing → generating → previewing (or `error`).
// The left pane shows the read-only generated LaTeX, the right pane shows the
// Tectonic-compiled PDF (or the log on failure). On "accept" we hand the .tex
// back to the caller; the caller is responsible for `createVersion(...)`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiError } from "./ai";
import CodeEditor from "./CodeEditor";
import { compileLatex } from "./latexCompile";
import {
  importDocumentToLatex,
  type ImportPhase,
  type ImportResult,
} from "./importToLatex";
import { useT } from "./i18n";
import { useModalExit } from "./useClosing";

interface Props {
  filePath: string;
  originalName: string;
  onAccept: (result: { tex: string; suggestedName: string }) => void;
  onClose: () => void;
}

type Phase = ImportPhase | "previewing" | "error";

const MAX_RETRIES = 3;

export default function ImportPreviewModal({
  filePath,
  originalName,
  onAccept,
  onClose,
}: Props) {
  const t = useT();
  const { closing, close } = useModalExit(onClose);
  const [phase, setPhase] = useState<Phase>("extracting");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retries, setRetries] = useState(0);
  // Compile right-pane state — independent from the AI generation phase.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [compileLog, setCompileLog] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const runIdRef = useRef(0);

  const startGenerate = useCallback(() => {
    const id = ++runIdRef.current;
    setResult(null);
    setErrorMsg(null);
    setPdfUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setCompileLog(null);
    setPhase("extracting");
    (async () => {
      try {
        const r = await importDocumentToLatex(filePath, {
          onPhase: (p) => {
            if (id === runIdRef.current) setPhase(p);
          },
        });
        if (id !== runIdRef.current) return;
        setResult(r);
        setPhase("previewing");
      } catch (e) {
        if (id !== runIdRef.current) return;
        setErrorMsg(humanizeError(e, t));
        setPhase("error");
      }
    })();
  }, [filePath, t]);

  // Kick off the very first run on mount.
  useEffect(() => {
    startGenerate();
    return () => {
      runIdRef.current = -1;
      setPdfUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compile the .tex into a PDF for the right pane whenever a new result
  // arrives. Re-runs on retry because `result` is a new object reference.
  useEffect(() => {
    if (phase !== "previewing" || !result) return;
    let cancelled = false;
    setCompiling(true);
    setCompileLog(null);
    (async () => {
      try {
        const r = await compileLatex(result.tex, []);
        if (cancelled) return;
        if (r.success && r.pdf) {
          const bytes = new Uint8Array(r.pdf);
          const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
          const url = URL.createObjectURL(blob);
          setPdfUrl((old) => {
            if (old) URL.revokeObjectURL(old);
            return url;
          });
          setCompileLog(null);
        } else {
          setPdfUrl((old) => {
            if (old) URL.revokeObjectURL(old);
            return null;
          });
          setCompileLog(r.log || t("compile_error"));
        }
      } catch (err) {
        if (cancelled) return;
        setCompileLog(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setCompiling(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, result, t]);

  const accept = useCallback(() => {
    if (!result) return;
    const suggested = `${t("import_resume_default_name_prefix")}${stripExt(originalName)}`;
    onAccept({ tex: result.tex, suggestedName: suggested });
  }, [originalName, onAccept, result, t]);

  const retry = useCallback(() => {
    if (retries >= MAX_RETRIES) return;
    setRetries((n) => n + 1);
    startGenerate();
  }, [retries, startGenerate]);

  const headerLabel = useMemo(() => phaseLabel(phase, t), [phase, t]);

  const canAccept = phase === "previewing" && !!result && !!pdfUrl && !compileLog;
  const canRetry =
    phase === "previewing" || phase === "error"
      ? retries < MAX_RETRIES
      : false;

  return (
    <div
      className="modal-backdrop"
      data-closing={closing || undefined}
      onClick={close}
    >
      <div
        className="modal import-preview"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="import-preview-head">
          <div className="import-preview-titles">
            <h3>{t("import_resume_title")}</h3>
            <div className="import-preview-sub">
              <span className="import-preview-file">{originalName}</span>
              <span className="import-preview-sep">·</span>
              <span className="import-preview-phase">{headerLabel}</span>
              {result && (
                <>
                  <span className="import-preview-sep">·</span>
                  <span className="import-preview-badge">
                    {result.templateChoice === "builtin-resume-cls"
                      ? t("import_template_builtin")
                      : t("import_template_custom")}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {phase !== "previewing" && phase !== "error" && (
          <div className="import-preview-progress">
            <div className="spinner-ring" />
            <div className="import-preview-progress-text">{headerLabel}</div>
            <div className="import-preview-progress-hint">
              {t("import_privacy_hint")}
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="import-preview-error">
            <div className="import-preview-error-title">
              {t("import_failed_title")}
            </div>
            <pre className="error-log">{errorMsg}</pre>
          </div>
        )}

        {phase === "previewing" && result && (
          <div className="import-preview-body">
            <div className="import-preview-tex">
              <div className="import-preview-pane-head">
                {t("import_pane_tex")}
              </div>
              <div className="import-preview-pane-body">
                <CodeEditor value={result.tex} onChange={() => {}} readOnly />
              </div>
            </div>
            <div className="import-preview-pdf">
              <div className="import-preview-pane-head">
                {t("import_pane_pdf")}
                {compiling && (
                  <span className="import-preview-compiling">
                    {t("rendering")}
                  </span>
                )}
              </div>
              <div className="import-preview-pane-body">
                {pdfUrl ? (
                  <iframe
                    className="pdf-frame"
                    src={pdfUrl}
                    title="import-preview-pdf"
                  />
                ) : compileLog ? (
                  <textarea
                    className="error-log"
                    readOnly
                    spellCheck={false}
                    value={compileLog}
                  />
                ) : (
                  <div className="placeholder">{t("rendering")}</div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="modal-actions import-preview-actions">
          <div className="import-preview-privacy">{t("import_privacy_hint")}</div>
          <span className="grow" />
          <button onClick={close}>{t("cancel")}</button>
          <button
            onClick={retry}
            disabled={!canRetry}
            title={
              retries >= MAX_RETRIES
                ? t("import_retries_exhausted")
                : t("import_retry_hint")
            }
          >
            {t("import_retry")}
            {retries > 0 && ` (${retries}/${MAX_RETRIES})`}
          </button>
          <button
            className="primary"
            onClick={accept}
            disabled={!canAccept}
            title={!canAccept ? t("import_accept_disabled_hint") : undefined}
          >
            {t("import_accept")}
          </button>
        </div>
      </div>
    </div>
  );
}

function phaseLabel(p: Phase, t: ReturnType<typeof useT>): string {
  switch (p) {
    case "extracting": return t("import_phase_extracting");
    case "analyzing": return t("import_phase_analyzing");
    case "generating": return t("import_phase_generating");
    case "previewing": return t("import_phase_previewing");
    case "error": return t("import_phase_error");
  }
}

function humanizeError(e: unknown, t: ReturnType<typeof useT>): string {
  if (e instanceof AiError) {
    switch (e.code) {
      case "not_configured": return t("ai_not_configured");
      case "auth": return t("ai_err_auth");
      case "rate": return t("ai_err_rate");
      case "network": return t("ai_err_network");
      case "no_cli": return t("ai_err_no_cli");
      case "empty": return e.log || t("ai_err_empty");
      case "too_long": return t("ai_err_too_long");
      default: return e.log || String(e.code);
    }
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}
