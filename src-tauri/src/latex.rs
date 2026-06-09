use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

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

fn compile_latex_inner(source: String) -> Result<CompileResult, String> {
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

    let started = SystemTime::now();
    let started_str = format!("{:?}", started);

    let output = Command::new(&tectonic)
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

            let mut log = String::new();
            log.push_str(&cmd_summary);
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
pub async fn compile_latex(source: String) -> Result<CompileResult, String> {
    tauri::async_runtime::spawn_blocking(move || compile_latex_inner(source))
        .await
        .map_err(|e| format!("join error: {e}"))?
}

#[tauri::command]
pub async fn tectonic_available() -> bool {
    find_tectonic().is_some()
}
