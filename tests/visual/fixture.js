/* Copies the real data directory to a scratch copy before the suite runs, so
   tests that publish cannot touch the paper's own schedule. */
import { cp, rm, mkdir } from "node:fs/promises";

const SRC = "data", DEST = ".tmp-test-data";

export default async function globalSetup() {
  await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });
  await cp(SRC, DEST, { recursive: true });
}
