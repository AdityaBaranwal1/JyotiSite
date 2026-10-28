/* dates.js — the paper's calendar arithmetic, in one place. A program's date
   is a label ("2026-11-03"), never an instant, so everything here works in
   local calendar days and a clock change can never move a program. */

export const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const SHORT_DAYS = DAYS.map((d) => d.slice(0, 3));

const pad2 = (n) => String(n).padStart(2, "0");

export const isoFromYMD = (year, month1, day) => `${year}-${pad2(month1)}-${pad2(day)}`;
export const isoOf = (d) => isoFromYMD(d.getFullYear(), d.getMonth() + 1, d.getDate());
export const todayIso = (now = new Date()) => isoOf(now);
/* "2026-11" */
export const monthKey = (year, month1) => `${year}-${pad2(month1)}`;

/* Local midnight of a date label. `new Date("2026-11-03")` would read it as
   UTC midnight, which is the evening before here. */
export function dateOf(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = dateOf(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

/* The paper's week runs Monday to Sunday. */
export function mondayOf(d) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

/* A month laid out Monday-first, as on a wall calendar: the empty cells
   before the 1st, every date, and the empty cells that square off the last
   row. */
export function monthCells(year, month1) {
  const lead = (new Date(year, month1 - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, month1, 0).getDate();
  const isos = Array.from({ length: days }, (_, i) => isoFromYMD(year, month1, i + 1));
  return { lead, isos, trail: (7 - ((lead + days) % 7)) % 7 };
}

/* Group a list into a Map of lists, keeping first-seen order. */
export function groupBy(list, keyOf) {
  const out = new Map();
  for (const item of list) {
    const k = keyOf(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

/* "Monday, November 3": the date as a sentence says it. */
export function longDate(iso) {
  const d = dateOf(iso);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
