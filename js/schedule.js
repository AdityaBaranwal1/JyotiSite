/* schedule.js — renders the weekly schedule as a newspaper Datebook column:
   day kickers over thick-thin rules, listings separated by hairline rules,
   TODAY/NEW/CANCELLED rubber stamps. Consumes the normalized event shape
   from data-adapter.js only. */

import {
  parseISO, format, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  eachDayOfInterval, isSameDay, addMonths, getDay,
} from "date-fns";
import { categoryIcon } from "./icons.js";

export const DEFAULT_PHONE = "845-709-2216";

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/* The paper's week runs Monday to Sunday, so every week boundary in here
   passes weekStartsOn:1 rather than date-fns' Sunday default. */
const MON = { weekStartsOn: 1 };

/* "YYYY-MM-DD" is a calendar label, and parseISO reads it as local midnight —
   `new Date(str)` would read it as UTC and shift the day in our timezone. */
const localDate = (iso) => parseISO(iso);

export function formatTime(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const am = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}

/* Dash-free time range; meridiem stated once when both times share it:
   "10:00 to 11:00 AM", "11:00 AM to 1:00 PM". */
export function timeRange(start, end) {
  if (!end) return formatTime(start);
  const a = formatTime(start), b = formatTime(end);
  const [, aM] = a.split(" "), [, bM] = b.split(" ");
  return aM === bM ? `${a.split(" ")[0]} to ${b}` : `${a} to ${b}`;
}

/* ---------- The edition's computed furniture ---------- */

/* Monday..Sunday window containing `now` (a Sunday belongs to the week
   that began the previous Monday). */
function weekBounds(now) {
  return { monday: startOfWeek(now, MON), sunday: endOfWeek(now, MON) };
}

export const isoOf = (d) => format(d, "yyyy-MM-dd");

export function weekLabelFor(now = new Date()) {
  const { monday, sunday } = weekBounds(now);
  const from = `${MONTHS[monday.getMonth()]} ${monday.getDate()}` +
    (monday.getFullYear() !== sunday.getFullYear() ? `, ${monday.getFullYear()}` : "");
  const to = `${MONTHS[sunday.getMonth()]} ${sunday.getDate()}, ${sunday.getFullYear()}`;
  return `Week of ${from} to ${to}`;
}

