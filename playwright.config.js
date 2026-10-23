import { defineConfig, devices } from "@playwright/test";

/* The paper's whole value is that it stays legible for low-vision readers, so
   the regression suite is visual: it builds the site, serves it the way a
   reader gets it, and compares renderings pixel for pixel. */
export default defineConfig({
  testDir: "tests/visual",
  snapshotPathTemplate: "{testDir}/__snapshots__/{arg}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  /* The desk specs publish into the shared fixture, so they must not run
     beside the reader specs that read it. The whole suite is a few seconds
     serially; parallelism would only buy a race. */
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8193" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  /* The desk tests really do press Publish, so the server under test is given
     a disposable copy of the data directory. The paper's own schedule is never
     touched by a test run. */
  globalSetup: "./tests/visual/fixture.js",
  webServer: {
    command: "npm run build && PORT=8193 JYOTI_DATA_DIR=.tmp-test-data JYOTI_LOGIN_MAX=500 node server.mjs",
    url: "http://127.0.0.1:8193/month.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
