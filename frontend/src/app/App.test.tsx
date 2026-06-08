/*
This file tests the main calendar routes and root startup redirect.
Edit this file when top-level calendar routes change.
Copy a test pattern here when you add another route or redirect.
*/

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const { createCalendar } = vi.hoisted(() => ({
  createCalendar: vi.fn(),
}));

vi.mock("../features/calendar/api", () => ({
  createCalendar,
}));

vi.mock("../pages/CalendarPage", () => ({
  CalendarPage: ({ editable }: { editable: boolean }) => <h1>{editable ? "Edit calendar" : "View calendar"}</h1>,
}));

describe("App calendar routes", () => {
  beforeEach(() => {
    window.localStorage.clear();
    createCalendar.mockReset();
  });

  it("opens a remembered edit calendar from the root route", async () => {
    window.localStorage.setItem("year_last_calendar", JSON.stringify({ calendarId: "cal-1", editKey: "edit-1" }));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Edit calendar" })).toBeInTheDocument();
    expect(createCalendar).not.toHaveBeenCalled();
  });

  it("creates a first calendar when nothing is remembered", async () => {
    createCalendar.mockResolvedValue({
      calendar_id: "cal-2",
      edit_key: "edit-2",
      calendar: { id: "cal-2", revision: 1, created_at: "", updated_at: "", snapshot: {} },
      view_url: "http://127.0.0.1:5101/calendar/cal-2",
      edit_url: "http://127.0.0.1:5101/calendar/cal-2/edit/edit-2",
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Edit calendar" })).toBeInTheDocument();
    expect(createCalendar).toHaveBeenCalledTimes(1);
  });

  it("renders view-only calendar links", () => {
    render(
      <MemoryRouter initialEntries={["/calendar/cal-3"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "View calendar" })).toBeInTheDocument();
  });
});
