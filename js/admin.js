/* admin.js — the Editor's Desk. Volunteers sign in with the shared password
   and change the paper directly: every change is saved the moment it is
   made, and Undo takes changes back one at a time, saying each time exactly
   which change it is. There is no separate "publish" step to forget.

   The desk is written for volunteers who are seniors themselves: one button
   per job, plain words, one calendar, and nothing that cannot be taken back. */

import { timeRange, weekLabelFor, monthTitle, isToday, formatTime, el, byStartTime } from "./schedule.js";
import { expandSeries, describeSeries, activeSeries, zoomKind, isHttpUrl } from "./data-adapter.js";
import { isoOf, todayIso, dateOf, mondayOf, addDays, longDate, monthCells, groupBy, SHORT_DAYS } from "./dates.js";
import {
  WEEKDAYS, weekdayOf, weekdayOfDate, dayName, addSeries, changeSeries, stopSeries, handChangesFrom,
  setCancelled, resetDate, writeDate, addEvent, deleteEvent,
} from "./schedule-edit.js";

const $ = (sel) => document.querySelector(sel);

/* ---------- state ---------- */
let schedule = { defaultZoomLink: "", editorsNote: "", series: [], exceptions: [], events: [] }; // RAW: keeps "default" markers
let view = "week";               // "week" | "month"
let anchor = new Date();         // the date the current view centres on
let editing = null;              // what the editor dialog is working on (see openEditor)

/* ---------- talking to the server ---------- */
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  return { ok: Boolean(res?.ok), status: res?.status ?? 0, data, error: data?.error ?? null };
}

/* ---------- dates on the desk ----------
   The week a volunteer sees is not the events array: it is the weekly
   programs expanded, their per-date changes applied, and the one-off events
   laid on top. Every date remembers where it came from (see
   js/schedule-edit.js), because that decides what changing it writes. These
   are worked out again only when the paper changes, not on every redraw. */
let occurrences = new Map();
let seriesIndex = new Map();
let datesInOrder = [];

function rebuild() {
  seriesIndex = new Map((schedule.series ?? []).map((s) => [s.id, s]));
  occurrences = groupBy([
    ...expandSeries(schedule.series, schedule.exceptions, { includeSkipped: true })
      .map((o) => ({ ...o, kind: "series" })),
    ...(schedule.events ?? []).map((e, i) => ({ ...e, kind: "once", eventIndex: i, cancelled: Boolean(e.cancelled) })),
  ], (o) => o.date);
  for (const list of occurrences.values()) list.sort(byStartTime);
  datesInOrder = [...occurrences.keys()].sort();
}

const occurrencesOn = (iso) => occurrences.get(iso) ?? [];

/* The first date on or after `fromIso` that a weekly program is on the paper:
   the date a change "every week from now" really begins. */
const nextDateOf = (seriesId, fromIso) =>
  datesInOrder.find((iso) => iso >= fromIso &&
    occurrencesOn(iso).some((o) => o.kind === "series" && o.seriesId === seriesId)) ?? null;
const latest = (a, b) => (a > b ? a : b);

/* ---------- saving: every change, straight away ----------
   `change` takes the schedule and returns the changed one. The paper as it
   was is kept for Undo, with the change described in words. Saves go one at
   a time, in order; if one fails, the desk goes back to the paper as it was
   and says so plainly. */
const undoStack = [];            // { before, label, date }, newest last
const UNDO_KEEP = 25;
let saving = Promise.resolve();
let pending = 0;

const payload = (s) => ({
  defaultZoomLink: s.defaultZoomLink || null,
  editorsNote: s.editorsNote || "",
  series: s.series ?? [],
  exceptions: s.exceptions ?? [],
  events: s.events ?? [],
});

/* The save bar reads like a receipt: a word for what happened ("Saved",
   "Undone"), the change itself in full, and a quiet line for what comes
   next. Read aloud it is one sentence: "Saved: Yoga cancelled on Monday,
   November 2. Readers see it now." `reassure` marks a line a phone can do
   without, because the word already says it. */
