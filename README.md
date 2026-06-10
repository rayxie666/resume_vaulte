# Resume Vault

A local-first desktop app for managing multiple resume versions across job
categories. Built with Tauri 2 + React 19 + TypeScript. Stores everything in
local SQLite + filesystem, with optional two-way sync to a GitHub repo for
backup, remote access, and restoring the vault on a new machine.

Features:

- **Categories** — one per target role / company; each holds many resume versions
- **Versions** — LaTeX source (compiled live with Tectonic) or imported PDF
- **Side-by-side LaTeX preview** — type on the left, PDF rendered on the right (debounced 800 ms)
- **Checkpoints** — git-style snapshots per version with notes; diff and restore
- **PDF thumbnails** — first-page preview on PDF cards (PDF.js)
- **Bulk delete** — iOS-style selection mode for categories and versions
- **i18n** — English / 中文 / follow system
- **GitHub sync** — two-way sync with a private repo (PAT auth, single branch + folders): push the vault, pull remote edits back, restore a full vault on a new machine
- **iOS-flavored UI** — light/dark mode, blur navbar, rounded cards

## Requirements

You'll need these installed before running the app:

| Tool                                   | Purpose                                     | macOS install                    |
| -------------------------------------- | ------------------------------------------- | -------------------------------- |
| **Node.js ≥ 20**                       | Vite dev server, npm scripts                | `brew install node`              |
| **Rust (stable, ≥ 1.78)**              | Tauri backend                               | `curl -sSf https://sh.rustup.rs \| sh -s -- -y` |
| **Xcode Command Line Tools**           | C linker / SDK for Tauri builds             | `xcode-select --install`         |
| **Tectonic** _(only for LaTeX preview)_ | Single-binary LaTeX engine, auto-fetches packages | `brew install tectonic`     |
| **git ≥ 2.30** _(only for GitHub sync)_ | Runs `git clone/commit/push` from Rust     | already on macOS via Xcode CLT   |

The app degrades gracefully if Tectonic or git are missing — LaTeX preview /
GitHub sync just stop working, the rest still does.

