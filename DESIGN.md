# Design — Resume Vault

Visual system for the "midnight letterpress studio" identity: brass type
under a desk lamp, ink-black slate; the compiled page glows like paper on a
light table. Dark-first dual theme, all colors in OKLCH, all tokens live in
`src/App.css` `:root` (light) and the `prefers-color-scheme: dark` block.

## Theme

- **Dark (primary design target):** ink-black slate `oklch(0.15 0.005 80)`,
  surfaces step up in lightness (`0.19`, `0.23`). Brass carries the brand.
- **Light:** bright stock `oklch(0.975 0.004 85)` with pure-white surfaces;
  brand becomes bronze (darker brass) for contrast.
- Theme follows the system (`prefers-color-scheme`); no in-app toggle.
- The PDF stage (`--stage`) is dark in *both* themes — the compiled page
  always sits on a light table.

## Color roles (tokens)

| Token | Role |
|---|---|
| `--bg` / `--surface` / `--surface-2` | app background, cards/panels, recessed chrome |
| `--ink` / `--ink-2` / `--ink-3` | body text (≥7:1), secondary (≥4.5:1), faint/icons |
| `--line` / `--line-strong` | hairlines, input borders |
| `--brand` + `--brand-ink` | brass/bronze fill + its text color (white in light, near-black in dark) |
| `--brand-text` | brand-colored text on bg (links, nav actions) |
| `--brand-soft` / `--brand-edge` | brass tint surfaces, focus rings & splitter |
| `--accent-text` / `--accent-soft` | ink-blue: diff "new", selection matches, info |
| `--danger*`, `--ok*` | error / success trios (fill, text-on-bg, soft surface) |
| `--stage` | PDF light-table background |
| `--code-*` | CodeMirror syntax (keyword=brass, literal=ink-blue, comment=italic gray) |

Strategy: **restrained** — brass is the only brand voice; semantic colors
appear only in active states. Category gradients (`iconUtils.ts`) are user
data, not brand chrome.

## Typography

- **Serif display** (`--font-serif`: New York / ui-serif): nav title, modal
  h3, section titles (`.gh-title`, `.preview-title`), placeholder initials.
  Titles only — never buttons, labels, or data.
- **Sans** (`--font-sans`: SF Pro stack): everything else. Base 14px; UI
  runs 11–13px.
- **Mono** (`--font-mono`: SF Mono stack): code, diffs, filenames, dates,
  tags. Tabular numerals on counts and dates.

## Shape & depth

- Radii: `--r-xs 6 / --r-sm 8 / --r-md 10 / --r-lg 14 / --r-xl 18` (cards
  lg, buttons sm–md, modals xl, pills 999).
- Borders do the separating; shadows (`--shadow-sm/md/lg`) only suggest
  elevation on hover, floating bars, and modals. No frosted glass.
- Add-cards are dashed outlines that warm to brass on hover.

## Motion

- `--t-fast 140ms` for hovers, `--t-med 220ms` for entrances, all on
  `--ease-out` (expo-style). Motion conveys state only: modal rise, drawer
  rise, sync pop, compile progress sweep.
- `prefers-reduced-motion` collapses everything to near-instant; the
  compile progress bar degrades to a static tinted strip.

## Key surfaces

- **Editor split:** draggable divider (brass on hover/drag, double-click
  resets, fraction persisted in `localStorage["rv-split"]`).
- **PDF preview:** serif "Preview" header, 2px brass indeterminate progress
  while compiling. On compile error the last good PDF stays visible and the
  error becomes a collapsible drawer (`.compile-error.overlay`) pinned to
  the stage bottom; full-panel only when no PDF exists yet.
- **Selection:** brass ring (`box-shadow` 2px) + brass check disc; floating
  select bar is a bordered surface pill, danger action filled red.
- **Diff:** additions/removals tint with `--ok-soft` / `--danger-soft`;
  active checkpoint row uses `--brand-soft` fill (no side-stripe borders).

## Z-index scale

`--z-nav 10 < --z-bar 30 < --z-backdrop 40 < --z-modal 50 < --z-toast 60`.
Never hardcode z-index values.

Any overlay with a `.modal-backdrop` **must render outside `.content`** — at the
App root or via `createPortal(…, document.body)`. `.content` carries
`position/z-index` (and view-enter `transform`), which establish a stacking
context that traps a nested `fixed` backdrop *below* the navbar. Modals sit at
`--z-backdrop`; prompt/confirm dialogs (`.dialog-backdrop`) sit one step up at
`--z-modal` so they stay above an open modal.

## Accessibility

WCAG AA verified per token pair: `--ink` ≥7:1, `--ink-2` ≥4.5:1 on `--bg`;
brand fills carry `--brand-ink` chosen per theme for ≥4.5:1. Global
`:focus-visible` ring in `--brand-edge`. Both en/zh locales must fit; test
both.