function status({ word = "", change = "", note = "", kind = "info", reassure = false } = {}) {
  const host = $("#save-status");
  host.dataset.kind = kind;
  const parts = [];
  if (word) {
    const w = el("span", "save-word", word);
    if (change) w.append(el("span", "visually-hidden", ":"));
    parts.push(w, " ");
  }
  if (change) parts.push(el("strong", null, change), ". ");
  if (note) parts.push(el("span", "save-note" + (reassure ? " save-note--reassure" : ""), note));
  host.replaceChildren(...parts);
  const next = undoStack.at(-1);
  $("#undo").hidden = !next;
  if (next) $("#undo").setAttribute("aria-label", `Undo: ${next.label}`);
}

function commit(label, change, { date = null, isUndo = false } = {}) {
  const before = schedule;
  schedule = change(schedule);
  refresh();
  status({ word: "Saving…", kind: "working" });
  pending++;
  saving = saving.then(async () => {
    const res = await api("PUT", "/api/schedule", payload(schedule));
    pending--;
    if (res.ok) {
      if (!isUndo) {
        undoStack.push({ before, label, date });
        if (undoStack.length > UNDO_KEEP) undoStack.shift();
      }
      announce(isUndo ? "undone" : "saved", label);
      if (date) markChanged(date);
      drawEditions();
      return true;
    }
    schedule = before;
    refresh();
    fillSettings();
    if (res.status === 401) {
      showLogin("You were signed out, so that last change was not saved. Please sign in again.");
      return false;
    }
    status({ word: "Not saved", kind: "error", note: res.error
      ? `${res.error} Nothing was changed.`
      : "That change did not go through, so nothing was changed. Please check the internet connection and try again." });
    return false;
  });
  return saving;
}

function announce(kind, label) {
  if (kind === "saved") {
    status({ word: "Saved", change: label, note: "Readers see it now.", kind, reassure: true });
    return;
  }
  const next = undoStack.at(-1);
  status(next
    ? { word: "Undone", change: label, note: `Press Undo again to take back: ${next.label}.`, kind }
    : { word: "Undone", change: label, note: "Readers see it now.", kind, reassure: true });
}

$("#undo").addEventListener("click", async () => {
  const last = undoStack.pop();
  if (!last) return;
  if (last.date) anchor = dateOf(last.date);      // show the date being put back
  const ok = await commit(last.label, () => last.before, { date: last.date, isUndo: true });
  if (!ok) undoStack.push(last);
  fillSettings();
});

/* Tint the day a change landed on for a moment, so the volunteer sees it. */
function markChanged(iso) {
  for (const n of document.querySelectorAll(`[data-iso="${iso}"]`)) {
    n.classList.remove("just-changed");
    void n.offsetWidth;            // restart the tint if it is already showing
    n.classList.add("just-changed");
    setTimeout(() => n.classList.remove("just-changed"), 2600);
    if (n.offsetParent) n.scrollIntoView({ block: "nearest" });
  }
}

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
  const me = await api("GET", "/api/me");
  if (me.data?.signedIn) return openDesk();
  showLogin();
}

$("#login-show").addEventListener("change", (e) => {
  $("#login-pass").type = e.target.checked ? "text" : "password";
});

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-msg").textContent = "";
  const res = await api("POST", "/api/login", { password: $("#login-pass").value });
  if (!res.ok) {
    $("#login-msg").textContent = res.error || "Signing in didn't work. Please try again.";
    return;
  }
  $("#login-view").hidden = true;
  openDesk();
});

$("#signout").addEventListener("click", async () => {
  if ((noteChanged() || zoomChanged()) &&
      !confirm("The note or the meeting link has changes you have not saved. Sign out anyway?")) return;
  await api("POST", "/api/logout");
  location.reload();
});

