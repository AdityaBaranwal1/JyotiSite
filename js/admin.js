/* admin.js — the Editor's Desk. Volunteers sign in with the shared password
   and change the paper directly: every change is saved the moment it is
   made, and an Undo button takes back the last one. There is no separate
   "publish" step to forget.

   The desk is written for volunteers who are seniors themselves: one button
   per job, plain words, and nothing that cannot be taken back. */

import { dayLabel, timeRange, weekLabelFor, monthTitle, isToday, formatTime } from "./schedule.js";
import { expandSeries, describeSeries, activeSeries } from "./data-adapter.js";
import {
  WEEKDAYS, weekdayOf, addSeries, changeSeries, stopSeries, handChangesFrom,
} from "./series-edit.js";

const $ = (sel) => document.querySelector(sel);

/* ---------- state ---------- */
let schedule = { defaultZoomLink: "", editorsNote: "", series: [], exceptions: [], events: [] }; // RAW: keeps "default" markers
let view = "week";               // "week" | "month"
let anchor = new Date();         // the date the current view centres on
let editing = null;              // what the editor dialog is working on (see openEditor)

const isoOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayIso = () => isoOf(new Date());
const mondayOf = (d) => {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
};
const dateOf = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const dayName = (code) => WEEKDAYS.find(([c]) => c === code)?.[1] ?? "";

/* ---------- occurrences ----------
   The week a volunteer sees is not the events array: it is the weekly
   programs expanded, their per-date changes applied, and the one-off events
   laid on top. Every row remembers where it came from, because that decides
   what changing it should write — an event, or a change for one date. */
let occurrences = new Map();

const seriesById = (id) => (schedule.series ?? []).find((s) => s.id === id) ?? null;
const exceptionIndexOf = (seriesId, date) =>
  (schedule.exceptions ?? []).findIndex((x) => x.seriesId === seriesId && x.date === date);

function rebuildOccurrences() {
  occurrences = new Map();
  const push = (o) => {
    if (!occurrences.has(o.date)) occurrences.set(o.date, []);
    occurrences.get(o.date).push(o);
  };
  for (const o of expandSeries(schedule.series ?? [], schedule.exceptions ?? [], { includeSkipped: true })) {
    push({ ...o, kind: "series" });
  }
  (schedule.events ?? []).forEach((e, i) => push({ ...e, kind: "once", eventIndex: i }));
  for (const list of occurrences.values()) {
    list.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
  }
}

const occurrencesOn = (iso) => occurrences.get(iso) ?? [];

/* ---------- saving: every change, straight away ----------
   `change` edits the schedule in place, or returns a new one. The paper as it
   was is held for Undo. Saves go one at a time, in order; if one fails, the
   desk goes back to the paper as it was and says so plainly. */
let undoTo = null;
let saving = Promise.resolve();
let pending = 0;

const payload = (s) => ({
  defaultZoomLink: s.defaultZoomLink || null,
  editorsNote: s.editorsNote || "",
  series: s.series ?? [],
  exceptions: s.exceptions ?? [],
  events: s.events ?? [],
});

function status(text, { undo = false } = {}) {
  $("#save-status").textContent = text;
  $("#undo").hidden = !undo;
}

function commit(message, change, { undoable = true } = {}) {
  const before = structuredClone(schedule);
  const result = change();
  if (result) schedule = result;
  draw();
  status("Saving…");
  pending++;
  saving = saving.then(async () => {
    const res = await fetch("/api/schedule", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload(schedule)),
    }).catch(() => null);
    pending--;
    if (res && res.ok) {
      undoTo = undoable ? before : null;
      status(`${message} Readers see it now.`, { undo: undoable });
      drawEditions();
      return true;
    }
    schedule = before;
    draw();
    fillSettings();
    if (res && res.status === 401) {
      showLogin("You were signed out, so that last change was not saved. Please sign in again.");
      return false;
    }
    const body = res ? await res.json().catch(() => ({})) : {};
    status(body.error
      ? `${body.error} Nothing was changed.`
      : "That change did not go through, so nothing was changed. Please check the internet connection and try again.");
    return false;
  });
  return saving;
}

$("#undo").addEventListener("click", () => {
  const to = undoTo;
  if (!to) return;
  undoTo = null;
  commit("Your last change is undone.", () => to, { undoable: false })
    .then(() => fillSettings());
});

