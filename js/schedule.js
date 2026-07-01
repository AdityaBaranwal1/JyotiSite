/* schedule.js — renders the weekly schedule as a newspaper Datebook column:
   day kickers over thick-thin rules, listings separated by hairline rules,
   TODAY/NEW/CANCELLED rubber stamps. Consumes the normalized event shape
   from data-adapter.js only. */

import { categoryIcon } from "./icons.js";

export const DEFAULT_PHONE = "845-709-2216";

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/* Parse "YYYY-MM-DD" in LOCAL time (new Date(str) would give UTC). */
function localDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

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
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { monday, sunday };
}

const isoOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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
  const d = localDate(iso);
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate();
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

  for (const group of groupByDay(schedule.events)) {
    const d = localDate(group.date);
    const section = el("section", "day-section");
    section.setAttribute("aria-label", group.label);

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
  }
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
  for (let i = 0; i < lead; i++) {
    const pad = el("button", "cal-cell");
    pad.type = "button"; pad.disabled = true;
    grid.appendChild(pad);
  }
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
  container.appendChild(grid);
}

/* Full-size listings for one selected day (same rows as the front page). */
export function renderDayListings(container, events, iso, { now = new Date() } = {}) {
  container.textContent = "";
  if (!iso) return;
  const head = el("div", "day-head");
  head.appendChild(el("span", "day-meta"));
  head.firstChild.appendChild(el("span", "day-name", dayLabel(iso)));
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
    const d = localDate(e.date);
    const monday = new Date(d);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const key = isoOf(monday);
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
