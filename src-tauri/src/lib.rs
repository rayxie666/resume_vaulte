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
    ];

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            latex::compile_latex,
            latex::tectonic_available,
            git::git_connect,
            git::git_disconnect,
            git::git_status,
            git::git_apply
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
