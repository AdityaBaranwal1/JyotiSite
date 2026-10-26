/* app.mjs — the community paper's little press room.
   Serves the static site, the /admin panel, and a schedule API.
   Public reads are open; writes require a volunteer session. */

import express from "express";
import { readFile, writeFile, rename, readdir, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { normalizeSchedule } from "../js/data-adapter.js";
import { verifyPassword, issueToken, verifyToken, makeRateLimiter } from "./auth.mjs";

const COOKIE = "jyoti_session";
/* Volunteers stay signed in for two months on their own device: a password
   asked for every week is a password written on a sticky note. */
const SESSION_MS = 60 * 24 * 60 * 60 * 1000;

export function createApp({
  root,
  dataDir,
  credentials,          // { username, salt, hash, sessionSecret }
  loginWindowMs = 15 * 60 * 1000,
  loginMax = 10,
  keepVersions = 12,
  sittingMs = 15 * 60 * 1000,   // saves this close together are one sitting
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  const schedulePath = join(dataDir, "schedule.json");
  const versionsDir = join(dataDir, "versions");
  const allowLogin = makeRateLimiter({ windowMs: loginWindowMs, max: loginMax });

  /* ---------- previous editions ----------
     Every publish files the edition it replaces, so a volunteer who publishes
     a mistake can put last week's paper back without needing a developer. */
  const VERSION_FILE = /^schedule-[0-9TZ.\-]+\.json$/;

  /* The desk saves every change the moment it is made, so a morning's work
     is many saves. Filing each one would bury the version a volunteer
     actually wants back ("how it was before I sat down") under a dozen
     near-copies. Within a sitting, the paper from before it is already on
     file and the save is not filed again. A restore always files. */
  async function archiveCurrent({ sitting = false } = {}) {
    let current;
    try { current = await readFile(schedulePath, "utf8"); }
    catch { return null; }                      // nothing published yet
    if (sitting) {
      let savedAt = NaN;
      try { savedAt = Date.parse(JSON.parse(current).savedAt); } catch { /* file it */ }
      if (Date.now() - savedAt < sittingMs) return null;
    }
    await mkdir(versionsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `schedule-${stamp}.json`;
    await writeFile(join(versionsDir, name), current);

    // Keep the last `keepVersions`; older editions are of no use to anyone.
    const kept = (await readdir(versionsDir)).filter((f) => VERSION_FILE.test(f)).sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - keepVersions))) {
      await unlink(join(versionsDir, old)).catch(() => {});
    }
    return name;
  }

  async function writeSchedule(text) {
    const tmp = schedulePath + ".tmp";
    await writeFile(tmp, text);
    await rename(tmp, schedulePath);
  }

  /* ---------- session helpers ---------- */
  const readCookie = (req) => {
    const raw = req.headers.cookie ?? "";
    const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  };
  const hasSession = (req) =>
    Boolean(credentials?.sessionSecret && verifyToken(readCookie(req), credentials.sessionSecret));
  const requireSession = (req, res, next) => {
    if (!hasSession(req)) return res.status(401).json({ error: "Please sign in." });
    next();
  };

  /* ---------- auth ---------- */
  app.post("/api/login", async (req, res) => {
    const key = req.ip || "unknown";
    if (!allowLogin(key)) {
      return res.status(429).json({ error: "Too many tries. Please wait a few minutes and try again." });
    }
    /* One shared volunteer login, so the desk asks only for the password: a
       username everyone types the same adds a box to fill and nothing else. */
    const { password } = req.body ?? {};
    const passOk = await verifyPassword(String(password ?? ""), credentials ?? {});
    if (!passOk) {
      return res.status(401).json({ error: "That password isn't right. Please check it and try again." });
    }
    const token = issueToken(credentials.sessionSecret, SESSION_MS);
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure ? "; Secure" : ""}`
    );
    res.json({ ok: true });
  });

  app.post("/api/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get("/api/me", (req, res) => res.json({ signedIn: hasSession(req) }));

  /* ---------- schedule API ---------- */
  app.get("/api/schedule", async (_req, res) => {
    try {
      res.json(normalizeSchedule(JSON.parse(await readFile(schedulePath, "utf8"))));
    } catch {
      res.status(500).json({ error: "The schedule could not be read." });
    }
  });

  /* Raw (unresolved) copy for the editor, so "default" markers survive editing. */
  app.get("/api/schedule/raw", requireSession, async (_req, res) => {
    try {
      res.json(JSON.parse(await readFile(schedulePath, "utf8")));
    } catch {
      res.status(500).json({ error: "The schedule could not be read." });
    }
  });

  app.put("/api/schedule", requireSession, async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object" || !Array.isArray(body.events) || body.events.length > 5000) {
      return res.status(400).json({ error: "That doesn't look like a schedule." });
    }
    // Validate through the same normalizer the public site uses, but PERSIST
    // the raw shape (keeping "default" zoom markers editable later).
    const cleanEvents = body.events.filter(
      (e) => e && typeof e === "object" &&
        String(e.title ?? "").trim() &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(e.date ?? "")) &&
        /^\d{1,2}:\d{2}$/.test(String(e.startTime ?? ""))
    );
    /* Standing programs and their exceptions carry the bulk of the schedule.
       An editor that only knows about one-off events must never be able to
       delete them by omission, so anything the body does not supply is
       carried over from the copy already on disk. */
    let onDisk = {};
    try { onDisk = JSON.parse(await readFile(schedulePath, "utf8")); } catch { /* first run */ }

    const toSave = {
      savedAt: new Date().toISOString(),
      defaultZoomLink: String(body.defaultZoomLink ?? "").trim() || null,
      editorsNote: String(body.editorsNote ?? "").trim(),
      series: Array.isArray(body.series) ? body.series : (onDisk.series ?? []),
      exceptions: Array.isArray(body.exceptions) ? body.exceptions : (onDisk.exceptions ?? []),
      events: cleanEvents,
    };
    // sanity: it must normalize without throwing
    const normalized = normalizeSchedule(toSave);
    try {
      await archiveCurrent({ sitting: true });   // file the paper this one replaces
      await writeSchedule(JSON.stringify(toSave, null, 2) + "\n");
      res.json({ ok: true, savedAt: toSave.savedAt, kept: cleanEvents.length, normalizedEvents: normalized.events.length });
    } catch {
      res.status(500).json({ error: "The schedule could not be saved. Nothing was changed." });
    }
  });

  /* ---------- previous editions ---------- */
  app.get("/api/versions", requireSession, async (_req, res) => {
    try {
      let names = [];
      try { names = (await readdir(versionsDir)).filter((f) => VERSION_FILE.test(f)); }
      catch { /* nothing filed yet */ }
      const editions = [];
      for (const name of names.sort().reverse()) {
        try {
          const raw = JSON.parse(await readFile(join(versionsDir, name), "utf8"));
          editions.push({
            id: name,
            savedAt: raw.savedAt ?? null,
            series: Array.isArray(raw.series) ? raw.series.length : 0,
            exceptions: Array.isArray(raw.exceptions) ? raw.exceptions.length : 0,
            events: Array.isArray(raw.events) ? raw.events.length : 0,
            programs: normalizeSchedule(raw).events.length,
          });
        } catch { /* skip an unreadable file rather than fail the list */ }
      }
      res.json({ editions });
    } catch {
      res.status(500).json({ error: "The previous editions could not be read." });
    }
  });

  app.post("/api/versions/restore", requireSession, async (req, res) => {
    const id = String(req.body?.id ?? "");
    // The id names a file, so it must be a plain filename and nothing else.
    if (!VERSION_FILE.test(id)) {
      return res.status(400).json({ error: "That is not an edition we filed." });
    }
    try {
      const text = await readFile(join(versionsDir, id), "utf8");
      JSON.parse(text);                 // refuse to restore something unreadable
      await archiveCurrent();           // the restore is itself undoable
      await writeSchedule(text);
      res.json({ ok: true, restored: id });
    } catch (err) {
      const missing = err && err.code === "ENOENT";
      res.status(missing ? 404 : 500).json({
        error: missing ? "That edition is no longer on file." : "That edition could not be restored.",
      });
    }
  });

  /* ---------- pages & static ---------- */
  /* The schedule is runtime state, not build output: it is served straight
     from the data directory so a rebuild is never needed to publish a week. */
  app.use("/data", express.static(dataDir, {
    setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
  }));

  app.get("/admin", (_req, res) => res.sendFile(join(root, "admin.html")));
  app.use(express.static(root, {
    extensions: ["html"],
    // Volunteers update the paper weekly; make browsers revalidate code and
    // data instead of holding stale (or once-truncated) copies.
    setHeaders: (res, path) => {
      if (/\.(js|css|json|html)$/.test(path)) res.setHeader("Cache-Control", "no-cache");
    },
  }));

  return app;
}
