/* data-adapter.js — the seam between the schedule renderer and whatever
   backend the community eventually picks. The renderer only ever sees the
   normalized shape below. To switch backends, change SOURCE and implement
   the matching fetch — nothing else in the site changes.

   SOURCE options:
     "json"     — bundled data/schedule.json (default; editors replace the file
                  or, later, a tiny script regenerates it)
     "sheets"   — published Google Sheet CSV (no API key needed)   [stub]
     "airtable" — Airtable REST API                                 [stub]   */

export const SOURCE = "json";
export const SCHEDULE_URL = "data/schedule.json";
const CACHE_KEY = "jyoti-schedule-cache";

/* ---------- Normalization ---------- */

const truthy = (v) =>
  v === true || v === 1 || /^(true|yes|y|1|cancelled)$/i.test(String(v ?? "").trim());

export function normalizeEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title ?? "").trim();
  const date = String(raw.date ?? "").trim();
  const startTime = String(raw.startTime ?? "").trim();
  if (!title) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{1,2}:\d{2}$/.test(startTime)) return null;

  let zoomLink = String(raw.zoomLink ?? "").trim();
  if (!/^https?:\/\//i.test(zoomLink)) zoomLink = null;

  return {
    title,
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

export function normalizeSchedule(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const events = Array.isArray(r.events)
    ? r.events.map(normalizeEvent).filter(Boolean)
    : [];
  return {
    weekLabel: String(r.weekLabel ?? "").trim(),
    volume: String(r.volume ?? "").trim(),
    updated: String(r.updated ?? "").trim(),
    editorsNote: String(r.editorsNote ?? "").trim(),
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
