import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import {
  history,
  defaultKeymap,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  bracketMatching,
  indentOnInput,
  StreamLanguage,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";

// Brand syntax theme — colors resolve from the App.css tokens, so the
// editor follows the light/dark theme without swapping extensions.
const brandHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.tagName], color: "var(--code-keyword)" },
  { tag: [t.atom, t.number, t.string], color: "var(--code-literal)" },
  { tag: t.comment, color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [t.bracket, t.paren, t.brace], color: "var(--code-bracket)" },
]);

function prefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export default function CodeEditor({
  value,
  onChange,
  placeholder,
  extraExtensions,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  extraExtensions?: Extension[];
  readOnly?: boolean;
}) {
  const [dark, setDark] = useState(prefersDark);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const extensions = useMemo(
    () => [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      autocompletion(),
      highlightSelectionMatches(),
      StreamLanguage.define(stex),
      syntaxHighlighting(brandHighlight),
      // Tells CM widgets (autocomplete, panels) which scheme is active;
      // all colors come from App.css.
      EditorView.theme({}, { dark }),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.lineWrapping,
      EditorView.editable.of(!readOnly),
      EditorState.readOnly.of(!!readOnly),
      ...(extraExtensions ?? []),
    ],
    [dark, extraExtensions, readOnly],
  );

  return (
    <CodeMirror
      value={value}
      placeholder={placeholder}
      height="100%"
      theme="none"
      basicSetup={false}
      extensions={extensions}
      onChange={onChange}
      className="cm-wrap"
    />
  );
}
