# Product

## Register

product

## Users

Job seekers — mostly engineers comfortable with LaTeX — who maintain 3+ resume
variants targeted at different roles or companies. They work locally on macOS,
often at night between applications, switching between editing LaTeX source and
checking the compiled PDF. Privacy-conscious: data stays on disk (SQLite +
filesystem), with optional one-way GitHub backup. The job to be done: keep many
resume versions organized, edit with fast feedback, and never lose a good
revision (checkpoints + diffs).

## Product Purpose

Resume Vault is a local-first Tauri desktop app for managing resume versions
across job categories. Core loop: pick a category → pick a version → edit LaTeX
with live PDF preview (Tectonic compile, ~800ms debounce) → checkpoint →
optionally sync to a private GitHub repo. Success = the user trusts it as the
single home for every resume they own.

## Brand Personality

**Type-foundry / print-workshop** (排印工坊): precise, crafted, literate.
An homage to LaTeX's typesetting heritage — a late-night letterpress studio.
Three words: **precise, inky, composed**. The interface should feel like a
well-set page: confident typography, exact spacing, restrained but
unmistakable character. Dark-first dual theme (dark = ink on slate at night;
light = ink on bright stock).

## Anti-references

- The app's own previous skin: generic iOS clone — `#007aff` blue, frosted
  navbar, gray-on-gray hierarchy. We are deliberately leaving Apple-default
  aesthetics.
- SaaS-cream / parchment-tinted "warm minimal" defaults.
- Generic AI dashboard grammar: identical card grids, gradient text,
  side-stripe callouts, eyebrow labels over every section.
- Terminal/hacker dark mode (pure black + neon mono) — too cold for a
  document-craft tool.

## Design Principles

1. **The document is the hero.** The PDF preview is the product's payoff;
   chrome recedes, the compiled page gets light, contrast, and stage presence.
2. **Typography carries the brand.** Hierarchy comes from type scale, weight,
   and a serif display voice — not from boxes, borders, or gray ramps.
3. **Precision you can feel.** Aligned baselines, a real spacing scale,
   consistent radii — the UI itself demonstrates typesetting craft.
4. **Quiet until it matters.** One ink accent used deliberately; states
   (compiling, error, synced) speak clearly when active and disappear when not.
5. **Fast feedback, visible state.** Compile, sync, and checkpoint states are
   always one glance away, never modal interruptions.

## Accessibility & Inclusion

WCAG AA: body text ≥4.5:1, large text ≥3:1, in both themes. Full keyboard
navigation for primary flows. `prefers-reduced-motion` honored everywhere.
i18n: English + Chinese strings must both fit (zh labels are often wider per
glyph; test both locales).
