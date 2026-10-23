/* admin.js — the Editor's Desk. Volunteers sign in, edit the day-to-day
   schedule in a week or month outlook (any date, any year), set the usual
   Zoom room and the front-page note, then Publish. Nothing changes for
   readers until Publish. */

import { dayLabel, timeRange, weekLabelFor, monthTitle, isToday } from "./schedule.js";
import { expandSeries, describeSeries } from "./data-adapter.js";

const $ = (sel) => document.querySelector(sel);
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

/* ---------- state ---------- */
let schedule = { defaultZoomLink: "", editorsNote: "", events: [] }; // RAW: keeps "default" markers
let dirty = false;
let view = "week";               // "week" | "month"
let anchor = new Date();         // the date the current view centres on
let editing = null;              // the occurrence being edited, or null for a new one

/* ---------- occurrences ----------
   The week a volunteer sees is not the events array: it is the standing
   programs expanded, their exceptions applied, and the one-off events laid on
   top. Every row remembers where it came from, because that decides what
   saving it should write — an event, or an exception for one date. */
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

const isoOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const mondayOf = (d) => {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
};

function setDirty(v = true) {
  dirty = v;
  $("#publish").disabled = !dirty;
  $("#publish-status").textContent = dirty ? "You have unpublished changes." : "";
}
window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

/* ---------- sign in / out ---------- */
async function boot() {
  const me = await fetch("/api/me").then((r) => r.json()).catch(() => ({ signedIn: false }));
  if (me.signedIn) return openDesk();
  $("#login-view").hidden = false;
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-msg").textContent = "";
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: $("#login-user").value.trim(),
      password: $("#login-pass").value,
    }),
  }).catch(() => null);
  if (!res || !res.ok) {
    const body = res ? await res.json().catch(() => ({})) : {};
    $("#login-msg").textContent = body.error || "Sign-in didn't work. Please try again.";
    return;
  }
  $("#login-view").hidden = true;
  openDesk();
});

$("#signout").addEventListener("click", async () => {
  if (dirty && !confirm("You have unpublished changes. Sign out anyway?")) return;
  await fetch("/api/logout", { method: "POST" });
  location.reload();
});

async function openDesk() {
  const res = await fetch("/api/schedule/raw");
  if (!res.ok) { $("#login-view").hidden = false; return; }
  schedule = await res.json();
  schedule.events ??= [];
  $("#desk-view").hidden = false;
  $("#signout").hidden = false;
  $("#default-zoom").value = schedule.defaultZoomLink || "";
  $("#editors-note").value = schedule.editorsNote || "";
  setDirty(false);
  draw();
  drawEditions();
}

/* ---------- view plumbing ---------- */
/* The standing programs, named once, so the desk can answer "what is normally
   on?" without the volunteer reconstructing it from the week. */
function drawStanding() {
  const host = $("#standing-list");
  if (!host) return;
  host.textContent = "";
  const list = schedule.series ?? [];
  if (list.length === 0) {
    const none = document.createElement("p");
    none.className = "desk-empty";
    none.textContent = "No standing programs yet — every program is entered one date at a time.";
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
    what.appendChild(strong);
    what.appendChild(document.createTextNode(` · ${timeRange(s.startTime, s.endTime)}`));
    row.append(when, what);
    host.appendChild(row);
  }
}

