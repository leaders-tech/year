/*
This file keeps calendar state, server loading, optimistic patches, and websocket sync.
Edit this file when calendar save, load, or realtime behavior changes.
Copy the provider pattern here when you add another shared document editor.
*/

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createAppSocket, type SocketStatus } from "../../../shared/socket";
import { loadCalendar, patchCalendar } from "../api";
import type { CalendarPatchOperation, CalendarSnapshot, CalendarView } from "../types";
import type { ColorTextureCode, DateCellData } from "../utils/colors";
import { createDefaultMonthRange, ensureValidRange, type MonthRange } from "../utils/monthRange";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type CalendarContextType = {
  name: string;
  setName: (name: string) => void;
  monthRange: MonthRange;
  setMonthRange: (range: MonthRange) => void;
  dateCells: Map<string, DateCellData>;
  setDateCells: (dateCells: Map<string, DateCellData>) => void;
  selectedColorTexture: ColorTextureCode;
  setSelectedColorTexture: (colorTexture: ColorTextureCode) => void;
  selectedView: CalendarView;
  setSelectedView: (view: CalendarView) => void;
  calendarId: string;
  editKey: string | null;
  revision: number;
  canEdit: boolean;
  loading: boolean;
  error: string | null;
  saveStatus: SaveStatus;
  socketStatus: SocketStatus;
  viewUrl: string;
  editUrl: string | null;
  replaceCalendar: (snapshot: CalendarSnapshot) => void;
  getCurrentDataSnapshot: () => CalendarSnapshot;
  reloadCalendar: () => Promise<void>;
};

const CalendarContext = createContext<CalendarContextType | undefined>(undefined);

const PATCH_DEBOUNCE_MS = 250;
const LAST_CALENDAR_STORAGE_KEY = "year_last_calendar";
const VIEW_STORAGE_KEY_PREFIX = "year_calendar_view:";
const CALENDAR_VIEWS: CalendarView[] = ["Linear", "Classic", "Column"];

function createClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function isCalendarView(value: string | null | undefined): value is CalendarView {
  return Boolean(value && CALENDAR_VIEWS.includes(value as CalendarView));
}

function readViewFromUrl(): CalendarView | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const view = new URL(window.location.href).searchParams.get("view");
    return isCalendarView(view) ? view : null;
  } catch {
    return null;
  }
}

function readStoredView(calendarId: string): CalendarView | null {
  const view = window.localStorage.getItem(`${VIEW_STORAGE_KEY_PREFIX}${calendarId}`);
  return isCalendarView(view) ? view : null;
}

function rememberView(calendarId: string, view: CalendarView) {
  window.localStorage.setItem(`${VIEW_STORAGE_KEY_PREFIX}${calendarId}`, view);
}

function replaceUrlViewParam(view: CalendarView) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    window.history.replaceState({}, "", url.toString());
  } catch {
    // Keep view changes local when browser URL APIs are unavailable.
  }
}

function resolvePreferredView(calendarId: string, serverView: CalendarView): CalendarView {
  return readViewFromUrl() ?? readStoredView(calendarId) ?? serverView;
}

function normalizeSnapshot(snapshot: Partial<CalendarSnapshot> | null | undefined): CalendarSnapshot {
  const currentYear = new Date().getFullYear();
  const fallback = createDefaultMonthRange(currentYear);
  const monthRange = snapshot?.monthRange ? ensureValidRange(snapshot.monthRange) : fallback;
  const selectedView = snapshot?.selectedView && ["Linear", "Classic", "Column"].includes(snapshot.selectedView) ? snapshot.selectedView : "Linear";
  const selectedColorTexture = snapshot?.selectedColorTexture || "red";
  const dateCells = snapshot?.dateCells && typeof snapshot.dateCells === "object" ? snapshot.dateCells : {};
  return {
    name: (snapshot?.name || "My year").trim() || "My year",
    monthRange,
    dateCells,
    selectedColorTexture,
    selectedView,
    version: snapshot?.version || "4.0",
  };
}

function cellIsEmpty(cell: DateCellData | undefined) {
  return !cell || (!cell.color && !cell.texture && !cell.customText);
}

function cellsEqual(left: DateCellData | undefined, right: DateCellData | undefined) {
  if (cellIsEmpty(left) && cellIsEmpty(right)) {
    return true;
  }
  return left?.color === right?.color && left?.texture === right?.texture && (left?.customText || "") === (right?.customText || "");
}

function diffDateCells(previous: Map<string, DateCellData>, next: Map<string, DateCellData>): CalendarPatchOperation[] {
  const operations: CalendarPatchOperation[] = [];
  const keys = new Set([...previous.keys(), ...next.keys()]);
  for (const key of keys) {
    const previousCell = previous.get(key);
    const nextCell = next.get(key);
    if (cellsEqual(previousCell, nextCell)) {
      continue;
    }
    if (!nextCell || cellIsEmpty(nextCell)) {
      operations.push({ type: "delete_cell", date_key: key });
    } else {
      operations.push({ type: "set_cell", date_key: key, cell: nextCell });
    }
  }
  return operations;
}

