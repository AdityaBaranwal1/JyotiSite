/* server.mjs — run the paper: `node server.mjs`
   First time: `node tools/set-admin-password.mjs` to create the volunteer login. */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createApp } from "./server/app.mjs";
import { loginProblem } from "./server/auth.mjs";

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

/* The volunteer login: the hash of the shared password and the secret that
   signs sessions. A host that builds from GitHub has no data/admin.json (it
   is never committed), so the same record can come from the JYOTI_ADMIN
   secret instead: the file's contents on one line, made with
   `node tools/set-admin-password.mjs --env`. Neither is ever printed. */
const fromSecret = Boolean(process.env.JYOTI_ADMIN);
let credentials = null;
try {
  credentials = JSON.parse(fromSecret
    ? process.env.JYOTI_ADMIN
    : await readFile(join(dataDir, "admin.json"), "utf8"));
} catch {
  console.warn(fromSecret
    ? "\n  JYOTI_ADMIN is set but is not readable JSON. /admin sign-in is disabled.\n"
    : "\n  No admin credentials found (data/admin.json)." +
      "\n  The site will serve, but /admin sign-in is disabled until you run:" +
      "\n    node tools/set-admin-password.mjs\n");
}
const problem = credentials && loginProblem(credentials);
if (problem) {
  console.warn(`\n  The volunteer login (${fromSecret ? "JYOTI_ADMIN" : "data/admin.json"}) is not usable: ${problem}.` +
    "\n  /admin sign-in is disabled until it is set again with tools/set-admin-password.mjs.\n");
  credentials = null;
}

const port = Number(process.env.PORT) || 3000;
/* The browser suite signs in dozens of times in a minute, which the login
   limiter is right to refuse. Tests raise it; the default protects the paper,
   and the limiter's own behaviour is covered in tests/server.test.mjs. */
const loginMax = Number(process.env.JYOTI_LOGIN_MAX) || 10;
/* Which proxies may tell the server a visitor's address. Tailscale Funnel
   proxies from this machine ("loopback", the default); a host whose own proxy
   sits elsewhere names it here, as Express takes it: a hop count ("1") or
   addresses. Trust too much and the login limiter can be dodged with a
   made-up X-Forwarded-For; too little and every visitor shares one budget. */
const proxyEnv = process.env.JYOTI_TRUST_PROXY;
const trustProxy = !proxyEnv ? "loopback" : /^\d+$/.test(proxyEnv) ? Number(proxyEnv) : proxyEnv;

createApp({ root, dataDir, credentials, loginMax, trustProxy }).listen(port, () => {
  if (!built) {
    console.log("  Serving source files (no dist/ yet). Run `npm run build` for the built paper.");
  }
  console.log(`Jeevan Jyoti is on the stands at http://localhost:${port}`);
  console.log(`The editor's desk is at http://localhost:${port}/admin`);
});
