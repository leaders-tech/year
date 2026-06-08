/*
This file tests server-backed calendar provider loading, view-only UI, and websocket updates.
Edit this file when calendar provider behavior changes.
Copy this file when another realtime provider needs similar tests.
*/

import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Calendar from "../components/Calendar";
import { CalendarProvider, useCalendar } from "./CalendarContext";
import type { CalendarSnapshot } from "../types";

const { loadCalendar, patchCalendar, createAppSocket } = vi.hoisted(() => ({
  loadCalendar: vi.fn(),
  patchCalendar: vi.fn(),
  createAppSocket: vi.fn(),
}));

vi.mock("../api", () => ({
  loadCalendar,
  patchCalendar,
}));

vi.mock("../../../shared/socket", () => ({
  createAppSocket,
}));

const baseSnapshot: CalendarSnapshot = {
  name: "School year",
  monthRange: {
    start: { year: 2026, month: 0 },
    end: { year: 2026, month: 11 },
  },
  dateCells: {},
  selectedColorTexture: "red",
  selectedView: "Linear",
  version: "4.0",
};

function mockLoad(canEdit: boolean, snapshot: CalendarSnapshot = baseSnapshot) {
  loadCalendar.mockResolvedValue({
    calendar: {
      id: "calendar-id",
      revision: 1,
      created_at: "",
      updated_at: "",
      snapshot,
    },
    can_edit: canEdit,
    view_url: "http://127.0.0.1:5101/calendar/calendar-id",
    edit_url: canEdit ? "http://127.0.0.1:5101/calendar/calendar-id/edit/edit-key" : undefined,
  });
}

function ProviderHarness({ editKey = "edit-key", children }: { editKey?: string | null; children: React.ReactNode }) {
  return (
    <CalendarProvider calendarId="calendar-id" editKey={editKey}>
      {children}
    </CalendarProvider>
  );
}

function NameReader() {
  const { name } = useCalendar();
  return <p>{name}</p>;
}

function ViewPreferenceControls() {
  const { selectedView, setSelectedView } = useCalendar();
  return (
    <>
      <p>{selectedView}</p>
      <button onClick={() => setSelectedView("Column")}>Use column view</button>
    </>
  );
}

describe("CalendarProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    loadCalendar.mockReset();
    patchCalendar.mockReset();
    createAppSocket.mockReset();
    createAppSocket.mockReturnValue({ stop: vi.fn(), send: vi.fn(), sendPing: vi.fn() });
  });

  it("hides edit-only controls for view links", async () => {
    mockLoad(false);

    render(
      <ProviderHarness editKey={null}>
        <Calendar />
      </ProviderHarness>,
    );

    expect(await screen.findByText("School year")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy view link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy edit link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load Data" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Linear" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Calendar name")).not.toBeInTheDocument();
  });

  it("applies websocket patches from other tabs", async () => {
    let onMessage: ((message: { type: string; calendar_id: string; revision: number; snapshot: CalendarSnapshot; operations: unknown[]; client_id?: string }) => void) | null = null;
    createAppSocket.mockImplementation((options) => {
      onMessage = options.onMessage;
      return { stop: vi.fn(), send: vi.fn(), sendPing: vi.fn() };
    });
    mockLoad(true);

    render(
      <ProviderHarness>
        <NameReader />
      </ProviderHarness>,
    );

    expect(await screen.findByText("School year")).toBeInTheDocument();

    act(() => {
      onMessage?.({
        type: "calendar.patched",
        calendar_id: "calendar-id",
        revision: 2,
        snapshot: { ...baseSnapshot, name: "Remote year" },
        operations: [{ type: "set_name", name: "Remote year" }],
        client_id: "other-tab",
      });
    });

    expect(screen.getByText("Remote year")).toBeInTheDocument();
  });

  it("keeps view preference in URL and local storage without patching the server", async () => {
    window.history.replaceState({}, "", "/calendar/calendar-id?view=Classic");
    mockLoad(true);

    render(
      <ProviderHarness>
        <ViewPreferenceControls />
      </ProviderHarness>,
    );

    expect(await screen.findByText("Classic")).toBeInTheDocument();
    act(() => {
      screen.getByRole("button", { name: "Use column view" }).click();
    });

    expect(screen.getByText("Column")).toBeInTheDocument();
    expect(window.localStorage.getItem("year_calendar_view:calendar-id")).toBe("Column");
    expect(new URL(window.location.href).searchParams.get("view")).toBe("Column");
    expect(patchCalendar).not.toHaveBeenCalled();
  });
});
