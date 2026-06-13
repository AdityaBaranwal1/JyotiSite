import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePuzzle } from "../js/crossword.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "crosswords");

async function loadFirst() {
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  assert.ok(manifest.puzzles.length >= 20, "expected a healthy vendored set");
  const json = JSON.parse(await readFile(join(dir, manifest.puzzles[0]), "utf8"));
  return { manifest, json };
}

test("vendored set: manifest lists only Monday/Tuesday puzzles that parse cleanly", async () => {
  const { json } = await loadFirst();
  assert.ok(["Monday", "Tuesday"].includes(json.dow), "only gentle puzzles vendored");

  const p = parsePuzzle(json);
  assert.equal(p.cells.length, json.size.rows * json.size.cols);
  // every across/down clue produced a word
  assert.equal(p.across.length, json.clues.across.length);
  assert.equal(p.down.length, json.clues.down.length);
});

test("vendored set: every word's answer length matches its cell run and the grid letters", async () => {
  const { json } = await loadFirst();
  const p = parsePuzzle(json);
  for (const w of [...p.across, ...p.down]) {
    assert.equal(w.answer.length, w.cells.length, `word ${w.number} length mismatch`);
    const fromGrid = w.cells.map((i) => p.cells[i].solution).join("");
    assert.equal(fromGrid, w.answer, `word ${w.number} letters disagree with grid`);
  }
});
