// Two-stage AI pipeline: PDF/DOCX text → resume.cls-flavored LaTeX.
// See spec/2026-06-13-import-to-latex.md §4.

import { invoke } from "@tauri-apps/api/core";
import { AiError, aiComplete } from "./ai";

export interface ExtractedDoc {
  plain_text: string;
  source_kind: "pdf" | "docx";
  page_count: number | null;
  warnings: string[];
}

export type TemplateChoice = "builtin-resume-cls" | "ai-custom-cls";

export interface DetectedMeta {
  lang: "zh" | "en" | "mixed";
  sections: string[];
  hasPhoto: boolean;
}

export interface ImportResult {
  tex: string;
  templateChoice: TemplateChoice;
  /** Only populated when the experimental ai-custom-cls path is used. */
  customCls?: string;
  detected: DetectedMeta;
  warnings: string[];
}

// 30 KB cap for the AI input; matches §7 "抽出文本 > 30 KB" rule.
const AI_INPUT_MAX = 30 * 1024;

// ───── Settings: experimental AI-custom-cls switch ─────
//
// Off by default per spec §4.3 — stage 2b is expensive (two AI calls instead
// of one, and the AI must produce a coherent .cls + .tex pair).
const ALLOW_CUSTOM_CLS_KEY = "rv.import.allowCustomCls";

export function loadAllowCustomCls(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(ALLOW_CUSTOM_CLS_KEY) === "1";
}

export function setAllowCustomCls(v: boolean): void {
  if (typeof localStorage === "undefined") return;
  if (v) localStorage.setItem(ALLOW_CUSTOM_CLS_KEY, "1");
  else localStorage.removeItem(ALLOW_CUSTOM_CLS_KEY);
}

// ───── Extraction (Rust side) ─────

export async function extractDocument(
  filePath: string,
  kind: "pdf" | "docx",
): Promise<ExtractedDoc> {
  const cmd = kind === "pdf" ? "extract_pdf_text" : "extract_docx_text";
  return invoke<ExtractedDoc>(cmd, { path: filePath });
}

export function detectKindFromPath(path: string): "pdf" | "docx" | null {
  const p = path.toLowerCase();
  if (p.endsWith(".pdf")) return "pdf";
  if (p.endsWith(".docx")) return "docx";
  return null;
}

// ───── Stage 1 prompts ─────

const STAGE1_SYSTEM = `You are a resume layout analyst.

Read the resume text below (extracted from PDF or DOCX) and judge whether
its visual style is close to the project's built-in Medium-Length
Professional CV template (centered uppercase name, contact line(s),
uppercase section titles, rSubsection-style three-part headers).

Reply with ONLY a JSON object — no prose, no fences. Schema:
{
  "templateChoice": "builtin-resume-cls" | "ai-custom-cls",
  "reason": string,
  "detected": {
    "lang": "zh" | "en" | "mixed",
    "sections": string[],
    "hasPhoto": boolean
  }
}

"reason" must be <= 60 characters. Prefer "builtin-resume-cls" unless the
source uses a radically different layout (multi-column, sidebar, logo
header, color blocks).`;

// ───── Stage 2b prompts (experimental AI-generated .cls) ─────