window.addEventListener("beforeunload", (e) => {
  if (pending > 0 || noteChanged() || zoomChanged()) e.preventDefault();
});

/* ---------- sign in / out ---------- */
function showLogin(message = "") {
  $("#desk-view").hidden = true;
  $("#signout").hidden = true;
  $("#login-view").hidden = false;
  $("#login-msg").textContent = message;
}

async function boot() {
  const me = await fetch("/api/me").then((r) => r.json()).catch(() => ({ signedIn: false }));
  if (me.signedIn) return openDesk();
  showLogin();
}

$("#login-show").addEventListener("change", (e) => {
  $("#login-pass").type = e.target.checked ? "text" : "password";
});

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-msg").textContent = "";
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: $("#login-pass").value }),
  }).catch(() => null);
  if (!res || !res.ok) {
    const body = res ? await res.json().catch(() => ({})) : {};
    $("#login-msg").textContent = body.error || "Signing in didn't work. Please try again.";
    return;
  }
  $("#login-view").hidden = true;
  openDesk();
});

$("#signout").addEventListener("click", async () => {
  if ((noteChanged() || zoomChanged()) &&
      !confirm("The note or the Zoom link has changes you have not saved. Sign out anyway?")) return;
  await fetch("/api/logout", { method: "POST" });
  location.reload();
});

async function openDesk() {
  const res = await fetch("/api/schedule/raw");
  if (!res.ok) { showLogin(); return; }
  schedule = await res.json();
  schedule.series ??= [];
  schedule.exceptions ??= [];
  schedule.events ??= [];
  undoTo = null;
  $("#desk-view").hidden = false;
  $("#signout").hidden = false;
  fillSettings();
  status("Changes go on the paper straight away.");
  draw();
  drawEditions();
}

/* ---------- view plumbing ---------- */
function draw() {
  rebuildOccurrences();
  drawWeekly();
  const week = view === "week";
  $("#view-week").setAttribute("aria-pressed", String(week));
  $("#view-month").setAttribute("aria-pressed", String(!week));
  $("#week-panel").hidden = !week;
  $("#month-panel").hidden = week;
  $("#range-prev").textContent = week ? "‹ Week before" : "‹ Month before";
  $("#range-today").textContent = week ? "This week" : "This month";
  $("#range-next").textContent = week ? "Week after ›" : "Month after ›";
  if (week) {
    $("#desk-title").textContent = weekLabelFor(anchor);
    drawWeek();
  } else {
    $("#desk-title").textContent = monthTitle(anchor.getFullYear(), anchor.getMonth() + 1);
    drawMonth();
  }
  // The day dialog's rows can be cancelled in place; keep it current.
  if (dayDialog.open) drawDayList();
}

$("#view-week").addEventListener("click", () => { view = "week"; draw(); });
$("#view-month").addEventListener("click", () => { view = "month"; draw(); });
$("#range-prev").addEventListener("click", () => { step(-1); });
$("#range-next").addEventListener("click", () => { step(1); });
$("#range-today").addEventListener("click", () => { anchor = new Date(); draw(); });
function step(dir) {
  if (view === "week") anchor.setDate(anchor.getDate() + 7 * dir);
  else anchor = new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  draw();
}

