use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const MAX_ASSET_BYTES: usize = 5 * 1024 * 1024; // 5 MB per file
const MAX_TOTAL_ASSET_BYTES: usize = 30 * 1024 * 1024; // 30 MB total

const BUNDLED_FONTS: &[&str] = &[
    "FontAwesome5Free-Solid-900.otf",
    "FontAwesome5Free-Regular-400.otf",
    "FontAwesome5Brands-Regular-400.otf",
];

fn resource_fonts_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/fonts");
        if dev.exists() {
            return Some(dev);
        }
    }
    app.path()
        .resource_dir()
        .ok()
        .map(|p| p.join("resources/fonts"))
        .filter(|p| p.exists())
}

fn stage_fonts(dir: &Path, fonts_src: &Path, log: &mut String) -> usize {
    let mut staged = 0usize;
    for name in BUNDLED_FONTS {
        let src = fonts_src.join(name);
        if !src.exists() {
            log.push_str(&format!("[font missing in resources]: {name}\n"));
            continue;
        }
        if let Err(e) = fs::copy(&src, dir.join(name)) {
            log.push_str(&format!("[font copy failed]: {name}: {e}\n"));
        } else {
            staged += 1;
        }
    }
    if staged > 0 {
        log.push_str(&format!("fonts staged: {} OTFs\n", staged));
    }
    staged
}

/// Apply source-level workarounds for known engine bugs before compiling.
///
/// 1. `fontawesome5` triggers `\XeTeXglyphname` which segfaults in Tectonic
///    0.16.x. The v4 `fontawesome` package supports the same `\faPhone /
///    \faEnvelope / \faLinkedin / ...` commands without that introspection.
/// 2. `\input{glyphtounicode}` and `\pdfgentounicode=1` are pdftex-specific
///    and undefined in XeTeX; comment them out (XeTeX is Unicode native).
fn apply_compat_rewrites(source: &str, log: &mut String) -> String {
    let mut s = source.to_string();

    let fa = "\\usepackage{fontawesome5}";
    if s.contains(fa) {
        log.push_str(
            "[compat] \\usepackage{fontawesome5} → \\usepackage{fontawesome} \
             (Tectonic XeTeX cannot introspect fontawesome5 glyphs).\n",
        );
        s = s.replace(fa, "\\usepackage{fontawesome}");
    }

    let gtu = "\\input{glyphtounicode}";
    if s.contains(gtu) {
        log.push_str("[compat] commented out \\input{glyphtounicode} (pdftex-only).\n");
        s = s.replace(gtu, "%\\input{glyphtounicode} [removed: pdftex-only]");
    }

    let pdfgtu = "\\pdfgentounicode=1";
    if s.contains(pdfgtu) {
        log.push_str("[compat] commented out \\pdfgentounicode=1 (pdftex-only).\n");
        s = s.replace(pdfgtu, "%\\pdfgentounicode=1 [removed: pdftex-only]");
    }

    s
}

#[derive(serde::Deserialize, Default)]
pub struct CompileRequest {
    pub source: String,
    #[serde(default)]
    pub assets: Vec<CompileAsset>,
}

#[derive(serde::Deserialize)]
pub struct CompileAsset {
    pub name: String,
    #[serde(rename = "bytesBase64")]
    pub bytes_base64: String,
}

fn validate_asset_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("asset name empty".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("asset name '{name}' contains illegal path chars"));
    }
    if name.starts_with('.') {
        return Err(format!("asset name '{name}' must not start with '.'"));
    }
    Ok(())
}

fn write_assets(
    dir: &Path,
    assets: &[CompileAsset],
    log: &mut String,
) -> Result<(), String> {
    let mut total: usize = 0;
    let mut written: Vec<String> = Vec::new();
    for a in assets {
        if let Err(e) = validate_asset_name(&a.name) {
            log.push_str(&format!("[asset rejected]: {e}\n"));
            continue;
        }
        let bytes = match BASE64.decode(a.bytes_base64.as_bytes()) {
            Ok(b) => b,
            Err(e) => {
                log.push_str(&format!(
                    "[asset rejected]: '{}' base64 decode failed: {e}\n",
                    a.name
                ));
                continue;
            }
        };
        if bytes.len() > MAX_ASSET_BYTES {
            log.push_str(&format!(
                "[asset rejected]: '{}' is {} bytes (limit {})\n",
                a.name,
                bytes.len(),
                MAX_ASSET_BYTES
            ));
            continue;
        }
        total += bytes.len();
        if total > MAX_TOTAL_ASSET_BYTES {
            log.push_str(&format!(
                "[asset rejected]: total exceeds {} bytes, stopped at '{}'\n",
                MAX_TOTAL_ASSET_BYTES, a.name
            ));
            break;
        }
        let target = dir.join(&a.name);
        if let Err(e) = fs::write(&target, &bytes) {
            log.push_str(&format!("[asset write failed] {}: {e}\n", a.name));
            continue;
        }
        written.push(a.name.clone());
    }
    if !written.is_empty() {
        log.push_str(&format!("assets written: {}\n", written.join(", ")));
    }
    Ok(())
}

