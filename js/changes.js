/* changes.js — how one copy of the paper differs from another, in plain
   words: "Yoga cancelled on Monday, November 3". The desk lists these beside
   each earlier copy, so a volunteer can see what going back to it would
   undo before they press the button. */

import { normalizeSchedule } from "./data-adapter.js";
import { longDate, groupBy } from "./dates.js";

const sameDetails = (a, b) =>
  a.startTime === b.startTime && a.endTime === b.endTime &&
  a.description === b.description && a.zoomLink === b.zoomLink && a.category === b.category;

/* Pair each date's programs in the two copies: by name first, then whatever
   is left over on the same date (a program renamed for that date). */
function pairUp(before, after) {
  const pairs = [];
  const dates = new Set([...before.keys(), ...after.keys()]);
  for (const date of dates) {
    const a = [...(before.get(date) ?? [])];
    const b = [...(after.get(date) ?? [])];
    for (let i = a.length - 1; i >= 0; i--) {
      const j = b.findIndex((e) => e.title === a[i].title);
      if (j >= 0) { pairs.push([a[i], b[j]]); a.splice(i, 1); b.splice(j, 1); }
    }
    while (a.length && b.length) pairs.push([a.shift(), b.shift()]);
    for (const e of a) pairs.push([e, null]);
    for (const e of b) pairs.push([null, e]);
  }
  return pairs;
}

function kindOf([a, b]) {
  if (!a) return { kind: "added", title: b.title };
  if (!b) return { kind: "removed", title: a.title };
  if (a.title !== b.title) return { kind: "renamed", title: a.title, to: b.title };
  if (a.cancelled !== b.cancelled) return { kind: b.cancelled ? "cancelled" : "back", title: b.title };
  if (!sameDetails(a, b)) return { kind: "changed", title: b.title };
  return null;
}

const VERBS = {
  added: "added", removed: "taken off", cancelled: "cancelled", back: "back on", changed: "changed",
};

function phrase({ kind, title, to }, dates) {
  const first = longDate(dates[0]);
  const many = dates.length > 1;
  if (kind === "renamed") return `${title} is now ${to}, ${many ? `from ${first} on` : `on ${first}`}`;
  const on = kind === "removed" ? "" : kind === "back" ? "for " : "on ";
  return many
    ? `${title} ${VERBS[kind]} on ${dates.length} dates, from ${first}`
    : `${title} ${VERBS[kind]} ${on}${first}`;
}

/* The changes made going from `before` to `after` (two raw schedules), as
   sentences in date order. */
export function describeChanges(before, after) {
  // Programs in the usual Zoom room are compared as if both copies had the
  // same room: a new room link is one line of its own, not one per program.
  const room = after?.defaultZoomLink;
  const byDate = (raw) =>
    groupBy(normalizeSchedule({ ...raw, defaultZoomLink: room }).events, (e) => e.date);
  const found = pairUp(byDate(before), byDate(after))
    .map((pair) => ({ ...kindOf(pair), date: (pair[1] ?? pair[0]).date }))
    .filter((c) => c.kind);

  const groups = groupBy(found, (c) => `${c.kind}|${c.title}|${c.to ?? ""}`);
  const lines = [...groups.values()]
    .map((list) => {
      const dates = list.map((c) => c.date).sort();
      return { date: dates[0], text: phrase(list[0], dates) };
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => l.text);

  const say = (a, b) => String(a ?? "").trim() !== String(b ?? "").trim();
  if (say(before?.editorsNote, after?.editorsNote)) lines.unshift("The note on the front page was rewritten");
  if (say(before?.defaultZoomLink, after?.defaultZoomLink)) lines.unshift("The Zoom link was changed");
  return lines;
}
