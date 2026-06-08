/*
This file tests calendar API helper paths and payloads.
Edit this file when calendar API endpoints or request shapes change.
Copy this file when another feature gets a small API wrapper.
*/

import { afterEach, describe, expect, it, vi } from "vitest";
import { createCalendar, loadCalendar, patchCalendar } from "./api";

describe("calendar api helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts create, load, and patch payloads to calendar endpoints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true, data: { saved: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );

    await createCalendar("School year");
    await loadCalendar("calendar-id", "edit-key");
    await patchCalendar("calendar-id", "edit-key", "client-id", [{ type: "set_name", name: "Renamed" }]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/calendars/create",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "School year" }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/calendars/load",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ calendar_id: "calendar-id", edit_key: "edit-key" }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/calendars/patch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          calendar_id: "calendar-id",
          edit_key: "edit-key",
          client_id: "client-id",
          operations: [{ type: "set_name", name: "Renamed" }],
        }),
      }),
    );
  });
});
