import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contrastRatio,
  validateTheme,
  clampSize,
  serializeTheme,
  applyTheme,
  DEFAULT_THEME,
  CURATED_FONTS,
  SIZE_RANGE,
} from "../js/theme.js";

test("contrastRatio: black on white is 21:1", () => {
  assert.ok(Math.abs(contrastRatio("#000000", "#FFFFFF") - 21) < 0.01);
});

test("contrastRatio: identical colors are 1:1", () => {
  assert.ok(Math.abs(contrastRatio("#1F2D50", "#1F2D50") - 1) < 0.001);
});

test("contrastRatio: default ink on paper exceeds AAA body (7:1)", () => {
  assert.ok(contrastRatio(DEFAULT_THEME.ink, DEFAULT_THEME.paper) >= 7);
});

test("validateTheme: default theme passes with no problems", () => {
  const r = validateTheme(DEFAULT_THEME);
  assert.equal(r.ok, true);
  assert.equal(r.problems.length, 0);
});

test("validateTheme: low-contrast ink/paper is rejected with ratio and a passing suggestion", () => {
  const bad = { ...DEFAULT_THEME, ink: "#999999", paper: "#CCCCCC", panel: "#CCCCCC" };
  const r = validateTheme(bad);
  assert.equal(r.ok, false);
  const prob = r.problems.find((p) => p.pair === "ink/paper");
  assert.ok(prob, "expected an ink/paper problem");
  assert.ok(prob.ratio < 7);
  assert.equal(prob.required, 7);
  // the suggestion must itself pass against the same background
  assert.ok(contrastRatio(prob.suggestion, bad.paper) >= 7);
});

test("validateTheme: ink on accent must reach 4.5:1 (large/bold buttons)", () => {
  const ok = validateTheme(DEFAULT_THEME);
  assert.equal(ok.ok, true);
  const bad = { ...DEFAULT_THEME, accent: "#3A4A70" }; // nearly ink-dark accent
  const r = validateTheme(bad);
  assert.equal(r.ok, false);
  const prob = r.problems.find((p) => p.pair === "ink/accent");
  assert.ok(prob);
  assert.equal(prob.required, 4.5);
  assert.ok(contrastRatio(DEFAULT_THEME.ink, prob.suggestion) >= 4.5);
});

test("validateTheme: a light-ink suggestion passes paper, panel, AND accent at once", () => {
  const bad = { ...DEFAULT_THEME, ink: "#CCCCCC" };
  const r = validateTheme(bad);
  assert.equal(r.ok, false);
  const prob = r.problems.find((p) => p.pair === "ink/paper");
  assert.ok(prob, "expected an ink/paper problem");
  const fixed = { ...bad, ink: prob.suggestion };
  // applying the single suggested ink must clear EVERY problem in one click
  assert.equal(validateTheme(fixed).ok, true, "one fix should resolve all ink pairs");
});

test("clampSize: enforces the 17-24px floor and ceiling", () => {
  assert.equal(clampSize(12), SIZE_RANGE[0]);
  assert.equal(clampSize(99), SIZE_RANGE[1]);
  assert.equal(clampSize(20), 20);
  assert.equal(clampSize("21"), 21);
  assert.equal(clampSize("nonsense"), DEFAULT_THEME.textBase);
});

test("CURATED_FONTS: every entry has a name, css stack, and role", () => {
  assert.ok(CURATED_FONTS.length >= 4);
  for (const f of CURATED_FONTS) {
    assert.ok(f.name && f.css && ["head", "body"].includes(f.role));
  }
});

test("serializeTheme: emits a :root block containing every token", () => {
  const css = serializeTheme(DEFAULT_THEME).css;
  assert.match(css, /:root\s*\{/);
  for (const t of ["--ink", "--paper", "--panel", "--accent", "--font-head", "--font-body", "--text-base"]) {
    assert.ok(css.includes(t), `missing ${t}`);
  }
  const json = serializeTheme(DEFAULT_THEME).json;
  assert.equal(JSON.parse(json).ink, DEFAULT_THEME.ink);
});

test("applyTheme: sets custom properties on the provided root", () => {
  const calls = {};
  const fakeRoot = { style: { setProperty: (k, v) => (calls[k] = v) } };
  applyTheme(DEFAULT_THEME, fakeRoot);
  assert.equal(calls["--ink"], DEFAULT_THEME.ink);
  assert.equal(calls["--text-base"], `${DEFAULT_THEME.textBase}px`);
});
