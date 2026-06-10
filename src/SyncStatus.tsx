import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useT } from "./i18n";
import { NEEDS_PULL_MESSAGE } from "./github";
import { useClosing } from "./useClosing";

export type SyncState =
  | { kind: "idle" }
  | { kind: "syncing"; label?: string }
  | { kind: "success"; label?: string }
  | { kind: "error"; message: string };

interface SyncApi {
  state: SyncState;
  run<T>(label: string, fn: () => Promise<T>): Promise<T | null>;
  clearError: () => void;
}

const Ctx = createContext<SyncApi | null>(null);

export function useSync(): SyncApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSync must be used inside SyncProvider");
  return c;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SyncState>({ kind: "idle" });
  const successTimer = useRef<number | null>(null);

  const clearSuccessTimer = () => {
    if (successTimer.current != null) {
      window.clearTimeout(successTimer.current);
      successTimer.current = null;
    }
  };

  const clearError = useCallback(() => setState({ kind: "idle" }), []);

  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      clearSuccessTimer();
      setState({ kind: "syncing", label });
      try {
        const result = await fn();
        setState({ kind: "success", label });
        successTimer.current = window.setTimeout(
          () => setState({ kind: "idle" }),
          2200,
        );
        return result;
      } catch (e) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
        return null;
      }
    },
    [],
  );

  useEffect(() => () => clearSuccessTimer(), []);

  return (
    <Ctx.Provider value={{ state, run, clearError }}>
      {children}
      <SyncBadge state={state} onDismiss={clearError} />
    </Ctx.Provider>
  );
}

function SyncBadge({
  state,
  onDismiss,
}: {
  state: SyncState;
  onDismiss: () => void;
}) {
  const t = useT();
  const { mounted, closing } = useClosing(state.kind !== "idle");
  // Render the last non-idle state through the exit animation.
  const lastShown = useRef<SyncState>(state);
  if (state.kind !== "idle") lastShown.current = state;
  if (!mounted) return null;
  const shown = state.kind === "idle" ? lastShown.current : state;
  if (shown.kind === "idle") return null;
  const cls =
    shown.kind === "syncing"
      ? "sync-badge syncing"
      : shown.kind === "success"
        ? "sync-badge ok"
        : "sync-badge err";
  return (
    <div className={cls} data-closing={closing || undefined}>
      {shown.kind === "syncing" && (
        <>
          <span className="spin-dot" />
          <span>
            {t("github_status_syncing")}
            {shown.label ? ` — ${shown.label}` : ""}
          </span>
        </>
      )}
      {shown.kind === "success" && (
        <>
          <span className="ok-mark">✓</span>
          <span>{t("github_status_synced")}</span>
        </>
      )}
      {shown.kind === "error" && (
        <>
          <span className="err-mark">✕</span>
          <span className="err-text" title={shown.message}>
            {shown.message === NEEDS_PULL_MESSAGE
              ? t("github_needs_pull")
              : t("github_status_failed")}
          </span>
          <button className="err-close" onClick={onDismiss}>
            ✕
          </button>
        </>
      )}
    </div>
  );
}
