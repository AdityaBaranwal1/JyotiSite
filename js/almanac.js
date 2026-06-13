/* almanac.js — "The Almanac" box: one entry per calendar day from bundled
   data/almanac.json (keys "MM-DD"). Fully offline, zero weekly upkeep.
   Entries mix well-known anniversaries with proverbs and seasonal notes,
   the way a real local paper's almanac column does. */

export function dateKey(d = new Date()) {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function entryFor(data, d = new Date()) {
  if (!data || typeof data !== "object") return null;
  return data[dateKey(d)] ?? null;
}

export async function initAlmanac(el, { fetchImpl, now } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  try {
    const res = await doFetch("data/almanac.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = entryFor(await res.json(), now || new Date());
    if (!text) throw new Error("no entry");
    const slot = el.querySelector("[data-almanac-text]") || el;
    slot.textContent = text;
    el.hidden = false;
  } catch {
    el.hidden = true; // fails closed — a broken almanac never affects the page
  }
}