function snapshotToState(snapshot: CalendarSnapshot) {
  const normalized = normalizeSnapshot(snapshot);
  return {
    name: normalized.name,
    monthRange: normalized.monthRange,
    dateCells: new Map(Object.entries(normalized.dateCells ?? {})),
    selectedColorTexture: normalized.selectedColorTexture,
    selectedView: normalized.selectedView,
  };
}

function rememberCalendar(calendarId: string, editKey: string | null) {
  window.localStorage.setItem(LAST_CALENDAR_STORAGE_KEY, JSON.stringify({ calendarId, editKey }));
}

export function CalendarProvider({
  calendarId,
  editKey,
  children,
}: {
  calendarId: string;
  editKey?: string | null;
  children: React.ReactNode;
}) {
  const [name, setNameState] = useState("My year");
  const [monthRange, setMonthRangeState] = useState<MonthRange>(createDefaultMonthRange(new Date().getFullYear()));
  const [dateCells, setDateCellsState] = useState<Map<string, DateCellData>>(new Map());
  const [selectedColorTexture, setSelectedColorTextureState] = useState<ColorTextureCode>("red");
  const [selectedView, setSelectedViewState] = useState<CalendarView>("Linear");
  const [revision, setRevision] = useState(0);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("idle");
  const [viewUrl, setViewUrl] = useState("");
  const [editUrl, setEditUrl] = useState<string | null>(null);

  const clientIdRef = useRef(createClientId());
  const editKeyRef = useRef(editKey || null);
  const canEditRef = useRef(false);
  const patchQueueRef = useRef<CalendarPatchOperation[]>([]);
  const patchTimerRef = useRef<number | null>(null);
  const patchInFlightRef = useRef(false);
  const dateCellsRef = useRef(dateCells);
  const snapshotRef = useRef<CalendarSnapshot>(normalizeSnapshot(null));

  const applySnapshot = useCallback((snapshot: CalendarSnapshot, nextRevision: number) => {
    const state = snapshotToState(snapshot);
    const preferredView = resolvePreferredView(calendarId, state.selectedView);
    setNameState(state.name);
    setMonthRangeState(state.monthRange);
    setDateCellsState(state.dateCells);
    setSelectedColorTextureState(state.selectedColorTexture);
    setSelectedViewState(preferredView);
    setRevision(nextRevision);
    dateCellsRef.current = state.dateCells;
    snapshotRef.current = { ...normalizeSnapshot(snapshot), selectedView: preferredView };
    rememberView(calendarId, preferredView);
    replaceUrlViewParam(preferredView);
  }, [calendarId]);

  const reloadCalendar = useCallback(async () => {
    setError(null);
    const data = await loadCalendar(calendarId, editKeyRef.current);
    applySnapshot(data.calendar.snapshot, data.calendar.revision);
    setCanEdit(data.can_edit);
    canEditRef.current = data.can_edit;
    setViewUrl(data.view_url);
    setEditUrl(data.edit_url ?? null);
    rememberCalendar(calendarId, data.can_edit ? editKeyRef.current : null);
  }, [applySnapshot, calendarId]);

  const flushPatchQueue = useCallback(async () => {
    if (patchInFlightRef.current || !canEditRef.current || !editKeyRef.current) {
      return;
    }
    const operations = patchQueueRef.current.splice(0);
    if (operations.length === 0) {
      return;
    }
    patchInFlightRef.current = true;
    setSaveStatus("saving");
    setError(null);
    try {
      const data = await patchCalendar(calendarId, editKeyRef.current, clientIdRef.current, operations);
      applySnapshot(data.calendar.snapshot, data.calendar.revision);
      setSaveStatus("saved");
    } catch (caught) {
      patchQueueRef.current = [...operations, ...patchQueueRef.current];
      setSaveStatus("error");
      setError(caught instanceof Error ? caught.message : "Calendar changes could not be saved.");
    } finally {
      patchInFlightRef.current = false;
      if (patchQueueRef.current.length > 0) {
        patchTimerRef.current = window.setTimeout(() => void flushPatchQueue(), PATCH_DEBOUNCE_MS);
      }
    }
  }, [applySnapshot, calendarId]);

  const queuePatch = useCallback(
    (operations: CalendarPatchOperation[]) => {
      if (!canEditRef.current || operations.length === 0) {
        return;
      }
      patchQueueRef.current.push(...operations);
      setSaveStatus("saving");
      if (patchTimerRef.current !== null) {
        window.clearTimeout(patchTimerRef.current);
      }
      patchTimerRef.current = window.setTimeout(() => void flushPatchQueue(), PATCH_DEBOUNCE_MS);
    },
    [flushPatchQueue],
  );

  useEffect(() => {
    editKeyRef.current = editKey || null;
    canEditRef.current = false;
    patchQueueRef.current = [];
    setLoading(true);
    setSaveStatus("idle");
    void reloadCalendar()
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Calendar could not be loaded.");
      })
      .finally(() => setLoading(false));
  }, [editKey, reloadCalendar]);

  useEffect(() => {
    const socket = createAppSocket({
      onOpen(api) {
        api.send({ type: "calendar.subscribe", calendar_id: calendarId });
        void reloadCalendar().catch((caught) => {
          setError(caught instanceof Error ? caught.message : "Calendar could not be refreshed.");
        });
      },
      onMessage(message) {
        if (message.type === "calendar.patched" && message.calendar_id === calendarId && message.client_id !== clientIdRef.current) {
          applySnapshot(message.snapshot as CalendarSnapshot, message.revision);
          setSaveStatus("saved");
        }
      },
      onStatus(status) {
        setSocketStatus(status);
      },
    });
    return () => socket.stop();
  }, [applySnapshot, calendarId, reloadCalendar]);

  useEffect(() => {
    return () => {
      if (patchTimerRef.current !== null) {
        window.clearTimeout(patchTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    dateCellsRef.current = dateCells;
    snapshotRef.current = {
      name,
      monthRange,
      dateCells: Object.fromEntries(dateCells),
      selectedColorTexture,
      selectedView,
      version: "4.0",
    };
  }, [dateCells, monthRange, name, selectedColorTexture, selectedView]);

  const setName = useCallback(
    (nextName: string) => {
      if (!canEditRef.current) return;
      const normalizedName = nextName.slice(0, 120);
      setNameState(normalizedName);
      queuePatch([{ type: "set_name", name: normalizedName }]);
    },
    [queuePatch],
  );

  const setMonthRange = useCallback(
    (range: MonthRange) => {
      if (!canEditRef.current) return;
      const normalizedRange = ensureValidRange(range);
      setMonthRangeState(normalizedRange);
      queuePatch([{ type: "set_month_range", monthRange: normalizedRange }]);
    },
    [queuePatch],
  );

  const setDateCells = useCallback(
    (nextDateCells: Map<string, DateCellData>) => {
      if (!canEditRef.current) return;
      const normalizedNext = new Map(nextDateCells);
      const operations = diffDateCells(dateCellsRef.current, normalizedNext);
      dateCellsRef.current = normalizedNext;
      setDateCellsState(normalizedNext);
      queuePatch(operations);
    },
    [queuePatch],
  );

  const setSelectedColorTexture = useCallback(
    (colorTexture: ColorTextureCode) => {
      if (!canEditRef.current) return;
      setSelectedColorTextureState(colorTexture);
      queuePatch([{ type: "set_selected_color_texture", selectedColorTexture: colorTexture }]);
    },
    [queuePatch],
  );

  const setSelectedView = useCallback(
    (view: CalendarView) => {
      setSelectedViewState(view);
      rememberView(calendarId, view);
      replaceUrlViewParam(view);
    },
    [calendarId],
  );

  const replaceCalendar = useCallback(
    (snapshot: CalendarSnapshot) => {
      if (!canEditRef.current) return;
      const normalized = normalizeSnapshot(snapshot);
      applySnapshot(normalized, revision);
      queuePatch([{ type: "replace_calendar", snapshot: normalized }]);
    },
    [applySnapshot, queuePatch, revision],
  );

  const getCurrentDataSnapshot = useCallback(() => snapshotRef.current, []);

  const value = useMemo<CalendarContextType>(
    () => ({
      name,
      setName,
      monthRange,
      setMonthRange,
      dateCells,
      setDateCells,
      selectedColorTexture,
      setSelectedColorTexture,
      selectedView,
      setSelectedView,
      calendarId,
      editKey: editKey || null,
      revision,
      canEdit,
      loading,
      error,
      saveStatus,
      socketStatus,
      viewUrl,
      editUrl,
      replaceCalendar,
      getCurrentDataSnapshot,
      reloadCalendar,
    }),
    [
      calendarId,
      canEdit,
      dateCells,
      editKey,
      editUrl,
      error,
      getCurrentDataSnapshot,
      loading,
      monthRange,
      name,
      reloadCalendar,
      replaceCalendar,
      revision,
      saveStatus,
      selectedColorTexture,
      selectedView,
      setDateCells,
      setMonthRange,
      setName,
      setSelectedColorTexture,
      setSelectedView,
      socketStatus,
      viewUrl,
    ],
  );

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar() {
  const context = useContext(CalendarContext);
  if (context === undefined) {
    throw new Error("useCalendar must be used within CalendarProvider.");
  }
  return context;
}

export { LAST_CALENDAR_STORAGE_KEY };
