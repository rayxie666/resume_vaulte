# Screenshot shot list — README redesign

Source spec: `spec/2026-06-11-readme-redesign.md` §3–§4. The README already
references every filename below; images render as broken links until captured.
This file (and nothing else in `docs/screenshots/`) may be deleted once all
boxes are checked.

## One-time setup

- [ ] **Demo dataset** (§4.1) — in a scratch vault (move
      `~/Library/Application Support/com.zheruixie.resumevault/` aside first):
  - Categories ×6, each with a distinct emoji + gradient color, 2–5 versions:
    `Google — SWE`, `ByteDance — Infra`, `Stripe — Backend`,
    `Anthropic — Research Eng`, `Startup — Founding Eng`, `New Grad 2026`
  - Persona: **Ada Lovelace**, `ada@example.com` — realistic, quantified
    bullets; zero real personal data
  - ≥1 category with JD text pasted; ≥1 version with 2 attachments and
    3 checkpoints (notes like "quantified impact", "tailor for infra")
  - One deliberately weak bullet for F4: "Responsible for backend services"
- [ ] **Window**: 1280×800 logical px (temporarily edit `src-tauri/tauri.conf.json`
      or drag), Retina 2x display → captures at 2560×1600
- [ ] **Capture**: `screencapture -w -o <file>` (window mode, no shadow);
      no cursor in frame (F4 selection highlight excepted), no stray hover states

## Captures

| Done | File | View / content |
|---|---|---|
| [ ] | `00-hero.dark.png` + `00-hero.light.png` | Same composition as `31-editor.png` (editor + settled PDF), captured in both themes — the only dual-theme pair |
| [ ] | `10-home.png` | Home, 6 category cards, nebula background visible (dark theme — all Features shots are dark) |
| [ ] | `20-versions.png` | Category view, 4+ version cards with PDF thumbnails, TeX/PDF kind pills, JD block visible |
| [ ] | `30-editor.gif` | 6–8 s screen recording: edit a bullet → progress bar sweeps → new PDF settles. One take, no cuts. QuickTime/CleanShot → crop to window → `gifski --fps 12 --width 800` → **≤ 4 MB** (drop to 10 fps or shorten if over) |
| [ ] | `31-editor.png` | Static frame of the same composition (also reused by hero) |
| [ ] | `40-ai-rewrite.png` | Weak bullet selected, inline diff expanded (red old / green new + Accept/Reject) |
| [ ] | `50-history.png` | HistoryPanel: 3+ checkpoints on the left, red/green diff on the right |
| [ ] | `60-github.png` | Settings → GitHub section, connected state with Sync/Pull controls; or the pull-summary dialog with non-zero counts |
| [ ] | `70-attachments.png` | AttachmentsModal with 2–3 files, or the assets-library grid |
| [ ] | `80-themes.png` | Same view dark + light, joined side-by-side with a 2 px transparent gap: `magick a.png b.png +append 80-themes.png` |

## Post-processing

- [ ] All PNGs through `pngquant --quality 80-95` (or ImageOptim);
      each ≤ 600 KB, GIF ≤ 4 MB, directory total ≤ 12 MB
- [ ] Uncompressed originals stay out of the repo
- [ ] Final pass: every image checked for real personal info (must be none)
- [ ] Render check on GitHub in both site themes: hero `<picture>` swaps,
      widths uniform (800/840), GIF autoplays smoothly
