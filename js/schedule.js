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

  const time = event.endTime
    ? `${formatTime(event.startTime)} – ${formatTime(event.endTime)}`
    : formatTime(event.startTime);
  main.appendChild(el("p", "l-time", time));
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
        `No programs are listed this week — call us at ${DEFAULT_PHONE} to check what's on.`)
    );
    container.appendChild(box);
    return;
  }

  for (const group of groupByDay(schedule.events)) {
    const section = el("section", "day-section");
    section.setAttribute("aria-label", group.label);

    const head = el("div", "day-head");
    head.appendChild(el("span", "day-name", group.label));
    if (isToday(group.date, now)) head.appendChild(stamp("Today", "stamp--today"));
    section.appendChild(head);

    for (const event of group.events) section.appendChild(renderListing(event));
    container.appendChild(section);
  }
}

/* Renders the stale-cache correction notice above the datebook. */
export function renderStaleNotice(container) {
  const box = el("div", "notice");
  box.appendChild(el("span", "kicker", "Correction"));
  box.appendChild(
    el("p", null,
      `This may not be the latest schedule — call us at ${DEFAULT_PHONE} to confirm.`)
  );
  container.appendChild(box);
}
