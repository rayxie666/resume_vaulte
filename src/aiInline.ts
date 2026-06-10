import {
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  showTooltip,
  ViewPlugin,
  WidgetType,
  type Tooltip,
} from "@codemirror/view";
import { diffWords } from "diff";
import { AiError, type AiErrorCode } from "./ai";

const MAX_SELECTION = 12_000;

export interface AiInlineLabels {
  button: string;
  generating: string;
  apply: string;
  reject: string;
  retry: string;
  suggestionLabel: string;
  notConfigured: string;
  openSettings: string;
  error: (code: AiErrorCode) => string;
}

export interface AiInlineHost {
  isConfigured(): boolean;
  /** Throws AiError on failure. */
  rewrite(text: string, previousAttempt?: string): Promise<string>;
  /** Cancel any in-flight request (kills the CLI subprocess if any). */
  cancel(): void;
  openSettings(): void;
  onApplied(): void;
  labels: AiInlineLabels;
}

// ───── Session state ─────

interface Session {
  id: number;
  from: number;
  to: number;
  original: string;
  phase: "loading" | "preview" | "error";
  suggestion: string | null;
  prevAttempt: string | null;
  errorCode: AiErrorCode | null;
  errorLog: string | null;
}

let nextSessionId = 1;

const setSession = StateEffect.define<Session | null>();
const setHint = StateEffect.define<boolean>(); // "not configured" tooltip swap

function sessionFieldFor(): StateField<Session | null> {
  return StateField.define<Session | null>({
    create: () => null,
    update(value, tr) {
      for (const e of tr.effects) {
        if (e.is(setSession)) return e.value;
      }
      if (value && tr.docChanged) {
        // Edits inside the marked range invalidate the session (§3.5);
        // edits outside just shift it.
        if (tr.changes.touchesRange(value.from, value.to)) return null;
        return {
          ...value,
          from: tr.changes.mapPos(value.from, 1),
          to: tr.changes.mapPos(value.to, -1),
        };
      }
      return value;
    },
  });
}

// ───── Extension factory ─────

