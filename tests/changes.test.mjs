import { test } from "node:test";
import assert from "node:assert/strict";
import { describeChanges } from "../js/changes.js";
import { setCancelled, changeSeries, addEvent } from "../js/schedule-edit.js";

const paper = () => ({
  editorsNote: "Hello",
  defaultZoomLink: "https://zoom.us/j/1",
  series: [{
    id: "yoga", title: "Yoga", startTime: "10:00", endTime: "11:00", zoomLink: "default",
    rrule: "FREQ=WEEKLY;BYDAY=MO", from: "2026-09-07",
  }],
  exceptions: [],
  events: [],
});
const say = describeChanges;
const today = "2026-11-01";

test("the same paper has nothing to say", () => {
  assert.deepEqual(say(paper(), paper()), []);
});

test("one cancelled date, in words", () => {
  const after = setCancelled(paper(), { kind: "series", seriesId: "yoga", date: "2026-11-02" }, true);
  assert.deepEqual(say(paper(), after), ["Yoga cancelled on Monday, November 2"]);
  assert.deepEqual(say(after, paper()), ["Yoga back on for Monday, November 2"]);
});

test("a change to every week is one line, not one per week", () => {
  const after = changeSeries(paper(), "yoga", { startTime: "09:00" }, "2026-11-09");
  const [line, ...rest] = say(paper(), after);
  assert.match(line, /^Yoga changed on \d+ dates, from Monday, November 9$/);
  assert.deepEqual(rest, []);
});

test("a rename, added programs, the note and the link", () => {
  let after = changeSeries(paper(), "yoga", { title: "Tai Chi" }, today);
  after = addEvent(after, { title: "Picnic", date: "2026-11-05", startTime: "12:00" });
  after = addEvent(after, { title: "Old fair", date: "2026-10-01", startTime: "12:00" });
  after = { ...after, editorsNote: "Changed", defaultZoomLink: "https://zoom.us/j/2" };
  const lines = say(paper(), after);
  assert.equal(lines[0], "The Zoom link was changed");
  assert.equal(lines[1], "The note on the front page was rewritten");
  assert.equal(lines[2], "Old fair added on Thursday, October 1");
  assert.match(lines[3], /^Yoga is now Tai Chi, from Monday, November 2 on$/);
  assert.equal(lines[4], "Picnic added on Thursday, November 5");
  assert.equal(lines.length, 5);
});
