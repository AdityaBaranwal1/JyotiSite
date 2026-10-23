/* server.mjs — run the paper: `node server.mjs`
   First time: `node tools/set-admin-password.mjs` to create the volunteer login. */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createApp } from "./server/app.mjs";

const here = dirname(fileURLToPath(import.meta.url));
/* Tests point this at a throwaway copy so a suite can publish freely without
   ever rewriting the real schedule. */
const dataDir = process.env.JYOTI_DATA_DIR
  ? resolve(process.env.JYOTI_DATA_DIR)
  : join(here, "data");

/* Serve the built paper when there is one, the source folder otherwise, so
   `node server.mjs` works both after `npm run build` and on a fresh clone. */
const dist = join(here, "dist");
const built = existsSync(join(dist, "index.html"));
const root = built ? dist : here;

let credentials = null;
try {
  credentials = JSON.parse(await readFile(join(dataDir, "admin.json"), "utf8"));
} catch {
  console.warn(
    "\n  No admin credentials found (data/admin.json)." +
    "\n  The site will serve, but /admin sign-in is disabled until you run:" +
    "\n    node tools/set-admin-password.mjs\n"
  );
}

const port = Number(process.env.PORT) || 3000;
/* The browser suite signs in dozens of times in a minute, which the login
   limiter is right to refuse. Tests raise it; the default protects the paper,
   and the limiter's own behaviour is covered in tests/server.test.mjs. */
const loginMax = Number(process.env.JYOTI_LOGIN_MAX) || 10;

createApp({ root, dataDir, credentials, loginMax }).listen(port, () => {
  if (!built) {
    console.log("  Serving source files (no dist/ yet). Run `npm run build` for the built paper.");
  }
  console.log(`Jeevan Jyoti is on the stands at http://localhost:${port}`);
  console.log(`The editor's desk is at http://localhost:${port}/admin`);
});
