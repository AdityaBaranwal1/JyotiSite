import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

/* These drive the real desk against the real schedule file, so each test puts
   the file back the way it found it. Every change on the desk is saved the
   moment it is made, so a test waits for the save bar to say so, then reads
   the file. */
const SCHEDULE = ".tmp-test-data/schedule.json";   // the disposable copy, never the real paper
let original;

test.beforeAll(async () => { original = await readFile(SCHEDULE, "utf8"); });
test.afterEach(async () => { await writeFile(SCHEDULE, original); });

const signIn = async (page) => {
  await page.clock.setFixedTime(new Date("2026-09-19T15:30:00-04:00"));   // a Saturday
  await page.goto("/admin");
  await page.fill("#login-pass", "localdevpassword");
  await page.click("#login-form button[type=submit]");
  await page.waitForSelector("#desk-view:not([hidden])");
};
const saved = (page, text = "Readers see it now") =>
  expect(page.locator("#save-status")).toContainText(text);

const readSchedule = async () => JSON.parse(await readFile(SCHEDULE, "utf8"));
const exceptionFor = (s, id, date) =>
  (s.exceptions ?? []).find((x) => x.seriesId === id && x.date === date);
const rowFor = (page, t) => page.locator(".desk-event").filter({ hasText: t }).first();
const everyWeek = (page) => page.check('input[name="ev-scope"][value="weekly"]');

/* ---------------- signing in ---------------- */

test("signing in asks only for the password, and can show it", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.locator("#login-view input:visible")).toHaveCount(2);   // the password and "show it"
  await page.fill("#login-pass", "localdevpassword");
  await page.check("#login-show");
  await expect(page.locator("#login-pass")).toHaveAttribute("type", "text");
  await page.click("#login-form button[type=submit]");
  await expect(page.locator("#desk-view")).toBeVisible();
});

test("a wrong password says so plainly", async ({ page }) => {
  await page.goto("/admin");
  await page.fill("#login-pass", "not-the-password");
  await page.click("#login-form button[type=submit]");
  await expect(page.locator("#login-msg")).toContainText("password isn't right");
});

/* ---------------- one date ---------------- */

test("the week shows the weekly programs, not an empty page", async ({ page }) => {
  await signIn(page);
  await expect(page.locator(".desk-event")).toHaveCount(8);
  await expect(page.locator(".desk-event").first()).toContainText("Yoga & Guided Meditation");
  await expect(page.locator(".desk-event").first()).toContainText("Every Monday");
});

test("cancelling a date saves at once, as a change for that date only", async ({ page }) => {
  await signIn(page);
  const monday = rowFor(page, "Yoga & Guided Meditation");
  await monday.getByRole("button", { name: /Cancel Yoga/ }).click();
  await expect(monday).toContainText("Cancelled");
  await saved(page);

  const s = await readSchedule();
  expect(s.series, "the weekly program must still be there").toHaveLength(8);
  expect(exceptionFor(s, "yoga", "2026-09-14")).toMatchObject({ cancelled: true });
});

test("a cancelled date stays on the reader's month, stamped", async ({ page }) => {
  await signIn(page);
  await rowFor(page, "Yoga & Guided Meditation").getByRole("button", { name: /Cancel Yoga/ }).click();
  await saved(page);
  await page.goto("/month.html?m=2026-09");
  await page.waitForFunction(() => document.querySelectorAll(".tt-day").length > 0);
  const sep14 = page.locator(".tt-day").filter({ hasText: "14" }).first();
  await expect(sep14.locator(".tt-entry.is-cancelled")).toHaveCount(1);
});

test("a cancelled date can be put back, leaving no trace", async ({ page }) => {
  await signIn(page);
  const monday = rowFor(page, "Yoga & Guided Meditation");
  await monday.getByRole("button", { name: /Cancel Yoga/ }).click();
  await saved(page);
  await monday.getByRole("button", { name: /Put Yoga .* back on/ }).click();
  await expect(monday).not.toContainText("Cancelled");
  await saved(page, "back on");

  const s = await readSchedule();
  expect(exceptionFor(s, "yoga", "2026-09-14"), "the change should be gone entirely").toBeUndefined();
});

