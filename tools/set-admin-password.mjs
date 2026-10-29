/* set-admin-password.mjs — set the volunteers' shared password.
   Usage:  node tools/set-admin-password.mjs <password>
           read -rs PW && printf %s "$PW" | node tools/set-admin-password.mjs
   The second form keeps the password out of the shell's history.
   Writes data/admin.json (never commit that file). With --env it writes
   nothing and prints the same login as one JYOTI_ADMIN=… line instead, for a
   host's secrets page; treat that line like the password itself. Setting a
   new password signs every device out, so tell the volunteers before you
   change it. */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { text } from "node:stream/consumers";
import { hashPassword } from "../server/auth.mjs";

const asEnv = process.argv.includes("--env");
// The desk asks only for the password; an older "<username> <password>"
// call still works, and the username is kept for the record.
const args = process.argv.slice(2).filter((a) => a !== "--env");
const [username, given] = args.length > 1 ? args : ["volunteer", args[0]];
const password = given ?? (process.stdin.isTTY ? undefined : (await text(process.stdin)).replace(/\r?\n$/, ""));
if (!password) {
  console.log("Usage: node tools/set-admin-password.mjs [--env] <password>");
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

if (asEnv) {
  console.log(`JYOTI_ADMIN=${JSON.stringify(record)}`);
} else {
  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "admin.json");
  await writeFile(out, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  console.log("The volunteers' password is saved (data/admin.json). Keep that file out of git.");
}