async function loadSchedule() {
  const res = await api("GET", "/api/schedule/raw");
  if (!res.ok) { showLogin(); return false; }
  schedule = { series: [], exceptions: [], events: [], ...res.data };
  fillSettings();
  refresh();
  drawEditions();
  return true;
}

async function openDesk() {
  undoStack.length = 0;
  if (!(await loadSchedule())) return;
  $("#desk-view").hidden = false;
  $("#signout").hidden = false;
  status({ note: "Changes show on the paper as soon as you make them." });
}

/* ---------- view plumbing ---------- */
function refresh() {      // the paper changed
  rebuild();
  draw();
}

function draw() {         // only the view changed
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
$("#range-prev").addEventListener("click", () => step(-1));
$("#range-next").addEventListener("click", () => step(1));
$("#range-today").addEventListener("click", () => { anchor = new Date(); draw(); });
function step(dir) {
  if (view === "week") anchor.setDate(anchor.getDate() + 7 * dir);
  else anchor = new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  draw();
}

const JOIN_LABEL = { default: "in the usual meeting room", custom: "with a special meeting link", phone: "people call to register" };
const emptyNote = (text) => el("p", "desk-empty", text);

function button(label, cls, onClick, ariaLabel) {
  const b = el("button", `btn btn--quiet ${cls}`, label);
  b.type = "button";
  if (ariaLabel) b.setAttribute("aria-label", ariaLabel);
  b.addEventListener("click", onClick);
  return b;
}

/* ---------- week view ---------- */
function drawWeek() {
  const panel = $("#week-panel");
  const monday = isoOf(mondayOf(anchor));
  const days = Array.from({ length: 7 }, (_, d) => {
    const iso = addDays(monday, d);
    const sec = el("section", "desk-day");
    sec.dataset.iso = iso;
    const head = el("div", "desk-day-head");
    head.append(el("span", "day-name", longDate(iso)));
    if (isToday(iso)) head.append(el("span", "day-today", "Today"));
    sec.append(head);

    const todays = occurrencesOn(iso);
    if (todays.length === 0) sec.append(emptyNote("Nothing on this day."));
    for (const o of todays) sec.append(eventRow(o));
    sec.append(button(`+ Add a program on ${longDate(iso)}`, "desk-add", () => openEditor({ presetDate: iso })));
    return sec;
  });
  panel.replaceChildren(...days);
}

/* One row of the desk: the program, what has happened to it, and two
   buttons — change it, or cancel it for this date. Cancelling keeps it on
   the paper with a CANCELLED stamp, so nobody turns up to an empty room. */
function eventRow(o, { onEdit = (occ) => openEditor({ occurrence: occ }) } = {}) {
  const row = el("div", "desk-event" + (o.cancelled ? " is-cancelled" : ""));

  const what = el("span", "de-what");
  what.append(el("strong", "de-title", o.title),
    el("span", "de-when", `${timeRange(o.startTime, o.endTime)}, ${JOIN_LABEL[zoomKind(o.zoomLink)]}`));
  if (o.kind === "series") {
    const s = seriesIndex.get(o.seriesId);
    what.append(el("span", "de-origin", (s && describeSeries(s)) || "Every week"));
  }
  row.append(what);

  const state = stateOf(o);
  if (state) row.append(el("span", `de-state de-state--${state.key}`, state.label));

  const on = longDate(o.date);
  const off = o.cancelled;
  const actions = el("span", "de-actions");
  actions.append(
    button("Change ✎", "de-edit", () => onEdit(o), `Change ${o.title} on ${on}`),
    button(off ? "Put it back on" : "Cancel this date", "de-cancel", () =>
      commit(off ? `${o.title} back on for ${on}` : `${o.title} cancelled on ${on}`,
        (s) => setCancelled(s, o, !off), { date: o.date }),
    off ? `Put ${o.title} back on, ${on}` : `Cancel ${o.title} on ${on}`),
  );
  row.append(actions);
  return row;
}

/* Plain words for what has happened to this date, or null when it is simply
   the usual program at the usual hour. Like everything on the desk, this is
   read from the paper itself, so it stays for as long as the change does. */
function stateOf(o) {
  if (o.cancelled) return { key: "cancelled", label: "Cancelled" };
  if (o.kind === "once") return { key: "once", label: "One time only" };
  if (o.changed) return { key: "changed", label: "Changed for this date" };
  return null;
}

/* ---------- month view ---------- */
function drawMonth() {
  const y = anchor.getFullYear(), m1 = anchor.getMonth() + 1;
  const { lead, isos, trail } = monthCells(y, m1);
  const grid = el("div", "cal-grid");
  for (let i = 1; i <= 7; i++) grid.append(el("div", "cal-dow", SHORT_DAYS[i % 7]));
  const pad = () => {
    const c = el("button", "cal-cell");
    c.type = "button"; c.disabled = true;
    return c;
  };
  for (let i = 0; i < lead; i++) grid.append(pad());
  for (const iso of isos) {
    const todays = occurrencesOn(iso);
    const cell = el("button", "cal-cell"
      + (isToday(iso) ? " is-today" : "")
      + (todays.length ? " has-events" : ""));
    cell.type = "button";
    cell.dataset.iso = iso;
    cell.setAttribute("aria-label",
      `${longDate(iso)}: ${todays.length} program${todays.length === 1 ? "" : "s"}. Press to change this day.`);
    cell.append(el("span", "cal-date", String(dateOf(iso).getDate())));
    for (const o of todays.slice(0, 2)) cell.append(el("span", "cal-ev" + (o.cancelled ? " is-cancelled" : ""), o.title));
    if (todays.length > 2) cell.append(el("span", "cal-more", `+${todays.length - 2} more`));
    if (todays.length) cell.append(el("span", "cal-dots", "●".repeat(Math.min(todays.length, 4))));
    cell.addEventListener("click", () => openDayEditor(iso));
    grid.append(cell);
  }
  for (let i = 0; i < trail; i++) grid.append(pad());
  $("#month-panel").replaceChildren(grid,
    el("p", "byline", "Press any date to see and change that day's programs."));
}

/* ---------- one day: press a date in the month view ---------- */
const dayDialog = $("#day-dialog");
let dayDialogIso = null;

function openDayEditor(iso) {
  dayDialogIso = iso;
  $("#day-dialog-title").textContent = longDate(iso);
  drawDayList();
  dayDialog.showModal();
}

function drawDayList() {
  const todays = occurrencesOn(dayDialogIso);
  const edit = (occ) => { dayDialog.close(); openEditor({ occurrence: occ }); };
  $("#day-dialog-list").replaceChildren(
    ...(todays.length ? todays.map((o) => eventRow(o, { onEdit: edit })) : [emptyNote("Nothing on this day yet.")]));
}

$("#day-add").addEventListener("click", () => {
  dayDialog.close();
  openEditor({ presetDate: dayDialogIso });
});
$("#day-close").addEventListener("click", () => dayDialog.close());
$("#start-add").addEventListener("click", () => openEditor({ presetDate: todayIso() }));

/* ---------- the program editor ----------
   One dialog for every program. A weekly program's date asks first, as a
   phone's calendar does, which dates the change is for: just this one, or
   every week from it on. A new program asks the same question the other
   way round: just this once, or every week. */
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

/* Put a program's details into the form. */
function fillDetails(o) {
  $("#ev-title").value = o.title || "";
  fillTimes($("#ev-start"), o.startTime || "10:00");
  fillTimes($("#ev-end"), o.endTime || "", { none: true });
  // Match the stored category exactly where we can; only fall back to
  // "Something else" when it genuinely is something else.
  const cat = String(o.category || "");
  $("#ev-category").value = CATEGORIES.includes(cat) ? cat
    : (CATEGORIES.find((c) => cat.includes(c)) ?? "");
  $("#ev-desc").value = o.description || "";
  const join = zoomKind(o.zoomLink);
  document.querySelector(`input[name="ev-zoom"][value="${join}"]`).checked = true;
  $("#ev-zoom-url").value = join === "custom" ? o.zoomLink : "";
  $("#ev-new").checked = Boolean(o.isNew);
}

const scope = () => document.querySelector('input[name="ev-scope"]:checked').value;

function openEditor({ occurrence = null, presetDate = null } = {}) {
  const o = occurrence ?? {
    kind: "new", title: "", date: presetDate || todayIso(),
    startTime: "10:00", endTime: "", category: "", description: "", zoomLink: "default",
  };
  const series = o.kind === "series" ? seriesIndex.get(o.seriesId) ?? null : null;
  // A weekly change starts at this date, or, if this date is past, at the
  // program's next date from today: a Wednesday class changes from a
  // Wednesday, never from "today".
  const start = latest(o.date, todayIso());
  const from = series ? nextDateOf(series.id, start) : start;
  const canGoWeekly = o.kind === "new" || Boolean(from && activeSeries([series], from).length);
  editing = { o, series, from, touched: false };

  $("#event-dialog-title").textContent = o.kind === "new" ? "Add a program" : `Change ${o.title}`;
  $("#f-scope").hidden = !canGoWeekly;
  $("#scope-legend").textContent = o.kind === "new" ? "How often?" : "Change which dates?";
  document.querySelector('input[name="ev-scope"][value="date"]').checked = true;

  $("#ev-date").value = o.date;
  fillDetails(o);
  if (series) {
    const day = weekdayOf(series.rrule);
    fillDays($("#ev-day"), day);
    $("#ev-day").hidden = !day;          // a richer rhythm is stated, not offered
    $("#ev-day-text").hidden = Boolean(day);
    $("#ev-day-text").textContent = describeSeries(series);
  }
  $("#ev-more").open = false;
  $("#event-msg").textContent = "";
  applyScope();
  dialog.showModal();
}

/* Show what fits the answer to "which dates?". */
function applyScope() {
  const { o, series, from } = editing;
  const weekly = scope() === "weekly";
  const isNew = o.kind === "new";

  if (isNew) {
    const day = dayName(weekdayOfDate($("#ev-date").value || o.date));
    $("#scope-date").textContent = "Just this once";
    $("#scope-date-note").textContent = "It goes on the paper on this date only.";
    $("#scope-weekly").textContent = `Every ${day}, from then on`;
    $("#scope-weekly-note").textContent = "It goes on the paper every week until you stop it.";
  } else if (series && from) {
    $("#scope-date").textContent = `Only ${longDate(o.date)}`;
    $("#scope-date-note").textContent = "The other weeks stay as they are.";
    $("#scope-weekly").textContent = `Every week, from ${longDate(from)} on`;
    $("#scope-weekly-note").textContent = "Dates before that stay as they were.";
    // Each answer starts from its own details, until the volunteer types.
    if (!editing.touched) fillDetails(weekly ? series : o);
  }

  // A weekly program's dates cannot move one at a time; the whole program
  // can move to another day.
  $("#f-date").hidden = o.kind === "series";
  $("#ev-date-label").textContent = isNew && weekly ? "Starting on" : "Date";
  $("#f-day").hidden = !(series && weekly);
  $("#f-new").hidden = weekly;
  $("#ev-more-hint").textContent = weekly
    ? "The description, the kind of program, and how people join"
    : "The description, how people join, and the NEW stamp";

  $("#ev-reset").hidden = !(series && !weekly && o.changed);
  $("#ev-delete").hidden = o.kind !== "once";
  $("#ev-stop").hidden = !(series && weekly);
}

for (const r of document.querySelectorAll('input[name="ev-scope"]')) r.addEventListener("change", applyScope);
$("#ev-date").addEventListener("change", () => { if (editing?.o.kind === "new") applyScope(); });
$("#event-form").addEventListener("input", (e) => {
  if (editing && e.target.name !== "ev-scope" && e.target.id !== "ev-date") editing.touched = true;
});

function readForm() {
  const title = $("#ev-title").value.trim();
  const date = $("#ev-date").value;
  const startTime = $("#ev-start").value;
  if (!title) return { error: "Please give the program a name." };
  if (editing.o.kind !== "series" && !date) return { error: "Please choose a date." };
  const endTime = $("#ev-end").value || null;
  if (endTime && endTime <= startTime) {
    return { error: "The end time should be after the start time." };
  }
  const join = document.querySelector('input[name="ev-zoom"]:checked').value;
  let zoomLink = join === "default" ? "default" : null;
  if (join === "custom") {
    zoomLink = $("#ev-zoom-url").value.trim();
    if (!isHttpUrl(zoomLink)) {
      $("#ev-more").open = true;
      return { error: "The special meeting link should start with https://" };
    }
  }
  return {
    title, date, startTime, endTime,
    category: $("#ev-category").value,
    description: $("#ev-desc").value.trim(),
    zoomLink,
    isNew: $("#ev-new").checked,
  };
}

/* Close the editor, show where the change lands, and save it. */
function save(label, change, date) {
  dialog.close();
  anchor = dateOf(date);
  return commit(label, change, { date });
}

/* Enter in any box saves, as the volunteer expects, rather than closing the
   dialog and losing what they typed. */
$("#event-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = readForm();
  if (form.error) { $("#event-msg").textContent = form.error; return; }
  const { o, series, from } = editing;
  const weekly = scope() === "weekly" && !$("#f-scope").hidden;

  if (o.kind === "new" && weekly) {
    const start = latest(form.date, todayIso());
    const weekday = weekdayOfDate(form.date);
    return save(`${form.title} added, every ${dayName(weekday)} from ${longDate(start)}`,
      (s) => addSeries(s, { ...form, weekday }, start), start);
  }
  if (o.kind === "new") {
    return save(`${form.title} added on ${longDate(form.date)}`, (s) => addEvent(s, form), form.date);
  }
  if (!weekly) {
    const date = o.kind === "once" ? form.date : o.date;
    return save(`${form.title} changed on ${longDate(date)}`, (s) => writeDate(s, o, form), date);
  }

  const weekday = $("#ev-day").hidden ? null : $("#ev-day").value;
  const moved = weekday && weekday !== weekdayOf(series.rrule);
  const handMade = moved ? handChangesFrom(schedule, series.id, from) : 0;
  if (handMade && !confirm(
    `Moving ${series.title} to ${dayName(weekday)}s will undo ${handMade === 1 ? "the 1 date" : `the ${handMade} dates`} ` +
    `you changed by hand from ${longDate(from)} on, such as a cancelled week. Move it anyway?`)) return;
  save(moved
    ? `${form.title} moved to ${dayName(weekday)}s, from ${longDate(from)}`
    : `${form.title} changed every week, from ${longDate(from)}`,
  (s) => changeSeries(s, series.id, { ...form, endTime: form.endTime || "", weekday }, from), from);
});

