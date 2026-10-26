/* Builds a scratch data directory before the suite runs, so tests that
   publish cannot touch the paper's own schedule.

   The schedule itself comes from a frozen fixture, not data/: volunteers
   publish to data/schedule.json, and the suite must not change its answers
   (or its screenshots) every time they do. The live editions history is left
   behind for the same reason. */
import { cp, rm, mkdir } from "node:fs/promises";

const SRC = "data", DEST = ".tmp-test-data";
const SCHEDULE = "tests/fixtures/schedule.json";

export default async function globalSetup() {
  await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });
  await cp(SRC, DEST, { recursive: true, filter: (path) => !/[\\/]versions([\\/]|$)/.test(path) });
  await cp(SCHEDULE, `${DEST}/schedule.json`);
}
