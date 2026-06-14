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

  // §4.3: ai-custom-cls is experimental and disabled by default. If the
  // model picks it, we force the fallback path and note it in warnings.
  let templateChoice: TemplateChoice = analysis.templateChoice;
  if (templateChoice === "ai-custom-cls") {
    warnings.push(
      "AI suggested a custom .cls (experimental path is disabled). " +
        "Using the built-in resume.cls instead.",
    );
    templateChoice = "builtin-resume-cls";
  }

  // ── Stage 2a: produce LaTeX targeting built-in resume.cls ──
  phase("generating");
  const stage2Prompt = buildStage2aPrompt(aiInput, analysis.detected);
  const tex = postprocessTex(await aiComplete(STAGE2A_SYSTEM, stage2Prompt));

  validateBuiltinTex(tex); // throws AiError("empty") if the output isn't usable

  return {
    tex,
    templateChoice,
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

/** Strip wrapping code fences, BOM, leading/trailing whitespace. */
function postprocessTex(raw: string): string {
  let s = raw.replace(/^﻿/, "").trim();
  const fence = /^```(?:latex|tex)?\s*\n([\s\S]*?)\n?```$/i.exec(s);
  if (fence) s = fence[1].trim();
  return s;
}

/**
 * Cheap sanity check that the output actually targets resume.cls. We don't
 * compile here — that's the preview modal's job — but a structural failure
 * means we wasted a round-trip and should report `empty` to the UI.
 */
function validateBuiltinTex(tex: string): void {
  if (!tex.includes("\\documentclass") || !tex.includes("{resume}")) {
    throw new AiError(
      "empty",
      "AI output is missing \\documentclass{resume}; cannot use.",
    );
  }
  if (!tex.includes("\\begin{document}") || !tex.includes("\\end{document}")) {
    throw new AiError(
      "empty",
      "AI output is missing \\begin{document}/\\end{document}.",
    );
  }
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
