/* admin.js — the Editor's Desk. Volunteers sign in, edit the day-to-day
   schedule in a week or month outlook (any date, any year), set the usual
   Zoom room and the front-page note, then Publish. Nothing changes for
   readers until Publish. */

import { dayLabel, timeRange, weekLabelFor, monthTitle, isToday } from "./schedule.js";

const $ = (sel) => document.querySelector(sel);
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

/* ---------- state ---------- */
let schedule = { defaultZoomLink: "", editorsNote: "", events: [] }; // RAW: keeps "default" markers
let dirty = false;
let view = "week";               // "week" | "month"
let anchor = new Date();         // the date the current view centres on
let editingIndex = null;         // index into schedule.events, or null for new

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
}

/* ---------- view plumbing ---------- */
function draw() {
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

const eventsOn = (iso) =>
  schedule.events
    .map((e, i) => ({ ...e, _i: i }))
    .filter((e) => e.date === iso)
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

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

    const todays = eventsOn(iso);
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

function eventRow(e, { onEdit } = {}) {
  // A plain row of type; ONLY the Edit button is clickable.
  const row = document.createElement("div");
  row.className = "desk-event" + (e.cancelled ? " is-cancelled" : "");
  const what = document.createElement("span");
  what.className = "de-what";
  const strong = document.createElement("strong");
  strong.textContent = e.title;
  what.appendChild(strong);
  what.appendChild(document.createTextNode(` · ${timeRange(e.startTime, e.endTime)} · ${joinLabel(e)}`));
  row.appendChild(what);
  if (e.isNew || e.cancelled) {
    const badges = document.createElement("span");
    badges.className = "de-badges";
    badges.textContent = (e.isNew ? "NEW " : "") + (e.cancelled ? "CANCELLED" : "");
    row.appendChild(badges);
  }
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "btn btn--quiet de-edit";
  edit.textContent = "Edit ✎";
  edit.setAttribute("aria-label", `Edit ${e.title}`);
  edit.addEventListener("click", () => (onEdit ? onEdit(e._i) : openEditor(e._i)));
  row.appendChild(edit);
  return row;
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
    const todays = eventsOn(iso);
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
  const todays = eventsOn(iso);
  if (todays.length === 0) {
    const none = document.createElement("p");
    none.className = "desk-empty";
    none.textContent = "Nothing scheduled this day yet.";
    list.appendChild(none);
  }
  for (const e of todays) {
    list.appendChild(eventRow(e, {
      onEdit: (i) => { dayDialog.close(); openEditor(i); },
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

function openEditor(index, presetDate) {
  editingIndex = index;
  const e = index != null ? schedule.events[index] : {
    title: "", date: presetDate || isoOf(new Date()), startTime: "10:00", endTime: "",
    category: "", description: "", zoomLink: "default", isNew: false, cancelled: false,
  };
  $("#event-dialog-title").textContent = index != null ? "Edit program" : "Add a program";
  $("#ev-title").value = e.title || "";
  $("#ev-date").value = e.date || "";
  $("#ev-start").value = e.startTime || "";
  $("#ev-end").value = e.endTime || "";
  $("#ev-category").value = ["yoga","art","music","computer","finance","health","talk","social"]
    .find((c) => String(e.category || "").includes(c)) ?? "";
  $("#ev-desc").value = e.description || "";
  const mode = e.zoomLink === "default" ? "default"
    : /^https?:\/\//.test(e.zoomLink || "") ? "custom" : "phone";
  document.querySelector(`input[name="ev-zoom"][value="${mode}"]`).checked = true;
  $("#ev-zoom-url").value = mode === "custom" ? e.zoomLink : "";
  $("#ev-new").checked = Boolean(e.isNew);
  $("#ev-cancelled").checked = Boolean(e.cancelled);
  $("#ev-delete").hidden = index == null;
  $("#event-msg").textContent = "";
  dialog.showModal();
}

$("#ev-save").addEventListener("click", () => {
  const title = $("#ev-title").value.trim();
  const date = $("#ev-date").value;
  const startTime = $("#ev-start").value;
  if (!title || !date || !startTime) {
    $("#event-msg").textContent = "A program needs at least a name, a date, and a start time.";
    return;
  }
  const mode = document.querySelector('input[name="ev-zoom"]:checked').value;
  let zoomLink = null;
  if (mode === "default") zoomLink = "default";
  if (mode === "custom") {
    zoomLink = $("#ev-zoom-url").value.trim();
    if (!/^https?:\/\//.test(zoomLink)) {
      $("#event-msg").textContent = "The special Zoom link should start with https://";
      return;
    }
  }
  const event = {
    title, date, startTime,
    endTime: $("#ev-end").value || undefined,
    category: $("#ev-category").value,
    description: $("#ev-desc").value.trim(),
    zoomLink,
    isNew: $("#ev-new").checked || undefined,
    cancelled: $("#ev-cancelled").checked || undefined,
  };
  if (editingIndex != null) schedule.events[editingIndex] = event;
  else schedule.events.push(event);
  dialog.close();
  setDirty();
  anchor = new Date(...date.split("-").map(Number).map((n, i) => (i === 1 ? n - 1 : n)));
  draw();
});

$("#ev-delete").addEventListener("click", () => {
  if (editingIndex == null) return;
  if (!confirm("Remove this program from the schedule?")) return;
  schedule.events.splice(editingIndex, 1);
  dialog.close();
  setDirty();
  draw();
});

$("#ev-cancel").addEventListener("click", () => dialog.close());

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
});

boot();