function draw() {
  rebuildOccurrences();
  drawStanding();
  $("#view-week").setAttribute("aria-pressed", String(view === "week"));
  $("#view-month").setAttribute("aria-pressed", String(view === "month"));
  $("#week-panel").hidden = view !== "week";
  $("#month-panel").hidden = view !== "month";
  if (view === "week") {
    $("#desk-title").textContent = weekLabelFor(anchor);
    drawWeek();
  } else {
    $("#desk-title").textContent = monthTitle(anchor.getFullYear(), anchor.getMonth() + 1);
    drawMonth();
  }
  const jump = $("#range-jump");
  jump.value = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}`;
}

$("#view-week").addEventListener("click", () => { view = "week"; draw(); });
$("#view-month").addEventListener("click", () => { view = "month"; draw(); });
$("#range-prev").addEventListener("click", () => { step(-1); });
$("#range-next").addEventListener("click", () => { step(1); });
$("#range-today").addEventListener("click", () => { anchor = new Date(); draw(); });
$("#range-jump").addEventListener("change", (e) => {
  const [y, m] = e.target.value.split("-").map(Number);
  if (y && m) { anchor = new Date(y, m - 1, 1); draw(); }
});
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

/* ---------- week outlook ---------- */
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
      none.textContent = "Nothing scheduled.";
      sec.appendChild(none);
    }
    for (const e of todays) sec.appendChild(eventRow(e));

    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn btn--quiet desk-add";
    add.textContent = `+ Add a program on ${dayLabel(iso)}`;
    add.addEventListener("click", () => openEditor(null, iso));
    sec.appendChild(add);

    panel.appendChild(sec);
  }
}

/* One row of the desk. What it offers depends on where the program came
   from: a standing class can be called off for a single week, a one-off can
   only be edited or removed. */
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
    origin.textContent = s ? `Standing program · ${describeSeries(s)}` : "Standing program";
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

  if (o.skipped) {
    actions.appendChild(button("Put it back", "de-restore", () => {
      removeException(o.seriesId, o.date);
      redraw();
    }, `Put ${o.title} back on ${dayLabel(o.date)}`));
  } else {
    actions.appendChild(button("Edit ✎", "de-edit",
      () => (onEdit ? onEdit(o) : openEditor(o)), `Edit ${o.title}`));

    if (o.kind === "series") {
      const off = o.cancelled;
      actions.appendChild(button(off ? "It's back on" : "Call it off", "de-cancel", () => {
        patchException(o, { cancelled: off ? undefined : true });
        redraw();
      }, `${off ? "Restore" : "Call off"} ${o.title} on ${dayLabel(o.date)}`));
    }
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
  if (o.kind === "once") return { key: "once", label: "One-off" };
  if (o.hasException) return { key: "changed", label: "Changed this week" };
  return null;
}

const redraw = () => { setDirty(); draw(); };

/* ---------- exceptions ----------
   An exception records only what differs from the standing program, so a
   later change to the series still flows through everything it does not
   contradict. When nothing differs any more, the exception is deleted rather
   than left behind as an empty record. */
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

/* Merge a change into whatever exception this date already carries. */
function patchException(o, changes) {
  const i = exceptionIndexOf(o.seriesId, o.date);
  const current = i >= 0 ? { ...schedule.exceptions[i] } : { seriesId: o.seriesId, date: o.date };
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) delete current[k]; else current[k] = v;
  }
  writeException(current);
}

/* ---------- month outlook ---------- */
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
      `${dayLabel(iso)}: ${todays.length} program${todays.length === 1 ? "" : "s"}. Click to edit this day.`);
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
  hint.textContent = "Click any date to see and edit that day's programs.";
  panel.appendChild(hint);
}

/* ---------- day editor: click a date in the month outlook ---------- */
const dayDialog = $("#day-dialog");
let dayDialogIso = null;

function openDayEditor(iso) {
  dayDialogIso = iso;
  $("#day-dialog-title").textContent = dayLabel(iso);
  const list = $("#day-dialog-list");
  list.textContent = "";
  const todays = occurrencesOn(iso);
  if (todays.length === 0) {
    const none = document.createElement("p");
    none.className = "desk-empty";
    none.textContent = "Nothing scheduled this day yet.";
    list.appendChild(none);
  }
  for (const e of todays) {
    list.appendChild(eventRow(e, {
      onEdit: (occ) => { dayDialog.close(); openEditor(occ); },
    }));
  }
  dayDialog.showModal();
}

$("#day-add").addEventListener("click", () => {
  const iso = dayDialogIso;
  dayDialog.close();
  openEditor(null, iso);
});
$("#day-close").addEventListener("click", () => dayDialog.close());

/* ---------- event editor ---------- */
const dialog = $("#event-dialog");

const CATEGORIES = ["yoga", "art", "music", "computer", "finance",
                   "health", "stock market", "talk", "social"];

function openEditor(occurrence, presetDate) {
  editing = occurrence ?? null;
  const o = occurrence ?? {
    kind: "once", title: "", date: presetDate || isoOf(new Date()),
    startTime: "10:00", endTime: "", category: "", description: "",
    zoomLink: "default", isNew: false, cancelled: false,
  };
  const isSeries = o.kind === "series";
  const s = isSeries ? seriesById(o.seriesId) : null;

  $("#event-dialog-title").textContent =
    occurrence ? "Edit program" : "Add a program";

  // A standing program is edited one date at a time; say so plainly, and take
  // the date field out of play so nobody expects it to move the whole series.
  const banner = $("#ev-standing");
  banner.hidden = !isSeries;
  if (isSeries) {
    $("#ev-standing-text").textContent =
      `${s ? describeSeries(s) : "Standing program"} · ${s ? s.title : o.title}. ` +
      `Anything you change here applies to ${dayLabel(o.date)} only.`;
  }
  $("#ev-date").readOnly = isSeries;
  $("#ev-date-note").hidden = !isSeries;

  $("#ev-title").value = o.title || "";
  $("#ev-date").value = o.date || "";
  $("#ev-start").value = o.startTime || "";
  $("#ev-end").value = o.endTime || "";
  // Match the stored category exactly where we can; only fall back to
  // "Something else" when it genuinely is something else.
  const cat = String(o.category || "");
  $("#ev-category").value = CATEGORIES.includes(cat) ? cat
    : (CATEGORIES.find((c) => cat.includes(c)) ?? "");
  $("#ev-desc").value = o.description || "";

  const mode = o.zoomLink === "default" ? "default"
    : /^https?:\/\//.test(o.zoomLink || "") ? "custom" : "phone";
  document.querySelector(`input[name="ev-zoom"][value="${mode}"]`).checked = true;
  $("#ev-zoom-url").value = mode === "custom" ? o.zoomLink : "";
  $("#ev-new").checked = Boolean(o.isNew);
  $("#ev-cancelled").checked = Boolean(o.cancelled);

  $("#ev-delete").hidden = !occurrence;
  $("#ev-delete").textContent = isSeries ? "Take it off this week" : "Remove program";
  $("#ev-reset").hidden = !(isSeries && o.hasException);
  $("#event-msg").textContent = "";
  dialog.showModal();
}

function readForm() {
  const title = $("#ev-title").value.trim();
  const date = $("#ev-date").value;
  const startTime = $("#ev-start").value;
  if (!title || !date || !startTime) {
    return { error: "A program needs at least a name, a date, and a start time." };
  }
  const mode = document.querySelector('input[name="ev-zoom"]:checked').value;
  let zoomLink = null;
  if (mode === "default") zoomLink = "default";
  if (mode === "custom") {
    zoomLink = $("#ev-zoom-url").value.trim();
    if (!/^https?:\/\//.test(zoomLink)) {
      return { error: "The special Zoom link should start with https://" };
    }
  }
  return {
    title, date, startTime,
    endTime: $("#ev-end").value || null,
    category: $("#ev-category").value,
    description: $("#ev-desc").value.trim(),
    zoomLink,
    isNew: $("#ev-new").checked,
    cancelled: $("#ev-cancelled").checked,
  };
}

/* Only what actually differs from the standing program gets recorded. */
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
  if (form.cancelled) ex.cancelled = true;
  return ex;
}

$("#ev-save").addEventListener("click", () => {
  const form = readForm();
  if (form.error) { $("#event-msg").textContent = form.error; return; }

  if (editing?.kind === "series") {
    writeException(exceptionFromForm(editing, form));
  } else {
    const event = {
      title: form.title, date: form.date, startTime: form.startTime,
      endTime: form.endTime || undefined,
      category: form.category,
      description: form.description,
      zoomLink: form.zoomLink,
      isNew: form.isNew || undefined,
      cancelled: form.cancelled || undefined,
    };
    if (editing) schedule.events[editing.eventIndex] = event;
    else schedule.events.push(event);
  }
  dialog.close();
  anchor = new Date(...form.date.split("-").map(Number).map((n, i) => (i === 1 ? n - 1 : n)));
  redraw();
});

/* For a standing program this takes the date off the calendar entirely;
   for a one-off it deletes the event. */
$("#ev-delete").addEventListener("click", () => {
  if (!editing) return;
  if (editing.kind === "series") {
    if (!confirm(`Take ${editing.title} off ${dayLabel(editing.date)} completely? Readers will not see it that day.`)) return;
    writeException({ seriesId: editing.seriesId, date: editing.date, skip: true });
  } else {
    if (!confirm("Remove this program from the schedule?")) return;
    schedule.events.splice(editing.eventIndex, 1);
  }
  dialog.close();
  redraw();
});

$("#ev-reset").addEventListener("click", () => {
  if (editing?.kind !== "series") return;
  removeException(editing.seriesId, editing.date);
  dialog.close();
  redraw();
});

$("#ev-cancel").addEventListener("click", () => dialog.close());

/* ---------- preview ----------
   The draft is posted to the server's session-held preview slot, then the
   real reader pages are loaded against it in an iframe. Previewing the actual
   pages — rather than a mock-up of them — is the point. */
const previewDialog = $("#preview-dialog");
let previewPage = "index.html";

function draftPayload() {
  return {
    defaultZoomLink: schedule.defaultZoomLink || null,
    editorsNote: schedule.editorsNote || "",
    series: schedule.series ?? [],
    exceptions: schedule.exceptions ?? [],
    events: schedule.events ?? [],
  };
}

async function openPreview() {
  const status = $("#publish-status");
  status.textContent = "Getting the preview ready…";
  const res = await fetch("/api/schedule/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draftPayload()),
  }).catch(() => null);
  if (!res || !res.ok) {
    status.textContent = "The preview could not be prepared. Your edits are safe; try again.";
    return;
  }
  status.textContent = "";
  loadPreview();
  previewDialog.showModal();
}

function loadPreview() {
  $("#preview-front").setAttribute("aria-pressed", String(previewPage === "index.html"));
  $("#preview-month").setAttribute("aria-pressed", String(previewPage === "month.html"));
  // cache-bust so switching back and forth always re-reads the draft
  $("#preview-frame").src = `/${previewPage}?preview=1&t=${Date.now()}`;
}

$("#preview").addEventListener("click", openPreview);
$("#preview-front").addEventListener("click", () => { previewPage = "index.html"; loadPreview(); });
$("#preview-month").addEventListener("click", () => { previewPage = "month.html"; loadPreview(); });
$("#preview-close").addEventListener("click", () => {
  previewDialog.close();
  $("#preview-frame").src = "about:blank";     // stop the draft rendering in the background
});

/* ---------- previous editions ---------- */
function editionLabel(savedAt) {
  if (!savedAt) return "An earlier edition";
  const d = new Date(savedAt);
  if (Number.isNaN(d.getTime())) return "An earlier edition";
  return d.toLocaleString(undefined, {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

async function drawEditions() {
  const host = $("#editions-list");
  if (!host) return;
  const res = await fetch("/api/versions").catch(() => null);
  host.textContent = "";
  if (!res || !res.ok) {
    const p = document.createElement("p");
    p.className = "desk-empty";
    p.textContent = "The previous editions could not be read just now.";
    host.appendChild(p);
    return;
  }
  const { editions } = await res.json();
  if (!editions.length) {
    const p = document.createElement("p");
    p.className = "desk-empty";
    p.textContent = "No previous editions yet — the first one is filed the next time you publish.";
    host.appendChild(p);
    return;
  }
  for (const e of editions) {
    const row = document.createElement("div");
    row.className = "edition-row";
    const when = document.createElement("span");
    when.className = "ed-when";
    when.textContent = editionLabel(e.savedAt);
    const what = document.createElement("span");
    what.className = "ed-what";
    what.textContent = `${e.programs} programs · ${e.series} standing, ${e.exceptions} changed, ${e.events} one-off`;
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "btn btn--quiet ed-restore";
    restore.textContent = "Put this back";
    restore.setAttribute("aria-label", `Put back the edition from ${when.textContent}`);
    restore.addEventListener("click", () => restoreEdition(e, when.textContent));
    row.append(when, what, restore);
    host.appendChild(row);
  }
}

async function restoreEdition(edition, label) {
  if (dirty && !confirm("You have unpublished changes. Putting an older edition back will discard them. Continue?")) return;
  if (!confirm(`Put back the paper from ${label}? Readers will see it straight away, and today's paper will be kept so you can undo this.`)) return;
  const status = $("#publish-status");
  status.textContent = "Putting it back…";
  const res = await fetch("/api/versions/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: edition.id }),
  }).catch(() => null);
  if (!res || !res.ok) {
    const body = res ? await res.json().catch(() => ({})) : {};
    status.textContent = body.error || "That edition could not be put back. Nothing was changed.";
    return;
  }
  await openDesk();                 // reload the restored paper into the desk
  await drawEditions();
  setDirty(false);
  status.textContent = `Put back the paper from ${label}.`;
}

/* ---------- settings + publish ---------- */
$("#default-zoom").addEventListener("input", () => {
  schedule.defaultZoomLink = $("#default-zoom").value.trim();
  setDirty();
});
$("#editors-note").addEventListener("input", () => {
  schedule.editorsNote = $("#editors-note").value;
  setDirty();
});

$("#publish").addEventListener("click", async () => {
  const status = $("#publish-status");
  status.textContent = "Publishing…";
  const res = await fetch("/api/schedule", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      defaultZoomLink: schedule.defaultZoomLink || null,
      editorsNote: schedule.editorsNote || "",
      // Sent back untouched: the desk does not edit standing programs yet,
      // but it must not drop them either.
      series: schedule.series ?? [],
      exceptions: schedule.exceptions ?? [],
      events: schedule.events,
    }),
  }).catch(() => null);
  if (!res || !res.ok) {
    const body = res ? await res.json().catch(() => ({})) : {};
    status.textContent = body.error || "Publishing didn't work. Your edits are still here; try again.";
    return;
  }
  setDirty(false);
  status.textContent = "Published! The front page is up to date.";
  drawEditions();
});

boot();
