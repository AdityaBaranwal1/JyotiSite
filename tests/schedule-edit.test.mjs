import { test } from "node:test";
import assert from "node:assert/strict";
import { expandSeries, defaultHorizon, activeSeries } from "../js/data-adapter.js";
import {
  addSeries, changeSeries, stopSeries, handChangesFrom, weekdayOf, weekdayOfDate,
  setCancelled, resetDate, writeDate, addEvent, deleteEvent,
} from "../js/schedule-edit.js";

const yoga = {
  id: "yoga", title: "Yoga", shortTitle: "Yoga", description: "Chair yoga.", category: "yoga",
  startTime: "10:00", endTime: "11:00", zoomLink: "default",
  rrule: "FREQ=WEEKLY;BYDAY=MO", from: "2026-09-07",
};
const base = () => ({
  series: [{ ...yoga }],
  exceptions: [
    { seriesId: "yoga", date: "2026-09-14", cancelled: true },   // already printed
    { seriesId: "yoga", date: "2026-10-05", title: "Yoga: guest" }, // still ahead
  ],
  events: [],
});
const TODAY = "2026-09-30";   // a Wednesday
const dates = (s, id) =>
  expandSeries(s.series, s.exceptions, { horizon: "2026-10-31" })
    .filter((o) => !id || o.seriesId === id).map((o) => o.date);

test("a series with no end date runs to the horizon, a year ahead", () => {
  assert.equal(defaultHorizon(new Date(2026, 9, 26)), "2027-10-31");
  assert.equal(defaultHorizon(new Date(2026, 0, 31)), "2027-01-31");
  const out = expandSeries([yoga], [], { horizon: "2026-10-31" });
  assert.equal(out.at(-1).date, "2026-10-26");
  assert.equal(out.length, 8);
});

test("an explicit end date still wins", () => {
  const out = expandSeries([{ ...yoga, until: "2026-09-21" }], [], { horizon: "2026-10-31" });
  assert.deepEqual(out.map((o) => o.date), ["2026-09-07", "2026-09-14", "2026-09-21"]);
});

test("activeSeries leaves out programs that have ended", () => {
  const list = [yoga, { ...yoga, id: "old", until: "2026-09-29" }, { ...yoga, id: "last", until: "2026-09-30" }];
  assert.deepEqual(activeSeries(list, TODAY).map((s) => s.id), ["yoga", "last"]);
});

test("weekdayOf reads only the plain weekly rule", () => {
  assert.equal(weekdayOf("FREQ=WEEKLY;BYDAY=FR"), "FR");
  assert.equal(weekdayOf("FREQ=WEEKLY;BYDAY=MO,WE"), null);
  assert.equal(weekdayOf("FREQ=MONTHLY;BYDAY=1SA"), null);
});

test("changing the hour keeps printed weeks as they were and carries on from today", () => {
  const before = base();
  const after = changeSeries(before, "yoga", { startTime: "11:00", endTime: "12:00" }, TODAY);
  assert.notEqual(after, before);
  assert.equal(before.series.length, 1, "the original is untouched");

  const [old, next] = after.series;
  assert.equal(old.until, "2026-09-29");
  assert.equal(old.startTime, "10:00");
  assert.equal(next.from, TODAY);
  assert.equal(next.startTime, "11:00");
  assert.equal(next.until, undefined, "a weekly program runs until stopped");

  const out = expandSeries(after.series, after.exceptions, { horizon: "2026-10-31" });
  assert.equal(out.find((o) => o.date === "2026-09-28").startTime, "10:00");
  assert.equal(out.find((o) => o.date === "2026-10-05").startTime, "11:00");
  // Every Monday is still there exactly once.
  assert.deepEqual(dates(after), dates(before));
  // The printed cancellation stays with the old program, the future topic moves on.
  assert.ok(after.exceptions.some((x) => x.seriesId === "yoga" && x.date === "2026-09-14"));
  assert.equal(out.find((o) => o.date === "2026-10-05").title, "Yoga: guest");
});