export function updatedLabelFor(savedAt) {
  if (!savedAt) return null;
  const d = new Date(savedAt);
  if (Number.isNaN(d.getTime())) return null;
  return `Updated ${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function filterWeek(events, now = new Date()) {
  const { monday, sunday } = weekBounds(now);
  const from = isoOf(monday), to = isoOf(sunday);
  return events.filter((e) => e.date >= from && e.date <= to);
}

export function filterMonth(events, year, month1) {
  const prefix = `${year}-${String(month1).padStart(2, "0")}-`;
  return events.filter((e) => e.date.startsWith(prefix));
}

/* First and last months ("YYYY-MM") that actually have programs, so month
   navigation can stop where the data stops. */
export function monthBounds(events) {
  if (!events || events.length === 0) return null;
  let min = null, max = null;
  for (const e of events) {
    const ym = e.date.slice(0, 7);
    if (!min || ym < min) min = ym;
    if (!max || ym > max) max = ym;
  }
  return { min, max };
}

export function dayLabel(iso) {
  const d = localDate(iso);
  return `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function isToday(iso, now = new Date()) {
  return isSameDay(localDate(iso), now);
}

export function groupByDay(events) {
  const byDate = new Map();
  for (const e of events) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  return [...byDate.keys()].sort().map((date) => ({
    date,
    label: dayLabel(date),
    events: byDate.get(date).sort((a, b) => a.startTime.localeCompare(b.startTime)),
  }));
}

/* ---------- DOM rendering (browser only) ---------- */

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function stamp(text, extra = "") {
  const s = el("span", `stamp ${extra}`.trim(), text);
  return s;
}

function renderListing(event) {
  const item = el("article", "listing" + (event.cancelled ? " is-cancelled" : ""));

  const icon = el("div", "l-icon");
  icon.innerHTML = categoryIcon(event.category); // trusted, bundled SVG strings
  item.appendChild(icon);

  const main = el("div", "l-main");
  const title = el("h3", "l-title", event.title);
  if (event.isNew && !event.cancelled) title.appendChild(stamp("New", "stamp--today"));
  main.appendChild(title);

  main.appendChild(el("p", "l-time", timeRange(event.startTime, event.endTime)));
  if (event.description) main.appendChild(el("p", "l-desc", event.description));
  item.appendChild(main);

  if (!event.cancelled) {
    const action = el("div", "l-action");
    const a = el("a", "btn");
    if (event.zoomLink) {
      a.href = event.zoomLink;
      a.textContent = "Join on Zoom";
      a.setAttribute("aria-label", `Join ${event.title} on Zoom`);
    } else {
      const phone = event.phone || DEFAULT_PHONE;
      a.href = `tel:${phone.replace(/[^\d+]/g, "")}`;
      a.textContent = "Call to Register";
      a.setAttribute("aria-label", `Call to register for ${event.title}`);
    }
    action.appendChild(a);
    item.appendChild(action);
  } else {
    item.appendChild(stamp("Cancelled", "stamp--cancelled cancel-stamp"));
  }
  return item;
}

/* variant: "column" (rules & whitespace), "ledger" (big date numerals),
   "panel" (contained blocks). All flat, all senior-sized. */
export function renderSchedule(container, schedule, { now = new Date(), variant = "column" } = {}) {
  container.textContent = "";
  container.dataset.variant = variant;

  if (!schedule || schedule.events.length === 0) {
    const box = el("div", "notice");
    box.appendChild(el("span", "kicker", "Notice"));
    box.appendChild(
      el("p", null,
        `No programs are listed this week. Call us at ${DEFAULT_PHONE} to check what's on.`)
    );
    container.appendChild(box);
    return;
  }

  groupByDay(schedule.events).forEach((group, i) => {
    const d = localDate(group.date);
    const section = el("section", "day-section");
    section.setAttribute("aria-label", group.label);
    // its place in the order the days settle onto the page (css/motion.css)
    section.style.setProperty("--i", String(Math.min(i, 8)));

    const head = el("div", "day-head");
    head.appendChild(el("span", "day-num", String(d.getDate())));
    const meta = el("span", "day-meta");
    meta.appendChild(el("span", "day-name", DAYS[d.getDay()]));
    meta.appendChild(el("span", "day-date", `${MONTHS[d.getMonth()]} ${d.getDate()}`));
    head.appendChild(meta);
    if (isToday(group.date, now)) head.appendChild(stamp("Today", "stamp--today"));
    section.appendChild(head);

    const body = el("div", "day-body");
    for (const event of group.events) body.appendChild(renderListing(event));
    section.appendChild(body);
    container.appendChild(section);
  });
}

/* ---------- Public month calendar (grid like a wall calendar) ---------- */

export function renderMonthCalendar(container, events, { year, month1, now = new Date(), selected, onSelectDay } = {}) {
  container.textContent = "";
  const monthEvents = filterMonth(events, year, month1);
  const byDate = new Map();
  for (const e of monthEvents) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }

  const grid = el("div", "cal-grid cal-grid--public");
  for (const dow of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    grid.appendChild(el("div", "cal-dow", dow));
  }
  const first = new Date(year, month1 - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const pad = () => {
    const c = el("div", "cal-cell cal-cell--pad");
    c.setAttribute("aria-hidden", "true");
    return c;
  };
  for (let i = 0; i < lead; i++) grid.appendChild(pad());
  const daysInMonth = new Date(year, month1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const todays = byDate.get(iso) || [];
    const cell = el("button", "cal-cell");
    cell.type = "button";
    if (todays.length) cell.classList.add("has-events");
    if (isToday(iso, now)) cell.classList.add("is-today");
    if (iso === selected) cell.classList.add("is-selected");
    if (!todays.length) cell.disabled = true;
    cell.setAttribute("aria-label",
      `${dayLabel(iso)}: ${todays.length} program${todays.length === 1 ? "" : "s"}`);
    cell.appendChild(el("span", "cal-date", String(day)));
    if (todays.length) {
      cell.appendChild(el("span", "cal-dots", "●".repeat(Math.min(todays.length, 3))));
      cell.addEventListener("click", () => onSelectDay?.(iso));
    }
    grid.appendChild(cell);
  }
  // Complete the last week so the grid closes on a square edge instead of
  // stopping mid-row.
  const trail = (7 - ((lead + daysInMonth) % 7)) % 7;
  for (let i = 0; i < trail; i++) grid.appendChild(pad());
  container.appendChild(grid);
}

/* Full-size listings for one selected day (same rows as the front page). */
export function renderDayListings(container, events, iso, { now = new Date() } = {}) {
  container.textContent = "";
  if (!iso) return;
  const head = el("div", "day-head");
  head.appendChild(el("span", "day-meta"));
  // "October 23" stays together when the heading wraps beside its stamp
  head.firstChild.appendChild(el("span", "day-name", dayLabel(iso).replace(/ (\d+)$/, "\u00a0$1")));
  if (isToday(iso, now)) head.appendChild(stamp("Today", "stamp--today"));
  container.appendChild(head);
  events
    .filter((e) => e.date === iso)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .forEach((e) => container.appendChild(renderListing(e)));
}

/* ---------- Month view: the paper's listings page ----------
   Compact ruled rows grouped by week: distinct from the front page's
   generous datebook, like a broadsheet's "Month Ahead" listings column. */
export function renderMonthList(container, events, { year, month1, now = new Date() } = {}) {
  container.textContent = "";
  const monthEvents = filterMonth(events, year, month1);

  if (monthEvents.length === 0) {
    const box = el("div", "notice");
    box.appendChild(el("span", "kicker", "Notice"));
    box.appendChild(el("p", null,
      `Nothing is listed for ${MONTHS[month1 - 1]} yet. Call us at ${DEFAULT_PHONE} to check what's coming.`));
    container.appendChild(box);
    return;
  }

  // group by Monday-of-week
  const byWeek = new Map();
  for (const e of monthEvents) {
    const key = isoOf(startOfWeek(localDate(e.date), MON));
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push(e);
  }

  for (const key of [...byWeek.keys()].sort()) {
    const monday = localDate(key);
    const section = el("section", "month-week");
    section.appendChild(el("h3", "month-week-head", weekLabelFor(monday)));

    const list = el("div", "month-rows");
    byWeek.get(key)
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
      .forEach((e) => {
        const row = el("div", "month-row" + (e.cancelled ? " is-cancelled" : ""));
        const d = localDate(e.date);
        const day = el("span", "m-day");
        day.appendChild(el("strong", null, DAYS[d.getDay()].slice(0, 3)));
        day.appendChild(el("span", "m-date", ` ${d.getDate()}`));
        row.appendChild(day);
        const what = el("span", "m-what");
        what.appendChild(el("strong", "m-title", e.title));
        what.appendChild(el("span", "m-time", ` · ${timeRange(e.startTime, e.endTime)}`));
        if (e.cancelled) what.appendChild(el("span", "m-cxl", " · Cancelled"));
        row.appendChild(what);
        if (isToday(e.date, now)) row.appendChild(stamp("Today", "stamp--today m-stamp"));
        list.appendChild(row);
      });
    section.appendChild(list);
    container.appendChild(section);
  }
}

export function monthTitle(year, month1) {
  return `${MONTHS[month1 - 1]} ${year}`;
}

/* Renders the stale-cache correction notice above the datebook. */
export function renderStaleNotice(container) {
  const box = el("div", "notice");
  box.appendChild(el("span", "kicker", "Correction"));
  box.appendChild(
    el("p", null,
      `This may not be the latest schedule. Call us at ${DEFAULT_PHONE} to confirm.`)
  );
  container.appendChild(box);
}

/* ---------- The Month Ahead: a timetable, not a wall calendar ----------
   This community's month is a drumbeat — yoga every Monday, computer help
   every Tuesday — so the grid prints the PROGRAM, not a dot. Identical
   programs stack down a column and the rhythm becomes visible; the breaks in
   that column (a cancellation, a holiday, a one-off special) are the part
   actually worth reading. Marigold is spent on exactly two things: today, and
   anything that is not the usual. */

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* "10 AM", "3 PM", "11:30 AM" — the grid has one column's width, so a time
   with no minutes drops ":00" rather than wrapping the cell. */
export function briefTime(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const am = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${am ? "AM" : "PM"}` : `${h12}:${String(m).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}

function timetableEntry(event) {
  const entry = el("div", "tt-entry");
  // A one-off has no series behind it, so it is by definition not the usual.
  if (!event.seriesId || event.isNew) entry.classList.add("is-unusual");
  if (event.cancelled) entry.classList.add("is-cancelled");

  entry.appendChild(el("span", "tt-name", event.shortTitle || event.title));
  entry.appendChild(el("span", "tt-time",
    event.cancelled ? "Cancelled" : briefTime(event.startTime)));
  return entry;
}

export function renderTimetable(container, events, { year, month1, now = new Date(), selected, onSelectDay } = {}) {
  container.textContent = "";
  const monthEvents = filterMonth(events, year, month1);
  const byDate = new Map();
  for (const e of monthEvents) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }

  const grid = el("div", "timetable");

  // The abbreviation is what prints: a tracked full weekday overruns its
  // column at the largest reader size, and the cells below already say what
  // each day holds. Screen readers still get the whole word.
  for (let i = 1; i <= 7; i++) {
    const head = el("div", "tt-dow");
    head.appendChild(el("span", "visually-hidden", DAYS[i % 7]));
    head.appendChild(el("span", null, SHORT_DAYS[i % 7]));
    head.setAttribute("aria-hidden", "false");
    grid.appendChild(head);
  }

  const first = new Date(year, month1 - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month1, 0).getDate();
  const pad = () => {
    const c = el("div", "tt-day tt-day--pad");
    c.setAttribute("aria-hidden", "true");
    return c;
  };
  for (let i = 0; i < lead; i++) grid.appendChild(pad());

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const todays = (byDate.get(iso) || [])
      .slice()
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const d = localDate(iso);

    const cell = el(todays.length ? "button" : "div", "tt-day");
    cell.dataset.date = iso;
    if (todays.length) {
      cell.type = "button";
      cell.classList.add("has-events");
      cell.addEventListener("click", () => onSelectDay?.(iso));
    } else {
      cell.classList.add("is-quiet");
    }
    if (isToday(iso, now)) cell.classList.add("is-today");
    if (iso === selected) cell.classList.add("is-selected");

    const head = el("div", "tt-daynum");
    // The weekday only needs printing when the columns collapse on a phone.
    head.appendChild(el("span", "tt-dow-inline", SHORT_DAYS[d.getDay()]));
    head.appendChild(el("span", "tt-date", String(day)));
    cell.appendChild(head);

    for (const e of todays) cell.appendChild(timetableEntry(e));
    if (!todays.length) cell.appendChild(el("span", "tt-none", "No programs"));

    cell.setAttribute("aria-label", todays.length
      ? `${dayLabel(iso)}: ${todays.map((e) => e.title).join(", ")}`
      : `${dayLabel(iso)}: no programs`);
    grid.appendChild(cell);
  }

  const trail = (7 - ((lead + daysInMonth) % 7)) % 7;
  for (let i = 0; i < trail; i++) grid.appendChild(pad());

  container.appendChild(grid);
}

/* The rhythm stated in words, once, so a reader who never reads the grid
   still learns which day their class meets. */
export function renderStandingPrograms(container, series, describe) {
  container.textContent = "";
  if (!series || series.length === 0) return;

  const list = el("dl", "standing");
  for (const s of series) {
    const row = el("div", "standing-row");
    row.appendChild(el("dt", "standing-when", describe(s)));
    const what = el("dd", "standing-what");
    what.appendChild(el("span", "standing-name", s.title));
    what.appendChild(el("span", "standing-time", timeRange(s.startTime, s.endTime)));
    row.appendChild(what);
    list.appendChild(row);
  }
  container.appendChild(list);
}
