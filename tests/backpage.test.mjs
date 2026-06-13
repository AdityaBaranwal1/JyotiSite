import { test } from "node:test";
import assert from "node:assert/strict";
import { glyphFor } from "../js/icons.js";
import { entryFor, dateKey } from "../js/almanac.js";
import { summarizePeriods } from "../js/weather.js";

test("glyphFor: maps NWS shortForecast phrases to ink glyphs", () => {
  assert.equal(glyphFor("Chance Showers And Thunderstorms", true), "storm");
  assert.equal(glyphFor("Light Rain", true), "rain");
  assert.equal(glyphFor("Sunny", true), "sun");
  assert.equal(glyphFor("Clear", false), "moon");
  assert.equal(glyphFor("Partly Cloudy", true), "partly");
  assert.equal(glyphFor("Patchy Fog", true), "fog");
});

test("dateKey: formats a Date as MM-DD", () => {
  assert.equal(dateKey(new Date(2026, 5, 12)), "06-12");
  assert.equal(dateKey(new Date(2024, 1, 29)), "02-29");
});

test("entryFor: returns the entry for today's key, null when absent", () => {
  const data = { "06-12": "Anne Frank received her diary on this day in 1942." };
  assert.equal(entryFor(data, new Date(2026, 5, 12)), data["06-12"]);
  assert.equal(entryFor(data, new Date(2026, 5, 13)), null);
});

test("summarizePeriods: first period is 'now', next rows follow, capped", () => {
  const periods = Array.from({ length: 10 }, (_, i) => ({
    name: `P${i}`, temperature: 70 + i, temperatureUnit: "F",
    shortForecast: "Sunny", isDaytime: i % 2 === 0,
  }));
  const s = summarizePeriods(periods, 5);
  assert.equal(s.now.name, "P0");
  assert.equal(s.next.length, 5);
  assert.equal(s.next[0].name, "P1");
});

test("summarizePeriods: empty input yields null", () => {
  assert.equal(summarizePeriods([], 5), null);
  assert.equal(summarizePeriods(undefined, 5), null);
});
