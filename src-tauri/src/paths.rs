//! Application data directory resolution.
//!
//! Replaces the old hardcoded `$HOME/Library/Application Support/<id>` with
//! Tauri's platform-aware resolver: macOS → `~/Library/Application
//! Support/com.zheruixie.resumevault`, Windows → `%APPDATA%\
//! com.zheruixie.resumevault`. The bundle identifier is unchanged, so existing
//! macOS data is reused in place (spec 2026-06-12-windows-support §3.1).

use std::path::PathBuf;
use tauri::Manager;

pub fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("resolve app_data_dir failed: {e}"))
}
