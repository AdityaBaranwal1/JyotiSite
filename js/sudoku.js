/* sudoku.js — generator, solver, and a senior-friendly player.
   Grid is a flat array of 81 cells, 0 = empty, row-major. */

const N = 9;

const rowOf = (i) => Math.floor(i / N);
const colOf = (i) => i % N;
const boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

/* Can `val` go at index `i` given the current grid? */
function legal(grid, i, val) {
  const r = rowOf(i), c = colOf(i), b = boxOf(i);
  for (let k = 0; k < 81; k++) {
    if (grid[k] !== val) continue;
    if (rowOf(k) === r || colOf(k) === c || boxOf(k) === b) return false;
  }
  return true;
}

/* ---------- Seeded RNG (so generated puzzles are reproducible in tests) ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- Solver ---------- */
function firstEmpty(grid) {
  for (let i = 0; i < 81; i++) if (grid[i] === 0) return i;
  return -1;
}

export function solve(grid, rnd) {
  const g = grid.slice();
  // reject an already-inconsistent grid
  for (let i = 0; i < 81; i++) {
    if (g[i] !== 0) { const v = g[i]; g[i] = 0; if (!legal(g, i, v)) return null; g[i] = v; }
  }
  const order = rnd ? shuffled([1,2,3,4,5,6,7,8,9], rnd) : [1,2,3,4,5,6,7,8,9];
  const recurse = () => {
    const i = firstEmpty(g);
    if (i === -1) return true;
    for (const v of order) {
      if (legal(g, i, v)) {
        g[i] = v;
        if (recurse()) return true;
        g[i] = 0;
      }
    }
    return false;
  };
  return recurse() ? g : null;
}

/* Count solutions up to `limit` (2 is enough to prove uniqueness). */
export function countSolutions(grid, limit = 2) {
  const g = grid.slice();
  let count = 0;
  const recurse = () => {
    if (count >= limit) return;
    const i = firstEmpty(g);
    if (i === -1) { count++; return; }
    for (let v = 1; v <= 9; v++) {
      if (legal(g, i, v)) {
        g[i] = v;
        recurse();
        g[i] = 0;
        if (count >= limit) return;
      }
    }
  };
  recurse();
  return count;
}

/* ---------- Generator ---------- */
export function generate({ givens = 36, seed } = {}) {
  const rnd = mulberry32(seed == null ? (Math.random() * 2 ** 31) | 0 : seed);
  const solution = solve(new Array(81).fill(0), rnd);

  // Remove cells in symmetric pairs while uniqueness holds.
  const puzzle = solution.slice();
  const order = shuffled([...Array(81).keys()], rnd);
  let filled = 81;
  for (const i of order) {
    if (filled <= givens) break;
    const j = 80 - i; // 180° rotational symmetry, like a printed crossword/sudoku
    if (puzzle[i] === 0) continue;
    const a = puzzle[i], b = puzzle[j];
    puzzle[i] = 0; puzzle[j] = 0;
    const removed = i === j ? 1 : 2;
    if (countSolutions(puzzle, 2) !== 1) {
      puzzle[i] = a; puzzle[j] = b; // restore — removal broke uniqueness
    } else {
      filled -= removed;
    }
  }
  return { puzzle, solution };
}

/* ---------- Validation helpers for the player ---------- */
export function findConflicts(grid) {
  const bad = new Set();
  const groups = [];
  for (let u = 0; u < 9; u++) {
    const row = [], col = [], box = [];
    for (let k = 0; k < 9; k++) {
      row.push(u * 9 + k);
      col.push(k * 9 + u);
      const br = Math.floor(u / 3) * 3, bc = (u % 3) * 3;
      box.push((br + Math.floor(k / 3)) * 9 + (bc + (k % 3)));
    }
    groups.push(row, col, box);
  }
  for (const group of groups) {
    const seen = new Map();
    for (const idx of group) {
      const v = grid[idx];
      if (!v) continue;
      if (seen.has(v)) { bad.add(idx); bad.add(seen.get(v)); }
      else seen.set(v, idx);
    }
  }
  return bad;
}

