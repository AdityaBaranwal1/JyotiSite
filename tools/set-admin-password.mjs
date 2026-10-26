/* set-admin-password.mjs — set the volunteers' shared password.
   Usage:  node tools/set-admin-password.mjs <password>
   Writes data/admin.json (never commit that file). Setting a new password
   signs every device out, so tell the volunteers before you change it. */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../server/auth.mjs";

// The desk asks only for the password; an older "<username> <password>"
// call still works, and the username is kept for the record.
const args = process.argv.slice(2);
const [username, password] = args.length > 1 ? args : ["volunteer", args[0]];
if (!password) {
  console.log("Usage: node tools/set-admin-password.mjs <password>");
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
console.log("The volunteers' password is saved (data/admin.json). Keep that file out of git.");