test("Undo names the change it takes back, and takes it back", async ({ page }) => {
  await signIn(page);
  await rowFor(page, "Yoga & Guided Meditation").getByRole("button", { name: /Cancel Yoga/ }).click();
  await saved(page);
  const change = "Yoga & Guided Meditation cancelled on Monday, September 14";
  await expect(page.locator("#save-status strong")).toHaveText(change);
  await expect(page.locator("#undo")).toHaveAttribute("aria-label", `Undo: ${change}`);

  await page.click("#undo");
  await saved(page, `Undone: ${change}.`);
  await expect(page.locator("#undo")).toBeHidden();
  await expect(rowFor(page, "Yoga & Guided Meditation")).not.toContainText("Cancelled");
  expect(exceptionFor(await readSchedule(), "yoga", "2026-09-14")).toBeUndefined();
});

test("Undo walks back one change at a time, saying what is next", async ({ page }) => {
  await signIn(page);
  await rowFor(page, "Yoga & Guided Meditation").getByRole("button", { name: /Cancel Yoga/ }).click();
  await saved(page);
  await rowFor(page, "Art: Rangoli").getByRole("button", { name: /Cancel Art/ }).click();
  await saved(page);

  await page.click("#undo");
  await saved(page, "Press Undo again to take back: Yoga & Guided Meditation cancelled");
  await expect(rowFor(page, "Art: Rangoli")).not.toContainText("Cancelled");
  await expect(rowFor(page, "Yoga & Guided Meditation")).toContainText("Cancelled");

  await page.click("#undo");
  await saved(page, "Undone: Yoga & Guided Meditation cancelled");
  const s = await readSchedule();
  expect(exceptionFor(s, "yoga", "2026-09-14")).toBeUndefined();
  expect(exceptionFor(s, "art", "2026-09-16").cancelled).toBeUndefined();
});

test("the day a change lands on is marked for a moment", async ({ page }) => {
  await signIn(page);
  await rowFor(page, "Yoga & Guided Meditation").getByRole("button", { name: /Cancel Yoga/ }).click();
  await saved(page);
  await expect(page.locator('.desk-day[data-iso="2026-09-14"]')).toHaveClass(/just-changed/);
});

test("changing one week's topic records only what differs", async ({ page }) => {
  await signIn(page);
  await rowFor(page, "Rangoli").getByRole("button", { name: /Change/ }).click();

  await expect(page.locator("#f-scope")).toContainText("Only Wednesday, September 16");
  await expect(page.locator('input[name="ev-scope"][value="date"]')).toBeChecked();
  await expect(page.locator("#f-date"), "a weekly program's date cannot move").toBeHidden();

  await page.fill("#ev-title", "Art: Paper Lanterns");
  await page.click("#ev-save");
  await expect(rowFor(page, "Art: Paper Lanterns")).toContainText("Changed for this date");
  await saved(page);

  const ex = exceptionFor(await readSchedule(), "art", "2026-09-16");
  expect(ex.title).toBe("Art: Paper Lanterns");
  // The hour never changed, so the change must not pin one.
  expect(ex.startTime, "unchanged details stay with the weekly program").toBeUndefined();
});

test("pressing Enter in the name box saves instead of losing the change", async ({ page }) => {
  await signIn(page);
  await page.locator(".desk-add").first().click();
  await page.fill("#ev-title", "Diwali Lamps Workshop");
  await page.press("#ev-title", "Enter");
  await saved(page);
  const s = await readSchedule();
  expect(s.events.some((e) => e.title === "Diwali Lamps Workshop" && e.date === "2026-09-14")).toBe(true);
});

