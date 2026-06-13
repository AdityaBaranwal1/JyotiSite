import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTime, dayLabel, groupByDay, isToday } from "../js/schedule.js";

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

test("isToday: compares against a provided 'now' in local time", () => {
  const now = new Date(2026, 5, 12, 9, 0); // June 12 2026
  assert.equal(isToday("2026-06-12", now), true);
  assert.equal(isToday("2026-06-11", now), false);
});
