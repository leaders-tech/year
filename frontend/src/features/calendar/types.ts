/*
This file keeps shared frontend types for calendar snapshots, links, patches, and API payloads.
Edit this file when backend calendar JSON shapes change.
Copy the type pattern here when you add another realtime document feature.
*/

import type { ColorTextureCode, DateCellData } from "./utils/colors";
import type { MonthRange } from "./utils/monthRange";

export type CalendarView = "Linear" | "Classic" | "Column";

export type CalendarSnapshot = {
  name: string;
  monthRange: MonthRange;
  dateCells: Record<string, DateCellData>;
  selectedColorTexture: ColorTextureCode;
  selectedView: CalendarView;
  version?: string;
};

export type CalendarRecord = {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  snapshot: CalendarSnapshot;
};

export type CalendarLinks = {
  view_url: string;
  edit_url?: string;
};

export type CreateCalendarResponse = CalendarLinks & {
  calendar_id: string;
  edit_key: string;
  calendar: CalendarRecord;
};

export type LoadCalendarResponse = CalendarLinks & {
  calendar: CalendarRecord;
  can_edit: boolean;
};

export type PatchCalendarResponse = {
  calendar: CalendarRecord;
};

export type CalendarPatchOperation =
  | { type: "set_cell"; date_key: string; cell: DateCellData }
  | { type: "delete_cell"; date_key: string }
  | { type: "set_month_range"; monthRange: MonthRange }
  | { type: "set_selected_view"; selectedView: CalendarView }
  | { type: "set_selected_color_texture"; selectedColorTexture: ColorTextureCode }
  | { type: "set_name"; name: string }
  | { type: "replace_calendar"; snapshot: CalendarSnapshot };

export type CalendarWsMessage =
  | { type: "calendar.subscribed"; calendar_id: string; connections: number }
  | {
      type: "calendar.patched";
      calendar_id: string;
      revision: number;
      snapshot: CalendarSnapshot;
      operations: CalendarPatchOperation[];
      client_id?: string;
    };