> **Note on Rust**: after installing via rustup, `cargo` lives in
> `~/.cargo/bin`, which is only added to `PATH` for **new** shells (rustup
> appends `. "$HOME/.cargo/env"` to your shell profile). In the terminal you
> ran the installer from, run `source "$HOME/.cargo/env"` first — otherwise
> `tauri dev` fails with a confusing `failed to run 'cargo metadata'` error
> (see [Troubleshooting](#troubleshooting)).

## Quick start

```bash
# 0. verify prerequisites — all four must print a version
node --version    # ≥ 20
cargo --version   # ≥ 1.78  (missing? see Requirements above, then `source ~/.cargo/env`)
cc --version      # Xcode CLT
git --version

# 1. clone
git clone git@github.com:rayxie666/resume_vaulte.git
cd resume_vaulte

# 2. install JS deps (Vite, React, Tauri JS plugins, pdfjs, jsdiff)
npm install

# 3. launch in dev mode — opens a native window, hot-reload for frontend,
# auto-rebuild for Rust on change
npm run tauri dev
```

First Rust build is slow (~1-3 min, downloads ~100 crates). Subsequent dev
launches are seconds.

## Troubleshooting

**`failed to run 'cargo metadata' ... No such file or directory (os error 2)`**
when running `npm run tauri dev` — Tauri can't find `cargo` on your `PATH`.
Either Rust isn't installed (see [Requirements](#requirements)), or it was just
installed and the current shell hasn't picked it up yet:

```bash
source "$HOME/.cargo/env"   # fix the current shell
cargo --version             # should now print a version
```

New terminals get it automatically via your shell profile.

**Gatekeeper blocks the built `.app`** — see
[Building a release](#building-a-release-app--dmg) below; the binary is
unsigned.

**`tectonic not found. Install with: brew install tectonic`** (shown in the
LaTeX preview pane) — the Tectonic engine isn't installed. Fix:

```bash
brew install tectonic
```

Then restart the app (a running instance won't pick up the new binary). The
first compile is slow: Tectonic downloads LaTeX packages on demand and caches
them under `~/Library/Caches/Tectonic`.

## Building a release `.app` / `.dmg`

```bash
npm run tauri build
```

Outputs:

```
src-tauri/target/release/bundle/
├── macos/
│   └── resume-vault.app           # double-clickable .app bundle
└── dmg/
    └── resume-vault_0.1.0_aarch64.dmg
```

The binary is unsigned. On first launch macOS Gatekeeper will block it:

- **Finder** → right-click `resume-vault.app` → **Open** → **Open**
- Or: `xattr -dr com.apple.quarantine resume-vault.app`

To sign + notarize for distribution, set up Apple Developer credentials and
follow [Tauri's macOS signing guide](https://tauri.app/v2/distribute/sign/macos/).

Prebuilt artifacts: see [Releases](https://github.com/rayxie666/resume_vaulte/releases).

## Attachments (LaTeX images / extra files)

LaTeX templates that use `\includegraphics{logo.png}` or other external assets
won't compile out of the box — Tectonic runs in a fresh temp directory and
needs the files alongside `main.tex`. The app handles this via a per-version
**Attachments** panel:

1. Open a LaTeX version → click **Attachments** in the editor toolbar.
2. Add PNG/JPG/PDF/EPS files (max 5 MB each, 30 MB total per compile).
3. The file's base name is what `\includegraphics{...}` references, e.g. an
   uploaded `bytedance.png` is reachable as `\includegraphics{bytedance.png}`.
4. Preview recompiles automatically; assets are written to the temp dir each
   time and removed after.

Attachments live in the SQLite vault (global `assets` table, base64-encoded)
and are linked to versions via `resume_version_assets`. When GitHub sync is
connected they are pushed to `assets/<name>` in the repo (with an
`assets/_meta.json` index) and restored on pull, including the
version↔attachment links.

The Rust side rejects illegal names (`..`, slashes, dotfiles) and oversized
files with a clear hint in the compile log.

## Where data lives

```
~/Library/Application Support/com.zheruixie.resumevault/
├── vault.db                  # SQLite: categories, versions, checkpoints
├── pdfs/                     # imported PDF files (referenced by file_path)
├── last-compile.log          # most recent Tectonic invocation (for debugging)
└── github_repo/              # working tree of your synced GitHub repo (if connected)
```

Delete that folder to nuke the app's state completely.

## GitHub sync

In the app: **Settings (⚙)** → **GitHub Sync**.

1. Create a private repo (e.g. `rayxie666/resume_vaulte_data`).
2. Generate a fine-grained PAT at
   <https://github.com/settings/personal-access-tokens> with:
   - Resource owner: yourself
   - Repository access: only the vault repo
   - Permissions → **Contents: Read and Write**
3. Paste URL + PAT in the app, pick a branch (defaults to `main`), Connect.
4. Hit **Sync now** for a full snapshot, or toggle **Auto-push on checkpoint** to
   push every snapshot you save in the LaTeX editor.

Repo layout the app writes:

```
vault.json                       # top-level index of categories
README.md
assets/
  _meta.json                     # name → { mime, size, updated_at }
  logo.png                       # attachment bytes, filename = identity
categories/
  1-google-swe/
    _meta.json                   # category info (name, JD, icon, color, notes)
    1-polished.tex               # latex source
    1-polished.json              # version metadata
    2-imported.pdf               # imported binary
    2-imported.json
  3-bytedance-sre/
    ...
```

Each checkpoint commits with message `v<seq> <name> (<category>): <note>`, so
the `git log` of any `.tex` file is exactly its checkpoint history.

The PAT is stored only in `localStorage` and never leaves your machine except
as part of the `https://x-access-token:TOKEN@github.com/...` URL Tauri's git
process uses internally. Compile logs redact the token to `***`.

## Project layout

```
resume-vault/
├── src/                        # React frontend (Vite + TS)
│   ├── App.tsx                 # main UI, navigation, modals
│   ├── HistoryPanel.tsx        # checkpoint diff/restore
│   ├── Dialogs.tsx             # prompt/confirm modals (WKWebView blocks window.prompt)
│   ├── db.ts                   # tauri-plugin-sql wrapper
│   ├── github.ts               # vault → file-tree serializer + git invokes
│   ├── latexCompile.ts         # invoke Rust compile_latex
│   ├── thumbnail.ts            # PDF.js → dataURL for cards
│   ├── useThumbnail.ts         # cached, queued thumbnail hook
│   ├── i18n.ts                 # en/zh translation context
│   └── ...
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── lib.rs              # app entry, plugin + command registration, SQL migrations
│   │   ├── latex.rs            # tectonic invocation, log capture
│   │   ├── resume_cls.rs       # bundled LaTeX class for the default template
│   │   └── git.rs              # git clone / commit / push wrappers
│   ├── Cargo.toml
│   └── tauri.conf.json         # window config, identifier
├── package.json
└── README.md
```

## Development notes

- **Hot reload**: edits to `src/` reload instantly via Vite HMR; edits to
  `src-tauri/` trigger a Cargo rebuild and Tauri restart.
- **Native dialogs (alert/prompt/confirm)** are blocked by WKWebView. Use the
  React modal system in `src/Dialogs.tsx`.
- **SQL migrations** are append-only in `src-tauri/src/lib.rs`. Bump the
  `version` and add a `Migration { ... }` entry. They run once per install on
  startup.
- **PDF.js worker** is bundled via `?worker` import (see `src/thumbnail.ts`) to
  avoid Tauri custom-protocol Worker loading issues.
- **Concurrency**: thumbnail rendering uses a 2-job queue (`src/useThumbnail.ts`)
  to avoid pinning the CPU when 10 PDF cards mount at once.

## Tech stack

- [Tauri 2](https://tauri.app/) — desktop wrapper, ~10 MB Rust binary
- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) — frontend
- [Vite 7](https://vitejs.dev/) — dev server / bundler
- [tauri-plugin-sql](https://github.com/tauri-apps/plugins-workspace) — SQLite
- [tauri-plugin-fs](https://github.com/tauri-apps/plugins-workspace) / [-dialog](https://github.com/tauri-apps/plugins-workspace) — file I/O
- [Tectonic](https://tectonic-typesetting.github.io/) — LaTeX → PDF
- [PDF.js](https://mozilla.github.io/pdf.js/) — first-page thumbnails
- [jsdiff](https://github.com/kpdecker/jsdiff) — checkpoint diff rendering

## Bundled fonts

The macOS app bundle ships three FontAwesome 5 Free OTFs
(`src-tauri/resources/fonts/`) and copies them into Tectonic's working
directory at compile time via the `OSFONTDIR` env var. This lets
`\usepackage{fontawesome5}` work out of the box on machines that don't have the
fonts installed system-wide. The fonts are licensed under
[SIL OFL 1.1](https://scripts.sil.org/OFL); see `LICENSE.txt` in the fonts
folder.

## License

MIT (app code).
FontAwesome 5 Free fonts under SIL OFL 1.1 (see `src-tauri/resources/fonts/LICENSE.txt`).