const STAGE2B_CLS_SYSTEM = `You are a LaTeX class author.

Write a complete \`.cls\` file for a single-column resume layout. The class
will be used by a separate \`.tex\` (you will be asked to write that next),
so define a clear macro contract and stick to it.

HARD constraints:
1. Start with: \`\\ProvidesClass{custom_resume}[2026/06/14 v1 Custom resume class]\`.
2. Load article: \`\\LoadClass[11pt]{article}\`.
3. Only use packages from this allow-list (Tectonic can auto-fetch them):
   geometry, parskip, xcolor, titlesec, enumitem, fontspec, xstring.
   If the source language is "zh" or "mixed", also load \`fontspec\` and try
   \`\\setCJKmainfont\` via \`xeCJK\` (the only CJK package on the allow-list:
   add \`xeCJK\` to the allow-list for this case).
4. Top margin 0.6in, left/right 0.75in (via geometry).
5. NO graphics. NO external font files. NO images. NO multi-column.
6. Define EXACTLY these macros for the .tex side to use — match names verbatim:
   - \`\\name{TEXT}\` — full name. Display centered, uppercase, bold, large.
   - \`\\address{LINE}\` — contact line. Multiple calls allowed; join with a centered separator.
   - \`\\begin{rSection}{TITLE}\` ... \`\\end{rSection}\` — section block. Title in small caps or bold uppercase.
   - \`\\begin{rSubsection}{title}{date}{role}{location}\` ... \`\\end{rSubsection}\` — entry header.
     If a field is empty (\`{}\`) skip its slot gracefully.
   - \`\\item\` (standard) inside rSubsection.
7. Output ONLY the .cls source. No markdown fences, no commentary.

You may vary the typography (titlesec rules, color accents, font choice via
fontspec) to match the source resume's visual character.`;

const STAGE2B_TEX_SYSTEM = `You are a LaTeX typesetter.

Convert the resume text below into a \`.tex\` that targets the custom class
defined above (\`\\documentclass{custom_resume}\`). Use ONLY the macros the
class exposes:
  \`\\name{...}\`, \`\\address{...}\` (1 or 2 lines),
  \`\\begin{rSection}{TITLE}\` ... \`\\end{rSection}\`,
  \`\\begin{rSubsection}{org}{date}{role}{loc}\` ... \`\\end{rSubsection}\`,
  \`\\item ...\`.

Rules:
1. First line must be \`\\documentclass{custom_resume}\`.
2. Sections become \`rSection\`. Use the EXACT section names found in the
   source (Chinese in, Chinese out). Common ones: EDUCATION, EXPERIENCE,
   PROJECTS, SKILLS.
3. Each job/project = one \`rSubsection\`. Empty fields stay empty (\`{}\`).
4. Achievements = \`\\item\` lines. Preserve wording.
5. NO \`\\usepackage{...}\` calls — everything must be provided by the class.
6. NO graphics, NO images.
7. Escape LaTeX-special characters: % & _ # $ { } ~ ^.
8. Output ONLY the .tex source — no markdown fences, no commentary.`;

// ───── Stage 2a prompt (built-in resume.cls) ─────

const STAGE2A_SYSTEM = `You are a LaTeX typesetter.

Convert the resume text below into a complete .tex document that uses the
project's bundled \`resume.cls\` (\`\\documentclass[11pt]{resume}\`).

You may ONLY use:
  - \`\\name{...}\` (exactly once)
  - \`\\address{...}\` (1 or 2 lines; lines inside one \\address use \`\\\\\` for breaks)
  - \`\\begin{rSection}{TITLE}\` ... \`\\end{rSection}\`
  - \`\\begin{rSubsection}{title}{date}{role}{location}\` ... \`\\end{rSubsection}\`
  - \`\\item ...\` inside rSubsection / itemize
  - Standard LaTeX: itemize, tabular, \\textbf, \\textit, \\hfill, \\\\, $\\cdot$, %, etc.
  - \`\\usepackage{ebgaramond}\` (optional, only for English resumes)

Rules:
1. Sections become \`rSection\` blocks. Use the EXACT section names found in the
   source (Chinese in, Chinese out; English uppercase). Common ones: EDUCATION,
   EXPERIENCE, PROJECTS, SKILLS, TECHNICAL STRENGTHS.
2. Each job/project is one \`rSubsection\`. The four header fields are
   {company-or-project}, {dates}, {role-or-tech}, {location}. If a field is
   missing in the source, leave it empty (\`{}\`).
3. Achievements go as \`\\item\` lines. Preserve wording — do not invent
   metrics or rewrite content beyond what's needed to fit the macros.
4. Education / Skills use \`rSection\` + plain text or itemize / tabular.
5. NO \`\\usepackage\` beyond what's listed above. NO graphics. NO images
   even if the original had a photo.
6. Escape LaTeX-special characters in the content: % & _ # $ { } ~ ^.
7. Output ONLY the .tex source — no markdown fences, no commentary.

The document must start with the comment block, then
\`\\documentclass[11pt]{resume}\`, then \`\\begin{document}\` ... \`\\end{document}\`.`;

