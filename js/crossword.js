/* crossword.js — parses the doshea/nyt_crosswords JSON shape into a model
   the player can render, plus a senior-friendly DOM player.

   Source JSON (confirmed): size{rows,cols}, grid[] (one char per cell,
   "." = black), gridnums[] (clue-start number or 0), clues.across/down[]
   ("12. Clue text"), answers.across/down[] ("WORD"). */

function stripNumber(clue) {
  return String(clue).replace(/^\s*\d+\s*[.:]\s*/, "").trim();
}
function clueNumber(clue) {
  const m = String(clue).match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

export function parsePuzzle(json) {
  const rows = json.size.rows, cols = json.size.cols;
  const grid = json.grid;
  const gridnums = json.gridnums || [];
  const idx = (r, c) => r * cols + c;
  const isBlack = (r, c) => r < 0 || c < 0 || r >= rows || c >= cols || grid[idx(r, c)] === ".";

  const cells = grid.map((ch, i) => ({
    index: i,
    row: Math.floor(i / cols),
    col: i % cols,
    isBlack: ch === ".",
    number: gridnums[i] ? gridnums[i] : null,
    solution: ch === "." ? null : String(ch).toUpperCase(),
  }));

  // Pair clue strings with answers by position; index them by their number.
  const indexWords = (clueList = [], answerList = []) => {
    const byNum = new Map();
    clueList.forEach((clue, k) => {
      const num = clueNumber(clue);
      byNum.set(num, { clue: clue, clueText: stripNumber(clue), answer: String(answerList[k] ?? "").toUpperCase() });
    });
    return byNum;
  };
  const acrossByNum = indexWords(json.clues?.across, json.answers?.across);
  const downByNum = indexWords(json.clues?.down, json.answers?.down);

  const across = [], down = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isBlack(r, c)) continue;
      const i = idx(r, c);
      const number = gridnums[i];

      // across word starts here?
      if (isBlack(r, c - 1) && !isBlack(r, c + 1)) {
        const wcells = [];
        let cc = c;
        while (!isBlack(r, cc)) { wcells.push(idx(r, cc)); cc++; }
        const meta = acrossByNum.get(number) || { clue: "", clueText: "", answer: "" };
        across.push({ number, cells: wcells, ...meta });
      }
      // down word starts here?
      if (isBlack(r - 1, c) && !isBlack(r + 1, c)) {
        const wcells = [];
        let rr = r;
        while (!isBlack(rr, c)) { wcells.push(idx(rr, c)); rr++; }
        const meta = downByNum.get(number) || { clue: "", clueText: "", answer: "" };
        down.push({ number, cells: wcells, ...meta });
      }
    }
  }

  return { rows, cols, cells, across, down, title: json.title || "", dow: json.dow || "" };
}

