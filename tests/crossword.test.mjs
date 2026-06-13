import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePuzzle } from "../js/crossword.js";

// A tiny 3x3 puzzle, no black squares, to exercise numbering + word extraction.
//   C A T
//   A R E
//   B E D
const MINI = {
  size: { rows: 3, cols: 3 },
  grid: ["C","A","T", "A","R","E", "B","E","D"],
  gridnums: [1,2,3, 4,0,0, 5,0,0],
  clues: {
    across: ["1. Feline pet", "4. \"We ___ family\"", "5. Where you sleep"],
    down: ["1. Yellow taxi", "2. \"We ___ here\"", "3. Bear's nickname"],
  },
  answers: {
    across: ["CAT", "ARE", "BED"],
    down: ["CAB", "ARE", "TED"],
  },
  dow: "Monday",
  title: "Mini Test",
};

test("parsePuzzle: reports grid size and black squares", () => {
  const p = parsePuzzle(MINI);
  assert.equal(p.rows, 3);
  assert.equal(p.cols, 3);
  assert.equal(p.cells.length, 9);
  assert.equal(p.cells.filter((c) => c.isBlack).length, 0);
});

test("parsePuzzle: numbers the starting cells from gridnums", () => {
  const p = parsePuzzle(MINI);
  assert.equal(p.cells[0].number, 1);
  assert.equal(p.cells[1].number, 2);
  assert.equal(p.cells[4].number, null);
  assert.equal(p.cells[0].solution, "C");
});

test("parsePuzzle: extracts across words with their cells, clue, and answer", () => {
  const p = parsePuzzle(MINI);
  const a1 = p.across.find((w) => w.number === 1);
  assert.ok(a1);
  assert.deepEqual(a1.cells, [0, 1, 2]);
  assert.equal(a1.answer, "CAT");
  assert.match(a1.clue, /Feline/);
});

test("parsePuzzle: extracts down words with their cells and answer", () => {
  const p = parsePuzzle(MINI);
  const d1 = p.down.find((w) => w.number === 1);
  assert.deepEqual(d1.cells, [0, 3, 6]);
  assert.equal(d1.answer, "CAB");
  const d3 = p.down.find((w) => w.number === 3);
  assert.deepEqual(d3.cells, [2, 5, 8]);
  assert.equal(d3.answer, "TED");
});

test("parsePuzzle: handles black squares (.) by splitting words", () => {
  const puz = {
    size: { rows: 1, cols: 5 },
    grid: ["O","N",".","U","P"],
    gridnums: [1,0,0,2,0],
    clues: { across: ["1. Switched ___", "2. Not down"], down: [] },
    answers: { across: ["ON", "UP"], down: [] },
  };
  const p = parsePuzzle(puz);
  assert.equal(p.cells[2].isBlack, true);
  assert.equal(p.across.length, 2);
  assert.deepEqual(p.across[0].cells, [0, 1]);
  assert.deepEqual(p.across[1].cells, [3, 4]);
});

test("parsePuzzle: solution letters are uppercased and clue numbers stripped cleanly", () => {
  const p = parsePuzzle(MINI);
  assert.ok(p.across.every((w) => /^[A-Z]+$/.test(w.answer)));
  // The clue keeps its human text but we can find the bare clue without the number
  const a1 = p.across.find((w) => w.number === 1);
  assert.equal(a1.clueText, "Feline pet");
});
