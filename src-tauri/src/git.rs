use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const REPO_SUBPATH: &str = "github_repo";

fn vault_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::paths::app_data_dir(app)
}

fn repo_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(vault_dir(app)?.join(REPO_SUBPATH))
}

#[derive(serde::Serialize)]
pub struct GitResult {
    pub success: bool,
    pub log: String,
    pub needs_pull: bool,
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
    // Lock line endings to LF (local scope only). Without this, Git for
    // Windows' default core.autocrlf=true rewrites pushed .tex to CRLF, which
    // a macOS peer then sees as LF — a spurious full-file diff every sync.
    let _ = run_git(&["config", "core.autocrlf", "false"], cwd, log);
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
    app: tauri::AppHandle,
    repo_url: String,
    pat: String,
    branch: String,
) -> Result<GitResult, String> {
    let dir = repo_dir(&app)?;
    let pat_clone = pat.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<GitResult, String> {
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
                needs_pull: false,
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
                needs_pull: false,
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
            needs_pull: false,
        })
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

#[tauri::command]
pub async fn git_disconnect(app: tauri::AppHandle) -> Result<GitResult, String> {
    let dir = repo_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<GitResult, String> {
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
            needs_pull: false,
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
pub async fn git_status(app: tauri::AppHandle) -> Result<GitStatus, String> {
    let dir = repo_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<GitStatus, String> {
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
    app: tauri::AppHandle,
    files: Vec<FileWrite>,
    deletes: Vec<String>,
    commit_message: String,
    repo_url: String,
    pat: String,
    branch: String,
    push: bool,
) -> Result<GitResult, String> {
    let dir = repo_dir(&app)?;
    let pat_clone = pat.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<GitResult, String> {
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
            let needs_pull = !pushed
                && (log.contains("non-fast-forward")
                    || log.contains("fetch first")
                    || log.contains("[rejected]"));
            return Ok(GitResult {
                success: pushed,
                log: redact(&log, &pat_clone),
                needs_pull,
            });
        }

        Ok(GitResult {
            success: true,
            log: redact(&log, &pat_clone),
            needs_pull: false,
        })
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

fn rev_parse(dir: &Path, rev: &str) -> Option<String> {
    let out = Command::new("git")
        .args(["rev-parse", "--verify", rev])
        .current_dir(dir)
        .output()
        .ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    }
}

fn count_revs(dir: &Path, range: &str) -> u32 {
    Command::new("git")
        .args(["rev-list", "--count", range])
        .current_dir(dir)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
        .unwrap_or(0)
}

#[derive(serde::Serialize)]
pub struct GitPullResult {
    pub success: bool,
    pub log: String,
    pub updated: bool,
    pub ahead: u32,
    pub behind: u32,
    pub head: Option<String>,
}

#[tauri::command]
pub async fn git_pull(
    app: tauri::AppHandle,
    repo_url: String,
    pat: String,
    branch: String,
) -> Result<GitPullResult, String> {
    let dir = repo_dir(&app)?;
    let pat_clone = pat.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<GitPullResult, String> {
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
        let _ = run_git(&["remote", "set-url", "origin", &auth], &dir, &mut log);
        let _ = ensure_user_config(&dir, &mut log);

        let remote_ref = format!("origin/{branch}");
        let before = rev_parse(&dir, &remote_ref);

        let fetched = run_git(&["fetch", "origin", &branch], &dir, &mut log)
            .map_err(|e| format!("run git failed: {e}"))?;
        if !fetched {
            // A branch that doesn't exist remotely yet (fresh/empty repo) is
            // not an error — there is simply nothing to pull.
            let missing_ref = log.contains("couldn't find remote ref");
            return Ok(GitPullResult {
                success: missing_ref,
                log: redact(&log, &pat_clone),
                updated: false,
                ahead: 0,
                behind: 0,
                head: None,
            });
        }

        let after = rev_parse(&dir, &remote_ref);
        let updated = before != after;
        let ahead = count_revs(&dir, &format!("{remote_ref}..{branch}"));
        let behind = count_revs(&dir, &format!("{branch}..{remote_ref}"));

        // Align the working tree so a later push fast-forwards. Import reads
        // origin/<branch> directly and is unaffected by this outcome.
        let _ = run_git(&["checkout", "-B", &branch], &dir, &mut log);
        if ahead == 0 {
            let _ = run_git(&["reset", "--hard", &remote_ref], &dir, &mut log);
        } else {
            let rebased = run_git(&["rebase", &remote_ref], &dir, &mut log).unwrap_or(false);
            if !rebased {
                let _ = run_git(&["rebase", "--abort"], &dir, &mut log);
                log.push_str("REBASE_CONFLICT\n");
            }
        }

        let head = Command::new("git")
            .args(["log", "-1", "--pretty=%h %s", &remote_ref])
            .current_dir(&dir)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty());

        Ok(GitPullResult {
            success: true,
            log: redact(&log, &pat_clone),
            updated,
            ahead,
            behind,
            head,
        })
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

#[derive(serde::Serialize)]
pub struct RepoFile {
    pub path: String,
    pub text: Option<String>,
    pub bytes_base64: Option<String>,
}

// Matches the per-compile asset budget; anything bigger is skipped and the
// frontend surfaces it as a warning (both content fields stay None).
const MAX_SNAPSHOT_FILE: usize = 30 * 1024 * 1024;
// Matches the upload limit in AssetsPanel/AttachmentsModal — oversized files
// can only come from manual pushes and never enter the local library.
const MAX_ASSET_FILE: usize = 5 * 1024 * 1024;

#[tauri::command]
pub async fn git_remote_snapshot(
    app: tauri::AppHandle,
    branch: String,
) -> Result<Vec<RepoFile>, String> {
    let dir = repo_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<RepoFile>, String> {
        if !dir.exists() {
            return Err("repo not connected".into());
        }
        let branch = if branch.trim().is_empty() {
            "main".to_string()
        } else {
            branch
        };
        let remote_ref = format!("origin/{branch}");

        let ls = Command::new("git")
            .args(["ls-tree", "-r", "--name-only", "-z", &remote_ref])
            .current_dir(&dir)
            .output()
            .map_err(|e| format!("run git failed: {e}"))?;
        if !ls.status.success() {
            // No remote branch yet → empty snapshot.
            return Ok(Vec::new());
        }
        let names = String::from_utf8_lossy(&ls.stdout).into_owned();

        let mut out = Vec::new();
        for path in names.split('\0').filter(|p| !p.is_empty()) {
            if path != "vault.json"
                && !path.starts_with("categories/")
                && !path.starts_with("assets/")
            {
                continue;
            }
            // Asset blobs are opaque binary regardless of extension; the
            // assets/_meta.json index is the only text file in that tree.
            let is_asset_blob = path.starts_with("assets/") && path != "assets/_meta.json";
            let limit = if is_asset_blob {
                MAX_ASSET_FILE
            } else {
                MAX_SNAPSHOT_FILE
            };
            let show = Command::new("git")
                .args(["show", &format!("{remote_ref}:{path}")])
                .current_dir(&dir)
                .output()
                .map_err(|e| format!("run git failed: {e}"))?;
            if !show.status.success() || show.stdout.len() > limit {
                out.push(RepoFile {
                    path: path.to_string(),
                    text: None,
                    bytes_base64: None,
                });
                continue;
            }
            if is_asset_blob || path.ends_with(".pdf") {
                out.push(RepoFile {
                    path: path.to_string(),
                    text: None,
                    bytes_base64: Some(BASE64.encode(&show.stdout)),
                });
            } else {
                out.push(RepoFile {
                    path: path.to_string(),
                    text: Some(String::from_utf8_lossy(&show.stdout).into_owned()),
                    bytes_base64: None,
                });
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}