export function aiInline(host: AiInlineHost): Extension {
  const sessionField = sessionFieldFor();

  const hintField = StateField.define<boolean>({
    create: () => false,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(setHint)) return e.value;
      if (tr.selection || tr.docChanged) return false;
      return value;
    },
  });

  function getSession(view: EditorView): Session | null {
    return view.state.field(sessionField);
  }

  function safeDispatch(view: EditorView, spec: Parameters<EditorView["dispatch"]>[0]): void {
    try {
      view.dispatch(spec);
    } catch {
      // view was destroyed mid-flight — nothing to update
    }
  }

  function failSession(view: EditorView, base: Session, code: AiErrorCode, log?: string) {
    safeDispatch(view, {
      effects: setSession.of({
        ...base,
        phase: "error",
        errorCode: code,
        errorLog: log ?? null,
      }),
    });
  }

  function startRewrite(view: EditorView, retryFrom?: Session): boolean {
    const current = getSession(view);
    if (current && !retryFrom) return true; // one session at a time

    let from: number, to: number, original: string, prevAttempt: string | null;
    if (retryFrom) {
      ({ from, to, original } = retryFrom);
      prevAttempt = retryFrom.suggestion;
    } else {
      const sel = view.state.selection.main;
      if (sel.empty) return false;
      from = sel.from;
      to = sel.to;
      original = view.state.doc.sliceString(from, to);
      prevAttempt = null;
    }

    if (!host.isConfigured()) {
      safeDispatch(view, { effects: setHint.of(true) });
      return true;
    }

    const session: Session = {
      id: nextSessionId++,
      from,
      to,
      original,
      phase: "loading",
      suggestion: null,
      prevAttempt,
      errorCode: null,
      errorLog: null,
    };

    if (original.length > MAX_SELECTION) {
      safeDispatch(view, {
        effects: setSession.of({ ...session, phase: "error", errorCode: "too_long" }),
      });
      return true;
    }

    safeDispatch(view, { effects: setSession.of(session) });

    host
      .rewrite(original, prevAttempt ?? undefined)
      .then((suggestion) => {
        const s = getSession(view);
        if (!s || s.id !== session.id || s.phase !== "loading") return; // cancelled
        safeDispatch(view, {
          effects: setSession.of({ ...s, phase: "preview", suggestion }),
        });
      })
      .catch((err) => {
        const s = getSession(view);
        if (!s || s.id !== session.id || s.phase !== "loading") return;
        if (err instanceof AiError) failSession(view, s, err.code, err.log);
        else failSession(view, s, "network", String(err));
      });
    return true;
  }

  function accept(view: EditorView): boolean {
    const s = getSession(view);
    if (!s || s.phase !== "preview" || s.suggestion == null) return false;
    // Belt-and-suspenders: the doc must still hold the text we rewrote.
    if (view.state.doc.sliceString(s.from, s.to) !== s.original) {
      failSession(view, s, "stale");
      return true;
    }
    // Single transaction → a single Cmd+Z restores the original.
    safeDispatch(view, {
      changes: { from: s.from, to: s.to, insert: s.suggestion },
      effects: setSession.of(null),
    });
    host.onApplied();
    return true;
  }

  function dismiss(view: EditorView): boolean {
    const s = getSession(view);
    if (!s) return false;
    if (s.phase === "loading") host.cancel();
    safeDispatch(view, { effects: setSession.of(null) });
    return true;
  }

  function retry(view: EditorView): void {
    const s = getSession(view);
    if (!s || s.phase === "loading") return;
    startRewrite(view, s);
  }

  // ───── Tooltip (floating button / loading pill / config hint) ─────

  function computeTooltip(state: EditorState): Tooltip | null {
    const session = state.field(sessionField);
    if (session) {
      if (session.phase !== "loading") return null; // preview/error use the widget
      return {
        pos: session.from,
        above: true,
        create: (view) => ({ dom: loadingPill(view) }),
      };
    }
    const sel = state.selection.main;
    if (sel.empty || sel.to - sel.from > MAX_SELECTION) return null;
    const hint = state.field(hintField);
    return {
      pos: sel.from,
      above: true,
      create: (view) => ({ dom: hint ? configHint(view) : rewriteButton(view) }),
    };
  }

  function rewriteButton(view: EditorView): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "ai-fab";
    btn.textContent = `✦ ${host.labels.button}`;
    btn.onmousedown = (e) => e.preventDefault(); // keep the selection
    btn.onclick = () => startRewrite(view);
    return btn;
  }

  function loadingPill(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "ai-fab ai-fab-loading";
    const label = document.createElement("span");
    label.textContent = `⋯ ${host.labels.generating}`;
    const cancel = document.createElement("button");
    cancel.className = "ai-fab-cancel";
    cancel.textContent = "✕";
    cancel.onclick = () => dismiss(view);
    wrap.append(label, cancel);
    return wrap;
  }

  function configHint(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "ai-fab ai-fab-hint";
    const label = document.createElement("span");
    label.textContent = host.labels.notConfigured;
    const open = document.createElement("button");
    open.className = "ai-fab-link";
    open.textContent = host.labels.openSettings;
    open.onmousedown = (e) => e.preventDefault();
    open.onclick = () => {
      safeDispatch(view, { effects: setHint.of(false) });
      host.openSettings();
    };
    wrap.append(label, open);
    return wrap;
  }

  const tooltipField = StateField.define<Tooltip | null>({
    create: (state) => computeTooltip(state),
    update(value, tr) {
      if (
        !tr.docChanged &&
        !tr.selection &&
        !tr.effects.some((e) => e.is(setSession) || e.is(setHint))
      ) {
        return value;
      }
      return computeTooltip(tr.state);
    },
    provide: (f) => showTooltip.from(f),
  });

  // ───── Decorations (range mark + suggestion widget) ─────

  class SuggestionWidget extends WidgetType {
    constructor(private session: Session) {
      super();
    }

    eq(other: SuggestionWidget): boolean {
      return (
        other.session.id === this.session.id &&
        other.session.phase === this.session.phase &&
        other.session.suggestion === this.session.suggestion &&
        other.session.errorCode === this.session.errorCode
      );
    }

    toDOM(view: EditorView): HTMLElement {
      const s = this.session;
      const box = document.createElement("div");
      box.className = `ai-suggest ${s.phase === "error" ? "ai-suggest-error" : ""}`;

      if (s.phase === "error") {
        const line = document.createElement("div");
        line.className = "ai-suggest-errline";
        line.textContent = host.labels.error(s.errorCode ?? "network");
        box.appendChild(line);
        if (s.errorLog) {
          const det = document.createElement("details");
          det.className = "ai-suggest-log";
          const sum = document.createElement("summary");
          sum.textContent = "log";
          const pre = document.createElement("pre");
          pre.textContent = s.errorLog.slice(0, 1500);
          det.append(sum, pre);
          box.appendChild(det);
        }
        const row = document.createElement("div");
        row.className = "ai-suggest-actions";
        if (s.errorCode === "no_cli" || s.errorCode === "not_configured") {
          row.appendChild(
            actionBtn(host.labels.openSettings, () => {
              dismiss(view);
              host.openSettings();
            }),
          );
        }
        if (s.errorCode !== "too_long" && s.errorCode !== "stale") {
          row.appendChild(actionBtn(`↻ ${host.labels.retry}`, () => retry(view)));
        }
        row.appendChild(actionBtn(`✕ ${host.labels.reject}`, () => dismiss(view)));
        box.appendChild(row);
        return box;
      }

      const label = document.createElement("div");
      label.className = "ai-suggest-label";
      label.textContent = `✦ ${host.labels.suggestionLabel}`;
      box.appendChild(label);

      const pre = document.createElement("pre");
      pre.className = "ai-suggest-text";
      // Word-level diff: changed words in the suggestion get emphasized.
      for (const part of diffWords(s.original, s.suggestion ?? "")) {
        if (part.removed) continue;
        const span = document.createElement("span");
        if (part.added) span.className = "ai-added";
        span.textContent = part.value;
        pre.appendChild(span);
      }
      box.appendChild(pre);

      const row = document.createElement("div");
      row.className = "ai-suggest-actions";
      row.appendChild(actionBtn(`✓ ${host.labels.apply} (Tab)`, () => accept(view), "primary"));
      row.appendChild(actionBtn(`✕ ${host.labels.reject} (Esc)`, () => dismiss(view)));
      row.appendChild(actionBtn(`↻ ${host.labels.retry}`, () => retry(view)));
      box.appendChild(row);
      return box;
    }

    ignoreEvent(): boolean {
      return true; // clicks inside the widget shouldn't move the cursor
    }
  }

  function actionBtn(
    text: string,
    onClick: () => void,
    variant?: "primary",
  ): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `ai-suggest-btn ${variant ?? ""}`;
    b.textContent = text;
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = onClick;
    return b;
  }

  const decorations = EditorView.decorations.compute([sessionField], (state) => {
    const s = state.field(sessionField);
    if (!s || s.from >= s.to) return Decoration.none;
    const marks = [];
    const markClass =
      s.phase === "loading" ? "ai-mark-pending" : "ai-mark-old";
    marks.push(Decoration.mark({ class: markClass }).range(s.from, s.to));
    if (s.phase === "preview" || s.phase === "error") {
      marks.push(
        Decoration.widget({
          widget: new SuggestionWidget(s),
          side: 1,
          block: true,
        }).range(s.to),
      );
    }
    return Decoration.set(marks);
  });

  // Cancel in-flight work when an edit inside the range silently kills the
  // session, and when the editor unmounts.
  const lifecycle = ViewPlugin.define((view) => {
    let last = view.state.field(sessionField);
    return {
      update(update) {
        const now = update.state.field(sessionField);
        if (last && last.phase === "loading" && (!now || now.id !== last.id)) {
          if (!update.transactions.some((tr) => tr.effects.some((e) => e.is(setSession)))) {
            host.cancel(); // invalidated by a doc edit, not an explicit action
          }
        }
        last = now;
      },
      destroy() {
        if (last && last.phase === "loading") host.cancel();
      },
    };
  });

  const keys = Prec.highest(
    keymap.of([
      { key: "Mod-j", run: (view) => startRewrite(view) },
      {
        key: "Tab",
        run: (view) => {
          const s = getSession(view);
          if (s?.phase === "preview") return accept(view);
          return false;
        },
      },
      {
        key: "Escape",
        run: (view) => dismiss(view),
      },
    ]),
  );

  return [sessionField, hintField, tooltipField, decorations, lifecycle, keys];
}
