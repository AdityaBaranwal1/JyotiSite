/* fetch-crosswords.mjs — one-time helper to vendor a curated set of the
   *gentlest* NYT crosswords (Monday & Tuesday only) from the public
   doshea/nyt_crosswords repo into data/crosswords/.

   Run:  node tools/fetch-crosswords.mjs [count]

   Why vendored? So the live site has no runtime dependency on a third-party
   repo, and so we can guarantee only easy (Mon/Tue) puzzles reach our seniors.

   Licensing: these are copyrighted NYT puzzles and the source repo ships no
   license. This is acceptable for an internal/community site; swap to original
   or licensed puzzles before any wide public launch (the player is
   source-agnostic — only this folder changes). */

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "crosswords");
const BASE = "https://raw.githubusercontent.com/doshea/nyt_crosswords/master";
const WANT = Number(process.argv[2] || 40);
const KEEP_DOW = new Set(["Monday", "Tuesday"]);

const pad = (n) => String(n).padStart(2, "0");

/* All Mondays & Tuesdays in a span the repo covers (after the mid-2016 gap,
   through 2017). Iterated newest-first so we prefer more recent puzzles. */
function candidateDates() {
  const dates = [];
  const start = new Date(2016, 4, 2), end = new Date(2017, 11, 31);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay(); // 1 = Mon, 2 = Tue
    if (wd === 1 || wd === 2) dates.push(new Date(d));
  }
  return dates.reverse();
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const puzzles = [];
  let saved = 0;

  for (const d of candidateDates()) {
    if (saved >= WANT) break;
    const y = d.getFullYear(), m = pad(d.getMonth() + 1), day = pad(d.getDate());
    const url = `${BASE}/${y}/${m}/${day}.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      if (!KEEP_DOW.has(json.dow)) continue;
      if (!json.size || !Array.isArray(json.grid)) continue;
      const name = `${y}-${m}-${day}.json`;
      await writeFile(join(OUT, name), JSON.stringify(json));
      puzzles.push(name);
      saved++;
      process.stdout.write(`  saved ${name} (${json.dow})\n`);
    } catch (e) {
      /* skip network hiccups silently and keep going */
    }
  }

  await writeFile(
    join(OUT, "manifest.json"),
    JSON.stringify({ generated: new Date().toISOString().slice(0, 10), puzzles }, null, 2)
  );
  console.log(`\nDone. Vendored ${saved} Monday/Tuesday puzzles into data/crosswords/.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
