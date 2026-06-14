<div align="center">

# Resume Vault

*One vault for every version of you.*

Local-first desktop app for managing LaTeX/PDF resume versions —
live compile, git-style checkpoints, two-way GitHub sync.

[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1d1d1f?style=flat)](https://github.com/rayxie666/resume_vaulte)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8D8?style=flat&logo=tauri&logoColor=white)](https://tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/license-MIT-3da639?style=flat)](#license)
[![Release](https://img.shields.io/github/v/release/rayxie666/resume_vaulte?style=flat&color=b08d4a)](https://github.com/rayxie666/resume_vaulte/releases)

<picture>
  <source media="(prefers-color-scheme: dark)"
          srcset="docs/screenshots/00-hero.dark.png">
  <img src="docs/screenshots/00-hero.light.png" width="840"
       alt="Resume Vault — LaTeX editor with live PDF preview">
</picture>

</div>

## Download

Latest release: **v0.2.2** — or browse all on the
[Releases page](https://github.com/rayxie666/resume_vaulte/releases).

| OS | Installer |
| --- | --- |
| **macOS** (Apple Silicon) | [resume-vault_0.2.2_aarch64.dmg](https://github.com/rayxie666/resume_vaulte/releases/download/v0.2.2/resume-vault_0.2.2_aarch64.dmg) |
| **Windows** 10/11 (x64) | [resume-vault_0.2.2_x64-setup.exe](https://github.com/rayxie666/resume_vaulte/releases/download/v0.2.2/resume-vault_0.2.2_x64-setup.exe) · [.msi](https://github.com/rayxie666/resume_vaulte/releases/download/v0.2.2/resume-vault_0.2.2_x64_en-US.msi) |

The installers are unsigned, so the OS warns on first launch: macOS Gatekeeper
→ right-click the app → **Open**; Windows SmartScreen → **More info → Run
anyway**. To build from source instead, see [Quick start](#quick-start).

## Contents

- [Download](#download)
- [✨ Features](#-features)
- [Quick start](#quick-start)
- [Requirements](#requirements)
- [Windows](#windows)
- [GitHub sync](#github-sync)
- [Attachments (LaTeX images / extra files)](#attachments-latex-images--extra-files)
- [Where data lives](#where-data-lives)
- [Building a release `.app` / `.dmg`](#building-a-release-app--dmg)
- [Troubleshooting](#troubleshooting)
- [Architecture](#architecture)
- [Bundled fonts](#bundled-fonts)
- [License](#license)

## ✨ Features

### 🗂 Organize by target role

One category per company or role you're chasing — each with its own icon,
color, job description, and as many resume versions as the hunt requires.

<img src="docs/screenshots/10-home.png" width="800"
     alt="Home view: category cards for each target role">

### 📄 Every version, one glance

Versions show up as cards with live PDF thumbnails, so "the one with the
infra bullet points" is something you see, not something you remember.
Paste the job description right into the category and keep it one fold away.

<img src="docs/screenshots/20-versions.png" width="800"
     alt="Category view: version cards with PDF thumbnails and the job description block">

### ⚡ Type LaTeX, watch the PDF

Edit on the left, and the compiled page settles onto the light table on the
right a moment later. No save button mashing, no terminal — Tectonic compiles
in the background as you type.

<img src="docs/screenshots/30-editor.gif" width="800"
     alt="Animated: editing a LaTeX bullet and the PDF preview recompiling automatically">

<details>
<summary>Static view</summary>
<img src="docs/screenshots/31-editor.png" width="800"
     alt="Split view: LaTeX source beside the rendered PDF preview">
</details>

### ✦ Rewrite with an expert eye

Select a flabby bullet and ask the built-in AI assistant for a sharper one —
the suggestion arrives as an in-place diff you can accept or reject, tuned to
the job description you saved on the category.

<img src="docs/screenshots/40-ai-rewrite.png" width="800"
     alt="AI rewrite: inline diff of the old and suggested bullet with Accept and Reject actions">

### 🕰 Checkpoint, diff, restore

Never lose a good paragraph again. Snapshot a version whenever it feels right,
leave yourself a note, and diff or restore any earlier state later.

<img src="docs/screenshots/50-history.png" width="800"
     alt="History panel: checkpoint list with notes and a red/green diff against the current text">

### ☁️ Two-way GitHub sync

Connect a private repo and every checkpoint can push itself; pull edits made
elsewhere back in. Wipe your laptop, reinstall, reconnect — the vault comes
back whole.

<img src="docs/screenshots/60-github.png" width="800"
     alt="Settings: GitHub sync connected, with Sync now and Pull controls">

### 🖼 Assets that just compile

`\includegraphics{logo.png}` works the way you'd hope: attach the file once
and every compile of that version can see it — synced to GitHub along with
everything else.

<img src="docs/screenshots/70-attachments.png" width="800"
     alt="Attachments panel: image files linked to a resume version">

### 🌗 Dark-first, light-ready

A midnight-letterpress dark theme for late-night editing, a clean paper-white
one for daylight — both follow the system automatically.

<img src="docs/screenshots/80-themes.png" width="800"
     alt="The same view rendered in dark and light themes, side by side">

## Quick start

```bash
# 0. verify prerequisites (Node ≥ 20, Rust ≥ 1.78, Xcode CLT, git) — details in Requirements below

# 1. clone
git clone git@github.com:rayxie666/resume_vaulte.git
cd resume_vaulte

# 2. install JS deps (Vite, React, Tauri JS plugins, pdfjs, jsdiff)
npm install

# 3. launch in dev mode — opens a native window, hot-reload for frontend,
# auto-rebuild for Rust on change
npm run tauri dev
```

<details>
<summary>Verify prerequisites — all four must print a version</summary>

```bash
node --version    # ≥ 20
cargo --version   # ≥ 1.78  (missing? see Requirements below, then `source ~/.cargo/env`)
cc --version      # Xcode CLT
git --version
```

</details>

First Rust build is slow (~1-3 min, downloads ~100 crates). Subsequent dev
launches are seconds.

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

## Windows

Resume Vault runs on Windows 10/11 (x64). Install these, then the build and
run commands are identical to macOS (`npm install && npm run tauri dev`):

| Tool | Install |
| --- | --- |
| **Node.js ≥ 20** | <https://nodejs.org/> or `winget install OpenJS.NodeJS.LTS` |
| **Rust (stable ≥ 1.78)** | <https://rustup.rs/> — pick the `x86_64-pc-windows-msvc` host |
| **MSVC Build Tools** | Visual Studio Installer → "Desktop development with C++" |
| **WebView2 Runtime** | Built into Windows 11; on Windows 10 run `winget install Microsoft.EdgeWebView2Runtime` |
| **Git for Windows** _(only for GitHub sync)_ | `winget install Git.Git` |
| **Tectonic** _(only for LaTeX preview)_ | `winget install --id TectonicProject.Tectonic`, or download from <https://tectonic-typesetting.github.io/> |

The app finds `tectonic`, `git`, and the Claude Code CLI on your `PATH` (with
the usual winget/scoop/npm install locations as fallbacks), and stores its data
under `%APPDATA%\com.zheruixie.resumevault\`.

The release installers are **unsigned**, so SmartScreen warns on first launch.
Click **More info → Run anyway**, or right-click the installer → **Properties**
→ tick **Unblock**. Code signing is planned but not yet in place.

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

## Building a release `.app` / `.dmg`

```bash
npm run tauri build
```

Outputs (per the OS you build on):

```
src-tauri/target/release/bundle/
├── macos/  dmg/                    # macOS: resume-vault.app, *_aarch64.dmg
├── msi/                            # Windows: resume-vault_<version>_x64_en-US.msi
└── nsis/                           # Windows: resume-vault_<version>_x64-setup.exe
```

On Windows both installers double-click to install; the app lands in the Start
menu with the bundled icon. SmartScreen warning → see [Windows](#windows).

The macOS binary is unsigned. On first launch Gatekeeper will block it:

- **Finder** → right-click `resume-vault.app` → **Open** → **Open**
- Or: `xattr -dr com.apple.quarantine resume-vault.app`

To sign + notarize for distribution, set up Apple Developer credentials and
follow [Tauri's macOS signing guide](https://tauri.app/v2/distribute/sign/macos/).

Prebuilt artifacts: see [Releases](https://github.com/rayxie666/resume_vaulte/releases).

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
[Building a release](#building-a-release-app--dmg) above; the binary is
unsigned.

**`tectonic not found`** (shown in the LaTeX preview pane) — the Tectonic
engine isn't installed. Fix:

```bash
brew install tectonic                                  # macOS
winget install --id TectonicProject.Tectonic           # Windows
```

Then restart the app (a running instance won't pick up the new binary). The
first compile is slow: Tectonic downloads LaTeX packages on demand and caches
them (`~/Library/Caches/Tectonic` on macOS,
`%LOCALAPPDATA%\TectonicProject\Tectonic` on Windows).

**`[plugin:vite:import-analysis] Failed to resolve import "three" from "src/pet/catScene.ts"`**
— the 3D pet companion depends on `three` (declared in `package.json`) but
`node_modules/three` is missing. Happens after pulling a commit that added the
dep without re-running install. Fix:

```bash
npm install
```

Then restart `npm run tauri dev`. Same recipe for any other "Failed to resolve
import" pointing at a dep that already lives in `package.json`.

## Architecture

For contributors — how the codebase is laid out and why.

### Project layout

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

### Development notes

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

### Tech stack

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
