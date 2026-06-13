import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEvent, normalizeSchedule, getSchedule } from "../js/data-adapter.js";

const valid = {
  title: "Yoga & Guided Meditation",
  description: "Gentle chair yoga with Dr. Mehta.",
  category: "yoga",
  date: "2026-06-08",
  startTime: "10:00",
  endTime: "11:00",
  zoomLink: "https://zoom.us/j/123",
};

test("normalizeEvent: keeps a valid event and its fields", () => {
  const e = normalizeEvent(valid);
  assert.equal(e.title, valid.title);
  assert.equal(e.date, "2026-06-08");
  assert.equal(e.zoomLink, valid.zoomLink);
  assert.equal(e.cancelled, false);
});

test("normalizeEvent: drops rows missing title, date, or startTime", () => {
  assert.equal(normalizeEvent({ ...valid, title: "" }), null);
  assert.equal(normalizeEvent({ ...valid, date: "not-a-date" }), null);
  assert.equal(normalizeEvent({ ...valid, startTime: undefined }), null);
});

test("normalizeEvent: coerces cancelled/isNew flags and strips non-http zoom links", () => {
  const e = normalizeEvent({ ...valid, cancelled: "yes", isNew: 1, zoomLink: "javascript:alert(1)" });
  assert.equal(e.cancelled, true);
  assert.equal(e.isNew, true);
  assert.equal(e.zoomLink, null);
});

test("normalizeSchedule: keeps meta, drops invalid rows silently", () => {
  const s = normalizeSchedule({
    weekLabel: "Week of June 8–14, 2026",
    volume: "Vol. 2 · No. 23",
    updated: "Monday, June 8",
    editorsNote: "Welcome back, friends.",
    events: [valid, { title: "broken" }, null],
  });
  assert.equal(s.weekLabel, "Week of June 8–14, 2026");
  assert.equal(s.events.length, 1);
  assert.equal(s.editorsNote, "Welcome back, friends.");
});

function fakeStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _map: m,
  };
}

test("getSchedule: success normalizes, caches, and is not stale", async () => {
  const storage = fakeStorage();
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ weekLabel: "W", events: [valid] }),
  });
  const r = await getSchedule({ fetchImpl, storage });
  assert.equal(r.ok, true);
  assert.equal(r.stale, false);
  assert.equal(r.schedule.events.length, 1);
  assert.ok(storage._map.size > 0, "expected the schedule to be cached");
});

test("getSchedule: fetch failure falls back to cache and marks stale", async () => {
  const storage = fakeStorage();
  const good = async () => ({ ok: true, json: async () => ({ weekLabel: "W", events: [valid] }) });
  await getSchedule({ fetchImpl: good, storage });
  const bad = async () => { throw new Error("offline"); };
  const r = await getSchedule({ fetchImpl: bad, storage });
  assert.equal(r.ok, true);
  assert.equal(r.stale, true);
  assert.equal(r.schedule.events.length, 1);
});

test("getSchedule: failure with no cache returns ok:false and a null schedule", async () => {
  const r = await getSchedule({ fetchImpl: async () => { throw new Error("offline"); }, storage: fakeStorage() });
  assert.equal(r.ok, false);
  assert.equal(r.schedule, null);
});
