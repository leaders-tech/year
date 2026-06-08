"""Store shared calendar rows, day cells, edit keys, and patch operations.

Edit this file when calendar tables or calendar patch behavior changes.
Copy this file as a starting point when you add another shared document table.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import re
from secrets import token_urlsafe
from typing import Any
from uuid import uuid4

import aiosqlite

from backend.db.connection import utc_now_text


CALENDAR_VERSION = "4.0"
DEFAULT_SELECTED_COLOR_TEXTURE = "red"
DEFAULT_SELECTED_VIEW = "Linear"
VALID_COLORS = {"red", "orange", "green", "blue", "yellow", "purple", "teal", "pink"}
VALID_TEXTURES = {"diagonal-stripes", "polka-dots", "square-net"}
VALID_COLOR_TEXTURES = VALID_COLORS | VALID_TEXTURES
VALID_VIEWS = {"Linear", "Classic", "Column"}
DATE_KEY_PATTERN = re.compile(r"^\d{4}-\d{1,2}-\d{1,2}$")


@dataclass(frozen=True)
class CreatedCalendar:
    calendar_id: str
    edit_key: str
    calendar: dict[str, Any]


def hash_edit_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def verify_edit_key(row: aiosqlite.Row, raw_key: str | None) -> bool:
    if not raw_key:
        return False
    return hmac.compare_digest(row["edit_key_hash"], hash_edit_key(raw_key))


def default_snapshot(year: int, name: str) -> dict[str, Any]:
    return {
        "name": name,
        "monthRange": {
            "start": {"year": year, "month": 0},
            "end": {"year": year, "month": 11},
        },
        "dateCells": {},
        "selectedColorTexture": DEFAULT_SELECTED_COLOR_TEXTURE,
        "selectedView": DEFAULT_SELECTED_VIEW,
        "version": CALENDAR_VERSION,
    }


def _row_to_snapshot(row: aiosqlite.Row, cells: list[aiosqlite.Row]) -> dict[str, Any]:
    date_cells: dict[str, dict[str, str]] = {}
    for cell in cells:
        cell_data: dict[str, str] = {}
        if cell["color"] is not None:
            cell_data["color"] = cell["color"]
        if cell["texture"] is not None:
            cell_data["texture"] = cell["texture"]
        if cell["custom_text"] is not None:
            cell_data["customText"] = cell["custom_text"]
        if cell_data:
            date_cells[cell["date_key"]] = cell_data

    return {
        "name": row["name"],
        "monthRange": {
            "start": {"year": row["month_start_year"], "month": row["month_start_month"]},
            "end": {"year": row["month_end_year"], "month": row["month_end_month"]},
        },
        "dateCells": date_cells,
        "selectedColorTexture": row["selected_color_texture"],
        "selectedView": row["selected_view"],
        "version": CALENDAR_VERSION,
    }


async def _get_calendar_row(db: aiosqlite.Connection, calendar_id: str) -> aiosqlite.Row | None:
    cursor = await db.execute(
        """
        SELECT id, edit_key_hash, name, month_start_year, month_start_month, month_end_year, month_end_month,
               selected_view, selected_color_texture, revision, created_at, updated_at
        FROM calendars
        WHERE id = ?
        """,
        (calendar_id,),
    )
    return await cursor.fetchone()


async def get_calendar(db: aiosqlite.Connection, calendar_id: str) -> dict[str, Any] | None:
    row = await _get_calendar_row(db, calendar_id)
    if row is None:
        return None
    cursor = await db.execute(
        """
        SELECT date_key, color, texture, custom_text
        FROM calendar_cells
        WHERE calendar_id = ?
        ORDER BY date_key
        """,
        (calendar_id,),
    )
    cells = await cursor.fetchall()
    return {
        "id": row["id"],
        "revision": row["revision"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "snapshot": _row_to_snapshot(row, cells),
    }


async def calendar_can_edit(db: aiosqlite.Connection, calendar_id: str, edit_key: str | None) -> bool:
    row = await _get_calendar_row(db, calendar_id)
    if row is None:
        return False
    return verify_edit_key(row, edit_key)


async def create_calendar(db: aiosqlite.Connection, year: int, name: str = "My year") -> CreatedCalendar:
    calendar_id = str(uuid4())
    edit_key = token_urlsafe(32)
    now = utc_now_text()
    snapshot = default_snapshot(year, name)
    await db.execute(
        """
        INSERT INTO calendars (
            id, edit_key_hash, name, month_start_year, month_start_month, month_end_year, month_end_month,
            selected_view, selected_color_texture, revision, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        """,
        (
            calendar_id,
            hash_edit_key(edit_key),
            snapshot["name"],
            snapshot["monthRange"]["start"]["year"],
            snapshot["monthRange"]["start"]["month"],
            snapshot["monthRange"]["end"]["year"],
            snapshot["monthRange"]["end"]["month"],
            snapshot["selectedView"],
            snapshot["selectedColorTexture"],
            now,
            now,
        ),
    )
    await db.commit()
    calendar = await get_calendar(db, calendar_id)
    if calendar is None:
        raise ValueError("Created calendar could not be loaded.")
    return CreatedCalendar(calendar_id=calendar_id, edit_key=edit_key, calendar=calendar)


def _parse_month_pointer(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        raise ValueError("Month pointer must be an object.")
    year = value.get("year")
    month = value.get("month")
    if not isinstance(year, int) or not isinstance(month, int) or month < 0 or month > 11:
        raise ValueError("Month pointer must include integer year and month from 0 to 11.")
    return {"year": year, "month": month}


def _normalize_month_range(value: Any) -> dict[str, dict[str, int]]:
    if not isinstance(value, dict):
        raise ValueError("Month range must be an object.")
    start = _parse_month_pointer(value.get("start"))
    end = _parse_month_pointer(value.get("end"))
    if (start["year"], start["month"]) > (end["year"], end["month"]):
        start, end = end, start
    return {"start": start, "end": end}


def _normalize_name(value: Any) -> str:
    name = str(value or "").strip()
    if not name:
        return "My year"
    return name[:120]


def _normalize_view(value: Any) -> str:
    if value not in VALID_VIEWS:
        raise ValueError("Selected view is invalid.")
    return str(value)


def _normalize_color_texture(value: Any) -> str:
    if value not in VALID_COLOR_TEXTURES:
        raise ValueError("Selected color or texture is invalid.")
    return str(value)


def _normalize_date_key(value: Any) -> str:
    if not isinstance(value, str) or not DATE_KEY_PATTERN.match(value):
        raise ValueError("Date key is invalid.")
    return value


def _normalize_cell(value: Any) -> dict[str, str | None]:
    if not isinstance(value, dict):
        raise ValueError("Cell data must be an object.")
    color = value.get("color")
    texture = value.get("texture")
    custom_text = value.get("customText")

    if color is not None and color not in VALID_COLORS:
        raise ValueError("Cell color is invalid.")
    if texture is not None and texture not in VALID_TEXTURES:
        raise ValueError("Cell texture is invalid.")
    if custom_text is not None:
        custom_text = str(custom_text)[:500]
        if not custom_text.strip():
            custom_text = None

    if color is not None and texture is not None:
        texture = None

    return {"color": color, "texture": texture, "custom_text": custom_text}


async def _set_cell(db: aiosqlite.Connection, calendar_id: str, date_key: str, cell: dict[str, str | None], now: str) -> None:
    if cell["color"] is None and cell["texture"] is None and cell["custom_text"] is None:
        await db.execute("DELETE FROM calendar_cells WHERE calendar_id = ? AND date_key = ?", (calendar_id, date_key))
        return
    await db.execute(
        """
        INSERT INTO calendar_cells (calendar_id, date_key, color, texture, custom_text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(calendar_id, date_key) DO UPDATE SET
            color = excluded.color,
            texture = excluded.texture,
            custom_text = excluded.custom_text,
            updated_at = excluded.updated_at
        """,
        (calendar_id, date_key, cell["color"], cell["texture"], cell["custom_text"], now, now),
    )


async def _replace_calendar(db: aiosqlite.Connection, calendar_id: str, snapshot: dict[str, Any], now: str) -> None:
    month_range = _normalize_month_range(snapshot.get("monthRange"))
    selected_view = _normalize_view(snapshot.get("selectedView"))
    selected_color_texture = _normalize_color_texture(snapshot.get("selectedColorTexture"))
    name = _normalize_name(snapshot.get("name"))
    await db.execute(
        """
        UPDATE calendars
        SET name = ?,
            month_start_year = ?,
            month_start_month = ?,
            month_end_year = ?,
            month_end_month = ?,
            selected_view = ?,
            selected_color_texture = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (
            name,
            month_range["start"]["year"],
            month_range["start"]["month"],
            month_range["end"]["year"],
            month_range["end"]["month"],
            selected_view,
            selected_color_texture,
            now,
            calendar_id,
        ),
    )
    await db.execute("DELETE FROM calendar_cells WHERE calendar_id = ?", (calendar_id,))
    date_cells = snapshot.get("dateCells", {})
    if not isinstance(date_cells, dict):
        raise ValueError("Calendar date cells must be an object.")
    for raw_date_key, raw_cell in date_cells.items():
        await _set_cell(db, calendar_id, _normalize_date_key(raw_date_key), _normalize_cell(raw_cell), now)


async def apply_calendar_patch(db: aiosqlite.Connection, calendar_id: str, edit_key: str | None, operations: list[Any]) -> dict[str, Any] | None:
    row = await _get_calendar_row(db, calendar_id)
    if row is None or not verify_edit_key(row, edit_key):
        return None
    if not operations:
        return await get_calendar(db, calendar_id)

    now = utc_now_text()
    await db.execute("BEGIN")
    try:
        for operation in operations:
            if not isinstance(operation, dict):
                raise ValueError("Patch operation must be an object.")
            operation_type = operation.get("type")
            if operation_type == "set_cell":
                await _set_cell(db, calendar_id, _normalize_date_key(operation.get("date_key")), _normalize_cell(operation.get("cell")), now)
            elif operation_type == "delete_cell":
                await db.execute(
                    "DELETE FROM calendar_cells WHERE calendar_id = ? AND date_key = ?",
                    (calendar_id, _normalize_date_key(operation.get("date_key"))),
                )
            elif operation_type == "set_month_range":
                month_range = _normalize_month_range(operation.get("monthRange"))
                await db.execute(
                    """
                    UPDATE calendars
                    SET month_start_year = ?, month_start_month = ?, month_end_year = ?, month_end_month = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        month_range["start"]["year"],
                        month_range["start"]["month"],
                        month_range["end"]["year"],
                        month_range["end"]["month"],
                        now,
                        calendar_id,
                    ),
                )
            elif operation_type == "set_selected_view":
                await db.execute(
                    "UPDATE calendars SET selected_view = ?, updated_at = ? WHERE id = ?",
                    (_normalize_view(operation.get("selectedView")), now, calendar_id),
                )
            elif operation_type == "set_selected_color_texture":
                await db.execute(
                    "UPDATE calendars SET selected_color_texture = ?, updated_at = ? WHERE id = ?",
                    (_normalize_color_texture(operation.get("selectedColorTexture")), now, calendar_id),
                )
            elif operation_type == "set_name":
                await db.execute(
                    "UPDATE calendars SET name = ?, updated_at = ? WHERE id = ?",
                    (_normalize_name(operation.get("name")), now, calendar_id),
                )
            elif operation_type == "replace_calendar":
                snapshot = operation.get("snapshot")
                if not isinstance(snapshot, dict):
                    raise ValueError("Replacement snapshot must be an object.")
                await _replace_calendar(db, calendar_id, snapshot, now)
            else:
                raise ValueError("Patch operation type is invalid.")

        await db.execute(
            "UPDATE calendars SET revision = revision + 1, updated_at = ? WHERE id = ?",
            (now, calendar_id),
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    return await get_calendar(db, calendar_id)
