import { test, expect } from "@playwright/test";

/* The paper's motion is decoration on top of a page that must work without
   it. These hold it to that: Reduce Motion means no motion at all, nothing
   is left half-printed, and nothing in flight ever makes a phone scroll
   sideways. */
const WHEN = new Date("2026-09-19T15:30:00-04:00");
const PAGES = ["/", "/month.html", "/back-page.html", "/about.html", "/contact.html"];

test.describe("With Reduce Motion on", () => {
  test.use({ reducedMotion: "reduce" });

  for (const path of PAGES) {
    test(`${path} does not move at all`, async ({ page }) => {
      await page.clock.setFixedTime(WHEN);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const running = await page.evaluate(() =>
        document.getAnimations().map((a) => a.animationName || a.id || "animation"));
      expect(running, "no CSS animation may run").toEqual([]);
      await expect(page.locator("hr.is-waiting"), "no rule may wait to be drawn").toHaveCount(0);
    });
  }
});

test("once the press has run, every listing and stamp is fully inked", async ({ page }) => {
  await page.clock.setFixedTime(WHEN);
  await page.goto("/");
  await page.waitForFunction(() => document.querySelectorAll(".listing").length > 0);
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const faint = await page.evaluate(() =>
    [...document.querySelectorAll(".day-section, .stamp, .nameplate .name, .weather-ear")]
      .filter((e) => e.checkVisibility() && getComputedStyle(e).opacity !== "1").length);
  expect(faint).toBe(0);
});

test("the second page of a visit opens already printed", async ({ page }) => {
  await page.goto("/");
  await page.goto("/about.html");
  await expect(page.locator("html")).toHaveClass(/jj-pressed/);
});

for (const width of [360, 400]) {
  test(`nothing in flight makes a ${width}px phone scroll sideways`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.clock.setFixedTime(WHEN);
    for (const path of PAGES) {
      await page.goto(path, { waitUntil: "commit" });
      // Animations start once the styles are in, and a browser draws nothing
      // before then, so the unstyled first instant (when a photo is still its
      // file's full width) is not something any reader sees.
      await page.waitForFunction(() =>
        [...document.querySelectorAll('link[rel="stylesheet"]')].every((l) => l.sheet));
      let worst = 0;
      for (let i = 0; i < 18; i++) {
        const over = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => 0);
        worst = Math.max(worst, over);
        await page.waitForTimeout(60);
      }
      expect(worst, `${path} overflowed while animating`).toBeLessThanOrEqual(0);
    }
  });
}

test("the desk's sign-out button stays hidden until someone signs in", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.locator("#login-view")).toBeVisible();
  await expect(page.locator("#signout")).toBeHidden();
});
