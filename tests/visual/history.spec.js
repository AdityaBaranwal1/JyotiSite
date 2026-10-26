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
  await page.fill("#login-pass", "localdevpassword");
  await page.click("#login-form button[type=submit]");
  await page.waitForSelector("#desk-view:not([hidden])");
};
const saved = (page, text = "Readers see it now") =>
  expect(page.locator("#save-status")).toContainText(text);
const rowFor = (page, t) => page.locator(".desk-event").filter({ hasText: t }).first();
const readSchedule = async () => JSON.parse(await readFile(SCHEDULE, "utf8"));
const cancelYoga = async (page) => {
  await rowFor(page, "Yoga & Guided Meditation").getByRole("button", { name: /Cancel Yoga/ }).click();
  await saved(page);
};

/* ---------------- the paper, as readers see it ---------------- */

test("See the paper shows the real pages with the change already on them", async ({ page }) => {
  await signIn(page);
  await cancelYoga(page);

  await page.click("#preview");
  await expect(page.locator("#preview-dialog")).toBeVisible();
  const frame = page.frameLocator("#preview-frame");
  // The week already had one cancelled talk; the change makes two.
  await expect(frame.locator(".listing.is-cancelled")).toHaveCount(2);

  await page.click("#preview-month");
  await expect(frame.locator(".timetable")).toBeVisible();
  await page.click("#preview-close");
  await expect(page.locator("#preview-dialog")).toBeHidden();
});

test("there is no draft preview left to reach", async ({ page }) => {
  await signIn(page);
  const status = await page.evaluate(async () => (await fetch("/api/schedule/preview")).status);
  expect(status).toBe(404);
});

/* ---------------- earlier versions ---------------- */

test("the first change of a sitting keeps the paper from before it", async ({ page }) => {
  await signIn(page);
  await expect(page.locator("#editions-list")).toContainText("Nothing here yet");

  await cancelYoga(page);
  await expect(page.locator(".edition-row")).toHaveCount(1);
  await expect(page.locator(".edition-row").first()).toContainText("As it was on");
  await expect(page.locator(".edition-row").first()).toContainText("170 programs");

  // More changes in the same sitting do not bury it under near-copies.
  await page.click("#undo");
  await saved(page, "undone");
  await expect(page.locator(".edition-row")).toHaveCount(1);
});

test("putting a version back undoes a mistake, and is itself undoable", async ({ page }) => {
  await signIn(page);
  // A mistake: the Monday class called off.
  await cancelYoga(page);
  let s = await readSchedule();
  expect(s.exceptions.some((x) => x.seriesId === "yoga" && x.cancelled)).toBe(true);

  // Put back the paper from before the mistake.
  page.on("dialog", (d) => d.accept());
  await page.locator(".edition-row").first().getByRole("button", { name: /Put back/ }).click();
  await saved(page, "back as it was");

  s = await readSchedule();
  expect(s.exceptions.some((x) => x.seriesId === "yoga" && x.date === "2026-09-14" && x.cancelled),
    "the mistake should be gone").toBe(false);
  expect(s.series).toHaveLength(8);

  // The mistaken paper was itself kept, so the restore can be undone.
  await expect(page.locator(".edition-row")).toHaveCount(2);
  // And the desk reloaded the restored paper.
  await expect(rowFor(page, "Yoga & Guided Meditation")).not.toContainText("Cancelled");
});

test("only a signed-in volunteer can list or restore versions", async ({ page }) => {
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