$("#ev-delete").addEventListener("click", () => {
  const { o } = editing;
  const on = longDate(o.date);
  if (!confirm(`Delete ${o.title} on ${on}? It will not be on the paper at all. (To keep it on the paper marked CANCELLED, choose Never mind and then Cancel this date.)`)) return;
  save(`${o.title} on ${on} deleted`, (s) => deleteEvent(s, o), o.date);
});

$("#ev-stop").addEventListener("click", () => {
  const { series, from } = editing;
  if (!confirm(`Stop ${series.title}? It will not be on the paper from ${longDate(from)} on. Dates before that stay as they were.`)) return;
  save(`${series.title} stopped from ${longDate(from)}`, (s) => stopSeries(s, series.id, from), from);
});

$("#ev-reset").addEventListener("click", () => {
  const { o } = editing;
  save(`${o.title} on ${longDate(o.date)} back to the usual`, (s) => resetDate(s, o), o.date);
});

$("#ev-cancel").addEventListener("click", () => dialog.close());

/* ---------- the note and the meeting link ----------
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
  const editorsNote = $("#editors-note").value.trim();
  const ok = await commit("the note on the front page rewritten", (s) => ({ ...s, editorsNote }));
  if (ok) $("#note-state").textContent = "Saved.";
});
$("#zoom-save").addEventListener("click", async () => {
  const defaultZoomLink = $("#default-zoom").value.trim();
  if (defaultZoomLink && !isHttpUrl(defaultZoomLink)) {
    $("#zoom-state").textContent = "The link should start with https://";
    return;
  }
  const ok = await commit("the meeting link changed", (s) => ({ ...s, defaultZoomLink }));
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

/* ---------- earlier copies of the paper ---------- */
function copyLabel(savedAt) {
  const d = new Date(savedAt ?? "");
  if (Number.isNaN(d.getTime())) return "an earlier time";
  const day = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}

