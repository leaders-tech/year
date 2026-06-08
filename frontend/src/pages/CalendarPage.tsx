/*
This file renders a calendar by URL id and optional edit key.
Edit this file when calendar route parameters or page-level loading UI change.
Copy this route wrapper when another page needs a provider from URL params.
*/

import { Navigate, useParams } from "react-router-dom";
import Calendar from "../features/calendar/components/Calendar";
import { CalendarProvider } from "../features/calendar/contexts/CalendarContext";
import "../features/calendar/calendar.css";

export function CalendarPage({ editable }: { editable: boolean }) {
  const { calendarId, editKey } = useParams();
  if (!calendarId) {
    return <Navigate to="/" replace />;
  }
  if (editable && !editKey) {
    return <Navigate to={`/calendar/${calendarId}`} replace />;
  }

  return (
    <CalendarProvider calendarId={calendarId} editKey={editable ? editKey : null}>
      <div className="App calendar-app">
        <Calendar />
      </div>
    </CalendarProvider>
  );
}
