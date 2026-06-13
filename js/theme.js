/* theme.js — single source of truth for the editable design system.
   Both editing surfaces (Theme Studio + reader A/A+/A++ control) route
   through here, so no path can produce an inaccessible result. */

export const DEFAULT_THEME = {
  ink: "#1F2D50",
  paper: "#F6F1E5",
  panel: "#FDFBF4",
  accent: "#E8940A",
  fontHead: '"Lora", Georgia, serif',
  fontBody: '"Atkinson Hyperlegible", Verdana, system-ui, sans-serif',
  textBase: 19,
};

export const SIZE_RANGE = [17, 24];

/* Curated, pre-validated senior-legible faces only. `gf` is the Google
   Fonts family parameter needed to load it on demand. */
export const CURATED_FONTS = [
  { name: "Lora",                  css: '"Lora", Georgia, serif',                            role: "head", gf: "Lora:wght@500;600;700" },
  { name: "Frank Ruhl Libre",      css: '"Frank Ruhl Libre", Georgia, serif',                role: "head", gf: "Frank+Ruhl+Libre:wght@500;700" },
  { name: "Source Serif 4",        css: '"Source Serif 4", Georgia, serif',                  role: "head", gf: "Source+Serif+4:wght@600;700" },
  { name: "Atkinson Hyperlegible", css: '"Atkinson Hyperlegible", Verdana, system-ui, sans-serif', role: "body", gf: "Atkinson+Hyperlegible:wght@400;700" },
  { name: "Libre Franklin",        css: '"Libre Franklin", Verdana, system-ui, sans-serif',  role: "body", gf: "Libre+Franklin:wght@400;700" },
  { name: "Source Serif 4 (body)", css: '"Source Serif 4", Georgia, serif',                  role: "body", gf: "Source+Serif+4:opsz,wght@8..60,400;8..60,700" },
];

/* ---------- WCAG contrast math ---------- */

