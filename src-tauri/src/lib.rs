mod ai;
mod git;
mod latex;
mod resume_cls;

use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: r#"
CREATE TABLE IF NOT EXISTS job_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  jd_text TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resume_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES job_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('tsx', 'pdf')),
  content TEXT,
  file_path TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_versions_category ON resume_versions(category_id);
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_category_icon_and_color",
            sql: r#"
ALTER TABLE job_categories ADD COLUMN icon TEXT;
ALTER TABLE job_categories ADD COLUMN color TEXT;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "allow_latex_kind",
            sql: r#"
CREATE TABLE resume_versions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES job_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('tsx', 'pdf', 'latex')),
  content TEXT,
  file_path TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO resume_versions_new (id, category_id, name, kind, content, file_path, notes, created_at, updated_at)
  SELECT id, category_id, name, kind, content, file_path, notes, created_at, updated_at FROM resume_versions;
DROP TABLE resume_versions;
ALTER TABLE resume_versions_new RENAME TO resume_versions;
CREATE INDEX IF NOT EXISTS idx_versions_category ON resume_versions(category_id);
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create_resume_checkpoints",
            sql: r#"
CREATE TABLE IF NOT EXISTS resume_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES resume_versions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  content TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(version_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_version
  ON resume_checkpoints(version_id, seq DESC);
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_resume_assets",
            sql: r#"
CREATE TABLE IF NOT EXISTS resume_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES resume_versions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(version_id, name)
);
CREATE INDEX IF NOT EXISTS idx_assets_version ON resume_assets(version_id);
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "create_global_assets_and_links",
            sql: r#"
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resume_version_assets (
  version_id INTEGER NOT NULL REFERENCES resume_versions(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY (version_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_va_version ON resume_version_assets(version_id);
CREATE INDEX IF NOT EXISTS idx_va_asset ON resume_version_assets(asset_id);
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "migrate_resume_assets_to_global",
            sql: r#"
-- Promote each per-version (name, bytes) to a global asset (dedup by name).
INSERT OR IGNORE INTO assets (name, bytes, size)
  SELECT name, bytes, length(bytes) FROM resume_assets;

-- Wire every old per-version row to the global asset with the same name.
INSERT OR IGNORE INTO resume_version_assets (version_id, asset_id)
  SELECT ra.version_id, a.id
  FROM resume_assets ra
  JOIN assets a ON a.name = ra.name;

DROP TABLE resume_assets;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add_bytes_b64_to_assets",
            sql: r#"
ALTER TABLE assets ADD COLUMN bytes_b64 TEXT;
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "drop_assets_without_b64",
            // Pre-v8 assets stored raw bytes via sqlx, which truncates binary
            // BLOBs. They cannot be salvaged; delete so the user re-uploads.
            sql: r#"
DELETE FROM assets WHERE bytes_b64 IS NULL OR bytes_b64 = '';
"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "add_git_key_for_remote_identity",
            // Stable identity between local rows and remote repo paths.
            // Backfilled lazily on first push; never changes on rename.
            sql: r#"
ALTER TABLE job_categories  ADD COLUMN git_key TEXT;
ALTER TABLE resume_versions ADD COLUMN git_key TEXT;
"#,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            latex::compile_latex,
            latex::tectonic_available,
            git::git_connect,
            git::git_disconnect,
            git::git_status,
            git::git_apply,
            git::git_pull,
            git::git_remote_snapshot,
            ai::ai_complete,
            ai::claude_code_check,
            ai::claude_code_run,
            ai::claude_code_cancel
        ])
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:vault.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