fn summarize_errors(main_log: &str) -> Vec<String> {
    let mut hints: Vec<String> = Vec::new();
    for line in main_log.lines() {
        let l = line.trim();
        // Missing file: "! LaTeX Error: File `foo.png' not found."
        if let Some(idx) = l.find("LaTeX Error: File `") {
            let after = &l[idx + "LaTeX Error: File `".len()..];
            if let Some(end) = after.find('\'') {
                let name = &after[..end];
                hints.push(format!(
                    "Missing asset: '{name}'. Upload it via the attachments panel."
                ));
            }
        }
        // Cannot include: "! Package pdftex.def Error: File `foo.png' not found"
        if l.contains("pdftex.def Error: File `") {
            if let Some(start) = l.find('`') {
                let after = &l[start + 1..];
                if let Some(end) = after.find('\'') {
                    let name = &after[..end];
                    hints.push(format!(
                        "Missing asset: '{name}'. Upload it via the attachments panel."
                    ));
                }
            }
        }
        if l.contains("Package fontawesome5 Error")
            || l.contains("fontawesome5.sty")
        {
            hints.push(
                "fontawesome5 needs internet on first compile to download fonts. \
                 Re-run with a connection.".into(),
            );
        }
        if l.starts_with("! Undefined control sequence")
            || l.contains("! Undefined control sequence")
        {
            // dedupe
            let hint = "Undefined control sequence — likely a missing \\usepackage{...} or a typo.";
            if !hints.iter().any(|h| h == hint) {
                hints.push(hint.into());
            }
        }
    }
    // dedupe missing-file hints (same file mentioned multiple times)
    let mut seen = std::collections::HashSet::new();
    hints.retain(|h| seen.insert(h.clone()));
    hints
}

const COMMON_PATHS: &[&str] = &[
    "/opt/homebrew/bin/tectonic",
    "/usr/local/bin/tectonic",
    "/usr/bin/tectonic",
];

