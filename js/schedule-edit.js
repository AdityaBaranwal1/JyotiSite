/* schedule-edit.js — what each change on the Editor's Desk means for the data.
   Pure functions over the raw schedule, so the desk stays a thin layer of
   buttons and these rules can be tested without a browser. None of them
   change the schedule they are given; each returns a new one.

   The rules of the house:
   - A change to a weekly program takes effect from the date it is made for
     (never earlier than today). Weeks before that keep the details they were
     printed with, so a past month never quietly rewrites itself.
   - A weekly program has no end date: it runs until a volunteer stops it.
   - A change for one date records only what differs from the weekly
     program, so a later change to the program still flows through
     everything that date does not contradict. */

import { addDays } from "./dates.js";

export const WEEKDAYS = [
  ["MO", "Monday"], ["TU", "Tuesday"], ["WE", "Wednesday"], ["TH", "Thursday"],
  ["FR", "Friday"], ["SA", "Saturday"], ["SU", "Sunday"],
];
const SUNDAY_FIRST = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/* "MO" for a plain once-a-week rule; null for anything richer, which the
   desk states in words but does not offer to move. */
export function weekdayOf(rrule) {
  const m = /^FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU)$/.exec(String(rrule ?? ""));
  return m ? m[1] : null;
}

/* The weekday code of a date label: "2026-11-03" → "TU". */
export const weekdayOfDate = (iso) => SUNDAY_FIRST[new Date(`${iso}T12:00:00Z`).getUTCDay()];
export const dayName = (code) => WEEKDAYS.find(([c]) => c === code)?.[1] ?? "";

const slug = (title) =>
  String(title).toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "program";

function freshId(schedule, title, from) {
  const base = `${slug(title)}-${from.replace(/-/g, "")}`;
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
const seriesOf = (schedule, id) => (schedule.series ?? []).find((s) => s.id === id) ?? null;

/* ---------- Weekly programs ---------- */

/* How many dates from `from` on carry a change made by hand (a cancelled
   week, a different topic). Moving the program to another day leaves those
   dates behind, so the desk asks before doing it. */
export function handChangesFrom(schedule, seriesId, from) {
  return (schedule.exceptions ?? []).filter((x) => x.seriesId === seriesId && x.date >= from).length;
}

export function addSeries(schedule, fields, from) {
  const s = withDetails({ id: freshId(schedule, fields.title, from) }, fields);
  s.rrule = ruleFor(fields.weekday);
  s.from = from;
  return { ...schedule, series: [...(schedule.series ?? []), s] };
}

export function changeSeries(schedule, seriesId, fields, from) {
  const series = schedule.series ?? [];
  const old = seriesOf(schedule, seriesId);
  if (!old) return schedule;

  const rrule = fields.weekday && weekdayOf(old.rrule) ? ruleFor(fields.weekday) : old.rrule;
  const dayMoved = rrule !== old.rrule;
  const updated = withDetails(old, fields);
  updated.rrule = rrule;
  delete updated.until;
  // The grid's short name belonged to the old name.
  if (updated.title !== old.title) delete updated.shortTitle;

  let exceptions = schedule.exceptions ?? [];

  // Nothing printed before `from`: change it where it stands.
  if (old.from >= from) {
    if (dayMoved) exceptions = exceptions.filter((x) => x.seriesId !== seriesId);
    return { ...schedule, series: series.map((s) => (s === old ? updated : s)), exceptions };
  }

  // Otherwise the old program ends the day before and the changed one carries
  // on from `from`, taking this program's later hand-made changes with it (or
  // leaving them behind, if it has moved to another day).
  const next = { ...updated, id: freshId(schedule, updated.title, from), from };
  exceptions = exceptions.flatMap((x) => {
    if (x.seriesId !== seriesId || x.date < from) return [x];
    return dayMoved ? [] : [{ ...x, seriesId: next.id }];
  });
  return {
    ...schedule,
    series: [...series.map((s) => (s === old ? { ...old, until: addDays(from, -1) } : s)), next],
    exceptions,
  };
}

/* Stopping keeps the weeks it already ran; a program that never ran is
   simply removed. */
export function stopSeries(schedule, seriesId, from) {
  const series = schedule.series ?? [];
  const old = seriesOf(schedule, seriesId);
  if (!old) return schedule;
  const neverRan = old.from >= from;
  return {
    ...schedule,
    series: neverRan
      ? series.filter((s) => s !== old)
      : series.map((s) => (s === old ? { ...old, until: addDays(from, -1) } : s)),
    exceptions: (schedule.exceptions ?? []).filter(
      (x) => x.seriesId !== seriesId || (!neverRan && x.date < from)),
  };
}

/* ---------- One date ----------
   The desk shows dates, not records. A date is either a weekly program's
   (kind "series": its seriesId and date) or a one-off event (kind "once":
   its place in the events list). Every change to one date goes through
   these, whichever kind it is. */

const isAt = (o) => (x) => x.seriesId === o.seriesId && x.date === o.date;
const merge = (current, changes) => {
  const out = { ...current };
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) delete out[k]; else out[k] = v;
  }
  return out;
};
const saysNothing = (x) => Object.keys(x).every((k) => k === "seriesId" || k === "date");

