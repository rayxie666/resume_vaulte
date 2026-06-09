use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const REPO_SUBPATH: &str = "github_repo";

fn vault_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join("Library/Application Support/com.zheruixie.resumevault")
}

fn repo_dir() -> PathBuf {
    vault_dir().join(REPO_SUBPATH)
}

#[derive(serde::Serialize)]
pub struct GitResult {
    pub success: bool,
    pub log: String,
}

#[derive(serde::Deserialize)]
pub struct FileWrite {
    pub path: String,
    pub text: Option<String>,
    pub bytes: Option<Vec<u8>>,
}

fn inject_token(url: &str, pat: &str) -> String {
    if let Some(stripped) = url.strip_prefix("https://") {
        if pat.is_empty() {
            return url.to_string();
        }
        format!("https://x-access-token:{}@{}", pat, stripped)
    } else {
        url.to_string()
    }
}

fn run_git(args: &[&str], cwd: &Path, log: &mut String) -> std::io::Result<bool> {
    log.push_str(&format!("$ git {}\n", args.join(" ")));
    let out = Command::new("git").args(args).current_dir(cwd).output()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !stdout.is_empty() {
        log.push_str(&stdout);
        if !stdout.ends_with('\n') {
            log.push('\n');
        }
    }
    if !stderr.is_empty() {
        log.push_str(&stderr);
        if !stderr.ends_with('\n') {
            log.push('\n');
        }
    }
    Ok(out.status.success())
}

fn ensure_user_config(cwd: &Path, log: &mut String) -> std::io::Result<()> {
    let _ = run_git(
        &["config", "user.email", "resume-vault@local"],
        cwd,
        log,
    );
    let _ = run_git(&["config", "user.name", "Resume Vault"], cwd, log);
    Ok(())
}

fn redact(log: &str, pat: &str) -> String {
    if pat.is_empty() {
        return log.to_string();
    }
    log.replace(pat, "***")
}

#[tauri::command]
pub async fn git_connect(
    repo_url: String,
    pat: String,
    branch: String,
) -> Result<GitResult, String> {
    let pat_clone = pat.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<GitResult, String> {
        let dir = repo_dir();
        let auth = inject_token(&repo_url, &pat_clone);
        let branch = if branch.trim().is_empty() {
            "main".to_string()
        } else {
            branch
        };
        let mut log = String::new();

        // Remove any prior local clone for a fresh start.
        if dir.exists() {
            let _ = fs::remove_dir_all(&dir);
        }
        fs::create_dir_all(dir.parent().unwrap())
            .map_err(|e| format!("create vault dir failed: {e}"))?;

        let parent = dir.parent().unwrap().to_path_buf();
        // Try to clone first.
        let cloned = run_git(
            &["clone", "--branch", &branch, &auth, dir.to_str().unwrap()],
            &parent,
            &mut log,
        )
        .map_err(|e| format!("run git failed: {e}"))?;

        if cloned {
            let _ = ensure_user_config(&dir, &mut log);
            return Ok(GitResult {
                success: true,
                log: redact(&log, &pat_clone),
            });
        }

        // Maybe branch doesn't exist yet — clone default and create the branch.
        // First try cloning without --branch.
        if dir.exists() {
            let _ = fs::remove_dir_all(&dir);
        }
        let cloned_default = run_git(
            &["clone", &auth, dir.to_str().unwrap()],
            &parent,
            &mut log,
        )
        .map_err(|e| format!("run git failed: {e}"))?;

        if cloned_default {
            let _ = ensure_user_config(&dir, &mut log);
            let _ = run_git(&["checkout", "-B", &branch], &dir, &mut log);
            return Ok(GitResult {
                success: true,
                log: redact(&log, &pat_clone),
            });
        }

        // Likely empty repo. Init locally + set remote.
        fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;
        run_git(&["init", "-b", &branch], &dir, &mut log)
            .map_err(|e| format!("run git failed: {e}"))?;
        let _ = run_git(&["remote", "add", "origin", &auth], &dir, &mut log);
        let _ = ensure_user_config(&dir, &mut log);

        Ok(GitResult {
            success: true,
            log: redact(&log, &pat_clone),
        })
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

#[tauri::command]
pub async fn git_disconnect() -> Result<GitResult, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<GitResult, String> {
        let dir = repo_dir();
        let mut log = String::new();
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| format!("remove failed: {e}"))?;
            log.push_str(&format!("removed {}\n", dir.display()));
        } else {
            log.push_str("no repo to remove\n");
        }
        Ok(GitResult {
            success: true,
            log,
        })
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

#[derive(serde::Serialize)]
pub struct GitStatus {
    pub connected: bool,
    pub head: Option<String>,
    pub remote: Option<String>,
}

#[tauri::command]
pub async fn git_status() -> Result<GitStatus, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<GitStatus, String> {
        let dir = repo_dir();
        if !dir.exists() {
            return Ok(GitStatus {
                connected: false,
                head: None,
                remote: None,
            });
        }
        let head = Command::new("git")
            .args(["log", "-1", "--pretty=%h %s"])
            .current_dir(&dir)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    if s.is_empty() {
                        None
                    } else {
                        Some(s)
                    }
                } else {
                    None
                }
            });
        let remote = Command::new("git")
            .args(["config", "--get", "remote.origin.url"])
            .current_dir(&dir)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    if s.is_empty() {
                        None
                    } else {
                        // Strip the embedded token if present.
                        Some(strip_token(&s))
                    }
                } else {
                    None
                }
            });
        Ok(GitStatus {
            connected: true,
            head,
            remote,
        })
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

