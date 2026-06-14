//! Import: extract plain text from PDF / DOCX resumes.
//!
//! The frontend feeds the result to the AI rewrite pipeline (see
//! `src/importToLatex.ts`); this module is intentionally dumb about
//! semantics — paragraphs in, normalized text out.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use serde::Serialize;

const MAX_TEXT_BYTES: usize = 256 * 1024; // hard cap: 256 KB; FE truncates to 30 KB for AI

#[derive(Serialize)]
pub struct ExtractedDoc {
    pub plain_text: String,
    pub source_kind: &'static str,
    pub page_count: Option<u32>,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub async fn extract_pdf_text(path: String) -> Result<ExtractedDoc, String> {
    tauri::async_runtime::spawn_blocking(move || extract_pdf_inner(Path::new(&path)))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

#[tauri::command]
pub async fn extract_docx_text(path: String) -> Result<ExtractedDoc, String> {
    tauri::async_runtime::spawn_blocking(move || extract_docx_inner(Path::new(&path)))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

// ───── PDF ─────

fn extract_pdf_inner(path: &Path) -> Result<ExtractedDoc, String> {
    if !path.exists() {
        return Err(format!("file not found: {}", path.display()));
    }
    // pdf-extract can panic on malformed PDFs; isolate it.
    let raw = match std::panic::catch_unwind(|| pdf_extract::extract_text(path)) {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            return Err(format!(
                "PDF text extraction failed: {e}. The file may be scanned (image-only) or encrypted; OCR is not supported yet."
            ));
        }
        Err(_) => {
            return Err(
                "PDF parser panicked. The file may be malformed, encrypted, or non-standard."
                    .into(),
            );
        }
    };

    let mut warnings: Vec<String> = Vec::new();
    let cleaned = normalize(&raw);
    if cleaned.trim().is_empty() {
        return Err(
            "no extractable text — this PDF is likely a scanned image. OCR is not supported yet."
                .into(),
        );
    }
    let (capped, was_capped) = cap_bytes(&cleaned, MAX_TEXT_BYTES);
    if was_capped {
        warnings.push(format!("text truncated to {} KB", MAX_TEXT_BYTES / 1024));
    }
    Ok(ExtractedDoc {
        plain_text: capped,
        source_kind: "pdf",
        page_count: None, // intentional: pdf-extract does not expose it; lopdf adds 100KB+ for one number
        warnings,
    })
}

// ───── DOCX ─────

fn extract_docx_inner(path: &Path) -> Result<ExtractedDoc, String> {
    if !path.exists() {
        return Err(format!("file not found: {}", path.display()));
    }
    let f = File::open(path).map_err(|e| format!("open docx failed: {e}"))?;
    let mut zip = zip::ZipArchive::new(f)
        .map_err(|e| format!("invalid .docx (not a zip): {e}"))?;
    let mut entry = match zip.by_name("word/document.xml") {
        Ok(e) => e,
        Err(_) => {
            return Err(
                "word/document.xml not found — is this really a .docx? Word 97-2003 (.doc) is not supported."
                    .into(),
            );
        }
    };
    let mut xml = String::new();
    entry
        .read_to_string(&mut xml)
        .map_err(|e| format!("read document.xml failed: {e}"))?;
    drop(entry);

    let mut warnings: Vec<String> = Vec::new();
    let raw = paragraphs_from_docx_xml(&xml);
    let cleaned = normalize(&raw);
    if cleaned.trim().is_empty() {
        return Err("no readable text found in this .docx.".into());
    }
    let (capped, was_capped) = cap_bytes(&cleaned, MAX_TEXT_BYTES);
    if was_capped {
        warnings.push(format!("text truncated to {} KB", MAX_TEXT_BYTES / 1024));
    }
    Ok(ExtractedDoc {
        plain_text: capped,
        source_kind: "docx",
        page_count: None,
        warnings,
    })
}

/// Hand-rolled tag walker. We only care about three Word XML elements:
/// - `<w:p>` … `</w:p>`  → paragraph boundary (emit newline)
/// - `<w:t…>` … `</w:t>` → run text (concatenate verbatim)
/// - `<w:br/>` / `<w:tab/>` → soft break / tab inside a paragraph
///
/// Everything else is skipped. We avoid a real XML parser because the file
/// is structurally simple and an extra crate (quick-xml ≈ 200 KB) is not
/// worth it for one pass.
fn paragraphs_from_docx_xml(xml: &str) -> String {
    let bytes = xml.as_bytes();
    let mut i = 0;
    let mut out = String::with_capacity(xml.len() / 2);
    let mut in_text = false;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'<' {
            // find tag end
            let Some(end) = xml[i..].find('>') else { break };
            let tag = &xml[i + 1..i + end];
            let tag_trim = tag.trim_start_matches('/');
            let name = tag_trim
                .split(|c: char| c.is_whitespace() || c == '/')
                .next()
                .unwrap_or("");
            let closing = tag.starts_with('/');
            let self_closing = tag.ends_with('/');
            match name {
                "w:p" => {
                    if closing {
                        out.push('\n');
                    }
                }
                "w:t" => {
                    in_text = !closing && !self_closing;
                }
                "w:tab" => out.push('\t'),
                "w:br" | "w:cr" => out.push('\n'),
                _ => {}
            }
            i += end + 1;
            continue;
        }
        if in_text {
            // decode the entity if any — only the five XML ones can appear in w:t
            if b == b'&' {
                if let Some(semi) = xml[i..].find(';') {
                    let entity = &xml[i + 1..i + semi];
                    let decoded = match entity {
                        "amp" => Some('&'),
                        "lt" => Some('<'),
                        "gt" => Some('>'),
                        "quot" => Some('"'),
                        "apos" => Some('\''),
                        _ => None,
                    };
                    if let Some(c) = decoded {
                        out.push(c);
                        i += semi + 1;
                        continue;
                    }
                }
            }
            // push the next UTF-8 codepoint
            let ch_start = i;
            let mut ch_end = i + 1;
            while ch_end < bytes.len() && (bytes[ch_end] & 0xC0) == 0x80 {
                ch_end += 1;
            }
            out.push_str(&xml[ch_start..ch_end]);
            i = ch_end;
        } else {
            i += 1;
        }
    }
    out
}

// ───── shared normalization ─────

fn normalize(s: &str) -> String {
    // 1. drop unicode controls (except \n and \t); strip soft hyphen
    let mut buf: String = s
        .chars()
        .filter_map(|c| {
            if c == '\n' || c == '\t' {
                Some(c)
            } else if c == '\u{00AD}' {
                None // soft hyphen
            } else if c == '\u{3000}' {
                Some(' ') // ideographic space → regular space
            } else if c.is_control() {
                None
            } else {
                Some(c)
            }
        })
        .collect();

    // 2. CRLF → LF
    buf = buf.replace("\r\n", "\n").replace('\r', "\n");

    // 3. merge soft line wraps that broke a hyphenated word: "tion-\n al" → "tional"
    //    Only when the previous char and the first non-space after \n are word chars.
    let mut merged = String::with_capacity(buf.len());
    let chars: Vec<char> = buf.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '-' && i + 1 < chars.len() && chars[i + 1] == '\n' {
            // peek the next word char after newline+whitespace
            let mut j = i + 2;
            while j < chars.len() && (chars[j] == ' ' || chars[j] == '\t') {
                j += 1;
            }
            let prev_is_word = i > 0 && chars[i - 1].is_alphabetic();
            let next_is_word = j < chars.len() && chars[j].is_alphabetic();
            if prev_is_word && next_is_word {
                // skip the '-' and the '\n' (and any spaces)
                i = j;
                continue;
            }
        }
        merged.push(c);
        i += 1;
    }

