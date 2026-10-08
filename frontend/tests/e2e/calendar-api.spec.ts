/*
This file checks calendar API edits appearing in open browser calendars.
Edit this file when API dates, partial updates, revision conflicts, or live sync change.
Copy this test when another external API needs browser verification.
*/

import { expect, test } from "@playwright/test";

test("API batches update open view and edit pages, preserve fields, and reject stale edits", async ({ page, context, request }) => {
  const createdResponse = await request.post("/api/calendars/create", { data: { name: "API calendar", year: 2026 } });
  expect(createdResponse.ok()).toBe(true);
  const created = (await createdResponse.json()).data;
  const headers = { Authorization: `Bearer ${created.edit_key}` };

  await page.goto(`/calendar/${created.calendar_id}/edit/${created.edit_key}?view=Classic`);
  await expect(page.getByLabel("Calendar name")).toHaveValue("API calendar");
  const viewer = await context.newPage();
  await viewer.goto(`/calendar/${created.calendar_id}?view=Classic`);
  await expect(viewer.getByText("API calendar", { exact: true })).toBeVisible();

  const response = await request.post("/api/calendars/update", {
    headers,
    data: {
      calendar_id: created.calendar_id,
      expected_revision: 1,
      name: "Agent calendar",
      start_month: "2026-10",
      end_month: "2026-12",
      days: { "2026-10-08": { text: "API exam", color: "blue" }, "2026-10-09": { text: "API trip" } },
    },
  });
  expect(response.ok()).toBe(true);
  await expect(page.getByLabel("Calendar name")).toHaveValue("Agent calendar");
  await expect(viewer.getByText("Agent calendar", { exact: true })).toBeVisible();
  for (const tab of [page, viewer]) {
    await expect(tab.getByText("API exam", { exact: true })).toBeVisible();
    await expect(tab.getByText("API trip", { exact: true })).toBeVisible();
    await expect(tab.getByText("API exam", { exact: true }).locator("..")).toHaveAttribute("data-colored", "true");
    await expect(tab).toHaveURL(/view=Classic/);
  }
  await expect(page.getByLabel("Start")).toHaveValue("2026-10");

  const partial = await request.post("/api/calendars/update", {
    headers,
    data: { calendar_id: created.calendar_id, expected_revision: 2, days: { "2026-10-08": { text: "Updated exam" } } },
  });
  expect(partial.ok()).toBe(true);
  expect((await partial.json()).data.days["2026-10-08"]).toEqual({ text: "Updated exam", color: "blue" });
  await expect(viewer.getByText("Updated exam", { exact: true })).toBeVisible();

  const stale = await request.post("/api/calendars/update", {
    headers,
    data: { calendar_id: created.calendar_id, expected_revision: 2, name: "Stale name", days: { "2026-10-08": null } },
  });
  expect(stale.status()).toBe(409);
  await expect(viewer.getByText("Agent calendar", { exact: true })).toBeVisible();
  await expect(viewer.getByText("Updated exam", { exact: true })).toBeVisible();

  const browserPatch = page.waitForResponse((result) => result.url().includes("/api/calendars/patch") && result.status() === 200);
  await page.getByLabel("Calendar name").fill("Browser calendar");
  await browserPatch;
  const readResponse = await request.post("/api/calendars/read", { data: { calendar_id: created.calendar_id } });
  const current = (await readResponse.json()).data;
  expect(current.name).toBe("Browser calendar");
  expect(current.revision).toBe(4);
  expect(current.days["2026-10-08"]).toEqual({ text: "Updated exam", color: "blue" });

  const clear = await request.post("/api/calendars/update", {
    headers,
    data: { calendar_id: created.calendar_id, expected_revision: current.revision, days: { "2026-10-08": null } },
  });
  expect(clear.ok()).toBe(true);
  await expect(viewer.getByText("Updated exam", { exact: true })).toHaveCount(0);
  await expect(viewer.getByText("API trip", { exact: true })).toBeVisible();
  await viewer.reload();
  await expect(viewer.getByText("Browser calendar", { exact: true })).toBeVisible();
  await expect(viewer.getByText("API trip", { exact: true })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Copy edit link" })).toHaveCount(0);
});
