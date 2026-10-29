import { test, before, after } from "node:test";
import { request } from "node:http";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scrypt } from "node:crypto";
import { hashPassword, verifyPassword, loginProblem } from "../server/auth.mjs";
import { createApp } from "../server/app.mjs";

const siteRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------- auth unit ---------- */

test("hashPassword/verifyPassword: roundtrip accepts the right password only", async () => {
  const rec = await hashPassword("chai-and-sudoku");
  assert.ok(rec.salt && rec.hash);
  assert.equal(await verifyPassword("chai-and-sudoku", rec), true);
  assert.equal(await verifyPassword("wrong-guess", rec), false);
});

test("a login hashed before the stronger settings still signs in", async () => {
  // Node's scrypt defaults, which every record made before had no field for.
  const salt = "00112233445566778899aabbccddeeff";
  const hash = await new Promise((res, rej) =>
    scrypt("old-password", salt, 64, (err, key) => (err ? rej(err) : res(key.toString("hex")))));
  assert.equal(await verifyPassword("old-password", { salt, hash }), true);
  assert.equal(await verifyPassword("wrong-guess", { salt, hash }), false);
  assert.deepEqual((await hashPassword("x")).scrypt, { N: 16384, r: 8, p: 5 }, "new records say how they were made");
});

test("loginProblem: only a whole record with a long session secret is usable", async () => {
  const good = { username: "volunteer", ...(await hashPassword("pw-12345678")), sessionSecret: "a".repeat(64) };
  assert.equal(loginProblem(good), null);
  assert.equal(loginProblem({ ...good, scrypt: undefined }), null, "older records are fine");
  assert.match(loginProblem({ ...good, sessionSecret: "short" }), /session secret/);
  assert.match(loginProblem({ ...good, hash: "" }), /hash/);
  assert.match(loginProblem({ ...good, scrypt: { N: 2 ** 30, r: 8, p: 1 } }), /settings/);
  assert.match(loginProblem("{}"), /not a login record/);
});

/* ---------- API integration (real HTTP against an ephemeral port) ---------- */

let server, base, dataDir;

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "jyoti-test-"));
  await writeFile(join(dataDir, "schedule.json"), JSON.stringify({
    defaultZoomLink: "https://zoom.us/j/999",
    editorsNote: "hello",
    events: [{ title: "Yoga", date: "2026-06-08", startTime: "10:00", zoomLink: "default" }],
  }));
  const credentials = {
    username: "volunteer",
    ...(await hashPassword("correct-horse")),
    sessionSecret: "test-secret-please-ignore",
  };
  const app = createApp({ root: siteRoot, dataDir, credentials, loginWindowMs: 500, loginMax: 3 });
  await new Promise((res) => { server = app.listen(0, res); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test("GET / serves the front page", async () => {
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Jeevan Jyoti/);
});

test("GET /api/schedule is public and normalized (default zoom resolved)", async () => {
  const res = await fetch(base + "/api/schedule");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.events[0].zoomLink, "https://zoom.us/j/999");
});

test("PUT /api/schedule without a session is rejected 401", async () => {
  const res = await fetch(base + "/api/schedule", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: [] }),
  });
  assert.equal(res.status, 401);
});

test("login: wrong password 401, right password sets a session cookie that authorizes PUT", async () => {
  const bad = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "volunteer", password: "nope" }),
  });
  assert.equal(bad.status, 401);

  const good = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "volunteer", password: "correct-horse" }),
  });
  assert.equal(good.status, 200);
  const cookie = good.headers.get("set-cookie");
  assert.ok(cookie?.includes("HttpOnly"), "session cookie must be HttpOnly");

  const put = await fetch(base + "/api/schedule", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      defaultZoomLink: "https://zoom.us/j/123",
      editorsNote: "updated note",
      events: [
        { title: "Bhajan", date: "2026-06-19", startTime: "11:00", zoomLink: "default" },
        { title: "broken row ignored" },
      ],
    }),
  });
  assert.equal(put.status, 200);
  const saved = JSON.parse(await readFile(join(dataDir, "schedule.json"), "utf8"));
  assert.equal(saved.events.length, 1, "invalid rows dropped before saving");
  assert.equal(saved.events[0].title, "Bhajan");
  assert.ok(saved.savedAt, "server stamps savedAt");

  // a tampered cookie must not pass
  const forged = cookie.replace(/=[^;]+/, "=1999999999.deadbeef");
  const evil = await fetch(base + "/api/schedule", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: forged },
    body: JSON.stringify({ events: [] }),
  });
  assert.equal(evil.status, 401);
});