const SHOW_CHANGES = 4;

/* Opening the desk and finishing a save can both ask for the list at once.
   Each draw builds its rows off-page and swaps them in whole, and a draw
   that a newer one has overtaken is dropped, so the list can never be
   printed twice. */
let editionsDraw = 0;
async function drawEditions() {
  const host = $("#editions-list");
  const ticket = ++editionsDraw;
  const res = await api("GET", "/api/versions");
  if (ticket !== editionsDraw) return;

  if (!res.ok) {
    host.replaceChildren(emptyNote("The earlier copies could not be read just now."));
    return;
  }
  const { editions } = res.data;
  if (!editions.length) {
    host.replaceChildren(emptyNote("Nothing here yet. The first copy is kept the next time the paper changes."));
    return;
  }
  host.replaceChildren(...editions.map((e) => {
    const label = copyLabel(e.savedAt);
    const row = el("div", "edition-row");
    const when = el("span", "ed-when", `As it was on ${label}`);
    const restore = button("Go back to this copy", "ed-restore", () => restoreEdition(e, label),
      `Go back to the paper as it was on ${label}`);
    restore.disabled = !e.changes.length;
    if (!e.changes.length) {
      row.append(when, el("p", "ed-what", "The same as the paper now."), restore);
      return row;
    }
    const what = el("ul", "ed-what");
    for (const c of e.changes.slice(0, SHOW_CHANGES)) what.append(el("li", null, c));
    const more = e.changes.length - SHOW_CHANGES;
    if (more > 0) what.append(el("li", null, `and ${more} more change${more === 1 ? "" : "s"}`));
    row.append(when, el("p", "ed-label", "Going back undoes:"), what, restore);
    return row;
  }));
}

async function restoreEdition(edition, label) {
  const undoing = edition.changes.slice(0, 8).map((c) => `\n  • ${c}`).join("");
  if (!confirm(`Go back to the paper as it was on ${label}?\n\nThis undoes:${undoing}\n\nReaders see it straight away. If you change your mind, press Undo.`)) return;
  await saving;
  status({ word: "Going back…", kind: "working" });
  const before = schedule;
  const res = await api("POST", "/api/versions/restore", { id: edition.id });
  if (!res.ok) {
    status({ word: "Not saved", kind: "error", note: res.error || "That copy could not be put back. Nothing was changed." });
    return;
  }
  await loadSchedule();             // the restored paper, into the desk
  const what = `the paper back as it was on ${label}`;
  undoStack.push({ before, label: what, date: null });
  announce("saved", what);
}

boot();