// ───── Public API ─────

export type ImportPhase = "extracting" | "analyzing" | "generating";

export async function importDocumentToLatex(
  filePath: string,
  opts?: { onPhase?: (p: ImportPhase) => void },
): Promise<ImportResult> {
  const phase = opts?.onPhase ?? (() => {});
  const kind = detectKindFromPath(filePath);
  if (!kind) {
    throw new AiError("empty", "unsupported file type — pick a .pdf or .docx");
  }
  phase("extracting");
  const extracted = await extractDocument(filePath, kind);

  const warnings = [...extracted.warnings];
  const raw = extracted.plain_text;
  if (raw.trim().length === 0) {
    throw new AiError("empty", "no extractable text in the document");
  }

  let aiInput = raw;
  if (aiInput.length > AI_INPUT_MAX) {
    aiInput = aiInput.slice(0, AI_INPUT_MAX);
    warnings.push(
      `Document is long (${(raw.length / 1024).toFixed(1)} KB). Only the first ` +
        `${AI_INPUT_MAX / 1024} KB was sent to the AI; you may need to fill in ` +
        `the rest manually.`,
    );
  }

  // ── Stage 1: classify layout ──
  phase("analyzing");
  const stage1Raw = await aiComplete(STAGE1_SYSTEM, aiInput);
  let analysis: { templateChoice: TemplateChoice; reason: string; detected: DetectedMeta };
  try {
    analysis = parseJson(stage1Raw);
  } catch (e) {
    warnings.push(
      `Layout analysis returned non-JSON; defaulting to the built-in template. ` +
        `Raw: ${stage1Raw.slice(0, 200)}`,
    );
    analysis = {
      templateChoice: "builtin-resume-cls",
      reason: "fallback: stage-1 JSON parse failed",
      detected: { lang: guessLang(aiInput), sections: [], hasPhoto: false },
    };
  }

  // §4.3: ai-custom-cls is experimental and disabled by default. The user
  // must explicitly opt in via Settings (`loadAllowCustomCls`).
  let templateChoice: TemplateChoice = analysis.templateChoice;
  const allowCustomCls = loadAllowCustomCls();
  if (templateChoice === "ai-custom-cls" && !allowCustomCls) {
    warnings.push(
      "AI suggested a custom .cls but the experimental toggle is off. " +
        "Using the built-in resume.cls instead.",
    );
    templateChoice = "builtin-resume-cls";
  }

  phase("generating");

  if (templateChoice === "builtin-resume-cls") {
    // ── Stage 2a: produce LaTeX targeting built-in resume.cls ──
    const stage2Prompt = buildStage2aPrompt(aiInput, analysis.detected);
    const raw = postprocessTex(await aiComplete(STAGE2A_SYSTEM, stage2Prompt));
    const tex = coerceBuiltinTex(raw, warnings);
    return { tex, templateChoice, detected: analysis.detected, warnings };
  }

  // ── Stage 2b: two AI calls to produce a coherent .cls + .tex pair ──
  //
  // Spec §6 wanted the .cls saved as a separate per-version asset, but the
  // global-asset table dedupes by name (`custom_resume.cls` would collide
  // between imports). Instead we wrap the .cls in `\begin{filecontents*}`
  // and inline it into the .tex, so every imported version is one
  // self-contained file with no asset bookkeeping. Users can still edit the
  // class header in the editor.
  const langTag =
    `[detected: lang=${analysis.detected.lang}, sections=` +
    `${analysis.detected.sections.join("|") || "?"}` +
    `, hasPhoto=${analysis.detected.hasPhoto}]`;
  const clsPrompt = `${langTag}\n\n--- RESUME TEXT ---\n${aiInput}`;
  const customCls = postprocessTex(
    await aiComplete(STAGE2B_CLS_SYSTEM, clsPrompt),
  );
  validateCustomCls(customCls);

  const texPrompt =
    `${langTag}\n\n--- CLASS FILE (already written, do not repeat) ---\n` +
    `${customCls}\n\n--- RESUME TEXT ---\n${aiInput}`;
  const texRaw = postprocessTex(await aiComplete(STAGE2B_TEX_SYSTEM, texPrompt));
  const texBody = coerceCustomTex(texRaw, warnings);

  const tex = embedClsAsFilecontents(customCls, texBody);
  return {
    tex,
    templateChoice,
    customCls,
    detected: analysis.detected,
    warnings,
  };
}