test("the stock-market talk keeps its category through a change", async ({ page }) => {
  await signIn(page);
  await page.locator("#range-prev").click();      // week of Sept 7 has an ordinary Thursday
  await rowFor(page, "Understanding the Stock Market").getByRole("button", { name: /Change/ }).click();
  await expect(page.locator("#ev-category")).toHaveValue("stock market");
  await page.click("#ev-save");
  await saved(page);
  const ex = exceptionFor(await readSchedule(), "stocks", "2026-09-10");
  expect(ex?.category, "saving an unchanged category must not record a blank one").toBeUndefined();
});

test("times are picked from a plain list", async ({ page }) => {
  await signIn(page);
  await rowFor(page, "Yoga & Guided Meditation").getByRole("button", { name: /Change/ }).click();
  await expect(page.locator("#ev-start")).toHaveValue("10:00");
  await expect(page.locator("#ev-start option:checked")).toHaveText("10:00 AM");
  await expect(page.locator("#ev-end option").first()).toHaveText("No end time");
});

test("a save that fails puts the desk back and says nothing changed", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/schedule", (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue());
  const monday = rowFor(page, "Yoga & Guided Meditation");
  await monday.getByRole("button", { name: /Cancel Yoga/ }).click();
  await saved(page, "nothing was changed");
  await expect(monday).not.toContainText("Cancelled");
  await expect(page.locator("#undo")).toBeHidden();
});

/* ---------------- every week, from the same calendar ---------------- */

test("there is one calendar: no separate list of weekly programs", async ({ page }) => {
  await signIn(page);
  await expect(page.locator("#weekly")).toHaveCount(0);
  await expect(page.locator(".start-grid")).not.toContainText("weekly");
});

test("changing every week from a later date leaves the weeks before it alone", async ({ page }) => {
  await signIn(page);
  await page.locator("#range-next").click();          // the week of September 21
  await rowFor(page, "Yoga & Guided Meditation").getByRole("button", { name: /Change/ }).click();
  await expect(page.locator("#f-scope")).toContainText("Every week, from Monday, September 21 on");
  await everyWeek(page);
  await expect(page.locator("#f-day")).toBeVisible();
  await expect(page.locator("#ev-day")).toHaveValue("MO");
  await page.selectOption("#ev-start", "11:00");
  await page.selectOption("#ev-end", "12:00");
  await page.click("#ev-save");
  await saved(page, "changed every week, from Monday, September 21");

  const s = await readSchedule();
  const yoga = s.series.filter((x) => x.title === "Yoga & Guided Meditation");
  expect(yoga).toHaveLength(2);
  expect(yoga[0]).toMatchObject({ id: "yoga", startTime: "10:00", until: "2026-09-20" });
  expect(yoga[1]).toMatchObject({ from: "2026-09-21", startTime: "11:00", endTime: "12:00" });
  expect(yoga[1].until, "a weekly program runs until it is stopped").toBeUndefined();
  await expect(rowFor(page, "Yoga & Guided Meditation")).toContainText("11:00 AM to 12:00 PM");

  // Readers: the Monday before as it was, this Monday at the new hour.
  await page.goto("/month.html?m=2026-09");
  await page.waitForFunction(() => document.querySelectorAll(".tt-day").length > 0);
  const yogaOn = (day) => page.locator(".tt-day").filter({ hasText: day }).first()
    .locator(".tt-entry").filter({ hasText: "Yoga" }).locator(".tt-time");
  await expect(yogaOn("14")).toHaveText("10 AM");
  await expect(yogaOn("21")).toHaveText("11 AM");
});

test("a past date's 'every week' starts today, never in the past", async ({ page }) => {
  await signIn(page);
  await rowFor(page, "Yoga & Guided Meditation").getByRole("button", { name: /Change/ }).click();
  await expect(page.locator("#f-scope")).toContainText("Every week, from Saturday, September 19 on");
  await everyWeek(page);
  await page.selectOption("#ev-start", "09:30");
  await page.click("#ev-save");
  await saved(page);
  const yoga = (await readSchedule()).series.filter((x) => x.title === "Yoga & Guided Meditation");
  expect(yoga[0].until).toBe("2026-09-18");
  expect(yoga[1].from).toBe("2026-09-19");
});

