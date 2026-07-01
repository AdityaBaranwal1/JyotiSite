/* server.mjs — run the paper: `node server.mjs`
   First time: `node tools/set-admin-password.mjs` to create the volunteer login. */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApp } from "./server/app.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, "data");

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
createApp({ root, dataDir, credentials }).listen(port, () => {
  console.log(`Jeevan Jyoti is on the stands at http://localhost:${port}`);
  console.log(`The editor's desk is at http://localhost:${port}/admin`);
});
