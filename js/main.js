/* main.js — page bootstrap. Applies the saved theme before anything paints,
   wires the reader size control, and fills whatever slots the page has:
   datebook, dateline, editor's note, weather ear. */

import {
  applyTheme, applyScale, loadSavedTheme, loadScale, saveScale, SCALE_STEPS,
  CURATED_FONTS,
} from "./theme.js";
import { getSchedule } from "./data-adapter.js";
import {
  renderSchedule, renderStaleNotice, renderMonthCalendar, renderDayListings,
  filterWeek, filterMonth, weekLabelFor, updatedLabelFor, monthTitle, monthBounds,
} from "./schedule.js";
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
  const view = datebook.dataset.view || "week";

  const { ok, stale, schedule } = await getSchedule();
  const noticeSlot = document.getElementById("notice-slot");
  if (stale && noticeSlot) renderStaleNotice(noticeSlot);

  if (view === "month") {
    initMonthView(datebook, ok ? schedule : null);
  } else {
    const now = new Date();
    const weekSchedule =
      ok && schedule ? { ...schedule, events: filterWeek(schedule.events, now) } : null;
    const draw = (variant) => renderSchedule(datebook, weekSchedule, { variant });
    draw(wireVariantPicker(draw));
  }

  // The dateline is computed, never typed: week label from today's date,
  // the Updated line from when the schedule was last saved.
  const weekEl = document.getElementById("week-label");
  if (weekEl) weekEl.textContent = weekLabelFor(new Date());
  const updEl = document.getElementById("updated-line");
  if (updEl) {
    const up = updatedLabelFor(schedule?.savedAt);
    if (up) updEl.textContent = up;
    else updEl.remove();
  }

  const note = document.getElementById("editors-note-text");
  if (note && schedule?.editorsNote) note.textContent = schedule.editorsNote;
}

/* TEMPORARY variant picker for the weekly datebook (remove before launch).
   Returns the saved variant and wires the buttons to redraw. */
function wireVariantPicker(draw) {
  const KEY = "jyoti-datebook-variant";
  let variant = "column";
  try { variant = localStorage.getItem(KEY) || "column"; } catch { /* ignore */ }
  const wrap = document.querySelector(".variant-picker");
  if (wrap) {
    const buttons = [...wrap.querySelectorAll("button[data-variant]")];
    const select = (v) => {
      variant = v;
      try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.variant === v)));
      draw(v);
    };
    buttons.forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.variant === variant));
      b.addEventListener("click", () => select(b.dataset.variant));
    });
  }
  return variant;
}

/* Month page: a wall-calendar grid; tap a marked day to read its programs.
   Navigation only reaches months that actually have data. */
function initMonthView(container, schedule) {
  const titleEl = document.getElementById("month-title");
  const prev = document.getElementById("month-prev");
  const next = document.getElementById("month-next");
  const dayPrograms = document.getElementById("day-programs");
  const hint = document.getElementById("cal-hint");

  const events = schedule ? schedule.events : [];
  const bounds = monthBounds(events);

  const fromParam = /^\d{4}-\d{2}$/.test(new URLSearchParams(location.search).get("m") || "")
    ? new URLSearchParams(location.search).get("m").split("-").map(Number)
    : null;
  const now = new Date();
  let year = fromParam ? fromParam[0] : now.getFullYear();
  let month1 = fromParam ? fromParam[1] : now.getMonth() + 1;
  let selected = null;

  const ym = () => `${year}-${String(month1).padStart(2, "0")}`;
  const shift = (delta) => {
    let m = month1 + delta, y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    return `${y}-${String(m).padStart(2, "0")}`;
  };

  const pickDefaultDay = () => {
    const inMonth = filterMonth(events, year, month1)
      .map((e) => e.date).sort();
    if (!inMonth.length) return null;
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (inMonth.includes(todayIso)) return todayIso;
    return inMonth.find((d) => d >= todayIso) || inMonth[0];
  };

  const draw = () => {
    if (titleEl) titleEl.textContent = monthTitle(year, month1);
    renderMonthCalendar(container, events, {
      year, month1, selected,
      onSelectDay: (iso) => { selected = iso; draw(); },
    });
    if (hint) hint.hidden = false;
    if (dayPrograms) renderDayListings(dayPrograms, events, selected);
    // navigation stops where the data stops
    if (prev) prev.disabled = !bounds || shift(-1) < bounds.min;
    if (next) next.disabled = !bounds || shift(1) > bounds.max;
    history.replaceState(null, "", `?m=${ym()}`);
  };
  const step = (delta) => {
    [year, month1] = shift(delta).split("-").map(Number);
    selected = pickDefaultDay();
    draw();
  };
  prev?.addEventListener("click", () => { if (!prev.disabled) step(-1); });
  next?.addEventListener("click", () => { if (!next.disabled) step(1); });
  selected = pickDefaultDay();
  draw();
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