test("choosing 'every week' fills in the usual details, not this date's", async ({ page }) => {
  await signIn(page);
  await rowFor(page, "Art: Rangoli").getByRole("button", { name: /Change/ }).click();
  await expect(page.locator("#ev-title")).toHaveValue("Art: Rangoli & Paper Craft");
  await everyWeek(page);
  await expect(page.locator("#ev-title")).toHaveValue("Art Class");
  await expect(page.locator("#ev-stop")).toBeVisible();
  await expect(page.locator("#ev-reset")).toBeHidden();
});

test("moving a weekly program to another day asks before dropping hand changes", async ({ page }) => {
  await signIn(page);
  await rowFor(page, "Diabetes").getByRole("button", { name: /Change/ }).click();
  await everyWeek(page);
  await page.selectOption("#ev-day", "SU");
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.accept(); });
  await page.click("#ev-save");
  await saved(page, "moved to Sundays");
  expect(asked).toContain("the 7 dates");
  const s = await readSchedule();
  const moved = s.series.find((x) => x.title === "Health Talk" && x.from === "2026-09-19");
  expect(moved.rrule).toBe("FREQ=WEEKLY;BYDAY=SU");
  expect(s.exceptions.filter((x) => x.date >= "2026-09-19" && x.seriesId.startsWith("health"))).toHaveLength(0);
});

test("stopping a weekly program keeps the weeks it ran", async ({ page }) => {
  await signIn(page);
  await rowFor(page, "Diabetes").getByRole("button", { name: /Change/ }).click();
  await everyWeek(page);
  page.once("dialog", (d) => d.accept());
  await page.click("#ev-stop");
  await saved(page, "stopped");

  const s = await readSchedule();
  expect(s.series.find((x) => x.id === "health").until).toBe("2026-09-18");
  expect(exceptionFor(s, "health", "2026-09-12"), "a printed week keeps its topic").toBeDefined();
  await page.locator("#range-next").click();
  await expect(page.locator(".desk-event").filter({ hasText: "Health Talk" })).toHaveCount(0);
});

test("a new program can be made weekly from its first date", async ({ page }) => {
  await signIn(page);
  await page.locator("#range-next").click();
  await page.locator('.desk-day[data-iso="2026-09-24"] .desk-add').click();
  await expect(page.locator("#scope-legend")).toHaveText("How often?");
  await expect(page.locator("#f-scope")).toContainText("Every Thursday, from then on");
  await everyWeek(page);
  await page.fill("#ev-title", "Gardening Club");
  await page.selectOption("#ev-start", "14:00");
  await page.click("#ev-save");
  await saved(page, "every Thursday from Thursday, September 24");

  const s = await readSchedule();
  const added = s.series.find((x) => x.title === "Gardening Club");
  expect(added).toMatchObject({ rrule: "FREQ=WEEKLY;BYDAY=TH", from: "2026-09-24", startTime: "14:00" });
  expect(added.until).toBeUndefined();
  await expect(rowFor(page, "Gardening Club")).toContainText("Every Thursday");
});

test("a one-time program is not asked about other weeks", async ({ page }) => {
  await signIn(page);
  await page.click("#start-add");
  await page.fill("#ev-title", "Diwali Lamps Workshop");
  await page.click("#ev-save");
  await saved(page, "Diwali Lamps Workshop added on Saturday, September 19");
  await rowFor(page, "Diwali Lamps").getByRole("button", { name: /Change/ }).click();
  await expect(page.locator("#f-scope")).toBeHidden();
  await expect(page.locator("#ev-delete")).toBeVisible();
});

/* ---------------- the note ---------------- */

test("the front-page note saves on its button", async ({ page }) => {
  await signIn(page);
  await page.click("a[href='#note']");
  await page.fill("#editors-note", "Happy Diwali, everyone.");
  await expect(page.locator("#note-state")).toHaveText("Not saved yet.");
  await page.click("#note-save");
  await expect(page.locator("#note-state")).toHaveText("Saved.");
  expect((await readSchedule()).editorsNote).toBe("Happy Diwali, everyone.");
});
