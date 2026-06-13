/* theme-studio.js — the owner-facing visual editor. Every control routes
   through theme.js, so nothing here can produce an inaccessible result:
   fonts come from a curated list, size is clamped, colors are gated by a
   live WCAG contrast check that suggests a passing shade when one fails. */

import {
  DEFAULT_THEME, CURATED_FONTS, SIZE_RANGE,
  validateTheme, applyTheme, serializeTheme, clampSize,
  saveTheme, loadSavedTheme, clearSavedTheme,
} from "./theme.js";

const $ = (sel, root = document) => root.querySelector(sel);

const PAIR_LABEL = {
  "ink/paper": "Ink on the page",
  "ink/panel": "Ink on panels",
  "ink/accent": "Ink on the accent (buttons)",
};

export function initStudio(root) {
  // Working copy starts from any saved theme, else the default.
  const theme = { ...DEFAULT_THEME, ...(loadSavedTheme() || {}) };

  const headSel = $("[data-font-head]", root);
  const bodySel = $("[data-font-body]", root);
  const sizeInput = $("[data-size]", root);
  const sizeReadout = $("[data-size-readout]", root);
  const msg = $("[data-studio-msg]", root);
  const exportOut = $("[data-export]", root);
  const colorInputs = {
    ink: $('[data-color="ink"]', root),
    paper: $('[data-color="paper"]', root),
    panel: $('[data-color="panel"]', root),
    accent: $('[data-color="accent"]', root),
  };
  const colorVals = {
    ink: $('[data-color-val="ink"]', root),
    paper: $('[data-color-val="paper"]', root),
    panel: $('[data-color-val="panel"]', root),
    accent: $('[data-color-val="accent"]', root),
  };

  // Populate font dropdowns from the curated list (head vs body roles).
  CURATED_FONTS.filter((f) => f.role === "head").forEach((f) => headSel.add(new Option(f.name, f.css)));
  CURATED_FONTS.filter((f) => f.role === "body").forEach((f) => bodySel.add(new Option(f.name, f.css)));
  headSel.value = theme.fontHead;
  bodySel.value = theme.fontBody;

  sizeInput.min = SIZE_RANGE[0];
  sizeInput.max = SIZE_RANGE[1];
  sizeInput.step = 1;
  sizeInput.value = clampSize(theme.textBase);

  for (const key of Object.keys(colorInputs)) {
    colorInputs[key].value = theme[key];
    colorVals[key].textContent = theme[key].toUpperCase();
  }

  function ensureFont(css) {
    const f = CURATED_FONTS.find((x) => x.css === css);
    if (!f) return;
    const id = `gf-${f.gf}`;
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id; link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${f.gf}&display=swap`;
      document.head.appendChild(link);
    }
  }

  /* Re-validate and re-render the live proof. Returns whether the theme is ok. */
  function render() {
    const { ok, problems } = validateTheme(theme);

    msg.innerHTML = "";
    if (!ok) {
      const p = problems[0];
      const span = document.createElement("span");
      span.textContent =
        `${PAIR_LABEL[p.pair] || p.pair}: contrast ${p.ratio}:1 is below ${p.required}:1. `;
      const fix = document.createElement("button");
      fix.type = "button"; fix.className = "fix";
      fix.textContent = `Use ${p.suggestion} instead`;
      fix.addEventListener("click", () => {
        // ink/accent suggests a new accent; the rest suggest a new ink.
        const target = p.pair === "ink/accent" ? "accent" : "ink";
        theme[target] = p.suggestion;
        colorInputs[target].value = p.suggestion;
        colorVals[target].textContent = p.suggestion.toUpperCase();
        render();
      });
      span.appendChild(fix);
      msg.appendChild(span);
    }

    // The proof always previews the *current* picks via inline custom props,
    // so the owner sees exactly what readers would get.
    ensureFont(theme.fontHead);
    ensureFont(theme.fontBody);
    const proof = $("[data-proof]", root);
    proof.style.setProperty("--ink", theme.ink);
    proof.style.setProperty("--paper", theme.paper);
    proof.style.setProperty("--panel", theme.panel);
    proof.style.setProperty("--accent", theme.accent);
    proof.style.setProperty("--font-head", theme.fontHead);
    proof.style.setProperty("--font-body", theme.fontBody);
    proof.style.setProperty("--text-base", `${clampSize(theme.textBase)}px`);
    proof.style.background = theme.paper;

    return ok;
  }

  // ---- wire controls ----
  headSel.addEventListener("change", () => { theme.fontHead = headSel.value; render(); });
  bodySel.addEventListener("change", () => { theme.fontBody = bodySel.value; render(); });
  sizeInput.addEventListener("input", () => {
    theme.textBase = clampSize(sizeInput.value);
    sizeReadout.textContent = `${theme.textBase}px`;
    render();
  });
  sizeReadout.textContent = `${clampSize(theme.textBase)}px`;

  for (const key of Object.keys(colorInputs)) {
    colorInputs[key].addEventListener("input", () => {
      theme[key] = colorInputs[key].value.toUpperCase();
      colorVals[key].textContent = theme[key];
      render();
    });
  }

  $("[data-action-preview]", root).addEventListener("click", () => {
    if (!render()) {
      msg.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    saveTheme(theme);
    applyTheme(theme); // takes effect across the site immediately, this device
    flash("Saved on this device — every page now uses this theme.");
  });

  $("[data-action-reset]", root).addEventListener("click", () => {
    clearSavedTheme();
    Object.assign(theme, DEFAULT_THEME);
    headSel.value = theme.fontHead; bodySel.value = theme.fontBody;
    sizeInput.value = theme.textBase; sizeReadout.textContent = `${theme.textBase}px`;
    for (const key of Object.keys(colorInputs)) {
      colorInputs[key].value = theme[key];
      colorVals[key].textContent = theme[key].toUpperCase();
    }
    applyTheme(DEFAULT_THEME);
    render();
    flash("Back to the original paper.");
  });

  $("[data-action-export]", root).addEventListener("click", () => {
    if (!render()) { msg.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const { css, json } = serializeTheme(theme);
    exportOut.textContent =
      `/* Paste into css/paper.css to make this the default for everyone */\n${css}\n\n` +
      `/* ...or save as data/theme.json */\n${json}`;
    exportOut.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  let flashTimer;
  function flash(text) {
    const fl = $("[data-flash]", root);
    fl.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (fl.textContent = ""), 4000);
  }

  render();
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("studio");
  if (root) initStudio(root);
});
