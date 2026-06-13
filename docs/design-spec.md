# Jeevan Jyoti — Design Spec

*The community newspaper of Jeevan Jyoti, Rockland County, N.Y. — on the web.*

## Core principle: flat, fully 2D, ink-on-paper

No 3D effects, no depth tricks: no soft drop shadows, no `perspective`/3D transforms, no glossy
gradients, no parallax. The only "depth" is the honest depth of print — a rule sitting on cream
paper. Separation comes from **hairline indigo rules and borders**, never blur. The single allowed
shadow is a flat, hard-edged 2–3px "printed offset" (used on buttons), never a soft blur.

## Palette (4 tokens — the entire color system)

| Token     | Hex       | Use                                           |
|-----------|-----------|-----------------------------------------------|
| `--paper` | `#F6F1E5` | page background (carries the grain)           |
| `--panel` | `#FDFBF4` | cards, boxes, panels (solid — never textured) |
| `--ink`   | `#1F2D50` | ALL text, rules, borders, grid lines          |
| `--accent`| `#E8940A` | actions only: buttons, active states, stamps  |

Contrast: ink-on-paper ≈ 9.7:1, ink-on-panel ≈ 11:1 (both AAA). Buttons are accent fill with
**ink** text ≈ 5.6:1 — AAA for the large/bold (≥19px bold) button labels, AA for everything.
White-on-accent (≈2.2:1) is forbidden.

## Type

- **Masthead:** hand-lettered nameplate with जीवन ज्योति worked in (English with Hindi accents).
- **Headlines:** Lora (sturdy newspaper serif — not Playfair; hairline strokes vanish for old eyes).
- **Body:** Atkinson Hyperlegible (designed by the Braille Institute for low-vision readers),
  19px default, line-height 1.6, **never below 17px anywhere, including captions**.
- Newspaper devices: all-caps small-spaced **kickers**, the **dateline**, **drop caps** on lead
  text, **thick-over-thin section rules**, small-caps bylines.

## Texture

SVG `feTurbulence` grain on the page background **only**, ~5% opacity, baked into the body
background image so solid panels physically cover it. Text never sits on texture or photos.

## Theming (validated — all options are valid)

All visuals run off CSS custom properties in one `:root` block (`css/paper.css`). Two editing
surfaces, both routed through `js/theme.js` (single source of truth):

1. **Theme Studio** (`theme-editor.html`): curated font list only, text size clamped 17–24px,
   color pickers gated by a live WCAG contrast check (`validateTheme`) — ink/paper and ink/panel
   ≥ 7:1, ink/accent ≥ 4.5:1. Failing picks are rejected with the computed ratio and a nearest
   passing suggestion. Preview persists per-device via localStorage; "Export theme" emits a
   `:root{}` block + `theme.json` to commit as the site default.
2. **Reader control**: A / A⁺ / A⁺⁺ size toggle in the header, same clamp, remembered per device.

## Senior non-negotiables

Body ≥17px; AAA contrast for body text; text never over texture/photos; buttons look like buttons,
≥48px tall; ≤4 nav items, no hamburgers/dropdowns; survives 200% zoom; full keyboard navigation;
phone numbers huge and tap-to-call on every page (the community is phone-first).

## Image-slot patterns

No real assets yet, so every image slot ships with on-brand generated SVG: page grain, Ben-Day
halftone fields, engraving cross-hatch, ruled "PHOTOGRAPH" placeholder frames with captions,
thick-thin rules, rotated rubber-stamp circles. All ink-on-cream, all recolor with theme tokens.

## Component voice

- Weekly schedule = a newspaper **Datebook column**: day kickers over thick-thin rules, listings
  separated by hairline rules (no floating card grid), TODAY/NEW/CANCELLED rubber stamps.
- Weather = a **masthead weather ear** set in type inside a ruled box; fuller ruled forecast
  table on the Back Page.
- Games (Sudoku, Mon/Tue crossword), almanac box, and forecast live on **The Back Page** — the
  front page stays a senior's single task: *what's on this week*.
