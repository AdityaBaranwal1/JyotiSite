/* ensure-deps.mjs — install the packages the paper needs if any are missing.
   Runs before `npm start` and `npm run build` (prestart, prebuild).
   GoDaddy's app hosting keeps node_modules from an earlier deploy and only
   installs when the folder is absent, so a package added since (mysql2) was
   never there and the server could not start. Where everything is already
   installed, as on the homelab, this only looks and says nothing.
   `--dev` also checks the build tools. */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const wanted = Object.keys({
  ...pkg.dependencies,
  ...(process.argv.includes("--dev") ? pkg.devDependencies : {}),
});
const missing = wanted.filter((name) => !existsSync(join(root, "node_modules", name, "package.json")));

if (missing.length) {
  console.log(`  Installing missing packages (${missing.join(", ")}) ...`);
  /* --include=dev: under NODE_ENV=production npm would otherwise leave out,
     and remove, the build tools, and the next build would fail instead. */
  execSync("npm install --include=dev --no-audit --no-fund", { cwd: root, stdio: "inherit" });
}
