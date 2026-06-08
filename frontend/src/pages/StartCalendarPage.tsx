/*
This file opens the last used calendar or creates the first server-backed calendar.
Edit this file when the root route startup behavior changes.
Copy this file when you add another one-shot redirect startup page.
*/

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createCalendar } from "../features/calendar/api";
import { LAST_CALENDAR_STORAGE_KEY } from "../features/calendar/contexts/CalendarContext";

type RememberedCalendar = {
  calendarId: string;
  editKey: string | null;
};

function readRememberedCalendar(): RememberedCalendar | null {
  const raw = window.localStorage.getItem(LAST_CALENDAR_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RememberedCalendar>;
    if (!parsed.calendarId || typeof parsed.calendarId !== "string") {
      return null;
    }
    return {
      calendarId: parsed.calendarId,
      editKey: typeof parsed.editKey === "string" && parsed.editKey ? parsed.editKey : null,
    };
  } catch {
    return null;
  }
}

export function StartCalendarPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const remembered = readRememberedCalendar();
    if (remembered) {
      const path = remembered.editKey ? `/calendar/${remembered.calendarId}/edit/${remembered.editKey}` : `/calendar/${remembered.calendarId}`;
      navigate(path, { replace: true });
      return;
    }

    void createCalendar()
      .then((data) => {
        window.localStorage.setItem(LAST_CALENDAR_STORAGE_KEY, JSON.stringify({ calendarId: data.calendar_id, editKey: data.edit_key }));
        navigate(`/calendar/${data.calendar_id}/edit/${data.edit_key}`, { replace: true });
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Calendar could not be created.");
      });
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fafafa] px-4 text-slate-800">
      <p>{error ?? "Opening calendar..."}</p>
    </main>
  );
}
