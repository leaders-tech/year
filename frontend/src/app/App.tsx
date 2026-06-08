/*
This file builds the top-level calendar routes.
Edit this file when public calendar URLs or root startup behavior changes.
Copy the route pattern here when you add another top-level page.
*/

import { Navigate, Route, Routes } from "react-router-dom";
import { CalendarPage } from "../pages/CalendarPage";
import { StartCalendarPage } from "../pages/StartCalendarPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<StartCalendarPage />} />
      <Route path="/calendar/:calendarId" element={<CalendarPage editable={false} />} />
      <Route path="/calendar/:calendarId/edit/:editKey" element={<CalendarPage editable />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
