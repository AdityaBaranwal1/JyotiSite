/* schedule.js — renders the weekly schedule as a newspaper Datebook column:
   day kickers over thick-thin rules, listings separated by hairline rules,
   TODAY/NEW/CANCELLED rubber stamps. Consumes the normalized event shape
   from data-adapter.js only. */

import {
  MONTHS, DAYS, SHORT_DAYS, isoOf, dateOf, addDays, mondayOf, monthKey, monthCells, groupBy,
} from "./dates.js";
import { categoryIcon } from "./icons.js";

export const DEFAULT_PHONE = "845-709-2216";

/* "3:00 PM". `brief` is for the month grid, which has one column's width:
   a time with no minutes drops ":00" there rather than wrapping the cell. */
export function formatTime(hhmm, { brief = false } = {}) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = brief && m === 0 ? "" : `:${String(m).padStart(2, "0")}`;
  return `${h12}${mm} ${h < 12 ? "AM" : "PM"}`;
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
  const monday = mondayOf(now);
  return { monday, sunday: dateOf(addDays(isoOf(monday), 6)) };
}

export function weekLabelFor(now = new Date()) {
  const { monday, sunday } = weekBounds(now);
  const from = `${MONTHS[monday.getMonth()]} ${monday.getDate()}` +
    (monday.getFullYear() !== sunday.getFullYear() ? `, ${monday.getFullYear()}` : "");
  // "June 8 to 14": the month is said again only when the week crosses into the next one.
  const to = (sunday.getMonth() === monday.getMonth() ? "" : `${MONTHS[sunday.getMonth()]} `) +
    `${sunday.getDate()}, ${sunday.getFullYear()}`;
  return `Week of ${from} to ${to}`;
}

export function filterWeek(events, now = new Date()) {
  const { monday, sunday } = weekBounds(now);
  const from = isoOf(monday), to = isoOf(sunday);
  return events.filter((e) => e.date >= from && e.date <= to);
}

export function filterMonth(events, year, month1) {
  const prefix = `${monthKey(year, month1)}-`;
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
  const d = dateOf(iso);
  return `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function isToday(iso, now = new Date()) {
  return iso === isoOf(now);
}

export const byStartTime = (a, b) => String(a.startTime).localeCompare(String(b.startTime));

export function groupByDay(events) {
  const byDate = groupBy(events, (e) => e.date);
  return [...byDate.keys()].sort().map((date) => ({
    date,
    label: dayLabel(date),
    events: byDate.get(date).sort(byStartTime),
  }));
}

/* ---------- DOM rendering (browser only) ---------- */

export function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

const stamp = (text, extra = "") => el("span", `stamp ${extra}`.trim(), text);

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

export function renderSchedule(container, schedule, { now = new Date() } = {}) {
  container.textContent = "";

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
    const d = dateOf(group.date);
    const section = el("section", "day-section");
    section.setAttribute("aria-label", group.label);
    // its place in the order the days settle onto the page (css/motion.css)
    section.style.setProperty("--i", String(Math.min(i, 8)));

    const head = el("div", "day-head");
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
    .sort(byStartTime)
    .forEach((e) => container.appendChild(renderListing(e)));
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

function timetableEntry(event) {
  const entry = el("div", "tt-entry");
  // A one-off has no series behind it, so it is by definition not the usual.
  if (!event.seriesId || event.isNew) entry.classList.add("is-unusual");
  if (event.cancelled) entry.classList.add("is-cancelled");

  entry.appendChild(el("span", "tt-name", event.shortTitle || event.title));
  entry.appendChild(el("span", "tt-time",
    event.cancelled ? "Cancelled" : formatTime(event.startTime, { brief: true })));
  return entry;
}

export function renderTimetable(container, events, { year, month1, now = new Date(), selected, onSelectDay } = {}) {
  container.textContent = "";
  const byDate = groupBy(filterMonth(events, year, month1), (e) => e.date);

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

  const { lead, isos, trail } = monthCells(year, month1);
  const pad = () => {
    const c = el("div", "tt-day tt-day--pad");
    c.setAttribute("aria-hidden", "true");
    return c;
  };
  for (let i = 0; i < lead; i++) grid.appendChild(pad());

  for (const iso of isos) {
    const todays = (byDate.get(iso) ?? []).sort(byStartTime);
    const d = dateOf(iso);

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
    head.appendChild(el("span", "tt-date", String(d.getDate())));
    cell.appendChild(head);

    for (const e of todays) cell.appendChild(timetableEntry(e));
    if (!todays.length) cell.appendChild(el("span", "tt-none", "No programs"));

    cell.setAttribute("aria-label", todays.length
      ? `${dayLabel(iso)}: ${todays.map((e) => e.title).join(", ")}`
      : `${dayLabel(iso)}: no programs`);
    grid.appendChild(cell);
  }

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
