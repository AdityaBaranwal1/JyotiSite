import { defineConfig } from "vite";
import { resolve } from "node:path";

/* The paper is a multi-page site: each page is its own entry, so a reader
   loading the front page never downloads the admin panel or the puzzles.

   `data/` is deliberately NOT bundled. The schedule is runtime state the
   volunteers rewrite from the admin panel, so express serves it from disk at
   /data in both dev (via proxy below) and production. Bundling it would bake
   one week's paper into the build. */
const pages = [
  "index", "month", "about", "contact", "back-page", "admin", "theme-editor",
];

export default defineConfig({
  appType: "mpa",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: Object.fromEntries(
        pages.map((p) => [p, resolve(import.meta.dirname, `${p}.html`)])
      ),
    },
  },
  server: {
    port: 5175,          // 5173 is spoken for elsewhere on this machine
    strictPort: true,
    proxy: {
      // The press room stays on express in dev; Vite only owns the front end.
      "/api": { target: "http://localhost:8090", changeOrigin: true },
    },
  },
});
