/* main.js — page bootstrap. Applies the saved theme before anything paints,
   wires the reader size control, and fills whatever slots the page has:
   datebook, dateline, editor's note, weather ear. */

import {
  applyTheme, applyScale, loadSavedTheme, loadScale, saveScale, ensureFont,
} from "./theme.js";
import { getSchedule, describeSeries, activeSeries } from "./data-adapter.js";
import {
  renderSchedule, renderStaleNotice, renderTimetable, renderDayListings,
  renderStandingPrograms, filterWeek, filterMonth, weekLabelFor,
  monthTitle, monthBounds,
} from "./schedule.js";
import { todayIso, monthKey, MONTHS } from "./dates.js";
import { initWeatherEar, initForecastBox } from "./weather.js";
import { initAlmanac } from "./almanac.js";
import { transition, motionOK } from "./motion.js";

/* ---------- Theme: apply per-device choices immediately ---------- */
const savedTheme = loadSavedTheme();
if (savedTheme) {
  applyTheme(savedTheme);
  ensureFont(savedTheme.fontHead, "head");
  ensureFont(savedTheme.fontBody, "body");
}
applyScale(loadScale());

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

  const { ok, stale, schedule } = await getSchedule();

  const noticeSlot = document.getElementById("notice-slot");
  if (stale && noticeSlot) renderStaleNotice(noticeSlot);

  const now = new Date();
  if (view === "month") {
    initMonthView(datebook, ok ? schedule : null);
  } else {
    const weekSchedule =
      ok && schedule ? { ...schedule, events: filterWeek(schedule.events, now) } : null;
    renderSchedule(datebook, weekSchedule);
  }

  // The dateline is computed, never typed.
  const weekEl = document.getElementById("week-label");
  if (weekEl) weekEl.textContent = weekLabelFor(now);
  // The month button names the month it opens: "See all of September".
  const monthLink = document.getElementById("month-link");
  if (monthLink) {
    document.getElementById("month-link-label").textContent = `See all of ${MONTHS[now.getMonth()]}`;
    monthLink.href = `month.html?m=${monthKey(now.getFullYear(), now.getMonth() + 1)}`;
  }

  const note = document.getElementById("editors-note-text");
  if (note && schedule?.editorsNote) note.textContent = schedule.editorsNote;

  // The page has its final height now; motion.js can find the rules that
  // are still below the fold.
  document.dispatchEvent(new Event("jj:rendered"));
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
  if (standing) {
    renderStandingPrograms(standing, activeSeries(schedule?.series, todayIso()), describeSeries);
  }

  const fromParam = /^\d{4}-\d{2}$/.test(new URLSearchParams(location.search).get("m") || "")
    ? new URLSearchParams(location.search).get("m").split("-").map(Number)
    : null;
  const now = new Date();
  let year = fromParam ? fromParam[0] : now.getFullYear();
  let month1 = fromParam ? fromParam[1] : now.getMonth() + 1;
  let selected = null;

  const shift = (delta) => {
    const d = new Date(year, month1 - 1 + delta, 1);
    return monthKey(d.getFullYear(), d.getMonth() + 1);
  };

  const pickDefaultDay = () => {
    const inMonth = filterMonth(events, year, month1)
      .map((e) => e.date).sort();
    if (!inMonth.length) return null;
    const today = todayIso(now);
    return inMonth.find((d) => d >= today) || inMonth[0];
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
    history.replaceState(null, "", `?m=${monthKey(year, month1)}`);
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