function joinLabel(e) {
  if (e.zoomLink === "default") return "Usual Zoom room";
  if (/^https?:\/\//.test(e.zoomLink || "")) return "Special Zoom link";
  return "Call to register";
}

/* ---------- week view ---------- */
function drawWeek() {
  const panel = $("#week-panel");
  panel.textContent = "";
  const monday = mondayOf(anchor);
  for (let d = 0; d < 7; d++) {
    const day = new Date(monday);
    day.setDate(day.getDate() + d);
    const iso = isoOf(day);

    const sec = document.createElement("section");
    sec.className = "desk-day";
    const head = document.createElement("div");
    head.className = "desk-day-head";
    const name = document.createElement("span");
    name.className = "day-name";
    name.textContent = dayLabel(iso) + (isToday(iso) ? "  ·  TODAY" : "");
    head.appendChild(name);
    sec.appendChild(head);

    const todays = occurrencesOn(iso);
    if (todays.length === 0) {
      const none = document.createElement("p");
      none.className = "desk-empty";
      none.textContent = "Nothing on this day.";
      sec.appendChild(none);
    }
    for (const e of todays) sec.appendChild(eventRow(e));

    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn btn--quiet desk-add";
    add.textContent = `+ Add a program on ${dayLabel(iso)}`;
    add.addEventListener("click", () => openEditor({ mode: "date", presetDate: iso }));
    sec.appendChild(add);

    panel.appendChild(sec);
  }
}

/* One row of the desk: the program, what has happened to it, and two
   buttons — change it, or cancel it for this date. Cancelling keeps it on
   the paper with a CANCELLED stamp, so nobody turns up to an empty room. */
function eventRow(o, { onEdit } = {}) {
  const row = document.createElement("div");
  row.className = "desk-event"
    + (o.cancelled ? " is-cancelled" : "")
    + (o.skipped ? " is-skipped" : "");

  const what = document.createElement("span");
  what.className = "de-what";
  const strong = document.createElement("strong");
  strong.textContent = o.title;
  what.appendChild(strong);
  what.appendChild(document.createTextNode(` · ${timeRange(o.startTime, o.endTime)} · ${joinLabel(o)}`));

  if (o.kind === "series") {
    const s = seriesById(o.seriesId);
    const origin = document.createElement("span");
    origin.className = "de-origin";
    origin.textContent = s ? describeSeries(s) : "Every week";
    what.appendChild(origin);
  }
  row.appendChild(what);

  const state = stateOf(o);
  if (state) {
    const badge = document.createElement("span");
    badge.className = `de-state de-state--${state.key}`;
    badge.textContent = state.label;
    row.appendChild(badge);
  }

  const actions = document.createElement("span");
  actions.className = "de-actions";
  const on = dayLabel(o.date);

  if (o.skipped) {
    // Older papers could take a date off entirely; it can still be put back.
    actions.appendChild(button("Put it back", "de-restore", () =>
      commit(`${o.title} is back on ${on}.`, () => removeException(o.seriesId, o.date)),
      `Put ${o.title} back on ${on}`));
  } else {
    actions.appendChild(button("Change ✎", "de-edit",
      () => (onEdit ? onEdit(o) : openEditor({ mode: "date", occurrence: o })),
      `Change ${o.title} on ${on}`));
    const off = o.cancelled;
    actions.appendChild(button(off ? "Put it back on" : "Cancel this date", "de-cancel", () =>
      commit(off ? `${o.title} is back on for ${on}.` : `${o.title} is cancelled for ${on}.`,
        () => setCancelled(o, !off)),
      off ? `Put ${o.title} back on, ${on}` : `Cancel ${o.title} on ${on}`));
  }
  row.appendChild(actions);
  return row;
}

function button(label, cls, onClick, ariaLabel) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `btn btn--quiet ${cls}`;
  b.textContent = label;
  if (ariaLabel) b.setAttribute("aria-label", ariaLabel);
  b.addEventListener("click", onClick);
  return b;
}

/* Plain words for what has happened to this date, or null when it is simply
   the usual program at the usual hour. */
function stateOf(o) {
  if (o.skipped) return { key: "off", label: "Off this week" };
  if (o.cancelled) return { key: "cancelled", label: "Cancelled" };
  if (o.kind === "once") return { key: "once", label: "Just this once" };
  if (o.hasException) return { key: "changed", label: "Changed this week" };
  return null;
}

function setCancelled(o, cancelled) {
  if (o.kind === "series") {
    patchException(o, { cancelled: cancelled ? true : undefined });
  } else {
    const e = { ...schedule.events[o.eventIndex] };
    if (cancelled) e.cancelled = true; else delete e.cancelled;
    schedule.events[o.eventIndex] = e;
  }
}

/* ---------- changes for one date ----------
   A change for one date records only what differs from the weekly program,
   so a later change to the program still flows through everything it does
   not contradict. When nothing differs any more, the record is deleted
   rather than left behind empty. */
function writeException(ex) {
  schedule.exceptions ??= [];
  const i = exceptionIndexOf(ex.seriesId, ex.date);
  const bare = Object.keys(ex).length <= 2;   // seriesId + date only
  if (bare) { if (i >= 0) schedule.exceptions.splice(i, 1); return; }
  if (i >= 0) schedule.exceptions[i] = ex; else schedule.exceptions.push(ex);
}