fn find_tectonic() -> Option<PathBuf> {
    for p in COMMON_PATHS {
        let path = PathBuf::from(p);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

#[derive(serde::Serialize)]
pub struct CompileResult {
    pub success: bool,
    pub pdf: Option<Vec<u8>>,
    pub log: String,
}

fn unique_dir_name() -> String {
    let ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("resume-vault-{}", ns)
}

fn compile_latex_inner(
    source: String,
    assets: Vec<CompileAsset>,
    fonts_src: Option<PathBuf>,
) -> Result<CompileResult, String> {
    let tectonic = find_tectonic()
        .ok_or_else(|| "tectonic not found. Install with `brew install tectonic`.".to_string())?;
    let dir = std::env::temp_dir().join(unique_dir_name());
    fs::create_dir_all(&dir).map_err(|e| format!("create temp dir failed: {e}"))?;
    let tex = dir.join("main.tex");
    fs::write(&tex, source.as_bytes()).map_err(|e| format!("write tex failed: {e}"))?;

    // Always provide the bundled resume.cls so templates using `\documentclass{resume}` work.
    let cls = dir.join("resume.cls");
    fs::write(&cls, crate::resume_cls::RESUME_CLS.as_bytes())
        .map_err(|e| format!("write resume.cls failed: {e}"))?;

    let mut prelude = String::new();
    let _ = write_assets(&dir, &assets, &mut prelude);

    // Rewrite known-broken package usage (e.g. fontawesome5 → fontawesome v4)
    // before handing to tectonic.
    let source = apply_compat_rewrites(&source, &mut prelude);
    fs::write(&tex, source.as_bytes()).map_err(|e| format!("rewrite tex failed: {e}"))?;

    // Stage bundled FontAwesome 5 fonts into the temp dir; XeTeX/fontspec
    // can pick them up via kpathsea / OSFONTDIR. Kept as a safety net even
    // though the v4 compat rewrite usually means we don't need them.
    let mut fonts_staged = 0usize;
    if let Some(src) = fonts_src.as_ref() {
        fonts_staged = stage_fonts(&dir, src, &mut prelude);
    } else {
        prelude.push_str("[warn] FontAwesome fonts not bundled in this build.\n");
    }
    let _ = fonts_staged;

    let started = SystemTime::now();
    let started_str = format!("{:?}", started);

    let output = Command::new(&tectonic)
        .env("OSFONTDIR", &dir)
        .arg("-X")
        .arg("compile")
        .arg("--keep-logs")
        .arg("--print")
        .arg("--outdir")
        .arg(&dir)
        .arg(&tex)
        .output();

    let elapsed = SystemTime::now()
        .duration_since(started)
        .map(|d| d.as_secs_f32())
        .unwrap_or(0.0);

    let cmd_summary = format!(
        "$ {} -X compile --keep-logs --print --outdir {} {}\nstarted: {}\nelapsed: {:.2}s\n",
        tectonic.display(),
        dir.display(),
        tex.display(),
        started_str,
        elapsed,
    );

    let result = match output {
        Ok(out) => {
            let exit_code = out
                .status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "<terminated by signal>".into());
            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
            let pdf_path = dir.join("main.pdf");
            let log_path = dir.join("main.log");
            let pdf_exists = pdf_path.exists();
            let pdf_size = if pdf_exists {
                fs::metadata(&pdf_path).map(|m| m.len()).unwrap_or(0)
            } else {
                0
            };
            let main_log = fs::read_to_string(&log_path).unwrap_or_else(|e| {
                format!("[main.log not available: {e}]")
            });

            let hints = summarize_errors(&main_log);
            let mut log = String::new();
            if !hints.is_empty() {
                log.push_str("=== hints ===\n");
                for h in &hints {
                    log.push_str(&format!("* {h}\n"));
                }
                log.push_str("\n");
            }
            log.push_str(&cmd_summary);
            if !prelude.is_empty() {
                log.push_str(&prelude);
            }
            log.push_str(&format!(
                "exit: {} | pdf: {} ({} bytes)\n",
                exit_code,
                if pdf_exists { "yes" } else { "no" },
                pdf_size,
            ));
            log.push_str("\n=== tectonic stderr ===\n");
            if stderr.is_empty() {
                log.push_str("(empty)\n");
            } else {
                log.push_str(&stderr);
                if !stderr.ends_with('\n') {
                    log.push('\n');
                }
            }
            log.push_str("\n=== tectonic stdout ===\n");
            if stdout.is_empty() {
                log.push_str("(empty)\n");
            } else {
                log.push_str(&stdout);
                if !stdout.ends_with('\n') {
                    log.push('\n');
                }
            }
            log.push_str("\n=== main.log ===\n");
            log.push_str(&main_log);

            if out.status.success() && pdf_exists {
                match fs::read(&pdf_path) {
                    Ok(bytes) => CompileResult {
                        success: true,
                        pdf: Some(bytes),
                        log,
                    },
                    Err(e) => CompileResult {
                        success: false,
                        pdf: None,
                        log: format!("{log}\n[read pdf failed]: {e}"),
                    },
                }
            } else {
                CompileResult {
                    success: false,
                    pdf: None,
                    log,
                }
            }
        }
        Err(e) => CompileResult {
            success: false,
            pdf: None,
            log: format!("{cmd_summary}\n[failed to spawn tectonic]: {e}"),
        },
    };

    // Persist last compile log to AppData so the user can inspect it.
    let _ = persist_last_log(&result.log);

    let _ = cleanup_dir(&dir);
    Ok(result)
}

fn persist_last_log(log: &str) -> std::io::Result<()> {
    let home = std::env::var("HOME").unwrap_or_default();
    let dir = PathBuf::from(home)
        .join("Library/Application Support/com.zheruixie.resumevault");
    fs::create_dir_all(&dir)?;
    fs::write(dir.join("last-compile.log"), log)
}

fn cleanup_dir(dir: &Path) -> std::io::Result<()> {
    fs::remove_dir_all(dir)
}

#[tauri::command]
pub async fn compile_latex(
    app: tauri::AppHandle,
    req: CompileRequest,
) -> Result<CompileResult, String> {
    let fonts_src = resource_fonts_dir(&app);
    let CompileRequest { source, assets } = req;
    tauri::async_runtime::spawn_blocking(move || {
        compile_latex_inner(source, assets, fonts_src)
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

#[tauri::command]
pub async fn tectonic_available() -> bool {
    find_tectonic().is_some()
}
