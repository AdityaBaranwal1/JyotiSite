/* app.mjs — the community paper's little press room.
   Serves the static site, the /admin panel, and a schedule API.
   Public reads are open; writes require a volunteer session. */

import express from "express";
import { readFile, writeFile, rename } from "node:fs/promises";
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
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  const schedulePath = join(dataDir, "schedule.json");
  const allowLogin = makeRateLimiter({ windowMs: loginWindowMs, max: loginMax });

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
    const toSave = {
      savedAt: new Date().toISOString(),
      defaultZoomLink: String(body.defaultZoomLink ?? "").trim() || null,
      editorsNote: String(body.editorsNote ?? "").trim(),
      events: cleanEvents,
    };
    // sanity: it must normalize without throwing
    const normalized = normalizeSchedule(toSave);
    try {
      const tmp = schedulePath + ".tmp";
      await writeFile(tmp, JSON.stringify(toSave, null, 2) + "\n");
      await rename(tmp, schedulePath);
      res.json({ ok: true, savedAt: toSave.savedAt, kept: cleanEvents.length, normalizedEvents: normalized.events.length });
    } catch {
      res.status(500).json({ error: "The schedule could not be saved. Nothing was changed." });
    }
  });

  /* ---------- pages & static ---------- */
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
