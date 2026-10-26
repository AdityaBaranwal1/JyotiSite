/* data-adapter.js — the seam between the schedule renderer and whatever
   backend the community eventually picks. The renderer only ever sees the
   normalized shape below. To switch backends, change SOURCE and implement
   the matching fetch — nothing else in the site changes.

   SOURCE options:
     "json"     — bundled data/schedule.json (default; editors replace the file
                  or, later, a tiny script regenerates it)
     "sheets"   — published Google Sheet CSV (no API key needed)   [stub]
     "airtable" — Airtable REST API                                 [stub]   */

/* rrule publishes a UMD `main` and an ESM `module` with no exports map, so
   Node and the bundler resolve different builds. A namespace import is the
   one form that yields the class under both. */
import * as rrulePkg from "rrule";
/* Reading the namespace through a parameter keeps the bundler from resolving
   (and warning about) the branch its own resolution makes dead. */
const pickRRule = (ns) => ns.RRule ?? ns.default?.RRule ?? ns.default;
const RRule = pickRRule(rrulePkg);

export const SOURCE = "json";
export const SCHEDULE_URL = "data/schedule.json";
const CACHE_KEY = "jyoti-schedule-cache";

/* ---------- Standing programs ----------
   The paper's week is a drumbeat: yoga every Monday, computer help every
   Tuesday. Storing that as one row per occurrence is what let the schedule
   quietly expire. A series states the rhythm once as an RRULE; `exceptions`
   carry the week-to-week variation (this Wednesday's art topic, a cancelled
   talk, a holiday closure).

   Dates are labels, never instants: rrule runs in UTC and we read back the
   calendar date only, so a clock change can never shift a program by a day.
   Time of day lives in startTime/endTime as written.

   A series with no `until` runs until a volunteer stops it. It is printed as
   far as the horizon: the end of the month a year from today, so readers can
   always look a full year ahead and the paper never quietly runs dry. */

const pad = (n) => String(n).padStart(2, "0");
const isoOfUTC = (d) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function utcMidnight(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

/* The last day of the month twelve months after `now`, as a date label. */
export function defaultHorizon(now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth() + 13, 0);
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
}

/* The weekly programs still running on `today`: not yet ended, whether or not
   they have begun. A program that was stopped or replaced stays in the data
   (it still prints the weeks it ran) but is no longer "what is normally on". */
export function activeSeries(series, today) {
  return (Array.isArray(series) ? series : []).filter(
    (s) => s && typeof s === "object" && (!s.until || s.until >= today));
}

/* "every week on Monday" — rrule's own prose, tidied for the paper's voice.
   Used by the standing-programs strip, which states the rhythm in words so a
   reader who never looks at the grid still learns when their class meets. */
export function describeSeries(s) {
  try {
    const text = RRule.fromString(`RRULE:${s.rrule}`).toText();
    return text.replace(/^every week on /, "Every ").replace(/^every /, "Every ");
  } catch {
    return "";
  }
}

/* `includeSkipped` is for the volunteers' desk: readers should never see a
   day that was taken off, but an editor needs to see it in order to put it
   back. */
export function expandSeries(series, exceptions = [], { includeSkipped = false, horizon } = {}) {
  if (!Array.isArray(series)) return [];
  const openEnd = horizon ?? defaultHorizon();

  // exceptions keyed by "<seriesId>@<date>"
  const byKey = new Map();
  for (const x of exceptions ?? []) {
    if (x && x.seriesId && x.date) byKey.set(`${x.seriesId}@${x.date}`, x);
  }

  const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

  const out = [];
  for (const s of series) {
    if (!s || typeof s !== "object") continue;
    const dtstart = utcMidnight(s.from);
    const until = utcMidnight(s.until || openEnd);
    if (!dtstart || !until || !s.rrule) continue;

    let dates;
    try {
      dates = RRule.fromString(`DTSTART:${s.from.replace(/-/g, "")}T000000Z\nRRULE:${s.rrule}`)
        .between(dtstart, until, true);
    } catch {
      continue;   // a malformed rule drops its series, never the whole paper
    }

    for (const d of dates) {
      const date = isoOfUTC(d);
      const ex = byKey.get(`${s.id}@${date}`) ?? null;
      if (ex?.skip && !includeSkipped) continue;   // no program that day at all
      out.push({
        skipped: Boolean(ex?.skip),
        hasException: Boolean(ex),
        title: ex?.title ?? s.title,
        shortTitle: ex?.shortTitle ?? s.shortTitle ?? s.title,
        description: ex?.description ?? s.description,
        category: ex?.category ?? s.category,
        date,
        startTime: ex?.startTime ?? s.startTime,
        endTime: ex?.endTime ?? s.endTime,
        // an exception may deliberately clear the link (a cancelled talk),
        // so presence of the key matters, not its truthiness
        zoomLink: has(ex, "zoomLink") ? ex.zoomLink : s.zoomLink,
        cancelled: ex?.cancelled ?? false,
        isNew: ex?.isNew ?? false,
        seriesId: s.id,
      });
    }
  }
  return out;
}