fn strip_token(url: &str) -> String {
    // https://x-access-token:TOKEN@github.com/owner/repo.git
    // → https://github.com/owner/repo.git
    if let Some(rest) = url.strip_prefix("https://") {
        if let Some(at_idx) = rest.find('@') {
            return format!("https://{}", &rest[at_idx + 1..]);
        }
    }
    url.to_string()
}

#[tauri::command]
pub async fn git_apply(
    files: Vec<FileWrite>,
    deletes: Vec<String>,
    commit_message: String,
    repo_url: String,
    pat: String,
    branch: String,
    push: bool,
) -> Result<GitResult, String> {
    let pat_clone = pat.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<GitResult, String> {
        let dir = repo_dir();
        if !dir.exists() {
            return Err("repo not connected".into());
        }
        let branch = if branch.trim().is_empty() {
            "main".to_string()
        } else {
            branch
        };
        let auth = inject_token(&repo_url, &pat_clone);
        let mut log = String::new();

        // Update auth URL in case PAT rotated.
        let _ = run_git(
            &["remote", "set-url", "origin", &auth],
            &dir,
            &mut log,
        );
        let _ = ensure_user_config(&dir, &mut log);

        // Write files
        for f in &files {
            let target = dir.join(&f.path);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!("mkdir {} failed: {e}", parent.display())
                })?;
            }
            if let Some(t) = &f.text {
                fs::write(&target, t).map_err(|e| {
                    format!("write {} failed: {e}", target.display())
                })?;
            } else if let Some(b) = &f.bytes {
                fs::write(&target, b).map_err(|e| {
                    format!("write {} failed: {e}", target.display())
                })?;
            } else {
                // touch
                fs::write(&target, "").ok();
            }
        }
        // Delete files
        for d in &deletes {
            let target = dir.join(d);
            if target.exists() {
                if target.is_file() {
                    let _ = fs::remove_file(&target);
                } else {
                    let _ = fs::remove_dir_all(&target);
                }
            }
        }

        // Stage + commit
        let _ = run_git(&["add", "-A"], &dir, &mut log);

        // Check if there's anything to commit
        let diff_out = Command::new("git")
            .args(["diff", "--cached", "--quiet"])
            .current_dir(&dir)
            .output()
            .map_err(|e| format!("git diff failed: {e}"))?;
        let has_changes = !diff_out.status.success();

        if has_changes {
            let _ = run_git(&["commit", "-m", &commit_message], &dir, &mut log);
        } else {
            log.push_str("(nothing to commit)\n");
        }

        if push {
            // Make sure we're on the right branch.
            let _ = run_git(&["checkout", "-B", &branch], &dir, &mut log);
            let pushed = run_git(
                &["push", "-u", "origin", &branch],
                &dir,
                &mut log,
            )
            .map_err(|e| format!("run git failed: {e}"))?;
            return Ok(GitResult {
                success: pushed,
                log: redact(&log, &pat_clone),
            });
        }

        Ok(GitResult {
            success: true,
            log: redact(&log, &pat_clone),
        })
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}
