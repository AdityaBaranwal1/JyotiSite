import { test, expect } from "@playwright/test";
import { readFile, writeFile, rm } from "node:fs/promises";

const SCHEDULE = ".tmp-test-data/schedule.json";
const VERSIONS = ".tmp-test-data/versions";
let original;

test.beforeAll(async () => { original = await readFile(SCHEDULE, "utf8"); });
test.afterEach(async () => {
  await writeFile(SCHEDULE, original);
  await rm(VERSIONS, { recursive: true, force: true });
});

const signIn = async (page) => {
  await page.clock.setFixedTime(new Date("2026-09-19T15:30:00-04:00"));
  await page.goto("/admin");
  await page.fill("#login-user", "volunteer");
  await page.fill("#login-pass", "localdevpassword");
  await page.click("#login-form button[type=submit]");
  await page.waitForSelector("#desk-view:not([hidden])");
};
const publish = async (page) => {
  await page.click("#publish");
  await expect(page.locator("#publish-status")).toContainText("Published");
};
const rowFor = (page, t) => page.locator(".desk-event").filter({ hasText: t }).first();
const readSchedule = async () => JSON.parse(await readFile(SCHEDULE, "utf8"));

/* ---------------- preview ---------------- */

test("preview shows the draft while readers still get the published paper", async ({ page }) => {
  await signIn(page);
  await rowFor(page, "Yoga & Guided Meditation").getByRole("button", { name: /Call off/ }).click();

  await page.click("#preview");
  await expect(page.locator("#preview-dialog")).toBeVisible();

  const frame = page.frameLocator("#preview-frame");
  await expect(frame.locator(".preview-bar")).toContainText("unpublished");
  // The draft has the extra cancellation; the published paper does not.
  await expect(frame.locator(".listing.is-cancelled")).toHaveCount(2);

  // Nothing was written by previewing.
  const s = await readSchedule();
  expect(s.exceptions.find((x) => x.seriesId === "yoga" && x.date === "2026-09-14")).toBeUndefined();

  // And a reader in another tab still sees the published paper.
  const readerPage = await page.context().newPage();
  await readerPage.goto("/");
  await readerPage.waitForSelector(".listing");
  await expect(readerPage.locator(".listing.is-cancelled")).toHaveCount(1);
  await expect(readerPage.locator(".preview-bar")).toHaveCount(0);
});

test("preview can switch between the front page and the month", async ({ page }) => {
  await signIn(page);
  await page.click("#preview");
  await page.click("#preview-month");
  const frame = page.frameLocator("#preview-frame");
  await expect(frame.locator(".timetable")).toBeVisible();
  await expect(frame.locator(".preview-bar")).toBeVisible();
});

test("a preview belongs to the volunteer, not the public", async ({ page }) => {
  await signIn(page);
  await page.click("#preview");
  await page.waitForTimeout(300);
  const status = await page.evaluate(async () => {
    const r = await fetch("/api/schedule/preview", { credentials: "omit" });
    return r.status;
  });
  expect(status, "a signed-out request must not read the draft").toBe(401);
});

/* ---------------- version history ---------------- */

test("publishing files the edition it replaced", async ({ page }) => {
  await signIn(page);
  await expect(page.locator("#editions-list")).toContainText("No previous editions yet");

  await rowFor(page, "Yoga & Guided Meditation").getByRole("button", { name: /Call off/ }).click();
  await publish(page);

  await expect(page.locator(".edition-row")).toHaveCount(1);
  await expect(page.locator(".edition-row").first()).toContainText("170 programs");
  await expect(page.locator(".edition-row").first()).toContainText("8 standing");
});

test("putting an edition back undoes a publish, and is itself undoable", async ({ page }) => {
  await signIn(page);
  // Publish a mistake: the whole Monday class called off.
  await rowFor(page, "Yoga & Guided Meditation").getByRole("button", { name: /Call off/ }).click();
  await publish(page);
  let s = await readSchedule();
  expect(s.exceptions.some((x) => x.seriesId === "yoga" && x.cancelled)).toBe(true);

  // Put back the edition from before the mistake.
  page.on("dialog", (d) => d.accept());
  await page.locator(".edition-row").first().getByRole("button", { name: /Put back/ }).click();
  await expect(page.locator("#publish-status")).toContainText("Put back");

  s = await readSchedule();
  expect(s.exceptions.some((x) => x.seriesId === "yoga" && x.date === "2026-09-14" && x.cancelled),
    "the mistake should be gone").toBe(false);
  expect(s.series).toHaveLength(8);

  // The mistaken paper was itself filed, so the restore can be undone.
  await expect(page.locator(".edition-row")).toHaveCount(2);
  // And the desk reloaded the restored paper.
  await expect(rowFor(page, "Yoga & Guided Meditation")).not.toContainText("Cancelled");
});

test("only a signed-in volunteer can list or restore editions", async ({ page }) => {
  await page.goto("/");
  const out = await page.evaluate(async () => ({
    list: (await fetch("/api/versions")).status,
    restore: (await fetch("/api/versions/restore", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "schedule-2026-01-01T00-00-00-000Z.json" }),
    })).status,
  }));
  expect(out.list).toBe(401);
  expect(out.restore).toBe(401);
});

test("a restore cannot be talked into reading another file", async ({ page }) => {
  await signIn(page);
  const attempts = await page.evaluate(async () => {
    const ids = ["../admin.json", "../../server/auth.mjs", "schedule-x/../../admin.json", "/etc/passwd"];
    const out = {};
    for (const id of ids) {
      const r = await fetch("/api/versions/restore", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      out[id] = r.status;
    }
    return out;
  });
  for (const [id, status] of Object.entries(attempts)) {
    expect(status, `${id} must be refused`).toBe(400);
  }
  // the schedule is untouched
  const s = await readSchedule();
  expect(s.series).toHaveLength(8);
});

test("only the last 12 editions are kept", async ({ page }) => {
  test.slow();
  await signIn(page);
  for (let i = 0; i < 14; i++) {
    await page.fill("#editors-note", `Edition number ${i}.`);
    await publish(page);
  }
  await expect(page.locator(".edition-row")).toHaveCount(12);
});
