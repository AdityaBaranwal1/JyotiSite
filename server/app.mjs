/* app.mjs — the community paper's little press room.
   Serves the static site, the /admin panel, and a schedule API.
   Public reads are open; writes require a volunteer session. */

import express from "express";
import { join, resolve, sep } from "node:path";
import { normalizeSchedule, isValidEvent } from "../js/data-adapter.js";
import { describeChanges } from "../js/changes.js";
import { verifyPassword, issueToken, verifyToken, makeRateLimiter } from "./auth.mjs";
import { fileStore } from "./store.mjs";

const COOKIE = "jyoti_session";
/* Volunteers stay signed in for two months on their own device: a password
   asked for every week is a password written on a sticky note. */
const SESSION_MS = 60 * 24 * 60 * 60 * 1000;

export function createApp({
  root,
  dataDir,
  store = fileStore(dataDir),   // the live paper and its earlier copies (store.mjs)
  credentials,          // { username, salt, hash, sessionSecret }
  loginWindowMs = 15 * 60 * 1000,
  loginMax = 10,
  keepVersions = 12,
  sittingMs = 15 * 60 * 1000,   // saves this close together are one sitting
  trustProxy = "loopback",
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  /* Public visitors arrive through Tailscale Funnel, which proxies from this
     machine. Trusting only a loopback proxy lets the login limiter see each
     visitor's own address, while nobody can claim one from outside. A host
     with its own proxy in front says which one (server.mjs). */
  app.set("trust proxy", trustProxy);

  /* Browsers must not second-guess a file's type, and links out of the paper
     carry no path. The desk may only be framed by the paper itself (its
     preview), so another site cannot lay it under a decoy and steer clicks.
     The rest of the paper stays frameable: the homelab dashboard shows it. */
  const DESK = /^\/admin(\.html)?$/;
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    if (DESK.test(req.path)) {
      res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  const allowLogin = makeRateLimiter({ windowMs: loginWindowMs, max: loginMax });

  /* ---------- earlier copies ----------
     Every save files the paper it replaces (once per sitting, below), so a
     volunteer who makes a mess can put the paper back as it was without
     needing a developer. */
  const VERSION_FILE = /^schedule-[0-9TZ.\-]+\.json$/;

  /* The desk saves every change the moment it is made, so a morning's work
     is many saves. Filing each one would bury the version a volunteer
     actually wants back ("how it was before I sat down") under a dozen
     near-copies. Within a sitting, the paper from before it is already on
     file and the save is not filed again. A restore always files. */
  const readCurrent = () => store.readSchedule();

  async function archiveCurrent({ sitting = false, current } = {}) {
    current ??= await readCurrent();
    if (current == null) return null;           // nothing saved yet
    if (sitting) {
      let savedAt = NaN;
      try { savedAt = Date.parse(JSON.parse(current).savedAt); } catch { /* file it */ }
      if (Date.now() - savedAt < sittingMs) return null;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `schedule-${stamp}.json`;
    await store.addEdition(name, current);

    // Keep the last `keepVersions`; older editions are of no use to anyone.
    const kept = (await store.listEditions()).filter((f) => VERSION_FILE.test(f)).sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - keepVersions))) {
      await store.dropEdition(old);
    }
    return name;
  }

  const writeSchedule = (text) => store.writeSchedule(text);

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
  const readPaper = async () => {
    const text = await readCurrent();
    if (text == null) throw new Error("no paper on file yet");
    return JSON.parse(text);
  };

  app.get("/api/schedule", async (_req, res) => {
    try {
      res.json(normalizeSchedule(await readPaper()));
    } catch {
      res.status(500).json({ error: "The schedule could not be read." });
    }
  });

  /* Raw (unresolved) copy for the editor, so "default" markers survive editing. */
  app.get("/api/schedule/raw", requireSession, async (_req, res) => {
    try {
      res.json(await readPaper());
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
    const cleanEvents = body.events.filter(isValidEvent);
    /* Standing programs and their exceptions carry the bulk of the schedule.
       An editor that only knows about one-off events must never be able to
       delete them by omission, so anything the body does not supply is
       carried over from the copy already on disk. */
    const current = await readCurrent();
    let onDisk = {};
    try { onDisk = JSON.parse(current); } catch { /* first run */ }

    const toSave = {
      savedAt: new Date().toISOString(),
      defaultZoomLink: String(body.defaultZoomLink ?? "").trim() || null,
      editorsNote: String(body.editorsNote ?? "").trim(),
      series: Array.isArray(body.series) ? body.series : (onDisk.series ?? []),
      exceptions: Array.isArray(body.exceptions) ? body.exceptions : (onDisk.exceptions ?? []),
      events: cleanEvents,
    };
    try {
      normalizeSchedule(toSave);                 // it must print without throwing
      await archiveCurrent({ sitting: true, current });   // file the paper this one replaces
      await writeSchedule(JSON.stringify(toSave, null, 2) + "\n");
      res.json({ ok: true, savedAt: toSave.savedAt });
    } catch {
      res.status(500).json({ error: "The schedule could not be saved. Nothing was changed." });
    }
  });

  /* Each earlier copy comes with what has changed since it, in plain words:
     exactly what putting it back would undo. */
  app.get("/api/versions", requireSession, async (_req, res) => {
    try {
      let names = [];
      names = (await store.listEditions()).filter((f) => VERSION_FILE.test(f));
      let now = {};
      try { now = JSON.parse(await readCurrent()); } catch { /* nothing saved yet */ }
      const editions = [];
      for (const name of names.sort().reverse()) {
        try {
          const raw = JSON.parse(await store.readEdition(name));
          editions.push({ id: name, savedAt: raw.savedAt ?? null, changes: describeChanges(raw, now) });
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
      const text = await store.readEdition(id);
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
     from the data directory so a rebuild is never needed to publish a week.
     That directory also holds the volunteer login (admin.json: the password
     hash and the secret that signs sessions) and the filed editions, so only
     the paper's own public files are let through; everything else is a 404.
     The paper itself comes from the store, which may be a database. */
  app.get("/data/schedule.json", async (_req, res) => {
    const text = await readCurrent();
    if (text == null) return res.sendStatus(404);
    res.set("Cache-Control", "no-cache").type("json").send(text);
  });
  const PUBLIC_DATA = /^\/(almanac\.json|crosswords\/[\w.-]+\.json)$/;
  app.use("/data", (req, res, next) => (PUBLIC_DATA.test(req.path) ? next() : res.sendStatus(404)),
    express.static(dataDir, {
      dotfiles: "deny",
      setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
    }));

  /* Unbuilt, the root is the source folder, and its data/ is the live data
     directory. The route above only catches that exact spelling: an encoded
     one ("/%64ata/admin.json", "/data%2fadmin.json") would reach the login
     through the static server below. So nothing that resolves into a data
     folder is served from there, however it is spelled. */
  const dataDirs = [resolve(dataDir), resolve(root, "data")];
  app.use((req, res, next) => {
    let target;
    try { target = resolve(root, "." + decodeURIComponent(req.path)); }
    catch { return res.sendStatus(400); }
    const inData = dataDirs.some((dir) => target === dir || target.startsWith(dir + sep));
    return inData ? res.sendStatus(404) : next();
  });

  app.get("/admin", (_req, res) => res.sendFile(join(root, "admin.html")));
  // Photos and the logo live in public/, which the build copies into dist/.
  // Run from the source folder (no build yet), they are served from there.
  app.use(express.static(join(root, "public")));
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
