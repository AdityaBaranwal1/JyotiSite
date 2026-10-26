import { test } from "node:test";
import assert from "node:assert/strict";
import { expandSeries, defaultHorizon, activeSeries } from "../js/data-adapter.js";
import { addSeries, changeSeries, stopSeries, handChangesFrom, weekdayOf } from "../js/series-edit.js";

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
