/* set-admin-password.mjs — create or update the volunteer login.
   Usage:  node tools/set-admin-password.mjs <username> <password>
   Writes data/admin.json (never commit that file). */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../server/auth.mjs";

const [, , username, password] = process.argv;
if (!username || !password) {
  console.log("Usage: node tools/set-admin-password.mjs <username> <password>");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Please pick a password of at least 8 characters.");
  process.exit(1);
}

const record = {
  username,
  ...(await hashPassword(password)),
  sessionSecret: randomBytes(32).toString("hex"),
};

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "admin.json");
await writeFile(out, JSON.stringify(record, null, 2) + "\n");
console.log(`Volunteer login saved for "${username}" (data/admin.json). Keep it out of git.`);