/* ---------- DOM player (browser only) ---------- */
export function mountCrossword(root, puzzle) {
  const model = parsePuzzle(puzzle);
  const entry = new Array(model.rows * model.cols).fill("");
  let direction = "across";
  let active = model.across[0] || model.down[0];
  let activeCell = active ? active.cells[0] : -1;

  const board = root.querySelector("[data-cw-board]");
  const clueBar = root.querySelector("[data-cw-clue]");
  const status = root.querySelector("[data-cw-status]");
  const acrossList = root.querySelector("[data-cw-across]");
  const downList = root.querySelector("[data-cw-down]");
  const pad = root.querySelector("[data-cw-pad]");

  board.style.setProperty("--cw-cols", model.cols);

  const wordAt = (cellIndex, dir) =>
    (dir === "across" ? model.across : model.down).find((w) => w.cells.includes(cellIndex));

  function setActive(cellIndex, dir) {
    const word = wordAt(cellIndex, dir) || wordAt(cellIndex, dir === "across" ? "down" : "across");
    if (!word) return;
    direction = word.cells.includes(cellIndex) && wordAt(cellIndex, dir) ? dir : (dir === "across" ? "down" : "across");
    active = wordAt(cellIndex, direction) || word;
    activeCell = cellIndex;
    draw();
  }

  function draw() {
    board.innerHTML = "";
    const activeCells = new Set(active ? active.cells : []);
    model.cells.forEach((cell) => {
      if (cell.isBlack) {
        const b = document.createElement("div");
        b.className = "cw-cell cw-black";
        board.appendChild(b);
        return;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cw-cell";
      if (activeCells.has(cell.index)) btn.classList.add("cw-inword");
      if (cell.index === activeCell) btn.classList.add("cw-active");
      btn.setAttribute("aria-label",
        `Row ${cell.row + 1}, column ${cell.col + 1}` + (cell.number ? `, clue ${cell.number}` : ""));
      if (cell.number) {
        const num = document.createElement("span");
        num.className = "cw-num"; num.textContent = cell.number;
        btn.appendChild(num);
      }
      const letter = document.createElement("span");
      letter.className = "cw-letter"; letter.textContent = entry[cell.index];
      btn.appendChild(letter);
      btn.addEventListener("click", () => {
        if (cell.index === activeCell) direction = direction === "across" ? "down" : "across";
        setActive(cell.index, direction);
      });
      board.appendChild(btn);
    });

    if (active) {
      const label = direction === "across" ? "Across" : "Down";
      clueBar.textContent = `${active.number} ${label}.  ${active.clueText}`;
    }
    highlightClueLists();
  }

  function highlightClueLists() {
    [...root.querySelectorAll("[data-clue-ref]")].forEach((li) => {
      li.classList.toggle("cw-clue-active",
        active && li.dataset.dir === direction && Number(li.dataset.num) === active.number);
    });
  }

  function typeLetter(ch) {
    if (activeCell < 0 || !active) return;
    entry[activeCell] = ch.toUpperCase();
    const pos = active.cells.indexOf(activeCell);
    const next = active.cells[pos + 1];
    if (next != null) activeCell = next;
    checkDone();
    draw();
  }
  function eraseLetter() {
    if (activeCell < 0 || !active) return;
    if (entry[activeCell]) {
      entry[activeCell] = "";
    } else {
      const pos = active.cells.indexOf(activeCell);
      const prev = active.cells[pos - 1];
      if (prev != null) { activeCell = prev; entry[activeCell] = ""; }
    }
    draw();
  }

  function checkDone() {
    const done = model.cells.every((c) => c.isBlack || entry[c.index] === c.solution);
    if (done) status.textContent = "🎉 Finished — every letter correct!";
  }

  // Build the on-screen big-key letter pad (no tiny phone keyboard needed)
  function buildPad() {
    pad.innerHTML = "";
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((ch) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "cw-key"; b.textContent = ch;
      b.addEventListener("click", () => typeLetter(ch));
      pad.appendChild(b);
    });
    const er = document.createElement("button");
    er.type = "button"; er.className = "cw-key cw-erase"; er.textContent = "⌫ Erase";
    er.addEventListener("click", eraseLetter);
    pad.appendChild(er);
  }

  function buildClueLists() {
    const fill = (ul, words, dir) => {
      ul.innerHTML = "";
      words.sort((a, b) => a.number - b.number).forEach((w) => {
        const li = document.createElement("li");
        li.dataset.clueRef = "1"; li.dataset.dir = dir; li.dataset.num = w.number;
        const b = document.createElement("button");
        b.type = "button"; b.className = "cw-cluebtn";
        b.innerHTML = `<strong>${w.number}.</strong> ${w.clueText}`;
        b.addEventListener("click", () => setActive(w.cells[0], dir));
        li.appendChild(b);
        ul.appendChild(li);
      });
    };
    fill(acrossList, model.across, "across");
    fill(downList, model.down, "down");
  }

  // Physical keyboard support (desktop) on top of the on-screen pad
  board.addEventListener("keydown", (e) => {
    if (/^[a-zA-Z]$/.test(e.key)) { typeLetter(e.key); e.preventDefault(); }
    else if (e.key === "Backspace") { eraseLetter(); e.preventDefault(); }
  });
  board.tabIndex = 0;

  root.querySelector("[data-cw-check]")?.addEventListener("click", () => {
    let wrong = 0, blank = 0;
    model.cells.forEach((c) => {
      if (c.isBlack) return;
      if (!entry[c.index]) blank++;
      else if (entry[c.index] !== c.solution) wrong++;
    });
    if (wrong) status.textContent = `${wrong} letter${wrong === 1 ? "" : "s"} need another look — no harm done, try again.`;
    else if (blank) status.textContent = `So far so good — ${blank} square${blank === 1 ? "" : "s"} still empty.`;
    else status.textContent = "🎉 All correct!";
  });
  root.querySelector("[data-cw-reveal-letter]")?.addEventListener("click", () => {
    const c = model.cells[activeCell];
    if (c && !c.isBlack) { entry[activeCell] = c.solution; checkDone(); draw(); }
  });
  root.querySelector("[data-cw-reveal-word]")?.addEventListener("click", () => {
    if (!active) return;
    active.cells.forEach((i) => { entry[i] = model.cells[i].solution; });
    checkDone(); draw();
  });
  root.querySelector("[data-cw-clear]")?.addEventListener("click", () => {
    entry.fill(""); status.textContent = ""; draw();
  });

  const titleSlot = root.querySelector("[data-cw-title]");
  if (titleSlot) titleSlot.textContent = model.dow ? `${model.dow}'s puzzle` : (model.title || "Crossword");

  buildPad();
  buildClueLists();
  draw();
}

/* Loads the manifest of vendored puzzles and mounts one (rotates by day). */
export async function initCrossword(root, { fetchImpl, now } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  try {
    const manifest = await (await doFetch("data/crosswords/manifest.json")).json();
    const files = manifest.puzzles || [];
    if (!files.length) throw new Error("no puzzles");
    const day = now || new Date();
    const pick = files[(day.getFullYear() * 366 + (day.getMonth() * 31 + day.getDate())) % files.length];
    const puzzle = await (await doFetch(`data/crosswords/${pick}`)).json();
    mountCrossword(root, puzzle);
    root.hidden = false;
  } catch {
    root.hidden = true; // fails closed
  }
}
