/* app.mjs — the community paper's little press room.
   Serves the static site, the /admin panel, and a schedule API.
   Public reads are open; writes require a volunteer session. */

import express from "express";
import { readFile, writeFile, rename, readdir, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { normalizeSchedule } from "../js/data-adapter.js";
import { verifyPassword, issueToken, verifyToken, makeRateLimiter } from "./auth.mjs";

const COOKIE = "jyoti_session";

export function createApp({
  root,
  dataDir,
  credentials,          // { username, salt, hash, sessionSecret }
  loginWindowMs = 15 * 60 * 1000,
  loginMax = 10,
  keepVersions = 12,
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

  async function archiveCurrent() {
    let current;
    try { current = await readFile(schedulePath, "utf8"); }
    catch { return null; }                      // nothing published yet
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

  /* ---------- draft previews ----------
     Held in memory against the volunteer's own session, never written to disk:
     a preview is not a publish, and must not survive a restart as one. */
  const drafts = new Map();
  const DRAFT_TTL = 30 * 60 * 1000;
  const draftKey = (req) => readCookie(req) ?? "";
  const sweepDrafts = () => {
    const cutoff = Date.now() - DRAFT_TTL;
    for (const [k, v] of drafts) if (v.at < cutoff) drafts.delete(k);
  };

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
    const { username, password } = req.body ?? {};
    const userOk = String(username ?? "") === String(credentials?.username ?? randomBytes(8).toString("hex"));
    const passOk = await verifyPassword(String(password ?? ""), credentials ?? {});
    if (!userOk || !passOk) {
      return res.status(401).json({ error: "That username and password don't match our records." });
    }
    const token = issueToken(credentials.sessionSecret);
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}${secure ? "; Secure" : ""}`
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
      await archiveCurrent();     // file the edition this one replaces
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

  /* ---------- draft preview ---------- */
  app.post("/api/schedule/preview", requireSession, (req, res) => {
    sweepDrafts();
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "That doesn't look like a schedule." });
    }
    drafts.set(draftKey(req), { schedule: normalizeSchedule(body), at: Date.now() });
    res.json({ ok: true });
  });

  app.get("/api/schedule/preview", requireSession, (req, res) => {
    sweepDrafts();
    const held = drafts.get(draftKey(req));
    if (!held) return res.status(404).json({ error: "There is no draft to preview." });
    res.json(held.schedule);
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