/* Write one date's record. A weekly program's change that no longer says
   anything is deleted rather than left behind empty. */
function putDate(schedule, o, record) {
  if (o.kind === "once") {
    const events = [...(schedule.events ?? [])];
    events[o.eventIndex] = record;
    return { ...schedule, events };
  }
  const rest = (schedule.exceptions ?? []).filter((x) => !isAt(o)(x));
  return { ...schedule, exceptions: saysNothing(record) ? rest : [...rest, record] };
}

function recordOf(schedule, o) {
  if (o.kind === "once") return schedule.events?.[o.eventIndex] ?? {};
  return (schedule.exceptions ?? []).find(isAt(o)) ?? { seriesId: o.seriesId, date: o.date };
}

/* Merge `changes` into what the date already carries; `undefined` removes. */
export const patchDate = (schedule, o, changes) =>
  putDate(schedule, o, merge(recordOf(schedule, o), changes));

/* Cancelling keeps the date on the paper stamped CANCELLED, so nobody turns
   up to an empty room. Putting it back on also clears the older way of
   taking a date off entirely. */
export const setCancelled = (schedule, o, cancelled) =>
  patchDate(schedule, o, cancelled ? { cancelled: true } : { cancelled: undefined, skip: undefined });

/* A weekly program's date back to the usual details. A cancelled date stays
   cancelled: that is a separate button. */
export const resetDate = (schedule, o) =>
  putDate(schedule, o, { seriesId: o.seriesId, date: o.date, ...(o.cancelled ? { cancelled: true } : {}) });

/* Save the editor's form for one date. For a weekly program only what
   differs from the program is kept; a cancelled date stays cancelled. */
export function writeDate(schedule, o, fields) {
  const keep = { ...(o.cancelled ? { cancelled: true } : {}), ...(fields.isNew ? { isNew: true } : {}) };
  if (o.kind === "once") {
    return putDate(schedule, o, { ...withDetails({ date: fields.date ?? o.date }, fields), ...keep });
  }
  const s = seriesOf(schedule, o.seriesId);
  const record = { seriesId: o.seriesId, date: o.date };
  const before = recordOf(schedule, o);
  for (const k of DETAILS) {
    const value = k === "endTime" ? fields.endTime || "" : fields[k];
    if ((value ?? "") !== (s?.[k] ?? "")) record[k] = value;
  }
  // The grid's short name for this date's topic, while the topic stands.
  if (before.shortTitle && record.title === before.title) record.shortTitle = before.shortTitle;
  return putDate(schedule, o, { ...record, ...keep });
}

export function addEvent(schedule, fields) {
  const event = withDetails({ date: fields.date }, fields);
  if (fields.isNew) event.isNew = true;
  return { ...schedule, events: [...(schedule.events ?? []), event] };
}

export const deleteEvent = (schedule, o) =>
  ({ ...schedule, events: (schedule.events ?? []).filter((_, i) => i !== o.eventIndex) });
