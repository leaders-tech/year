/*
This file keeps the small shared TypeScript types for users, notes, API results, and websocket messages.
Edit this file when backend JSON shapes or websocket message shapes change.
Copy a type pattern here when you add another shared API or websocket type.
*/

export type User = {
  id: number;
  username: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
};

export type Note = {
  id: number;
  user_id: number;
  text: string;
  created_at: string;
  updated_at: string;
};

export type ApiOk<T> = {
  ok: true;
  data: T;
};

export type ApiFail = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiResponse<T> = ApiOk<T> | ApiFail;

export type WsMessage =
  | { type: "ws.ready"; user_id: number | null; connections: number }
  | { type: "pong" }
  | { type: "error"; code: string; message: string }
  | { type: "notes.changed"; note?: Note; note_id?: number }
  | { type: "calendar.subscribed"; calendar_id: string; connections: number }
  | {
      type: "calendar.patched";
      calendar_id: string;
      revision: number;
      snapshot: unknown;
      operations: unknown[];
      client_id?: string;
    };