    // 4. collapse 3+ blank lines to 2 (one empty line as paragraph break)
    let mut collapsed = String::with_capacity(merged.len());
    let mut blank_run = 0;
    for line in merged.split('\n') {
        if line.trim().is_empty() {
            blank_run += 1;
            if blank_run <= 1 {
                collapsed.push('\n');
            }
        } else {
            blank_run = 0;
            collapsed.push_str(line);
            collapsed.push('\n');
        }
    }

    // 5. trim trailing whitespace on each line
    collapsed
        .lines()
        .map(|l| l.trim_end())
        .collect::<Vec<_>>()
        .join("\n")
        .trim_matches('\n')
        .to_string()
}

fn cap_bytes(s: &str, max: usize) -> (String, bool) {
    if s.len() <= max {
        return (s.to_string(), false);
    }
    // walk back to a char boundary
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    (s[..end].to_string(), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_merges_hyphenation() {
        let s = "interna-\ntional";
        assert_eq!(normalize(s), "international");
    }

    #[test]
    fn normalize_collapses_blanks() {
        let s = "a\n\n\n\nb";
        assert_eq!(normalize(s), "a\n\nb");
    }

    #[test]
    fn normalize_drops_soft_hyphen() {
        let s = "co\u{00AD}operate";
        assert_eq!(normalize(s), "cooperate");
    }

    #[test]
    fn docx_parses_paragraphs_and_entities() {
        let xml = r#"<w:p><w:r><w:t>Hello &amp; world</w:t></w:r></w:p><w:p><w:r><w:t>line 2</w:t></w:r></w:p>"#;
        let out = paragraphs_from_docx_xml(xml);
        assert!(out.contains("Hello & world"));
        assert!(out.contains("line 2"));
    }
}
