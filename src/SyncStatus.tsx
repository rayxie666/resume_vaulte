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
  if (state.kind === "idle") return null;
  const cls =
    state.kind === "syncing"
      ? "sync-badge syncing"
      : state.kind === "success"
        ? "sync-badge ok"
        : "sync-badge err";
  return (
    <div className={cls}>
      {state.kind === "syncing" && (
        <>
          <span className="spin-dot" />
          <span>
            {t("github_status_syncing")}
            {state.label ? ` — ${state.label}` : ""}
          </span>
        </>
      )}
      {state.kind === "success" && (
        <>
          <span className="ok-mark">✓</span>
          <span>{t("github_status_synced")}</span>
        </>
      )}
      {state.kind === "error" && (
        <>
          <span className="err-mark">✕</span>
          <span className="err-text" title={state.message}>
            {t("github_status_failed")}
          </span>
          <button className="err-close" onClick={onDismiss}>
            ✕
          </button>
        </>
      )}
    </div>
  );
}