function removeException(seriesId, date) {
  const i = exceptionIndexOf(seriesId, date);
  if (i >= 0) schedule.exceptions.splice(i, 1);
}

/* Merge a change into whatever this date already carries. */
function patchException(o, changes) {
  const i = exceptionIndexOf(o.seriesId, o.date);
  const current = i >= 0 ? { ...schedule.exceptions[i] } : { seriesId: o.seriesId, date: o.date };
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) delete current[k]; else current[k] = v;
  }
  writeException(current);
}

/* ---------- month view ---------- */
function drawMonth() {
  const panel = $("#month-panel");
  panel.textContent = "";
  const y = anchor.getFullYear(), m = anchor.getMonth();
  const grid = document.createElement("div");
  grid.className = "cal-grid";
  for (const dow of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    const h = document.createElement("div");
    h.className = "cal-dow";
    h.textContent = dow;
    grid.appendChild(h);
  }
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-start offset
  for (let i = 0; i < lead; i++) {
    const pad = document.createElement("button");
    pad.type = "button"; pad.className = "cal-cell"; pad.disabled = true;
    grid.appendChild(pad);
  }
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = isoOf(new Date(y, m, d));
    const todays = occurrencesOn(iso);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-cell"
      + (isToday(iso) ? " is-today" : "")
      + (todays.length ? " has-events" : "");
    cell.setAttribute("aria-label",
      `${dayLabel(iso)}: ${todays.length} program${todays.length === 1 ? "" : "s"}. Press to change this day.`);
    const num = document.createElement("span");
    num.className = "cal-date"; num.textContent = d;
    cell.appendChild(num);
    todays.slice(0, 2).forEach((e) => {
      const t = document.createElement("span");
      t.className = "cal-ev" + (e.cancelled ? " is-cancelled" : "");
      t.textContent = e.title;
      cell.appendChild(t);
    });
    if (todays.length > 2) {
      const more = document.createElement("span");
      more.className = "cal-more"; more.textContent = `+${todays.length - 2} more`;
      cell.appendChild(more);
    }
    if (todays.length) {
      const dots = document.createElement("span");
      dots.className = "cal-dots"; dots.textContent = "●".repeat(Math.min(todays.length, 4));
      cell.appendChild(dots);
    }
    cell.addEventListener("click", () => openDayEditor(iso));
    grid.appendChild(cell);
  }
  panel.appendChild(grid);
  const hint = document.createElement("p");
  hint.className = "byline";
  hint.textContent = "Press any date to see and change that day's programs.";
  panel.appendChild(hint);
}

/* ---------- one day: press a date in the month view ---------- */
const dayDialog = $("#day-dialog");
let dayDialogIso = null;

function openDayEditor(iso) {
  dayDialogIso = iso;
  $("#day-dialog-title").textContent = dayLabel(iso);
  drawDayList();
  dayDialog.showModal();
}

function drawDayList() {
  const list = $("#day-dialog-list");
  list.textContent = "";
  const todays = occurrencesOn(dayDialogIso);
  if (todays.length === 0) {
    const none = document.createElement("p");
    none.className = "desk-empty";
    none.textContent = "Nothing on this day yet.";
    list.appendChild(none);
  }
  for (const e of todays) {
    list.appendChild(eventRow(e, {
      onEdit: (occ) => { dayDialog.close(); openEditor({ mode: "date", occurrence: occ }); },
    }));
  }
}

$("#day-add").addEventListener("click", () => {
  const iso = dayDialogIso;
  dayDialog.close();
  openEditor({ mode: "date", presetDate: iso });
});
$("#day-close").addEventListener("click", () => dayDialog.close());

