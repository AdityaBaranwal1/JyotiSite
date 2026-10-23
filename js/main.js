/* main.js — page bootstrap. Applies the saved theme before anything paints,
   wires the reader size control, and fills whatever slots the page has:
   datebook, dateline, editor's note, weather ear. */

import {
  applyTheme, applyScale, loadSavedTheme, loadScale, saveScale, SCALE_STEPS,
  CURATED_FONTS,
} from "./theme.js";
import { getSchedule, describeSeries } from "./data-adapter.js";
import {
  renderSchedule, renderStaleNotice, renderTimetable, renderDayListings,
  renderStandingPrograms, filterWeek, filterMonth, weekLabelFor,
  updatedLabelFor, monthTitle, monthBounds,
} from "./schedule.js";
import { initWeatherEar, initForecastBox } from "./weather.js";
import { initAlmanac } from "./almanac.js";
import { transition, motionOK } from "./motion.js";

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
  // The whole page reflows at a new size; a cross-fade turns that jump
  // into one calm change.
  const select = (idx) => transition(() => {
    applyScale(idx);
    saveScale(idx);
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === idx)));
  }, "size");
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

  /* ?preview=1 renders the volunteer's unpublished draft instead of the
     published paper. It reads from the session-guarded preview endpoint and
     is given a throwaway cache, so a draft can never settle into the reader's
     stored copy of the schedule. */
  const previewing = new URLSearchParams(location.search).get("preview") === "1";
  const { ok, stale, schedule } = previewing
    ? await getSchedule({
        url: "/api/schedule/preview",
        storage: { getItem: () => null, setItem: () => {} },
      })
    : await getSchedule();

  const noticeSlot = document.getElementById("notice-slot");
  if (previewing) showPreviewBanner(ok);
  else if (stale && noticeSlot) renderStaleNotice(noticeSlot);

  if (view === "month") {
    initMonthView(datebook, ok ? schedule : null);
  } else {
    const now = new Date();
    const weekSchedule =
      ok && schedule ? { ...schedule, events: filterWeek(schedule.events, now) } : null;
    renderSchedule(datebook, weekSchedule, { variant: datebookVariant() });
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

  // The page has its final height now; motion.js can find the rules that
  // are still below the fold.
  document.dispatchEvent(new Event("jj:rendered"));
}

/* A preview must never be mistaken for the paper readers are getting. */
function showPreviewBanner(ok) {
  const bar = document.createElement("div");
  bar.className = "preview-bar";
  bar.setAttribute("role", "status");
  bar.textContent = ok
    ? "Preview of unpublished changes — readers are still seeing the last published paper."
    : "Nothing to preview. Make a change on the Editor's Desk, then preview again.";
  document.body.prepend(bar);
  document.body.classList.add("is-previewing");
}

/* The paper prints the "column" datebook. The other two looks stay
   reachable for comparison at ?style=ledger and ?style=panel. */
function datebookVariant() {
  const asked = new URLSearchParams(location.search).get("style");
  return ["column", "ledger", "panel"].includes(asked) ? asked : "column";
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

  // The rhythm, stated once in words, above the month that varies it.
  const standing = document.getElementById("standing-programs");
  if (standing) renderStandingPrograms(standing, schedule?.series ?? [], describeSeries);

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

  // The buttons name the month they lead to: "‹ September" says more than
  // "Previous month", and stays on one line on a phone.
  const labelNav = (btn, delta, arrowFirst) => {
    if (!btn) return;
    const [y, m] = shift(delta).split("-").map(Number);
    const name = monthTitle(y, m).split(" ")[0];
    btn.textContent = arrowFirst ? `‹ ${name}` : `${name} ›`;
    btn.setAttribute("aria-label",
      `${delta < 0 ? "Previous" : "Next"} month, ${monthTitle(y, m)}`);
  };

  // Choosing a day only moves the tint and re-sets the programs below; the
  // grid itself is not redrawn, so the tint can ease across.
  const selectDay = (iso, { reveal = false } = {}) => {
    selected = iso;
    for (const cell of container.querySelectorAll(".tt-day[data-date]")) {
      cell.classList.toggle("is-selected", cell.dataset.date === iso);
    }
    if (!dayPrograms) return;
    renderDayListings(dayPrograms, events, selected);
    // On a phone the programs are a long scroll below the day that was
    // tapped; bring them up so the tap visibly did something.
    if (reveal && dayPrograms.getBoundingClientRect().top > innerHeight * 0.75) {
      dayPrograms.scrollIntoView({ behavior: motionOK() ? "smooth" : "auto", block: "start" });
    }
  };

  const draw = () => {
    if (titleEl) titleEl.textContent = monthTitle(year, month1);
    renderTimetable(container, events, {
      year, month1, selected,
      onSelectDay: (iso) => selectDay(iso, { reveal: true }),
    });
    if (hint) hint.hidden = false;
    if (dayPrograms) renderDayListings(dayPrograms, events, selected);
    // navigation stops where the data stops
    if (prev) prev.disabled = !bounds || shift(-1) < bounds.min;
    if (next) next.disabled = !bounds || shift(1) > bounds.max;
    labelNav(prev, -1, true);
    labelNav(next, 1, false);
    history.replaceState(null, "", `?m=${ym()}`);
  };
  const step = (delta) => transition(() => {
    [year, month1] = shift(delta).split("-").map(Number);
    selected = pickDefaultDay();
    draw();
  }, delta < 0 ? "month-prev" : "month-next");
  prev?.addEventListener("click", () => { if (!prev.disabled) step(-1); });
  next?.addEventListener("click", () => { if (!next.disabled) step(1); });
  selected = pickDefaultDay();
  draw();
  container.querySelector(".timetable")?.classList.add("is-entering");
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
