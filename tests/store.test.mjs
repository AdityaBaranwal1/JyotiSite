/* Both keepers of the paper must behave the same. The MySQL one runs when
   JYOTI_TEST_MYSQL names a throwaway database, e.g.
   JYOTI_TEST_MYSQL=mysql://jyoti:jyoti-test@127.0.0.1:3307/jyoti_test npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileStore, mysqlStore } from "../server/store.mjs";
import { hashPassword } from "../server/auth.mjs";
import { createApp } from "../server/app.mjs";

const mysqlUrl = process.env.JYOTI_TEST_MYSQL;
const fromUrl = (u) => {
  const { hostname, port, username, password, pathname } = new URL(u);
  return { host: hostname, port, user: decodeURIComponent(username),
           password: decodeURIComponent(password), database: pathname.slice(1) };
};

async function seeded() {
  const dir = await mkdtemp(join(tmpdir(), "jyoti-store-"));
  await writeFile(join(dir, "schedule.json"), JSON.stringify({ editorsNote: "from the file", events: [] }));
  return dir;
}

const keepers = [["files", async () => { const dir = await seeded(); return { dir, store: fileStore(dir) }; }]];
if (mysqlUrl) {
  keepers.push(["MySQL", async () => {
    const dir = await seeded();
    const config = fromUrl(mysqlUrl);
    // Start from empty tables so the seed is tested every run.
    const wipe = await mysqlStore(config);
    await wipe.close();
    const { createConnection } = await import("mysql2/promise");
    const c = await createConnection(config);
    await c.query("DELETE FROM jyoti_paper"); await c.query("DELETE FROM jyoti_editions");
    await c.end();
    return { dir, store: await mysqlStore(config, { seedFile: join(dir, "schedule.json") }) };
  }]);
}

for (const [label, make] of keepers) {
  test(`${label}: the paper, its earlier copies, and a missing one`, async () => {
    const { store } = await make();
    try {
      assert.match(await store.readSchedule(), /from the file/, "starts from the data folder's paper");
      await store.writeSchedule('{"editorsNote":"नमस्ते, saved"}');
      assert.equal(await store.readSchedule(), '{"editorsNote":"नमस्ते, saved"}', "Hindi survives the round trip");
      await store.addEdition("schedule-1.json", "one");
      await store.addEdition("schedule-2.json", "two");
      assert.deepEqual((await store.listEditions()).sort(), ["schedule-1.json", "schedule-2.json"]);
      assert.equal(await store.readEdition("schedule-2.json"), "two");
      await store.dropEdition("schedule-1.json");
      assert.deepEqual(await store.listEditions(), ["schedule-2.json"]);
      await assert.rejects(store.readEdition("schedule-1.json"), { code: "ENOENT" });
    } finally { await store.close?.(); }
  });

  test(`${label}: the desk saves, files and restores through it`, async () => {
    const { dir, store } = await make();
    const credentials = { username: "volunteer", ...(await hashPassword("pw-12345678")), sessionSecret: "s".repeat(32) };
    const app = createApp({ root: join(import.meta.dirname, ".."), dataDir: dir, store, credentials, sittingMs: 0 });
    const srv = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
    const url = `http://127.0.0.1:${srv.address().port}`;
    try {
      const login = await fetch(url + "/api/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "pw-12345678" }),
      });
      const cookie = login.headers.getSetCookie().join("; ");
      const save = await fetch(url + "/api/schedule", {
        method: "PUT", headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ editorsNote: "after the save", events: [] }),
      });
      assert.equal(save.status, 200);
      const served = await fetch(url + "/data/schedule.json");
      assert.equal(served.headers.get("cache-control"), "no-cache");
      assert.equal((await served.json()).editorsNote, "after the save", "readers see the save at once");

      const { editions } = await (await fetch(url + "/api/versions", { headers: { cookie } })).json();
      assert.equal(editions.length, 1, "the paper it replaced was filed");
      const restore = await fetch(url + "/api/versions/restore", {
        method: "POST", headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ id: editions[0].id }),
      });
      assert.equal(restore.status, 200);
      assert.equal((await (await fetch(url + "/data/schedule.json")).json()).editorsNote, "from the file");
    } finally { srv.close(); await store.close?.(); }
  });
}

if (mysqlUrl) {
  test("MySQL: a newer paper in the repository replaces the database's, which is filed", async () => {
    const config = fromUrl(mysqlUrl);
    const dir = await mkdtemp(join(tmpdir(), "jyoti-store-"));
    const file = join(dir, "schedule.json");
    const { createConnection } = await import("mysql2/promise");
    const c = await createConnection(config);
    await c.query("DELETE FROM jyoti_paper"); await c.query("DELETE FROM jyoti_editions");
    await c.end();

    await writeFile(file, JSON.stringify({ savedAt: "2026-10-01T00:00:00Z", editorsNote: "first" }));
    let store = await mysqlStore(config, { seedFile: file });
    await store.writeSchedule(JSON.stringify({ savedAt: "2026-10-10T00:00:00Z", editorsNote: "edited on the host" }));
    await store.close();

    // An older paper in the repository leaves the host's edits alone.
    store = await mysqlStore(config, { seedFile: file });
    assert.match(await store.readSchedule(), /edited on the host/);
    assert.deepEqual(await store.listEditions(), []);
    await store.close();

    // A newer one takes over, and the host's copy is kept.
    await writeFile(file, JSON.stringify({ savedAt: "2026-10-20T00:00:00Z", editorsNote: "pushed from the laptop" }));
    store = await mysqlStore(config, { seedFile: file });
    try {
      assert.match(await store.readSchedule(), /pushed from the laptop/);
      const [filed] = await store.listEditions();
      assert.match(await store.readEdition(filed), /edited on the host/);
    } finally { await store.close(); }
  });
}