/* ---------- weekly programs ---------- */
function drawWeekly() {
  const host = $("#weekly-list");
  host.textContent = "";
  const today = todayIso();
  const order = (s) => {
    const i = WEEKDAYS.findIndex(([c]) => c === weekdayOf(s.rrule));
    return `${i < 0 ? 9 : i}${s.startTime}`;
  };
  const list = activeSeries(schedule.series, today).sort((a, b) => order(a).localeCompare(order(b)));
  if (list.length === 0) {
    const none = document.createElement("p");
    none.className = "desk-empty";
    none.textContent = "No weekly programs yet. Add one below, and it will go on the paper every week.";
    host.appendChild(none);
    return;
  }
  for (const s of list) {
    const row = document.createElement("div");
    row.className = "standing-def";
    const when = document.createElement("span");
    when.className = "sd-when";
    when.textContent = describeSeries(s);
    const what = document.createElement("span");
    what.className = "sd-what";
    const strong = document.createElement("strong");
    strong.textContent = s.title;
    what.append(strong, ` · ${timeRange(s.startTime, s.endTime)}`);
    if (s.from > today) {
      const first = [...occurrences.keys()].sort()
        .find((iso) => occurrencesOn(iso).some((o) => o.seriesId === s.id));
      if (first) what.append(` · starts ${dayLabel(first)}`);
    }
    const change = button("Change ✎", "sd-change",
      () => openEditor({ mode: "weekly", series: s }), `Change ${s.title}, ${describeSeries(s)}`);
    row.append(when, what, change);
    host.appendChild(row);
  }
}

$("#weekly-add").addEventListener("click", () => openEditor({ mode: "weekly" }));

/* ---------- the program editor ----------
   One dialog, two jobs:
     mode "date"   — one program on one date: a one-off, or a weekly program
                     changed for that date only.
     mode "weekly" — a weekly program itself, from today on. */
const dialog = $("#event-dialog");

const CATEGORIES = ["yoga", "art", "music", "computer", "finance",
                   "health", "stock market", "talk", "social"];

/* A plain list of times every quarter hour, 6 AM to 10 PM, instead of the
   browser's spinner (fiddly with a mouse, and different in every browser).
   An unusual time already on the paper is kept as an extra choice. */
