/*
This file wraps calendar JSON endpoints used by the calendar frontend.
Edit this file when calendar API paths or payload shapes change.
Copy this file when another feature needs a small API wrapper.
*/

import { postJson } from "../../shared/api";
import type {
  CalendarPatchOperation,
  CreateCalendarResponse,
  LoadCalendarResponse,
  PatchCalendarResponse,
} from "./types";

export function createCalendar(name = "My year") {
  return postJson<CreateCalendarResponse>("/calendars/create", { name });
}

export function loadCalendar(calendarId: string, editKey?: string | null) {
  return postJson<LoadCalendarResponse>("/calendars/load", {
    calendar_id: calendarId,
    edit_key: editKey || undefined,
  });
}

export function patchCalendar(calendarId: string, editKey: string, clientId: string, operations: CalendarPatchOperation[]) {
  return postJson<PatchCalendarResponse>("/calendars/patch", {
    calendar_id: calendarId,
    edit_key: editKey,
    client_id: clientId,
    operations,
  });
}
