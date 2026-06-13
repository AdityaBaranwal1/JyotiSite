import { test } from "node:test";
import assert from "node:assert/strict";
import { solve, countSolutions, generate, findConflicts, isComplete } from "../js/sudoku.js";

// A known-solvable puzzle (0 = empty)
const PUZZLE = [
  5,3,0, 0,7,0, 0,0,0,
  6,0,0, 1,9,5, 0,0,0,
  0,9,8, 0,0,0, 0,6,0,
  8,0,0, 0,6,0, 0,0,3,
  4,0,0, 8,0,3, 0,0,1,
  7,0,0, 0,2,0, 0,0,6,
  0,6,0, 0,0,0, 2,8,0,
  0,0,0, 4,1,9, 0,0,5,
  0,0,0, 0,8,0, 0,7,9,
];

test("solve: completes a valid puzzle into a full grid", () => {
  const s = solve(PUZZLE);
  assert.ok(s, "expected a solution");
  assert.equal(s.length, 81);
  assert.ok(s.every((n) => n >= 1 && n <= 9));
  // first row of the canonical solution to this classic puzzle
  assert.deepEqual(s.slice(0, 9), [5,3,4,6,7,8,9,1,2]);
});

test("solve: returns null for an unsolvable grid", () => {
  const bad = PUZZLE.slice();
  bad[1] = 5; // two 5s in the first row
  assert.equal(solve(bad), null);
});

test("countSolutions: a proper puzzle has exactly one solution", () => {
  assert.equal(countSolutions(PUZZLE, 2), 1);
});

test("countSolutions: an empty grid has many (stops at the limit)", () => {
  assert.equal(countSolutions(new Array(81).fill(0), 2), 2);
});

test("generate: produces a uniquely-solvable puzzle with its solution", () => {
  const { puzzle, solution } = generate({ givens: 40, seed: 7 });
  assert.equal(puzzle.length, 81);
  assert.equal(solution.length, 81);
  const given = puzzle.filter((n) => n !== 0).length;
  assert.ok(given >= 40, `expected at least 40 givens, got ${given}`);
  assert.equal(countSolutions(puzzle, 2), 1, "puzzle must be unique");
  assert.deepEqual(solve(puzzle), solution, "solution must match the unique solve");
});

test("findConflicts: flags duplicate values in a row, column, or box", () => {
  const grid = new Array(81).fill(0);
  grid[0] = 5; grid[1] = 5;          // row conflict
  grid[9] = 7; grid[18] = 7;         // column conflict (col 0)
  const conflicts = findConflicts(grid);
  assert.ok(conflicts.has(0) && conflicts.has(1));
  assert.ok(conflicts.has(9) && conflicts.has(18));
});

test("findConflicts: a valid partial grid has none", () => {
  assert.equal(findConflicts(PUZZLE).size, 0);
});

test("isComplete: true only when full and conflict-free", () => {
  assert.equal(isComplete(PUZZLE), false);
  assert.equal(isComplete(solve(PUZZLE)), true);
});