function fillTimes(select, value, { none = false } = {}) {
  select.textContent = "";
  const add = (v, label) => select.appendChild(new Option(label, v));
  if (none) add("", "No end time");
  const times = [];
  for (let m = 6 * 60; m <= 22 * 60; m += 15) {
    times.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  const v = /^\d:\d\d$/.test(value || "") ? `0${value}` : value;
  if (v && !times.includes(v)) { times.push(v); times.sort(); }
  for (const t of times) add(t, formatTime(t));
  select.value = v || "";
}

function fillDays(select, value) {
  select.textContent = "";
  for (const [code, name] of WEEKDAYS) select.appendChild(new Option(`Every ${name}`, code));
  select.value = value || "MO";
}

function openEditor({ mode, occurrence = null, presetDate = null, series = null }) {
  editing = { mode, occurrence, series };
  const weekly = mode === "weekly";
  const o = weekly
    ? (series ?? { title: "", startTime: "10:00", endTime: "", category: "", description: "", zoomLink: "default" })
    : (occurrence ?? {
        kind: "once", title: "", date: presetDate || todayIso(),
        startTime: "10:00", endTime: "", category: "", description: "",
        zoomLink: "default", isNew: false,
      });
  const isSeriesDate = !weekly && o.kind === "series";
  const s = isSeriesDate ? seriesById(o.seriesId) : null;

  $("#event-dialog-title").textContent = weekly
    ? (series ? "Change a weekly program" : "Add a weekly program")
    : (occurrence ? `Change ${dayLabel(o.date)}` : "Add a program for one date");

  // Say plainly which job this is, and offer the other one in case the
  // volunteer came in by the wrong door.
  const banner = $("#ev-banner");
  const sw = $("#ev-switch");
  banner.hidden = false;
  sw.hidden = true;
  if (weekly) {
    $("#ev-banner-text").textContent = series
      ? "This changes the program every week, starting today. Weeks already past stay as they were."
      : "A weekly program goes on the paper every week, starting today, until you stop it.";
  } else if (isSeriesDate) {
    $("#ev-banner-text").textContent =
      `This changes ${dayLabel(o.date)} only. The other weeks stay as they are.`;
    if (s && activeSeries([s], todayIso()).length) {
      sw.textContent = "Change every week instead";
      sw.hidden = false;
      sw.onclick = () => { dialog.close(); openEditor({ mode: "weekly", series: s }); };
    }
  } else if (!occurrence) {
    $("#ev-banner-text").textContent = "This adds a program on one date only.";
    sw.textContent = "It happens every week: add a weekly program instead";
    sw.hidden = false;
    sw.onclick = () => { dialog.close(); openEditor({ mode: "weekly" }); };
  } else {
    banner.hidden = true;
  }

  // A date for a new or one-off program; none for a weekly program's date
  // (the title already names it, and it cannot move); a weekday for a weekly
  // program (in words only, if its rhythm is richer than one day).
  $("#f-date").hidden = weekly || isSeriesDate;
  $("#f-day").hidden = !weekly;
  $("#ev-date").value = weekly ? "" : (o.date || "");
  const day = weekly ? (series ? weekdayOf(series.rrule) : "MO") : null;
  $("#ev-day").hidden = weekly && series && !day;
  $("#ev-day-text").hidden = !(weekly && series && !day);
  if (weekly) {
    fillDays($("#ev-day"), day);
    $("#ev-day-text").textContent = series ? describeSeries(series) : "";
  }

  $("#ev-title").value = o.title || "";
  fillTimes($("#ev-start"), o.startTime || "10:00");
  fillTimes($("#ev-end"), o.endTime || "", { none: true });
  // Match the stored category exactly where we can; only fall back to
  // "Something else" when it genuinely is something else.
  const cat = String(o.category || "");
  $("#ev-category").value = CATEGORIES.includes(cat) ? cat
    : (CATEGORIES.find((c) => cat.includes(c)) ?? "");
  $("#ev-desc").value = o.description || "";

  const mode0 = o.zoomLink === "default" ? "default"
    : /^https?:\/\//.test(o.zoomLink || "") ? "custom" : "phone";
  document.querySelector(`input[name="ev-zoom"][value="${mode0}"]`).checked = true;
  $("#ev-zoom-url").value = mode0 === "custom" ? o.zoomLink : "";
  $("#f-new").hidden = weekly;
  $("#ev-more-hint").textContent = weekly
    ? "(the description, kind of program, how people join)"
    : "(the description, how people join, the NEW stamp)";
  $("#ev-new").checked = Boolean(o.isNew);
  $("#ev-more").open = false;

  $("#ev-reset").hidden = !(isSeriesDate && o.hasException);
  $("#ev-delete").hidden = !(occurrence && o.kind === "once");
  $("#ev-stop").hidden = !(weekly && series);
  $("#event-msg").textContent = "";
  dialog.showModal();
}

function readForm() {
  const weekly = editing.mode === "weekly";
  const title = $("#ev-title").value.trim();
  const date = $("#ev-date").value;
  const startTime = $("#ev-start").value;
  if (!title) return { error: "Please give the program a name." };
  if (!weekly && !date) return { error: "Please choose a date." };
  const endTime = $("#ev-end").value || null;
  if (endTime && endTime <= startTime) {
    return { error: "The end time should be after the start time." };
  }
  const mode = document.querySelector('input[name="ev-zoom"]:checked').value;
  let zoomLink = null;
  if (mode === "default") zoomLink = "default";
  if (mode === "custom") {
    zoomLink = $("#ev-zoom-url").value.trim();
    if (!/^https?:\/\//.test(zoomLink)) {
      $("#ev-more").open = true;
      return { error: "The special Zoom link should start with https://" };
    }
  }
  return {
    title, date, startTime, endTime,
    weekday: weekly && !$("#ev-day").hidden ? $("#ev-day").value : null,
    category: $("#ev-category").value,
    description: $("#ev-desc").value.trim(),
    zoomLink,
    isNew: $("#ev-new").checked,
  };
}

/* Only what actually differs from the weekly program gets recorded; a date
   that was cancelled stays cancelled. */
function exceptionFromForm(o, form) {
  const s = seriesById(o.seriesId);
  const ex = { seriesId: o.seriesId, date: o.date };
  if (!s) return ex;
  const same = (a, b) => (a ?? "") === (b ?? "");
  if (!same(form.title, s.title)) ex.title = form.title;
  if (!same(form.description, s.description)) ex.description = form.description;
  if (!same(form.category, s.category)) ex.category = form.category;
  if (!same(form.startTime, s.startTime)) ex.startTime = form.startTime;
  if (!same(form.endTime, s.endTime)) ex.endTime = form.endTime;
  if (!same(form.zoomLink, s.zoomLink)) ex.zoomLink = form.zoomLink;
  if (form.isNew) ex.isNew = true;
  if (o.cancelled) ex.cancelled = true;
  return ex;
}

/* Enter in any box saves, as the volunteer expects, rather than closing the
   dialog and losing what they typed. */
$("#event-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = readForm();
  if (form.error) { $("#event-msg").textContent = form.error; return; }
  if (editing.mode === "weekly") saveWeekly(form); else saveDate(form);
});