test("login rate limit: repeated failures get 429", async () => {
  const attempt = () => fetch(base + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "volunteer", password: "spam" }),
  });
  let last;
  for (let i = 0; i < 5; i++) last = await attempt();
  assert.equal(last.status, 429);
});

test("PUT /api/schedule keeps standing programs an older editor never sent", async () => {
  // Seed a schedule whose bulk lives in series + exceptions.
  await writeFile(join(dataDir, "schedule.json"), JSON.stringify({
    defaultZoomLink: "https://zoom.us/j/999",
    editorsNote: "hello",
    series: [{ id: "yoga", title: "Yoga", category: "yoga", startTime: "10:00",
               endTime: "11:00", rrule: "FREQ=WEEKLY;BYDAY=MO",
               from: "2026-06-08", until: "2026-06-29" }],
    exceptions: [{ seriesId: "yoga", date: "2026-06-15", cancelled: true }],
    events: [],
  }));

  // The rate-limit test above spends this IP's login budget; the window is
  // short, so wait it out rather than racing it.
  await new Promise((r) => setTimeout(r, 700));
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "volunteer", password: "correct-horse" }),
  });
  assert.equal(login.status, 200, "volunteer should be able to sign in");
  const cookie = login.headers.getSetCookie().join("; ");

  // An editor that only understands one-off events publishes.
  const res = await fetch(base + "/api/schedule", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      defaultZoomLink: "https://zoom.us/j/999",
      editorsNote: "updated",
      events: [{ title: "Diwali Social", date: "2026-06-20", startTime: "16:00" }],
    }),
  });
  assert.equal(res.status, 200);

  const saved = JSON.parse(await readFile(join(dataDir, "schedule.json"), "utf8"));
  assert.equal(saved.series.length, 1, "standing programs must survive");
  assert.equal(saved.exceptions.length, 1, "exceptions must survive");
  assert.equal(saved.editorsNote, "updated");
});

test("GET /admin serves the admin page", async () => {
  const res = await fetch(base + "/admin");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Editor/i);
});

/* ---------- editions: one per sitting ---------- */

async function freshDesk(opts) {
  const dir = await mkdtemp(join(tmpdir(), "jyoti-ed-"));
  await writeFile(join(dir, "schedule.json"), JSON.stringify({
    savedAt: "2026-01-01T00:00:00.000Z", editorsNote: "first", events: [],
  }));
  const credentials = { username: "volunteer", ...(await hashPassword("pw-12345678")), sessionSecret: "s" };
  const app = createApp({ root: siteRoot, dataDir: dir, credentials, ...opts });
  const srv = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  const login = await fetch(url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "pw-12345678" }),
  });
  assert.equal(login.status, 200, "the password alone signs a volunteer in");
  const cookie = login.headers.getSetCookie().join("; ");
  const save = (note) => fetch(url + "/api/schedule", {
    method: "PUT", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ editorsNote: note, events: [] }),
  });
  const editions = async () =>
    (await (await fetch(url + "/api/versions", { headers: { cookie } })).json()).editions;
  return { srv, save, editions, url, cookie };
}

test("saves in one sitting file the paper from before it only once", async () => {
  const d = await freshDesk();
  try {
    for (const n of [1, 2, 3, 4]) assert.equal((await d.save(`note ${n}`)).status, 200);
    const eds = await d.editions();
    assert.equal(eds.length, 1, "four quick saves are one sitting");
    assert.equal(eds[0].savedAt, "2026-01-01T00:00:00.000Z", "and the filed paper is the one from before it");
  } finally { d.srv.close(); }
});

