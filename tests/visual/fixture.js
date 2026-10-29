/* Builds a scratch data directory before the suite runs, so tests that
   publish cannot touch the paper's own schedule.

   The schedule itself comes from a frozen fixture, not data/: volunteers
   publish to data/schedule.json, and the suite must not change its answers
   (or its screenshots) every time they do. The live editions history is left
   behind for the same reason, and so is the real volunteer login: the suite
   signs in with its own throwaway password. */
import { cp, rm, mkdir, writeFile } from "node:fs/promises";
import { hashPassword } from "../../server/auth.mjs";

const SRC = "data", DEST = ".tmp-test-data";
const SCHEDULE = "tests/fixtures/schedule.json";

export default async function globalSetup() {
  await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });
  await cp(SRC, DEST, {
    recursive: true,
    filter: (path) => !/[\\/](versions|admin\.json)([\\/]|$)/.test(path),
  });
  await cp(SCHEDULE, `${DEST}/schedule.json`);
  await writeFile(`${DEST}/admin.json`, JSON.stringify({
    username: "volunteer",
    ...(await hashPassword("localdevpassword")),
    sessionSecret: "visual-suite-only-not-a-real-secret",
  }));
}