function saveDate(form) {
  const o = editing.occurrence;
  if (o?.kind === "series") {
    dialog.close();
    commit(`${form.title} on ${dayLabel(o.date)} is changed.`,
      () => writeException(exceptionFromForm(o, form)));
    return;
  }
  const event = {
    title: form.title, date: form.date, startTime: form.startTime,
    endTime: form.endTime || undefined,
    category: form.category,
    description: form.description,
    zoomLink: form.zoomLink,
    isNew: form.isNew || undefined,
    cancelled: o?.cancelled || undefined,
  };
  dialog.close();
  anchor = dateOf(form.date);
  commit(o ? `${form.title} is changed.` : `${form.title} is added for ${dayLabel(form.date)}.`, () => {
    if (o) schedule.events[o.eventIndex] = event;
    else schedule.events.push(event);
  });
}

function saveWeekly(form) {
  const today = todayIso();
  const s = editing.series;
  const fields = {
    title: form.title, startTime: form.startTime, endTime: form.endTime || "",
    category: form.category, description: form.description, zoomLink: form.zoomLink,
    weekday: form.weekday,
  };
  if (!s) {
    dialog.close();
    commit(`${form.title} is added, every ${dayName(form.weekday)} from today.`,
      () => addSeries(schedule, fields, today));
    return;
  }
  const moved = form.weekday && form.weekday !== weekdayOf(s.rrule);
  const handMade = moved ? handChangesFrom(schedule, s.id, today) : 0;
  if (handMade && !confirm(
    `Moving ${s.title} to ${dayName(form.weekday)}s will undo ${handMade === 1 ? "the 1 date" : `the ${handMade} dates`} ` +
    "you changed by hand from today on, such as a cancelled week. Move it anyway?")) return;
  dialog.close();
  commit(moved
    ? `${form.title} is now every ${dayName(form.weekday)}, from today.`
    : `${form.title} is changed from today on.`,
  () => changeSeries(schedule, s.id, fields, today));
}

$("#ev-delete").addEventListener("click", () => {
  const o = editing?.occurrence;
  if (!o || o.kind !== "once") return;
  if (!confirm(`Delete ${o.title} on ${dayLabel(o.date)}? (To keep it on the paper marked CANCELLED, choose Never mind and then Cancel this date.)`)) return;
  dialog.close();
  commit(`${o.title} is deleted.`, () => { schedule.events.splice(o.eventIndex, 1); });
});

$("#ev-stop").addEventListener("click", () => {
  const s = editing?.series;
  if (!s) return;
  if (!confirm(`Stop ${s.title}? It will not be on the paper from today on. Weeks already past stay as they were.`)) return;
  dialog.close();
  commit(`${s.title} is stopped.`, () => stopSeries(schedule, s.id, todayIso()));
});

$("#ev-reset").addEventListener("click", () => {
  const o = editing?.occurrence;
  if (o?.kind !== "series") return;
  dialog.close();
  commit(`${o.title} on ${dayLabel(o.date)} is back to the usual.`, () => {
    // Back to the usual details, but a cancelled date stays cancelled.
    removeException(o.seriesId, o.date);
    if (o.cancelled) patchException(o, { cancelled: true });
  });
});

$("#ev-cancel").addEventListener("click", () => dialog.close());

/* ---------- the note and the Zoom link ----------
   These are typed, not clicked, so they save on their button rather than on
   every keystroke. */
const noteChanged = () => $("#editors-note").value !== (schedule.editorsNote || "");
const zoomChanged = () => $("#default-zoom").value.trim() !== (schedule.defaultZoomLink || "");

function fillSettings() {
  $("#editors-note").value = schedule.editorsNote || "";
  $("#default-zoom").value = schedule.defaultZoomLink || "";
  $("#note-state").textContent = "";
  $("#zoom-state").textContent = "";
}

$("#editors-note").addEventListener("input", () => {
  $("#note-state").textContent = noteChanged() ? "Not saved yet." : "";
});
$("#default-zoom").addEventListener("input", () => {
  $("#zoom-state").textContent = zoomChanged() ? "Not saved yet." : "";
});

