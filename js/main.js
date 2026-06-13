/* main.js — page bootstrap. Applies the saved theme before anything paints,
   wires the reader size control, and fills whatever slots the page has:
   datebook, dateline, editor's note, weather ear. */

import {
  applyTheme, applyScale, loadSavedTheme, loadScale, saveScale, SCALE_STEPS,
  CURATED_FONTS,
} from "./theme.js";
import { getSchedule } from "./data-adapter.js";
import { renderSchedule, renderStaleNotice } from "./schedule.js";
import { initWeatherEar, initForecastBox } from "./weather.js";
import { initAlmanac } from "./almanac.js";

/* ---------- Theme: apply per-device choices immediately ---------- */
const savedTheme = loadSavedTheme();
if (savedTheme) {
  applyTheme(savedTheme);
  ensureFontsLoaded(savedTheme);
}
applyScale(loadScale());

function ensureFontsLoaded(theme) {
  // If the saved theme uses a curated font not in the default page bundle,
  // pull it from Google Fonts on demand.
  const wanted = CURATED_FONTS.filter(
    (f) => theme.fontHead?.includes(f.name.split(" (")[0]) || theme.fontBody?.includes(f.name.split(" (")[0])
  );
  for (const f of wanted) {
    const id = `gf-${f.gf}`;
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${f.gf}&display=swap`;
      document.head.appendChild(link);
    }
  }
}

/* ---------- Reader text-size control (A / A+ / A++) ---------- */
function wireReaderControls() {
  const wrap = document.querySelector(".reader-controls");
  if (!wrap) return;
  const buttons = [...wrap.querySelectorAll("button[data-scale]")];
  const select = (idx) => {
    applyScale(idx);
    saveScale(idx);
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === idx)));
  };
  buttons.forEach((b, i) => b.addEventListener("click", () => select(i)));
  buttons.forEach((b, i) =>
    b.setAttribute("aria-pressed", String(i === loadScale()))
  );
}

/* ---------- Schedule slots ---------- */
async function fillSchedule() {
  const datebook = document.getElementById("datebook");
  if (!datebook) return;

  const { ok, stale, schedule } = await getSchedule();
  const noticeSlot = document.getElementById("notice-slot");

  if (stale && noticeSlot) renderStaleNotice(noticeSlot);
  renderSchedule(datebook, ok ? schedule : null);

  if (!schedule) return;
  const set = (id, text) => {
    const n = document.getElementById(id);
    if (n && text) n.textContent = text;
  };
  set("week-label", schedule.weekLabel);
  set("volume", schedule.volume);
  set("updated", schedule.updated);
  const note = document.getElementById("editors-note-text");
  if (note && schedule.editorsNote) note.textContent = schedule.editorsNote;
}

/* ---------- Boot ---------- */
document.addEventListener("DOMContentLoaded", () => {
  wireReaderControls();
  fillSchedule();

  const ear = document.querySelector(".weather-ear");
  if (ear) initWeatherEar(ear);
  const forecast = document.getElementById("forecast-box");
  if (forecast) initForecastBox(forecast);
  const almanac = document.getElementById("almanac-box");
  if (almanac) initAlmanac(almanac);

  // Games are loaded on demand so the front page stays light.
  const sudoku = document.getElementById("sudoku");
  if (sudoku) import("./sudoku.js").then((m) => m.mountSudoku(sudoku));
  const crossword = document.getElementById("crossword");
  if (crossword) import("./crossword.js").then((m) => m.initCrossword(crossword));
});
