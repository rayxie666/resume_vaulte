import { invoke } from "@tauri-apps/api/core";

// ───── Provider config ─────

export type AiProviderKind = "anthropic" | "openai-compatible" | "claude-code";
export type AiPreset =
  | "claude"
  | "openai"
  | "deepseek"
  | "kimi"
  | "custom"
  | "claude-code";

export interface AiConfig {
  kind: AiProviderKind;
  preset: AiPreset;
  baseUrl: string; // ignored for claude-code
  apiKey: string; // ignored for claude-code
  model: string;
}

export const AI_PRESETS: Record<
  AiPreset,
  { kind: AiProviderKind; baseUrl: string; model: string; modelPlaceholder?: string }
> = {
  claude: {
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-opus-4-8",
  },
  openai: {
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    modelPlaceholder: "gpt-4o",
  },
  deepseek: {
    kind: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
  kimi: {
    kind: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "",
    modelPlaceholder: "kimi-… / moonshot-…",
  },
  custom: {
    kind: "openai-compatible",
    baseUrl: "",
    model: "",
    modelPlaceholder: "model name",
  },
  "claude-code": { kind: "claude-code", baseUrl: "", model: "" },
};

const K_KIND = "rv.ai.kind";
const K_PRESET = "rv.ai.preset";
const K_BASE = "rv.ai.baseUrl";
const K_KEY = "rv.ai.apiKey";
const K_MODEL = "rv.ai.model";

export function loadAiConfig(): AiConfig {
  return {
    kind: (localStorage.getItem(K_KIND) as AiProviderKind) || "anthropic",
    preset: (localStorage.getItem(K_PRESET) as AiPreset) || "claude",
    baseUrl: localStorage.getItem(K_BASE) ?? AI_PRESETS.claude.baseUrl,
    apiKey: localStorage.getItem(K_KEY) ?? "",
    model: localStorage.getItem(K_MODEL) ?? AI_PRESETS.claude.model,
  };
}

export function saveAiConfig(cfg: AiConfig): void {
  localStorage.setItem(K_KIND, cfg.kind);
  localStorage.setItem(K_PRESET, cfg.preset);
  localStorage.setItem(K_BASE, cfg.baseUrl.trim().replace(/\/+$/, ""));
  localStorage.setItem(K_KEY, cfg.apiKey.trim());
  localStorage.setItem(K_MODEL, cfg.model.trim());
}

export function isAiConfigured(): boolean {
  const c = loadAiConfig();
  if (c.kind === "claude-code") return true; // CLI presence checked at run time
  return c.apiKey.length > 0 && c.baseUrl.length > 0 && c.model.length > 0;
}

// ───── Errors ─────

export type AiErrorCode =
  | "auth"
  | "rate"
  | "network"
  | "no_cli"
  | "empty"
  | "stale"
  | "too_long"
  | "not_configured";

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    public log?: string,
  ) {
    super(code);
  }
}

// ───── Persona & prompt ─────

// One system prompt for every provider. English on purpose — instruction 5
// makes the output language follow the input.
const SYSTEM_PROMPT = `You are a senior resume writer and career coach with 15+ years of experience in tech hiring — you have reviewed thousands of resumes as a hiring manager and recruiter, and you know exactly what makes a bullet point land an interview.

Rewrite the resume text the user provides, following these rules strictly:
1. Start bullet points with strong action verbs. Never use weak phrasing like "responsible for" or "participated in".
2. Emphasize quantifiable results and impact (scale, percentages, time, money) — but NEVER invent numbers or facts. If the original has no data, sharpen the wording of what is there; do not add new figures.
3. Follow the STAR principle: keep situation/action/result complete; cut filler, clichés and redundancy.
4. Keep tense consistent (past tense for past roles, present tense for current ones) and terminology accurate.
5. Reply in the same language as the original text: Chinese in, Chinese out; English in, English out.
6. Keep the length close to the original (within ±20%). Do not expand scope.
7. If the text contains LaTeX: do not add or remove \\commands, environments, or % comment structure. Only rewrite the natural-language content, and keep special-character escaping valid.

Output contract: return ONLY the replacement text itself — no preamble, no explanations, no code fences.`;

const MAX_TOKENS = 2048;

interface RustAiResult {
  success: boolean;
  text: string;
  log: string;
  status: number | null;
}

function throwForFailure(r: RustAiResult, kind: AiProviderKind): never {
  if (r.status === 401 || r.status === 403) throw new AiError("auth", r.log);
  if (r.status === 429) throw new AiError("rate", r.log);
  if (kind === "claude-code" && r.log.includes("claude CLI not found")) {
    throw new AiError("no_cli", r.log);
  }
  if (r.text.trim() === "" && r.log === "") throw new AiError("empty", r.log);
  if (/network error|timed out/.test(r.log)) throw new AiError("network", r.log);
  if (r.success) throw new AiError("empty", r.log); // unreachable guard
  throw new AiError("network", r.log);
}

// Strip wrapping code fences and blank padding the model may add despite
// the output contract.
function postprocess(raw: string): string {
  let s = raw.replace(/^\s+|\s+$/g, "");
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(s);
  if (fence) s = fence[1].trim();
  return s;
}

async function complete(system: string, prompt: string): Promise<string> {
  const cfg = loadAiConfig();
  if (!isAiConfigured()) throw new AiError("not_configured");

  let r: RustAiResult;
  if (cfg.kind === "claude-code") {
    r = await invoke<RustAiResult>("claude_code_run", {
      // CLI takes a single prompt; prepend the persona.
      prompt: `${system}\n\n---\n\n${prompt}`,
      model: cfg.model.trim() || null,
    });
  } else {
    r = await invoke<RustAiResult>("ai_complete", {
      kind: cfg.kind,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      system,
      prompt,
      maxTokens: MAX_TOKENS,
    });
  }
  if (!r.success) throwForFailure(r, cfg.kind);
  const text = postprocess(r.text);
  if (!text) throw new AiError("empty", r.log);
  return text;
}

export async function aiRewrite(
  selection: string,
  jdText: string | null,
  previousAttempt?: string,
): Promise<string> {
  let prompt = selection;
  if (jdText && jdText.trim()) {
    prompt += `\n\nTarget job description (tailor the wording toward it):\n${jdText.trim()}`;
  }
  if (previousAttempt) {
    prompt += `\n\n(Provide a different rewrite than the previous attempt:)\n${previousAttempt}`;
  }
  return complete(SYSTEM_PROMPT, prompt);
}

export async function aiCancel(): Promise<void> {
  const cfg = loadAiConfig();
  if (cfg.kind === "claude-code") {
    // API results are simply dropped on arrival; the CLI subprocess we kill.
    await invoke("claude_code_cancel").catch(() => undefined);
  }
}

export async function testAiConnection(): Promise<void> {
  await complete("Reply with the single word: pong", "ping");
}

export interface ClaudeCodeStatus {
  found: boolean;
  version: string | null;
}

export async function claudeCodeCheck(): Promise<ClaudeCodeStatus> {
  return invoke<ClaudeCodeStatus>("claude_code_check");
}
