/*
This file checks the main browser calendar flows: create, edit, view-only, and websocket sync.
Edit this file when real calendar browser behavior changes across pages, URLs, or WebSockets.
Copy a test pattern here when you add another end-to-end calendar flow.
*/

import { expect, test, type Page } from "@playwright/test";

async function openNewCalendar(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/calendar\/[^/]+\/edit\/[^/?]+(\?.*)?$/);
  await expect(page.getByRole("button", { name: "Copy edit link" })).toBeVisible();
}

test("root creates and remembers an editable calendar", async ({ page }) => {
  await openNewCalendar(page);
  const editUrl = page.url();

  await page.goto("/");

  await expect(page).toHaveURL(editUrl);
});

test("edit changes persist after reload", async ({ page }) => {
  await openNewCalendar(page);
  const patchResponse = page.waitForResponse((response) => response.url().includes("/api/calendars/patch") && response.status() === 200);

  await page.locator(".day").first().click({ position: { x: 2, y: 2 } });
  await patchResponse;
  await page.reload();

  await expect(page.locator('.day[data-colored="true"]').first()).toBeVisible();
});

test("range presets and month inputs update the calendar range", async ({ page }) => {
  await openNewCalendar(page);
  const currentYear = new Date().getFullYear();

  const presetPatch = page.waitForResponse((response) => response.url().includes("/api/calendars/patch") && response.status() === 200);
  await expect(page.getByRole("button", { name: "From Sep" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "From Mar" })).toHaveCount(0);
  await page.getByRole("button", { name: "School year" }).click();
  await presetPatch;
  await expect(page.getByText(`Sep ${currentYear - 1} to Aug ${currentYear}`)).toBeVisible();

  const startPatch = page.waitForResponse((response) => response.url().includes("/api/calendars/patch") && response.status() === 200);
  await page.getByLabel("Start").fill(`${currentYear - 2}-04`);
  await startPatch;
  await expect(page.getByText(`Apr ${currentYear - 2} to Aug ${currentYear}`)).toBeVisible();
});

test("view mode is stored in the URL and local storage", async ({ page }) => {
  await openNewCalendar(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.getByRole("button", { name: "Classic" }).click();
  await expect(page).toHaveURL(/view=Classic/);
  await expect(page.getByText(/January/).first()).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const calendarId = window.location.pathname.split("/")[2];
        return window.localStorage.getItem(`year_calendar_view:${calendarId}`);
      }),
    )
    .toBe("Classic");
  await page.getByRole("button", { name: "Copy view link" }).click();
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain("view=Classic");

  const viewUrl = page.url().replace(/\/edit\/[^/?]+/, "");
  const viewPage = await page.context().newPage();
  await viewPage.goto(viewUrl);
  await expect(viewPage.getByRole("button", { name: "Classic" })).toBeVisible();
  await expect(viewPage).toHaveURL(/view=Classic/);
  await viewPage.getByRole("button", { name: "Column" }).click();
  await expect(viewPage).toHaveURL(/view=Column/);
});

test("view link cannot edit the calendar", async ({ page }) => {
  await openNewCalendar(page);
  const viewUrl = page.url().replace(/\/edit\/[^/]+$/, "");

  await page.goto(viewUrl);
  await expect(page.getByRole("button", { name: "Copy view link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy edit link" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load Data" })).toHaveCount(0);

  await page.locator(".day").first().click({ position: { x: 2, y: 2 } });
  await expect(page.locator('.day[data-colored="true"]')).toHaveCount(0);
});

test("calendar edits update another open tab through websocket", async ({ page, context }) => {
  await openNewCalendar(page);
  const secondPage = await context.newPage();
  await secondPage.goto(page.url());
  await expect(secondPage.getByRole("button", { name: "Copy edit link" })).toBeVisible();

  const patchResponse = page.waitForResponse((response) => response.url().includes("/api/calendars/patch") && response.status() === 200);
  await page.locator(".day").nth(4).click({ position: { x: 2, y: 2 } });
  await patchResponse;

  await expect(secondPage.locator('.day[data-colored="true"]').first()).toBeVisible();
});