function buildStage2aPrompt(text: string, detected: DetectedMeta): string {
  const tag =
    `[detected: lang=${detected.lang}, sections=${detected.sections.join("|") || "?"}` +
    `, hasPhoto=${detected.hasPhoto}]`;
  return `${tag}\n\n--- RESUME TEXT ---\n${text}`;
}

/** Strip wrapping code fences, BOM, leading/trailing whitespace, and any
 *  prose the model added before/after the LaTeX source. */
function postprocessTex(raw: string): string {
  let s = raw.replace(/^﻿/, "").trim();
  // Strip code fences with any language tag (or none).
  const fence = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(s);
  if (fence) s = fence[1].trim();
  // If the model preambled "Here is your LaTeX:" before `\documentclass`,
  // drop everything up to it.
  const docIdx = s.indexOf("\\documentclass");
  if (docIdx > 0) s = s.slice(docIdx).trim();
  // Trim trailing prose after \end{document}.
  const endMatch = s.match(/\\end\{document\}/);
  if (endMatch && endMatch.index !== undefined) {
    s = s.slice(0, endMatch.index + endMatch[0].length).trim();
  }
  return s;
}

/**
 * Coerce the AI's .tex into something that compiles against the bundled
 * resume.cls. We forgive — if `\documentclass` exists but targets the wrong
 * class, rewrite it; if it's missing entirely, prepend one. Each rewrite
 * adds a warning so the user knows the import wasn't a clean match.
 */
function coerceBuiltinTex(tex: string, warnings: string[]): string {
  let out = tex;
  const docRe = /\\documentclass\b\s*(\[[^\]]*\])?\s*\{([^}]+)\}/;
  const match = docRe.exec(out);
  if (!match) {
    warnings.push("AI omitted \\documentclass; inserted \\documentclass[11pt]{resume}.");
    out = `\\documentclass[11pt]{resume}\n${out}`;
  } else if (match[2].trim() !== "resume") {
    warnings.push(
      `AI used \\documentclass{${match[2]}}; rewriting to \\documentclass[11pt]{resume}.`,
    );
    out = out.replace(docRe, "\\documentclass[11pt]{resume}");
  }
  return wrapInDocument(out, warnings);
}

function validateCustomCls(cls: string): void {
  if (!cls.includes("\\ProvidesClass{custom_resume}")) {
    throw new AiError(
      "empty",
      "Custom .cls is missing \\ProvidesClass{custom_resume}; cannot use.",
    );
  }
  if (!cls.includes("\\LoadClass")) {
    throw new AiError(
      "empty",
      "Custom .cls does not \\LoadClass on top of article; cannot use.",
    );
  }
}

/** Same forgiveness rules as `coerceBuiltinTex`, but targeted at the
 *  experimental custom-cls path. */
function coerceCustomTex(tex: string, warnings: string[]): string {
  let out = tex;
  const docRe = /\\documentclass\b\s*(\[[^\]]*\])?\s*\{([^}]+)\}/;
  const match = docRe.exec(out);
  if (!match) {
    warnings.push("AI omitted \\documentclass; inserted \\documentclass{custom_resume}.");
    out = `\\documentclass{custom_resume}\n${out}`;
  } else if (match[2].trim() !== "custom_resume") {
    warnings.push(
      `AI used \\documentclass{${match[2]}}; rewriting to \\documentclass{custom_resume}.`,
    );
    out = out.replace(docRe, "\\documentclass{custom_resume}");
  }
  return wrapInDocument(out, warnings);
}

