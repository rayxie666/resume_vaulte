import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type PromptOpts = {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
};
type ConfirmOpts = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

interface DialogApi {
  prompt: (opts: PromptOpts) => Promise<string | null>;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
}

const DialogCtx = createContext<DialogApi | null>(null);

export function useDialogs(): DialogApi {
  const ctx = useContext(DialogCtx);
  if (!ctx) throw new Error("useDialogs must be used inside DialogProvider");
  return ctx;
}

type Pending =
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | null;

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending>(null);

  const prompt = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) =>
        setPending({ kind: "prompt", opts, resolve }),
      ),
    [],
  );
  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) =>
        setPending({ kind: "confirm", opts, resolve }),
      ),
    [],
  );

  return (
    <DialogCtx.Provider value={{ prompt, confirm }}>
      {children}
      {pending?.kind === "prompt" && (
        <PromptModal
          opts={pending.opts}
          onResult={(v) => {
            pending.resolve(v);
            setPending(null);
          }}
        />
      )}
      {pending?.kind === "confirm" && (
        <ConfirmModal
          opts={pending.opts}
          onResult={(v) => {
            pending.resolve(v);
            setPending(null);
          }}
        />
      )}
    </DialogCtx.Provider>
  );
}

function PromptModal({
  opts,
  onResult,
}: {
  opts: PromptOpts;
  onResult: (v: string | null) => void;
}) {
  const [value, setValue] = useState(opts.defaultValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function ok() {
    const v = value.trim();
    if (!v) return;
    onResult(v);
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => onResult(null)}
      onKeyDown={(e) => {
        if (e.key === "Escape") onResult(null);
      }}
    >
      <div
        className="modal modal-sm"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            ok();
          } else if (e.key === "Escape") {
            onResult(null);
          }
        }}
      >
        <h3>{opts.title}</h3>
        {opts.label && <div className="dlg-label">{opts.label}</div>}
        <input
          ref={inputRef}
          className="dlg-input"
          value={value}
          placeholder={opts.placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="modal-actions">
          <button onClick={() => onResult(null)}>
            {opts.cancelText ?? "Cancel"}
          </button>
          <button className="primary" onClick={ok} disabled={!value.trim()}>
            {opts.confirmText ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({
  opts,
  onResult,
}: {
  opts: ConfirmOpts;
  onResult: (v: boolean) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btnRef.current?.focus();
  }, []);
  return (
    <div className="modal-backdrop" onClick={() => onResult(false)}>
      <div
        className="modal modal-sm"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") onResult(true);
          else if (e.key === "Escape") onResult(false);
        }}
      >
        <h3>{opts.title}</h3>
        <div className="dlg-message">{opts.message}</div>
        <div className="modal-actions">
          <button onClick={() => onResult(false)}>
            {opts.cancelText ?? "Cancel"}
          </button>
          <button
            ref={btnRef}
            className={opts.danger ? "danger" : "primary"}
            onClick={() => onResult(true)}
          >
            {opts.confirmText ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