/* ---------- Normalization ---------- */

const truthy = (v) =>
  v === true || v === 1 || /^(true|yes|y|1|cancelled)$/i.test(String(v ?? "").trim());

export function normalizeEvent(raw, defaultZoomLink = null) {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title ?? "").trim();
  const date = String(raw.date ?? "").trim();
  const startTime = String(raw.startTime ?? "").trim();
  if (!title) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{1,2}:\d{2}$/.test(startTime)) return null;

  // "default" points at the schedule-wide default Zoom room, so the link can
  // change once (in the admin) and every event follows it.
  let zoomLink = String(raw.zoomLink ?? "").trim();
  if (zoomLink === "default") zoomLink = defaultZoomLink ?? "";
  if (!/^https?:\/\//i.test(zoomLink)) zoomLink = null;

  return {
    title,
    // Grid cells have one column's worth of room; shortTitle is what the
    // timetable prints when the full headline will not fit.
    shortTitle: String(raw.shortTitle ?? "").trim() || title,
    seriesId: String(raw.seriesId ?? "").trim() || null,
    description: String(raw.description ?? "").trim(),
    category: String(raw.category ?? "").trim(),
    date,
    startTime,
    endTime: /^\d{1,2}:\d{2}$/.test(String(raw.endTime ?? "").trim())
      ? String(raw.endTime).trim()
      : null,
    zoomLink,
    phone: String(raw.phone ?? "").trim() || null,
    cancelled: truthy(raw.cancelled),
    isNew: truthy(raw.isNew),
  };
}

export function normalizeSchedule(raw, { horizon } = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  let defaultZoomLink = String(r.defaultZoomLink ?? "").trim();
  if (!/^https?:\/\//i.test(defaultZoomLink)) defaultZoomLink = null;
  // Standing programs expand first, then one-off events are layered on top.
  const expanded = expandSeries(r.series, r.exceptions, { horizon });
  const oneOffs = Array.isArray(r.events) ? r.events : [];
  const events = [...expanded, ...oneOffs]
    .map((e) => normalizeEvent(e, defaultZoomLink))
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  return {
    defaultZoomLink,
    savedAt: String(r.savedAt ?? "").trim(),
    editorsNote: String(r.editorsNote ?? "").trim(),
    series: Array.isArray(r.series) ? r.series : [],
    events,
  };
}

/* ---------- Fetch with cache fallback ---------- */

export async function getSchedule({ fetchImpl, storage, url } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const store =
    storage || (typeof localStorage !== "undefined" ? localStorage : null);
  const target = url || SCHEDULE_URL;

  try {
    const res = await doFetch(target, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const schedule = normalizeSchedule(await res.json());
    try { store?.setItem(CACHE_KEY, JSON.stringify(schedule)); } catch { /* full/private */ }
    return { ok: true, stale: false, schedule };
  } catch {
    try {
      const cached = store?.getItem(CACHE_KEY);
      if (cached) {
        return { ok: true, stale: true, schedule: normalizeSchedule(JSON.parse(cached)) };
      }
    } catch { /* corrupted cache — fall through */ }
    return { ok: false, stale: false, schedule: null };
  }
}

/* ---------- Future backends (Phase 2 seams) ----------
   sheets:   fetch `https://docs.google.com/spreadsheets/d/e/<id>/pub?output=csv`,
             parse rows to the raw event shape, feed through normalizeSchedule.
   airtable: fetch `https://api.airtable.com/v0/<base>/<table>` with a read-only
             token, map records[].fields to the raw event shape, normalize.   */