test("moving to another day leaves future hand changes behind", () => {
  const s = base();
  assert.equal(handChangesFrom(s, "yoga", TODAY), 1);
  const after = changeSeries(s, "yoga", { weekday: "TU" }, TODAY);
  const next = after.series[1];
  assert.equal(next.rrule, "FREQ=WEEKLY;BYDAY=TU");
  assert.equal(after.exceptions.filter((x) => x.date >= TODAY).length, 0);
  assert.deepEqual(dates(after, next.id), ["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]);
});

test("renaming drops the old short name", () => {
  const after = changeSeries(base(), "yoga", { title: "Tai Chi" }, TODAY);
  assert.equal(after.series[1].title, "Tai Chi");
  assert.equal(after.series[1].shortTitle, undefined);
});

test("a program that has not started yet is changed in place", () => {
  const s = { ...base(), series: [{ ...yoga, from: "2026-10-01" }] };
  const after = changeSeries(s, "yoga", { startTime: "09:00", endTime: "" }, TODAY);
  assert.equal(after.series.length, 1);
  assert.equal(after.series[0].id, "yoga");
  assert.equal(after.series[0].startTime, "09:00");
  assert.equal("endTime" in after.series[0], false, "an empty end time means none");
});

test("two changes on the same day do not pile up programs", () => {
  const once = changeSeries(base(), "yoga", { startTime: "11:00" }, TODAY);
  const twice = changeSeries(once, once.series[1].id, { startTime: "12:00" }, TODAY);
  assert.equal(twice.series.length, 2);
  assert.equal(twice.series[1].startTime, "12:00");
});

test("stopping keeps the weeks it ran and ends it yesterday", () => {
  const after = stopSeries(base(), "yoga", TODAY);
  assert.equal(after.series[0].until, "2026-09-29");
  assert.deepEqual(dates(after), ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
  assert.equal(after.exceptions.length, 1, "only the printed change is kept");
});

test("stopping a program that never ran removes it", () => {
  const s = { ...base(), series: [{ ...yoga, from: TODAY }] };
  const after = stopSeries(s, "yoga", TODAY);
  assert.equal(after.series.length, 0);
  assert.equal(after.exceptions.length, 0);
});

test("adding a weekly program starts today with no end", () => {
  const after = addSeries(base(), {
    title: "Gardening Club", weekday: "TH", startTime: "14:00", endTime: "",
    description: "", category: "social", zoomLink: "default",
  }, TODAY);
  const added = after.series[1];
  assert.equal(added.id, "gardening-club-20260930");
  assert.equal(added.from, TODAY);
  assert.equal(added.until, undefined);
  assert.deepEqual(dates(after, added.id), ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]);
  const again = addSeries(after, { title: "Gardening Club", weekday: "FR", startTime: "14:00" }, TODAY);
  assert.equal(again.series[2].id, "gardening-club-20260930-2");
});

/* ---------- one date: the same few rules for either kind ---------- */
const weekly = (date) => ({ kind: "series", seriesId: "yoga", date });
const once = (i) => ({ kind: "once", eventIndex: i });

test("cancelling and putting back on is one toggle, for a weekly date or a one-off", () => {
  const s = { ...base(), events: [{ title: "Picnic", date: "2026-10-10", startTime: "12:00" }] };
  const off = setCancelled(setCancelled(s, weekly("2026-10-12"), true), once(0), true);
  assert.ok(off.exceptions.some((x) => x.date === "2026-10-12" && x.cancelled));
  assert.equal(off.events[0].cancelled, true);

  const on = setCancelled(setCancelled(off, weekly("2026-10-12"), false), once(0), false);
  assert.deepEqual(on.exceptions, s.exceptions, "an emptied change for one date is removed");
  assert.equal("cancelled" in on.events[0], false);
});

test("putting a date back on also clears the older 'skip'", () => {
  const s = { ...base(), exceptions: [{ seriesId: "yoga", date: "2026-10-12", skip: true }] };
  assert.deepEqual(setCancelled(s, weekly("2026-10-12"), false).exceptions, []);
});

test("cancelling keeps a date's changed topic, and back-to-usual keeps it cancelled", () => {
  const s = setCancelled(base(), weekly("2026-10-05"), true);
  const x = s.exceptions.find((e) => e.date === "2026-10-05");
  assert.deepEqual(x, { seriesId: "yoga", date: "2026-10-05", title: "Yoga: guest", cancelled: true });
  const reset = resetDate(s, { ...weekly("2026-10-05"), cancelled: true });
  assert.deepEqual(reset.exceptions.find((e) => e.date === "2026-10-05"),
    { seriesId: "yoga", date: "2026-10-05", cancelled: true });
});

test("writing one date keeps only what differs from the weekly program", () => {
  const form = { ...yoga, startTime: "11:00", endTime: null, isNew: false };
  const s = writeDate(base(), weekly("2026-10-12"), form);
  assert.deepEqual(s.exceptions.find((e) => e.date === "2026-10-12"),
    { seriesId: "yoga", date: "2026-10-12", startTime: "11:00", endTime: "" });
  const [o] = expandSeries(s.series, s.exceptions, { horizon: "2026-10-31" }).filter((e) => e.date === "2026-10-12");
  assert.equal(o.startTime, "11:00");
  assert.equal(o.changed, true);
  // Saving the usual details again leaves nothing behind.
  const back = writeDate(s, weekly("2026-10-12"), { ...yoga, isNew: false });
  assert.equal(back.exceptions.some((e) => e.date === "2026-10-12"), false);
});

test("a change from a later date leaves the weeks before it alone", () => {
  const after = changeSeries(base(), "yoga", { startTime: "09:00" }, "2026-10-12");
  assert.equal(after.series[0].until, "2026-10-11");
  const out = expandSeries(after.series, after.exceptions, { horizon: "2026-10-31" });
  assert.equal(out.find((o) => o.date === "2026-10-05").startTime, "10:00");
  assert.equal(out.find((o) => o.date === "2026-10-12").startTime, "09:00");
});

test("one-off events are added, rewritten and deleted by place", () => {
  let s = addEvent(base(), { title: "Picnic", date: "2026-10-10", startTime: "12:00", endTime: null, zoomLink: null, isNew: true });
  assert.deepEqual(s.events[0], { date: "2026-10-10", title: "Picnic", startTime: "12:00", zoomLink: null, isNew: true });
  s = setCancelled(s, once(0), true);
  s = writeDate(s, { ...once(0), cancelled: true }, { title: "Picnic", date: "2026-10-11", startTime: "13:00" });
  assert.equal(s.events[0].date, "2026-10-11");
  assert.equal(s.events[0].cancelled, true, "a cancelled program stays cancelled when edited");
  assert.deepEqual(deleteEvent(s, once(0)).events, []);
});

test("weekdayOfDate reads the day from a date label", () => {
  assert.equal(weekdayOfDate("2026-11-03"), "TU");
  assert.equal(weekdayOfDate("2026-11-08"), "SU");
});
