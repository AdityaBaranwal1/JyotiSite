import { test, expect } from "@playwright/test";

/* The schedule is dated data and "today" moves, so every run pins the clock.
   Sept 19 2026 sits mid-month with a cancellation, a new class and a holiday
   closure around it — the month the timetable has to get right. */
const WHEN = new Date("2026-09-19T15:30:00-04:00");
const freeze = async (page) => page.clock.setFixedTime(WHEN);

/* fonts.ready only waits for faces already asked for; a bold weight first
   needed mid-render can land after it, and the picture comes out in a
   stand-in face. Loading every declared face first makes each run the same. */
const fontsLoaded = (page) =>
  page.evaluate(async () => {
    await Promise.all([...document.fonts].map((f) => f.load().catch(() => {})));
    await document.fonts.ready;
  });

const settled = async (page) => {
  await page.waitForFunction(() => document.querySelectorAll(".tt-day").length > 0);
  await fontsLoaded(page);
};

test.describe("The Month Ahead", () => {
  test.beforeEach(async ({ page }) => freeze(page));

  test("timetable renders the month at desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/month.html");
    await settled(page);
    await expect(page.locator(".timetable")).toHaveScreenshot("timetable-wide.png");
  });

  test("collapses to one day per row on a phone, with no sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 900 });
    await page.goto("/month.html");
    await settled(page);

    await expect(page.locator(".tt-dow").first()).toBeHidden();
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(0);
    await expect(page.locator(".timetable")).toHaveScreenshot("timetable-phone.png");
  });

  test("survives the largest reader text size", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/month.html");
    await settled(page);
    await page.getByRole("button", { name: "Largest text size" }).click();
    await expect(page.locator(".timetable")).toHaveScreenshot("timetable-largest-text.png");
  });

  test("marks exactly one day as today", async ({ page }) => {
    await page.goto("/month.html");
    await settled(page);
    await expect(page.locator(".tt-day.is-today")).toHaveCount(1);
    await expect(page.locator(".tt-day.is-today")).toContainText("Health Talk");
  });

  test("spends marigold only on days that depart from the rhythm", async ({ page }) => {
    await page.goto("/month.html");
    await settled(page);
    // Sept: one new art class, one new computer session. The other 28 days are
    // the usual drumbeat and must stay in plain ink.
    const unusual = page.locator(".tt-entry.is-unusual");
    await expect(unusual).toHaveCount(2);
    await expect(page.locator(".tt-entry.is-cancelled")).toHaveCount(1);
  });

  test("a cancelled class still says so in words, not only by styling", async ({ page }) => {
    await page.goto("/month.html");
    await settled(page);
    await expect(page.locator(".tt-entry.is-cancelled")).toContainText("Cancelled");
  });

  test("choosing a day opens its programs with a way to join", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/month.html");
    await settled(page);
    await page.locator(".tt-day.has-events").filter({ hasText: "Yoga" }).first().click();
    const detail = page.locator("#day-programs");
    await expect(detail).toContainText("Yoga & Guided Meditation");
    await expect(detail.getByRole("link", { name: /Join .* on Zoom/ })).toBeVisible();
  });

  test("states the standing programs in words", async ({ page }) => {
    await page.goto("/month.html");
    await settled(page);
    const standing = page.locator(".standing");
    await expect(standing).toContainText("Every Monday");
    await expect(standing).toContainText("Yoga & Guided Meditation");
  });
});

test.describe("The Front Page", () => {
  test.beforeEach(async ({ page }) => freeze(page));

  test("this week's datebook", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1600 });
    await page.goto("/");
    await page.waitForFunction(() => document.querySelectorAll(".listing").length > 0);
    await fontsLoaded(page);
    await expect(page.locator("#datebook")).toHaveScreenshot("datebook-week.png");
  });
});
