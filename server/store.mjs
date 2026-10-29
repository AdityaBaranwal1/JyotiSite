/* store.mjs — where the live paper and its earlier copies are kept.
   Two keepers with the same six calls: files in the data folder (the
   homelab, tests), or MySQL on a host that redeploys from GitHub. There a
   file would not do: data/schedule.json is in the repository, so each pull
   would put the committed paper back over the volunteers' saves. */

import { readFile, writeFile, rename, readdir, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

/* When a paper was last saved; one with no stamp counts as oldest. */
const savedAt = (text) => {
  try { return Date.parse(JSON.parse(text).savedAt) || 0; } catch { return 0; }
};

const missing = (name) => Object.assign(new Error(`${name} is not on file`), { code: "ENOENT" });

export function fileStore(dataDir) {
  const schedulePath = join(dataDir, "schedule.json");
  const versionsDir = join(dataDir, "versions");
  return {
    readSchedule: () => readFile(schedulePath, "utf8").catch(() => null),
    async writeSchedule(text) {
      const tmp = schedulePath + ".tmp";
      await writeFile(tmp, text);
      await rename(tmp, schedulePath);
    },
    listEditions: () => readdir(versionsDir).catch(() => []),
    readEdition: (name) => readFile(join(versionsDir, name), "utf8"),
    async addEdition(name, text) {
      await mkdir(versionsDir, { recursive: true });
      await writeFile(join(versionsDir, name), text);
    },
    dropEdition: (name) => unlink(join(versionsDir, name)).catch(() => {}),
  };
}

/* The paper is one row; each earlier copy is a row under its file name, so
   everything above this file reads the same whichever keeper is in use.
   On first start the table is empty and takes the paper from the data
   folder. After that the database is the paper, except that a copy in the
   repository saved later than it (a paper edited elsewhere and pushed)
   takes its place on the next start, with the one it replaces filed as an
   earlier copy so the swap can be undone from the desk. */
export async function mysqlStore({ host, port, user, password, database }, { seedFile } = {}) {
  const { createPool } = await import("mysql2/promise");
  const db = createPool({
    host, port: Number(port) || 3306, user, password, database,
    connectionLimit: 3, idleTimeout: 60_000, enableKeepAlive: true, charset: "utf8mb4",
  });
  await db.query(`CREATE TABLE IF NOT EXISTS jyoti_paper (
    id TINYINT PRIMARY KEY, body MEDIUMTEXT NOT NULL
  ) DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS jyoti_editions (
    name VARCHAR(64) PRIMARY KEY, body MEDIUMTEXT NOT NULL
  ) DEFAULT CHARSET=utf8mb4`);
  const one = async (sql, args) => (await db.query(sql, args))[0][0]?.body ?? null;

  const seed = seedFile && await readFile(seedFile, "utf8").catch(() => null);
  if (seed != null) {
    const kept = await one("SELECT body FROM jyoti_paper WHERE id = 1");
    if (kept == null) {
      await db.query("INSERT IGNORE INTO jyoti_paper (id, body) VALUES (1, ?)", [seed]);
    } else if (savedAt(seed) > savedAt(kept)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await db.query("INSERT INTO jyoti_editions (name, body) VALUES (?, ?)", [`schedule-${stamp}.json`, kept]);
      await db.query("UPDATE jyoti_paper SET body = ? WHERE id = 1", [seed]);
    }
  }

  return {
    readSchedule: () => one("SELECT body FROM jyoti_paper WHERE id = 1"),
    async writeSchedule(text) {
      await db.query("INSERT INTO jyoti_paper (id, body) VALUES (1, ?) ON DUPLICATE KEY UPDATE body = VALUES(body)", [text]);
    },
    listEditions: async () => (await db.query("SELECT name FROM jyoti_editions"))[0].map((r) => r.name),
    async readEdition(name) {
      const body = await one("SELECT body FROM jyoti_editions WHERE name = ?", [name]);
      if (body == null) throw missing(name);
      return body;
    },
    async addEdition(name, text) {
      await db.query("INSERT INTO jyoti_editions (name, body) VALUES (?, ?)", [name, text]);
    },
    async dropEdition(name) {
      await db.query("DELETE FROM jyoti_editions WHERE name = ?", [name]);
    },
    close: () => db.end(),
  };
}
