/* series-edit.js — what changing a weekly program means for the data.
   Pure functions over the raw schedule, so the desk stays a thin layer of
   buttons and these rules can be tested without a browser. None of them
   change the schedule they are given; each returns a new one.

   The rule of the house: a change to a weekly program takes effect from
   today. Weeks already printed keep the details they were printed with, so a
   past month never quietly rewrites itself. And a weekly program has no end
   date: it runs until a volunteer stops it. */

export const WEEKDAYS = [
  ["MO", "Monday"], ["TU", "Tuesday"], ["WE", "Wednesday"], ["TH", "Thursday"],
  ["FR", "Friday"], ["SA", "Saturday"], ["SU", "Sunday"],
];

/* "MO" for a plain once-a-week rule; null for anything richer, which the
   desk states in words but does not offer to change. */
export function weekdayOf(rrule) {
  const m = /^FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU)$/.exec(String(rrule ?? ""));
  return m ? m[1] : null;
}

const dayBefore = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const slug = (title) =>
  String(title).toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "program";

function freshId(schedule, title, today) {
  const base = `${slug(title)}-${today.replace(/-/g, "")}`;
  const taken = new Set((schedule.series ?? []).map((s) => s.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/* The details a volunteer can set. An empty end time means "no end time". */
const DETAILS = ["title", "description", "category", "startTime", "endTime", "zoomLink"];
function withDetails(target, fields) {
  const out = { ...target };
  for (const k of DETAILS) if (fields[k] !== undefined) out[k] = fields[k];
  if (!out.endTime) delete out.endTime;
  return out;
}

const ruleFor = (weekday) => `FREQ=WEEKLY;BYDAY=${weekday}`;

/* How many dates from today on carry a change made by hand (a cancelled
   week, a different topic). Moving the program to another day leaves those
   dates behind, so the desk asks before doing it. */
export function handChangesFrom(schedule, seriesId, today) {
  return (schedule.exceptions ?? []).filter((x) => x.seriesId === seriesId && x.date >= today).length;
}

export function addSeries(schedule, fields, today) {
  const s = withDetails({ id: freshId(schedule, fields.title, today) }, fields);
  s.rrule = ruleFor(fields.weekday);
  s.from = today;
  return { ...schedule, series: [...(schedule.series ?? []), s] };
}

export function changeSeries(schedule, seriesId, fields, today) {
  const series = schedule.series ?? [];
  const old = series.find((s) => s.id === seriesId);
  if (!old) return schedule;

  const rrule = fields.weekday && weekdayOf(old.rrule) ? ruleFor(fields.weekday) : old.rrule;
  const dayMoved = rrule !== old.rrule;
  const updated = withDetails(old, fields);
  updated.rrule = rrule;
  delete updated.until;
  // The grid's short name belonged to the old name.
  if (updated.title !== old.title) delete updated.shortTitle;

  let exceptions = schedule.exceptions ?? [];

  // Nothing printed yet: change it where it stands.
  if (old.from >= today) {
    if (dayMoved) exceptions = exceptions.filter((x) => x.seriesId !== seriesId);
    return { ...schedule, series: series.map((s) => (s === old ? updated : s)), exceptions };
  }

  // Otherwise the old program ends yesterday and the changed one carries on
  // from today, taking this program's future hand-made changes with it (or
  // leaving them behind, if it has moved to another day).
  const next = { ...updated, id: freshId(schedule, updated.title, today), from: today };
  exceptions = exceptions.flatMap((x) => {
    if (x.seriesId !== seriesId || x.date < today) return [x];
    return dayMoved ? [] : [{ ...x, seriesId: next.id }];
  });
  return {
    ...schedule,
    series: [...series.map((s) => (s === old ? { ...old, until: dayBefore(today) } : s)), next],
    exceptions,
  };
}

/* Stopping keeps the weeks it already ran; a program that never ran is
   simply removed. */
export function stopSeries(schedule, seriesId, today) {
  const series = schedule.series ?? [];
  const old = series.find((s) => s.id === seriesId);
  if (!old) return schedule;
  const neverRan = old.from >= today;
  return {
    ...schedule,
    series: neverRan
      ? series.filter((s) => s !== old)
      : series.map((s) => (s === old ? { ...old, until: dayBefore(today) } : s)),
    exceptions: (schedule.exceptions ?? []).filter(
      (x) => x.seriesId !== seriesId || (!neverRan && x.date < today)),
  };
}