function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(rgb) {
  const lin = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrastRatio(a, b) {
  const ra = hexToRgb(a), rb = hexToRgb(b);
  if (!ra || !rb) return 0;
  const la = luminance(ra), lb = luminance(rb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* Nudge `fg` toward black or white (whichever helps against `bg`)
   until the pair passes `required`. Returns a passing hex. */
function suggestShade(fg, bg, required) {
  const bgLum = luminance(hexToRgb(bg));
  const towardDark = bgLum > 0.18; // light background -> darken the foreground
  let rgb = hexToRgb(fg);
  for (let i = 0; i < 40; i++) {
    const hex = "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
    if (contrastRatio(hex, bg) >= required) return hex;
    rgb = rgb.map((c) =>
      towardDark ? Math.max(0, c - 12) : Math.min(255, c + 12)
    );
  }
  return towardDark ? "#000000" : "#FFFFFF";
}

/* Darken/lighten the ink until it clears EVERY constraint it participates in
   (>=7:1 on paper and panel, >=4.5:1 on the accent), so one click fixes ink. */
function suggestInk(t) {
  const bgLumMax = Math.max(luminance(hexToRgb(t.paper)), luminance(hexToRgb(t.panel)));
  const towardDark = bgLumMax > 0.18;
  let rgb = hexToRgb(t.ink) || [0, 0, 0];
  const passes = (hex) =>
    contrastRatio(hex, t.paper) >= 7 &&
    contrastRatio(hex, t.panel) >= 7 &&
    contrastRatio(hex, t.accent) >= 4.5;
  for (let i = 0; i < 40; i++) {
    const hex = "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
    if (passes(hex)) return hex;
    rgb = rgb.map((c) => (towardDark ? Math.max(0, c - 12) : Math.min(255, c + 12)));
  }
  return towardDark ? "#000000" : "#FFFFFF";
}

/* Contrast requirements:
   ink on paper + ink on panel: 7:1 (AAA body text)
   ink on accent: 4.5:1 (AAA large/bold — button labels are >=19px bold) */
export function validateTheme(theme) {
  const t = { ...DEFAULT_THEME, ...theme };
  const checks = [
    { pair: "ink/paper",  fg: t.ink, bg: t.paper,  required: 7 },
    { pair: "ink/panel",  fg: t.ink, bg: t.panel,  required: 7 },
    { pair: "ink/accent", fg: t.ink, bg: t.accent, required: 4.5 },
  ];
  const problems = [];
  for (const c of checks) {
    if (!hexToRgb(c.fg) || !hexToRgb(c.bg)) {
      problems.push({ ...c, ratio: 0, suggestion: DEFAULT_THEME.ink, message: "Not a valid color." });
      continue;
    }
    const ratio = contrastRatio(c.fg, c.bg);
    if (ratio < c.required) {
      // ink fails paper/panel -> fix the ink globally; ink fails ONLY accent
      // (ink is fine on paper/panel) -> the accent is too close, adjust accent.
      const inkOkOnPaperPanel =
        contrastRatio(t.ink, t.paper) >= 7 && contrastRatio(t.ink, t.panel) >= 7;
      const suggestion =
        c.pair === "ink/accent" && inkOkOnPaperPanel
          ? suggestShade(c.bg, c.fg, c.required) // adjust the accent, keep the ink
          : suggestInk(t);                       // fix the ink for all its pairs
      problems.push({
        pair: c.pair,
        ratio: Math.round(ratio * 100) / 100,
        required: c.required,
        suggestion,
        message: `Contrast is ${ratio.toFixed(2)}:1 — needs at least ${c.required}:1. Try ${suggestion}.`,
      });
    }
  }
  return { ok: problems.length === 0, problems };
}

/* ---------- Size clamp: the accessible floor cannot be crossed ---------- */
export function clampSize(px) {
  const n = Number(px);
  if (!Number.isFinite(n)) return DEFAULT_THEME.textBase;
  return Math.min(SIZE_RANGE[1], Math.max(SIZE_RANGE[0], Math.round(n)));
}

/* ---------- Apply + persist + serialize ---------- */

export function applyTheme(theme, root) {
  const t = { ...DEFAULT_THEME, ...theme };
  const el = root || (typeof document !== "undefined" ? document.documentElement : null);
  if (!el) return;
  el.style.setProperty("--ink", t.ink);
  el.style.setProperty("--paper", t.paper);
  el.style.setProperty("--panel", t.panel);
  el.style.setProperty("--accent", t.accent);
  el.style.setProperty("--font-head", t.fontHead);
  el.style.setProperty("--font-body", t.fontBody);
  el.style.setProperty("--text-base", `${clampSize(t.textBase)}px`);
}

export function serializeTheme(theme) {
  const t = { ...DEFAULT_THEME, ...theme };
  const css = `:root {
  --ink:    ${t.ink};
  --paper:  ${t.paper};
  --panel:  ${t.panel};
  --accent: ${t.accent};
  --font-head: ${t.fontHead};
  --font-body: ${t.fontBody};
  --text-base: ${clampSize(t.textBase)}px;
}`;
  return { css, json: JSON.stringify(t, null, 2) };
}

/* ---------- Per-device persistence (browser only) ---------- */

const THEME_KEY = "jyoti-theme";
const SCALE_KEY = "jyoti-scale";
export const SCALE_STEPS = [1, 1.15, 1.3]; // A / A+ / A++

export function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, JSON.stringify(theme)); } catch { /* private mode */ }
}
export function loadSavedTheme() {
  try { return JSON.parse(localStorage.getItem(THEME_KEY)) || null; } catch { return null; }
}
export function clearSavedTheme() {
  try { localStorage.removeItem(THEME_KEY); } catch { /* ignore */ }
}

export function saveScale(idx) {
  try { localStorage.setItem(SCALE_KEY, String(idx)); } catch { /* ignore */ }
}
export function loadScale() {
  try {
    const i = parseInt(localStorage.getItem(SCALE_KEY), 10);
    return Number.isInteger(i) && i >= 0 && i < SCALE_STEPS.length ? i : 0;
  } catch { return 0; }
}
export function applyScale(idx, root) {
  const el = root || (typeof document !== "undefined" ? document.documentElement : null);
  if (!el) return;
  el.style.setProperty("--scale", String(SCALE_STEPS[idx] ?? 1));
}
