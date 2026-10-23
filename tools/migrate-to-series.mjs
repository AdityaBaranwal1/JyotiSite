/* One-shot migration: fold the hand-listed occurrences into standing
   programs (RRULE) plus the exceptions that vary week to week.
   Verifies the rewrite by expanding it and diffing against the original. */
import { readFile, writeFile } from "node:fs/promises";
import { normalizeSchedule } from "../js/data-adapter.js";

const SRC = "data/schedule.json";
const orig = JSON.parse(await readFile(SRC, "utf8"));

const FROM = "2026-06-08", UNTIL = "2026-10-31";
const SERIES = [
  { id:"yoga",   day:"MO", startTime:"10:00", endTime:"11:00", category:"yoga",
    title:"Yoga & Guided Meditation", shortTitle:"Yoga", zoomLink:"default",
    description:"Gentle chair yoga and breathing with Smita ji. No experience needed." },
  { id:"computer", day:"TU", startTime:"15:00", endTime:"16:00", category:"computer",
    title:"Computer & Phone Helpful Hints", shortTitle:"Computer Help", zoomLink:"default",
    description:"Bring your questions! Photos, WhatsApp, passwords, whatever is stuck." },
  { id:"art",    day:"WE", startTime:"11:00", endTime:"12:30", category:"art",
    title:"Art Class", shortTitle:"Art", zoomLink:"default",
    description:"The art table, with Mrs. Kapoor." },
  { id:"stocks", day:"TH", startTime:"15:00", endTime:"16:00", category:"stock market",
    title:"Understanding the Stock Market", shortTitle:"Stock Market",
    zoomLink:"https://zoom.us/j/0000000004",
    description:"Dr. B. Aurora continues the series: reading a company's fundamentals." },
  { id:"bhajan", day:"FR", startTime:"11:00", endTime:"12:00", category:"music",
    title:"Bhajan & Music Hour", shortTitle:"Bhajan", zoomLink:null,
    description:"Sing along or just listen: old favorites together over the phone." },
  { id:"finance", day:"FR", startTime:"15:00", endTime:"16:00", category:"finance",
    title:"Basic Finance", shortTitle:"Finance", zoomLink:"default",
    description:"Shri Shonkar Manava on Social Security, senior discounts and household budgets." },
  { id:"health", day:"SA", startTime:"15:00", endTime:"16:00", category:"health",
    title:"Health Talk", shortTitle:"Health Talk", zoomLink:"default",
    description:"A visiting clinician takes questions." },
  { id:"social", day:"SU", startTime:"16:00", endTime:"17:00", category:"social",
    title:"Chai & Chat: Sunday Social", shortTitle:"Chai & Chat", zoomLink:"default",
    description:"No agenda, just neighbors. Bring your own chai." },
];

const series = SERIES.map((s) => ({
  id: s.id, title: s.title, shortTitle: s.shortTitle, description: s.description,
  category: s.category, startTime: s.startTime, endTime: s.endTime,
  ...(s.zoomLink ? { zoomLink: s.zoomLink } : {}),
  rrule: `FREQ=WEEKLY;BYDAY=${s.day}`, from: FROM, until: UNTIL,
}));

// Which series slot (if any) does an original event occupy?
const slotOf = (e) => SERIES.find(
  (s) => s.startTime === e.startTime && s.category === e.category
)?.id ?? null;

const origBySlot = new Map();   // "id@date" -> original event
const oneOffs = [];
for (const e of orig.events) {
  const id = slotOf(e);
  if (id) origBySlot.set(`${id}@${e.date}`, e);
  else oneOffs.push(e);
}

// Expand the bare series, then record every way reality differs from it.
const bare = normalizeSchedule({ ...orig, events: [], series, exceptions: [] });
const exceptions = [];
const seen = new Set();

for (const occ of bare.events) {
  const key = `${occ.seriesId}@${occ.date}`;
  seen.add(key);
  const actual = origBySlot.get(key);
  if (!actual) { exceptions.push({ seriesId: occ.seriesId, date: occ.date, skip: true }); continue; }

  const def = SERIES.find((s) => s.id === occ.seriesId);
  const ex = { seriesId: occ.seriesId, date: occ.date };
  if (actual.title !== def.title) ex.title = actual.title;
  if ((actual.description ?? "") !== def.description) ex.description = actual.description;
  const aZoom = actual.zoomLink ?? null, dZoom = def.zoomLink ?? null;
  if (aZoom !== dZoom) ex.zoomLink = aZoom;
  if (actual.cancelled) ex.cancelled = true;
  if (actual.isNew) ex.isNew = true;
  if (Object.keys(ex).length > 2) exceptions.push(ex);
}
// An original event sitting in a series slot on a date the rule never emits
// is not an exception — it is a one-off.
for (const [key, e] of origBySlot) if (!seen.has(key)) oneOffs.push(e);

const out = {
  savedAt: orig.savedAt,
  defaultZoomLink: orig.defaultZoomLink,
  editorsNote: orig.editorsNote,
  series,
  exceptions: exceptions.sort((a, b) => a.date.localeCompare(b.date) || a.seriesId.localeCompare(b.seriesId)),
  events: oneOffs.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)),
};

await writeFile(SRC, JSON.stringify(out, null, 2) + "\n");

/* ---- verify: the new file must expand to exactly the old listings ---- */
const before = normalizeSchedule(orig).events;
const after = normalizeSchedule(JSON.parse(await readFile(SRC, "utf8"))).events;
const sig = (e) => [e.title, e.date, e.startTime, e.endTime, e.category,
                    e.description, e.zoomLink, e.cancelled, e.isNew].join("|");
const a = before.map(sig).sort(), b = after.map(sig).sort();
const missing = a.filter((x) => !b.includes(x));
const added   = b.filter((x) => !a.includes(x));

console.log(`series ${series.length} · exceptions ${exceptions.length} · one-offs ${oneOffs.length}`);
console.log(`expanded ${after.length} events (was ${before.length})`);
console.log(missing.length || added.length ? "MISMATCH" : "✓ expands to an identical schedule");
for (const m of missing.slice(0, 5)) console.log("  missing:", m);
for (const x of added.slice(0, 5)) console.log("  added:  ", x);