test("each earlier copy says what has changed since it", async () => {
  const d = await freshDesk();
  try {
    await d.save("second");
    const [ed] = await d.editions();
    assert.deepEqual(ed.changes, ["The note on the front page was rewritten"]);
  } finally { d.srv.close(); }
});

test("a sitting ends after the quiet gap, and only the last 12 are kept", async () => {
  const d = await freshDesk({ sittingMs: 0 });
  try {
    for (let n = 0; n < 14; n++) await d.save(`note ${n}`);
    assert.equal((await d.editions()).length, 12);
  } finally { d.srv.close(); }
});

test("a session lasts two months", async () => {
  const d = await freshDesk();
  try {
    const login = await fetch(d.url + "/api/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "pw-12345678" }),
    });
    assert.match(login.headers.getSetCookie()[0], /Max-Age=5184000/);
  } finally { d.srv.close(); }
});

test("the data folder serves the paper, never the login or the filed editions", async () => {
  await writeFile(join(dataDir, "almanac.json"), "{}");
  await writeFile(join(dataDir, "admin.json"), JSON.stringify({ sessionSecret: "do-not-serve" }));
  for (const path of ["/data/schedule.json", "/data/almanac.json"]) {
    const res = await fetch(base + path);
    assert.notEqual(res.status, 404, `${path} is the paper and must be served`);
  }
  // Sent byte for byte: fetch() would tidy "../" away before it left.
  const rawStatus = (path) => new Promise((resolve, reject) => {
    request(base + "/", { path }, (res) => { res.resume(); resolve(res.statusCode); })
      .on("error", reject).end();
  });
  for (const path of ["/data/admin.json", "/data/versions/x.json", "/data/../admin.json",
                      "/data/%2e%2e/admin.json", "/data/.env", "/data/crosswords/../admin.json",
                      "/data/crosswords/%2e%2e/admin.json"]) {
    assert.equal(await rawStatus(path), 404, `${path} must not be served`);
  }
});

test("served unbuilt, no spelling of the data folder reaches the login", async () => {
  // The source folder as root, its data/ the data directory: how a fresh
  // clone runs before `npm run build`.
  const root = await mkdtemp(join(tmpdir(), "jyoti-src-"));
  await mkdir(join(root, "data", "versions"), { recursive: true });
  await writeFile(join(root, "index.html"), "<h1>Jeevan Jyoti</h1>");
  await writeFile(join(root, "data", "schedule.json"), "{}");
  await writeFile(join(root, "data", "admin.json"), JSON.stringify({ sessionSecret: "do-not-serve" }));
  await writeFile(join(root, "data", "versions", "schedule-1.json"), "{}");
  const app = createApp({ root, dataDir: join(root, "data"), credentials: null });
  const srv = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  const rawStatus = (path) => new Promise((resolve, reject) => {
    request(url + "/", { path }, (res) => { res.resume(); resolve(res.statusCode); })
      .on("error", reject).end();
  });
  try {
    assert.equal(await rawStatus("/index.html"), 200);
    assert.equal(await rawStatus("/data/schedule.json"), 200);
    for (const path of ["/%64ata/admin.json", "/data%2fadmin.json", "/%64ata%2fadmin.json",
                        "/x/..%2f%64ata/admin.json", "/%64ata/versions/schedule-1.json", "/%64ata/"]) {
      assert.equal(await rawStatus(path), 404, `${path} must not be served`);
    }
    assert.equal(await rawStatus("/%E0%A4"), 400, "a broken encoding is refused, not crashed on");
  } finally { srv.close(); }
});

test("the desk cannot be framed by another site; the paper still can", async () => {
  for (const path of ["/admin", "/admin.html"]) {
    const res = await fetch(base + path);
    assert.equal(res.headers.get("content-security-policy"), "frame-ancestors 'self'", path);
    assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN", path);
  }
  const front = await fetch(base + "/");
  assert.equal(front.headers.get("content-security-policy"), null);
  assert.equal(front.headers.get("x-content-type-options"), "nosniff");
  assert.equal(front.headers.get("referrer-policy"), "same-origin");
});