/**
 * Ensure `\begin{document} ... \end{document}` surrounds the body. The AI
 * sometimes returns only the documentclass + preamble + content macros
 * without the document environment, which Tectonic rejects. Insert the
 * boundaries by scanning for the end of the preamble (last `\usepackage`,
 * else the `\documentclass` line itself).
 */
function wrapInDocument(tex: string, warnings: string[]): string {
  const hasBegin = tex.includes("\\begin{document}");
  const hasEnd = tex.includes("\\end{document}");
  if (hasBegin && hasEnd) return tex;

  let out = tex;
  if (!hasBegin) {
    // Find the last `\usepackage{...}` line; otherwise, the `\documentclass` line.
    const lines = out.split("\n");
    let insertAfter = -1;
    for (let i = 0; i < lines.length; i++) {
      if (
        lines[i].trim().startsWith("\\usepackage") ||
        lines[i].trim().startsWith("\\RequirePackage") ||
        lines[i].trim().startsWith("\\documentclass")
      ) {
        insertAfter = i;
      }
      // Stop at the first body-content line so we don't push \begin{document}
      // past `\name{...}` / `\address{...}` / `\begin{rSection}...`.
      const trimmed = lines[i].trim();
      if (
        insertAfter >= 0 &&
        trimmed &&
        !trimmed.startsWith("%") &&
        !trimmed.startsWith("\\usepackage") &&
        !trimmed.startsWith("\\RequirePackage") &&
        !trimmed.startsWith("\\documentclass") &&
        !trimmed.startsWith("\\PassOptionsToPackage") &&
        i > insertAfter
      ) {
        break;
      }
    }
    if (insertAfter < 0) {
      // No preamble found at all — wrap everything.
      warnings.push("AI omitted \\begin{document}; wrapped the entire output.");
      out = `\\begin{document}\n${out}`;
    } else {
      warnings.push("AI omitted \\begin{document}; inserted it after the preamble.");
      lines.splice(insertAfter + 1, 0, "\\begin{document}");
      out = lines.join("\n");
    }
  }
  if (!out.includes("\\end{document}")) {
    warnings.push("AI omitted \\end{document}; appended it.");
    out = `${out.replace(/\s+$/, "")}\n\\end{document}\n`;
  }
  return out;
}

/**
 * Inline the generated `.cls` into the `.tex` via `filecontents*`. Tectonic
 * writes the file to its working dir before parsing `\documentclass`, so
 * there's no need to ship a separate asset.
 */
function embedClsAsFilecontents(cls: string, texBody: string): string {
  const docIdx = texBody.indexOf("\\documentclass{custom_resume}");
  if (docIdx < 0) {
    // validator already threw on this; defensive bail.
    return texBody;
  }
  const before = texBody.slice(0, docIdx);
  const fromDoc = texBody.slice(docIdx);
  return (
    `${before}` +
    `\\begin{filecontents*}[overwrite]{custom_resume.cls}\n` +
    `${cls.trim()}\n` +
    `\\end{filecontents*}\n` +
    `${fromDoc}`
  );
}

function parseJson<T>(s: string): T {
  // The model sometimes wraps the JSON in ```json … ```, or adds a leading
  // sentence. Strip both before parsing.
  let t = s.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(t);
  if (fence) t = fence[1].trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return JSON.parse(t) as T;
}

function guessLang(s: string): DetectedMeta["lang"] {
  let zh = 0;
  let other = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x4e00 && code <= 0x9fff) zh++;
    else if (code > 0x20) other++;
  }
  if (zh === 0) return "en";
  if (zh * 4 < other) return "mixed";
  return "zh";
}