$("#note-save").addEventListener("click", async () => {
  const text = $("#editors-note").value.trim();
  const ok = await commit("The front-page note is saved.", () => { schedule.editorsNote = text; });
  if (ok) $("#note-state").textContent = "Saved.";
});
$("#zoom-save").addEventListener("click", async () => {
  const link = $("#default-zoom").value.trim();
  if (link && !/^https?:\/\//.test(link)) {
    $("#zoom-state").textContent = "The link should start with https://";
    return;
  }
  const ok = await commit("The Zoom link is saved.", () => { schedule.defaultZoomLink = link; });
  if (ok) $("#zoom-state").textContent = "Saved.";
});

/* ---------- the paper as readers see it ---------- */
const previewDialog = $("#preview-dialog");
let previewPage = "index.html";

function loadPreview() {
  $("#preview-front").setAttribute("aria-pressed", String(previewPage === "index.html"));
  $("#preview-month").setAttribute("aria-pressed", String(previewPage === "month.html"));
  $("#preview-frame").src = `/${previewPage}?t=${Date.now()}`;
}

$("#preview").addEventListener("click", async () => {
  await saving;                       // show the paper with the latest change on it
  loadPreview();
  previewDialog.showModal();
});
$("#preview-front").addEventListener("click", () => { previewPage = "index.html"; loadPreview(); });
$("#preview-month").addEventListener("click", () => { previewPage = "month.html"; loadPreview(); });
$("#preview-close").addEventListener("click", () => {
  previewDialog.close();
  $("#preview-frame").src = "about:blank";
});

/* ---------- earlier versions ---------- */
function editionLabel(savedAt) {
  if (!savedAt) return "An earlier version";
  const d = new Date(savedAt);
  if (Number.isNaN(d.getTime())) return "An earlier version";
  return d.toLocaleString(undefined, {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/* Opening the desk and finishing a save can both ask for the list at once.
   Each draw builds its rows off-page and swaps them in whole, and a draw
   that a newer one has overtaken is dropped, so the list can never be
   printed twice. */
let editionsDraw = 0;
async function drawEditions() {
  const host = $("#editions-list");
  if (!host) return;
  const ticket = ++editionsDraw;
  const res = await fetch("/api/versions").catch(() => null);
  const data = res && res.ok ? await res.json().catch(() => null) : null;
  if (ticket !== editionsDraw) return;

  const note = (text) => {
    const p = document.createElement("p");
    p.className = "desk-empty";
    p.textContent = text;
    return p;
  };
  if (!data) {
    host.replaceChildren(note("The earlier versions could not be read just now."));
    return;
  }
  const { editions } = data;
  if (!editions.length) {
    host.replaceChildren(note("Nothing here yet. The first earlier version is kept the next time the paper changes."));
    return;
  }
  const rows = editions.map((e) => {
    const row = document.createElement("div");
    row.className = "edition-row";
    const when = document.createElement("span");
    when.className = "ed-when";
    when.textContent = `As it was on ${editionLabel(e.savedAt)}`;
    const what = document.createElement("span");
    what.className = "ed-what";
    what.textContent = `${e.programs} programs on the paper`;
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "btn btn--quiet ed-restore";
    restore.textContent = "Put this back";
    restore.setAttribute("aria-label", `Put back the paper ${when.textContent.toLowerCase()}`);
    restore.addEventListener("click", () => restoreEdition(e, editionLabel(e.savedAt)));
    row.append(when, what, restore);
    return row;
  });
  host.replaceChildren(...rows);
}

async function restoreEdition(edition, label) {
  if (!confirm(`Put back the paper as it was on ${label}? Readers will see it straight away. The paper as it is now will be kept here too, so you can change your mind.`)) return;
  await saving;
  status("Putting it back…");
  const res = await fetch("/api/versions/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: edition.id }),
  }).catch(() => null);
  if (!res || !res.ok) {
    const body = res ? await res.json().catch(() => ({})) : {};
    status(body.error || "That version could not be put back. Nothing was changed.");
    return;
  }
  await openDesk();                 // reload the restored paper into the desk
  status(`The paper is back as it was on ${label}. Readers see it now.`);
}

boot();
