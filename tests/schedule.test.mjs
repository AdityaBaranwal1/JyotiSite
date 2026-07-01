import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatTime, timeRange, dayLabel, groupByDay, isToday,
  weekLabelFor, updatedLabelFor, filterWeek, filterMonth, monthBounds,
} from "../js/schedule.js";

test("formatTime: converts 24h to senior-friendly 12h", () => {
  assert.equal(formatTime("15:00"), "3:00 PM");
  assert.equal(formatTime("10:30"), "10:30 AM");
  assert.equal(formatTime("12:00"), "12:00 PM");
  assert.equal(formatTime("00:30"), "12:30 AM");
});

test("dayLabel: renders a newspaper day kicker", () => {
  assert.equal(dayLabel("2026-06-08"), "Monday · June 8");
  assert.equal(dayLabel("2026-06-14"), "Sunday · June 14");
});

test("groupByDay: groups by date ascending, events sorted by start time", () => {
  const events = [
    { title: "B", date: "2026-06-09", startTime: "15:00" },
    { title: "A", date: "2026-06-08", startTime: "10:00" },
    { title: "C", date: "2026-06-09", startTime: "09:00" },
  ];
  const groups = groupByDay(events);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].date, "2026-06-08");
  assert.deepEqual(groups[1].events.map((e) => e.title), ["C", "B"]);
});

test("timeRange: dash-free, meridiem stated once when shared", () => {
  assert.equal(timeRange("10:00", "11:00"), "10:00 to 11:00 AM");
  assert.equal(timeRange("11:00", "13:00"), "11:00 AM to 1:00 PM");
  assert.equal(timeRange("15:00", "16:30"), "3:00 to 4:30 PM");
  assert.equal(timeRange("10:00", null), "10:00 AM");
});

test("weekLabelFor: Monday-to-Sunday label, dash-free, handles month crossings", () => {
  assert.equal(weekLabelFor(new Date(2026, 5, 13)), "Week of June 8 to June 14, 2026");
  assert.equal(weekLabelFor(new Date(2026, 5, 8)),  "Week of June 8 to June 14, 2026");
  assert.equal(weekLabelFor(new Date(2026, 5, 14)), "Week of June 8 to June 14, 2026"); // Sunday belongs to the week that began Monday
  assert.equal(weekLabelFor(new Date(2026, 6, 1)),  "Week of June 29 to July 5, 2026");
});

test("updatedLabelFor: renders a friendly Updated line from savedAt", () => {
  assert.equal(updatedLabelFor("2026-06-13T09:00:00"), "Updated Saturday, June 13");
  assert.equal(updatedLabelFor(""), null);
  assert.equal(updatedLabelFor("garbage"), null);
});

test("filterWeek: keeps only events in the Monday-Sunday week of 'now'", () => {
  const events = [
    { title: "in", date: "2026-06-08", startTime: "10:00" },
    { title: "in2", date: "2026-06-14", startTime: "10:00" },
    { title: "before", date: "2026-06-07", startTime: "10:00" },
    { title: "after", date: "2026-06-15", startTime: "10:00" },
  ];
  const kept = filterWeek(events, new Date(2026, 5, 13));
  assert.deepEqual(kept.map((e) => e.title), ["in", "in2"]);
});

test("filterMonth: keeps only events inside the given year-month", () => {
  const events = [
    { title: "jun", date: "2026-06-30", startTime: "10:00" },
    { title: "jul", date: "2026-07-01", startTime: "10:00" },
  ];
  assert.deepEqual(filterMonth(events, 2026, 6).map((e) => e.title), ["jun"]);
  assert.deepEqual(filterMonth(events, 2026, 7).map((e) => e.title), ["jul"]);
});

test("monthBounds: first and last months that actually have data", () => {
  const events = [
    { date: "2026-05-02" }, { date: "2026-07-08" }, { date: "2026-06-10" },
  ];
  const b = monthBounds(events);
  assert.deepEqual(b, { min: "2026-05", max: "2026-07" });
  assert.equal(monthBounds([]), null);
});

test("isToday: compares against a provided 'now' in local time", () => {
  const now = new Date(2026, 5, 12, 9, 0); // June 12 2026
  assert.equal(isToday("2026-06-12", now), true);
  assert.equal(isToday("2026-06-11", now), false);
});
