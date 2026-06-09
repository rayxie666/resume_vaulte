// Scan LaTeX source for image references like \includegraphics{name}
// or user-defined helper commands like \companyLogo{name}.

const ASSET_CMD_RE =
  /\\(?:includegraphics(?:\s*\[[^\]]*\])?|companyLogo|companyImage|includeimage|graphicsfile)\s*\{([^}]+)\}/g;

const LINE_COMMENT_RE = /(?<!\\)%.*$/gm;
const COMMENT_ENV_RE = /\\begin\{comment\}[\s\S]*?\\end\{comment\}/g;
const NEWCOMMAND_RE = /\\(?:re)?newcommand\*?\s*\{?\\[A-Za-z@]+\}?(?:\s*\[\d+\])?(?:\s*\[[^\]]*\])?\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;

export function stripCommentsAndDefinitions(source: string): string {
  // 1. drop \begin{comment}...\end{comment} blocks (verbatim regions)
  // 2. drop %-style line comments (unescaped)
  // 3. drop \newcommand bodies (their #1 / #2 args are not real filenames)
  return source
    .replace(COMMENT_ENV_RE, "")
    .replace(NEWCOMMAND_RE, "")
    .replace(LINE_COMMENT_RE, "");
}

export function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function looksLikeFilename(name: string): boolean {
  if (!name) return false;
  // Reject LaTeX parameter placeholders, macros, or anything obviously not a file
  if (/[#\\{}$]/.test(name)) return false;
  // Reject whitespace
  if (/\s/.test(name)) return false;
  return true;
}

/// Detect asset references in source. Drops comment blocks, line comments,
/// and \newcommand bodies (so `#1` parameters aren't reported as missing
/// files), then matches common LaTeX image commands. Names are normalized
/// to bare basenames and deduplicated, preserving first-seen order.
export function findReferencedAssets(source: string): string[] {
  const clean = stripCommentsAndDefinitions(source);
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  ASSET_CMD_RE.lastIndex = 0;
  while ((m = ASSET_CMD_RE.exec(clean)) !== null) {
    const raw = m[1].trim();
    const name = basename(raw);
    if (!looksLikeFilename(name)) continue;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
