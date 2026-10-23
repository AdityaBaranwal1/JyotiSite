import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

/* These drive the real desk against the real schedule file, so each test puts
   the file back the way it found it. */
const SCHEDULE = ".tmp-test-data/schedule.json";   // the disposable copy, never the real paper
let original;

test.beforeAll(async () => { original = await readFile(SCHEDULE, "utf8"); });
test.afterEach(async () => { await writeFile(SCHEDULE, original); });

const signIn = async (page) => {
  await page.clock.setFixedTime(new Date("2026-09-19T15:30:00-04:00"));
  await page.goto("/admin");
  await page.fill("#login-user", "volunteer");
  await page.fill("#login-pass", "localdevpassword");
  await page.click("#login-form button[type=submit]");
  await page.waitForSelector("#desk-view:not([hidden])");
};

const readSchedule = async () => JSON.parse(await readFile(SCHEDULE, "utf8"));
const exceptionFor = (s, id, date) =>
  (s.exceptions ?? []).find((x) => x.seriesId === id && x.date === date);

test("the week shows the standing programs, not an empty page", async ({ page }) => {
  await signIn(page);
  await expect(page.locator(".desk-event")).toHaveCount(8);
  await expect(page.locator(".desk-event").first()).toContainText("Yoga & Guided Meditation");
  await expect(page.locator(".desk-event").first()).toContainText("Every Monday");
});

test("names what is normally on", async ({ page }) => {
  await signIn(page);
  await expect(page.locator(".standing-def")).toHaveCount(8);
  await expect(page.locator(".standing-def").first()).toContainText("Every Monday");
});

test("calling off one week writes an exception, not a deletion", async ({ page }) => {
  await signIn(page);
  const monday = page.locator(".desk-event").filter({ hasText: "Yoga & Guided Meditation" }).first();
  await monday.getByRole("button", { name: /Call off/ }).click();
  await expect(monday).toContainText("Cancelled");

  await page.click("#publish");
  await expect(page.locator("#publish-status")).toContainText("Published");

  const s = await readSchedule();
  expect(s.series, "the series must still be there").toHaveLength(8);
  expect(exceptionFor(s, "yoga", "2026-09-14")).toMatchObject({ cancelled: true });
});

test("a cancelled week can be put back, leaving no trace", async ({ page }) => {
  await signIn(page);
  const monday = page.locator(".desk-event").filter({ hasText: "Yoga & Guided Meditation" }).first();
  await monday.getByRole("button", { name: /Call off/ }).click();
  await monday.getByRole("button", { name: /Restore/ }).click();
  await expect(monday).not.toContainText("Cancelled");

  await page.click("#publish");
  await expect(page.locator("#publish-status")).toContainText("Published");
  const s = await readSchedule();
  expect(exceptionFor(s, "yoga", "2026-09-14"), "the exception should be gone entirely").toBeUndefined();
});

test("changing one week's topic records only what differs", async ({ page }) => {
  await signIn(page);
  const wed = page.locator(".desk-event").filter({ hasText: "Rangoli" }).first();
  await wed.getByRole("button", { name: /Edit/ }).click();

  await expect(page.locator("#ev-standing")).toBeVisible();
  await expect(page.locator("#ev-standing")).toContainText("September 16 only");
  await expect(page.locator("#ev-date")).toHaveAttribute("readonly", "");

  await page.fill("#ev-title", "Art: Paper Lanterns");
  await page.click("#ev-save");
  // The row is re-rendered under its new name, so look it up again.
  await expect(page.locator(".desk-event").filter({ hasText: "Art: Paper Lanterns" }))
    .toHaveCount(1);
  await expect(page.locator(".desk-event").filter({ hasText: "Art: Paper Lanterns" }))
    .toContainText("Changed this week");

  await page.click("#publish");
  await expect(page.locator("#publish-status")).toContainText("Published");
  const s = await readSchedule();
  const ex = exceptionFor(s, "art", "2026-09-16");
  expect(ex.title).toBe("Art: Paper Lanterns");
  // The hour never changed, so the exception must not pin one.
  expect(ex.startTime, "unchanged fields stay with the series").toBeUndefined();
});

test("taking a date off removes it from the reader's month", async ({ page }) => {
  await signIn(page);
  const monday = page.locator(".desk-event").filter({ hasText: "Yoga & Guided Meditation" }).first();
  await monday.getByRole("button", { name: /Edit/ }).click();
  page.once("dialog", (d) => d.accept());
  await page.click("#ev-delete");
  await expect(page.locator(".desk-event").filter({ hasText: "Yoga" }).first()).toContainText("Off this week");

  await page.click("#publish");
  await expect(page.locator("#publish-status")).toContainText("Published");

  await page.goto("/month.html?m=2026-09");
  await page.waitForFunction(() => document.querySelectorAll(".tt-day").length > 0);
  const sep14 = page.locator(".tt-day").filter({ hasText: "14" }).first();
  await expect(sep14).not.toContainText("Yoga");
});

test("the stock-market talk keeps its category through an edit", async ({ page }) => {
  await signIn(page);
  await page.locator("#range-prev").click();      // week of Sept 7 has an ordinary Thursday
  const thu = page.locator(".desk-event").filter({ hasText: "Understanding the Stock Market" }).first();
  await thu.getByRole("button", { name: /Edit/ }).click();
  await expect(page.locator("#ev-category")).toHaveValue("stock market");
  await page.click("#ev-save");

  await page.click("#publish");
  const s = await readSchedule();
  const ex = exceptionFor(s, "stocks", "2026-09-10");
  expect(ex?.category, "saving an unchanged category must not record a blank one").toBeUndefined();
});