export function isComplete(grid) {
  return grid.every((n) => n >= 1 && n <= 9) && findConflicts(grid).size === 0;
}

/* ---------- Difficulty presets (more givens = gentler, for our audience) ---------- */
export const DIFFICULTY = { gentle: 45, easy: 38, regular: 32 };

/* ---------- DOM player (browser only) ---------- */
export function mountSudoku(root) {
  let puzzle, solution, grid, given, selected = -1, pencil = false, notes = [];
  let level = "gentle";

  const board = root.querySelector("[data-sudoku-board]");
  const pad = root.querySelector("[data-sudoku-pad]");
  const status = root.querySelector("[data-sudoku-status]");
  const levelSel = root.querySelector("[data-sudoku-level]");

  function newGame() {
    const out = generate({ givens: DIFFICULTY[level] });
    puzzle = out.puzzle; solution = out.solution;
    grid = puzzle.slice();
    given = puzzle.map((n) => n !== 0);
    notes = Array.from({ length: 81 }, () => new Set());
    selected = -1;
    status.textContent = "New puzzle — tap a square, then tap a number.";
    draw();
  }

  function draw() {
    board.innerHTML = "";
    const conflicts = findConflicts(grid);
    for (let i = 0; i < 81; i++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "sk-cell";
      if (colOf(i) % 3 === 0) cell.classList.add("sk-bl");
      if (rowOf(i) % 3 === 0) cell.classList.add("sk-bt");
      if (colOf(i) === 8) cell.classList.add("sk-br");
      if (rowOf(i) === 8) cell.classList.add("sk-bb");
      if (given[i]) cell.classList.add("sk-given");
      if (i === selected) cell.classList.add("sk-sel");
      if (conflicts.has(i)) cell.classList.add("sk-bad");
      cell.setAttribute("aria-label",
        `Row ${rowOf(i) + 1}, column ${colOf(i) + 1}` +
        (grid[i] ? `, ${grid[i]}` : ", empty"));
      if (grid[i]) {
        cell.textContent = grid[i];
      } else if (notes[i].size) {
        const n = document.createElement("span");
        n.className = "sk-notes";
        n.textContent = [...notes[i]].sort().join(" ");
        cell.appendChild(n);
      }
      cell.addEventListener("click", () => { selected = i; draw(); });
      board.appendChild(cell);
    }
  }

  function place(v) {
    if (selected < 0 || given[selected]) return;
    if (pencil && v !== 0) {
      const s = notes[selected];
      s.has(v) ? s.delete(v) : s.add(v);
    } else {
      grid[selected] = v;
      notes[selected].clear();
      if (isComplete(grid)) status.textContent = "🎉 Solved! Beautifully done.";
      else status.textContent = "";
    }
    draw();
  }

  function buildPad() {
    pad.innerHTML = "";
    for (let v = 1; v <= 9; v++) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "sk-key"; b.textContent = v;
      b.addEventListener("click", () => place(v));
      pad.appendChild(b);
    }
    const erase = document.createElement("button");
    erase.type = "button"; erase.className = "sk-key sk-erase"; erase.textContent = "Erase";
    erase.addEventListener("click", () => place(0));
    pad.appendChild(erase);
  }

  root.querySelector("[data-sudoku-new]")?.addEventListener("click", newGame);
  root.querySelector("[data-sudoku-check]")?.addEventListener("click", () => {
    const conflicts = findConflicts(grid);
    const empties = grid.filter((n) => n === 0).length;
    if (conflicts.size) status.textContent = "A few numbers clash — the squares in orange repeat in a row, column, or box.";
    else if (empties) status.textContent = `Looking good so far — ${empties} square${empties === 1 ? "" : "s"} to go.`;
    else status.textContent = "🎉 All correct!";
    draw();
  });
  root.querySelector("[data-sudoku-pencil]")?.addEventListener("click", (e) => {
    pencil = !pencil;
    e.currentTarget.setAttribute("aria-pressed", String(pencil));
    e.currentTarget.textContent = pencil ? "Pencil: ON" : "Pencil marks";
  });
  levelSel?.addEventListener("change", () => { level = levelSel.value; newGame(); });

  buildPad();
  newGame();
}
