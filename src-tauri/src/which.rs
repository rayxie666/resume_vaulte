//! Cross-platform executable discovery.
//!
//! A tiny, dependency-free `which`: scans `PATH` and, on Windows, tries each
//! `PATHEXT` suffix (`.EXE`/`.CMD`/`.BAT`/…) so npm shims like `claude.cmd`
//! resolve the same way the shell finds them. Centralizing the lookup here is
//! what lets `latex.rs` / `ai.rs` stay free of `#[cfg(windows)]` in their main
//! control flow (see spec 2026-06-12-windows-support §3.2).

use std::path::{Path, PathBuf};

/// Locate `name` on `PATH`. If `name` already contains a path separator it is
/// treated as a direct path. On Windows, `PATHEXT` suffixes are tried for bare
/// names. Returns the first existing match.
pub fn which(name: &str) -> Option<PathBuf> {
    if name.contains('/') || name.contains('\\') {
        let p = PathBuf::from(name);
        return p.is_file().then_some(p);
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .filter(|d| !d.as_os_str().is_empty())
        .find_map(|dir| probe_dir(&dir, name))
}

/// Like [`which`], but falls back to a list of candidate absolute paths when
/// the binary is not on `PATH`.
pub fn which_or(name: &str, fallbacks: &[PathBuf]) -> Option<PathBuf> {
    which(name).or_else(|| fallbacks.iter().find(|p| p.is_file()).cloned())
}

#[cfg(windows)]
fn probe_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    // A name that already carries an extension wins as-is.
    let direct = dir.join(name);
    if direct.is_file() {
        return Some(direct);
    }
    let pathext =
        std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    pathext
        .split(';')
        .filter(|e| !e.is_empty())
        .map(|ext| dir.join(format!("{name}{ext}")))
        .find(|cand| cand.is_file())
}

#[cfg(not(windows))]
fn probe_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    let cand = dir.join(name);
    cand.is_file().then_some(cand)
}
