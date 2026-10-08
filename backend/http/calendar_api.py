"""Expose calendar read and update endpoints with ISO dates and bearer edit keys.

Edit this file when the calendar integration API or its JSON fields change.
Copy a route here when another integration needs small explicit JSON commands.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from aiohttp import web

from backend.config import Settings
from backend.db.calendar_patches import CalendarRevisionConflict, apply_calendar_patch, read_calendar
from backend.db.calendars import VALID_COLORS, VALID_TEXTURES
from backend.http.json_api import AppError, ok, read_json
from backend.http.middleware import require_allowed_origin


def _check_fields(value: dict[str, Any], allowed: set[str]) -> None:
    unknown = value.keys() - allowed
    if unknown:
        raise AppError(400, "bad_request", f"Unknown fields: {', '.join(sorted(unknown))}.")


def _calendar_id(payload: dict[str, Any]) -> str:
    value = payload.get("calendar_id")
    if not isinstance(value, str) or not value.strip():
        raise AppError(400, "bad_request", "Calendar id is required.")
    return value.strip()


def _month(value: Any) -> dict[str, int]:
    try:
        parsed = date.fromisoformat(f"{value}-01")
        if not isinstance(value, str) or value != parsed.isoformat()[:7]:
            raise ValueError
    except (ValueError, TypeError) as error:
        raise AppError(400, "bad_request", "Months must use YYYY-MM with a valid year and month.") from error
    return {"year": parsed.year, "month": parsed.month - 1}


def _days(value: Any) -> dict[str, dict[str, Any] | None]:
    if not isinstance(value, dict):
        raise AppError(400, "bad_request", "Days must be an object keyed by YYYY-MM-DD dates.")
    days: dict[str, dict[str, Any] | None] = {}
    for iso_date, changes in value.items():
        try:
            parsed = date.fromisoformat(iso_date)
            if iso_date != parsed.isoformat():
                raise ValueError
        except (ValueError, TypeError) as error:
            raise AppError(400, "bad_request", f"Invalid date: {iso_date}. Use YYYY-MM-DD.") from error
        date_key = f"{parsed.year:04d}-{parsed.month - 1}-{parsed.day}"
        if changes is None:
            days[date_key] = None
            continue
        if not isinstance(changes, dict) or not changes:
            raise AppError(400, "bad_request", "Each day must contain changes, or null to clear the day.")
        _check_fields(changes, {"text", "color", "texture"})
        for field, allowed in (("color", VALID_COLORS), ("texture", VALID_TEXTURES)):
            item = changes.get(field)
            if item is not None and (not isinstance(item, str) or item not in allowed):
                raise AppError(400, "bad_request", f"Invalid {field}. Allowed values: {', '.join(sorted(allowed))}, or null.")
        if changes.get("color") is not None and changes.get("texture") is not None:
            raise AppError(400, "bad_request", "A day can have either a color or a texture.")
        text = changes.get("text")
        if text is not None and (not isinstance(text, str) or len(text) > 500):
            raise AppError(400, "bad_request", "Day text must be a string of at most 500 characters, or null.")
        days[date_key] = {("customText" if field == "text" else field): item for field, item in changes.items()}
    return days


def _calendar_data(calendar: dict[str, Any]) -> dict[str, Any]:
    snapshot = calendar["snapshot"]
    days: dict[str, dict[str, Any]] = {}
    for date_key, cell in snapshot["dateCells"].items():
        year, month, day = map(int, date_key.split("-"))
        iso_date = date(year, month + 1, day).isoformat()
        days[iso_date] = {("text" if field == "customText" else field): item for field, item in cell.items()}
    start = snapshot["monthRange"]["start"]
    end = snapshot["monthRange"]["end"]
    return {
        "calendar_id": calendar["id"],
        "name": snapshot["name"],
        "revision": calendar["revision"],
        "start_month": f"{start['year']:04d}-{start['month'] + 1:02d}",
        "end_month": f"{end['year']:04d}-{end['month'] + 1:02d}",
        "days": dict(sorted(days.items())),
        "created_at": calendar["created_at"],
        "updated_at": calendar["updated_at"],
    }


async def calendars_read(request: web.Request) -> web.Response:
    payload = await read_json(request)
    _check_fields(payload, {"calendar_id"})
    settings: Settings = request.app["settings"]
    calendar = await read_calendar(settings.db_path, _calendar_id(payload))
    if calendar is None:
        raise AppError(404, "not_found", "Calendar does not exist.")
    return ok(_calendar_data(calendar))


async def calendars_update(request: web.Request) -> web.Response:
    require_allowed_origin(request)
    scheme, _, edit_key = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not edit_key or edit_key != edit_key.strip():
        raise AppError(403, "not_allowed", "Use Authorization: Bearer followed by the calendar edit key.")
    payload = await read_json(request)
    _check_fields(payload, {"calendar_id", "expected_revision", "name", "start_month", "end_month", "days"})
    calendar_id = _calendar_id(payload)
    revision = payload.get("expected_revision")
    if type(revision) is not int or revision < 1:
        raise AppError(400, "bad_request", "Expected revision must be a positive integer from the read response.")

    operations: list[dict[str, Any]] = []
    if "name" in payload:
        name = payload["name"]
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 120:
            raise AppError(400, "bad_request", "Name must contain 1 to 120 characters.")
        operations.append({"type": "set_name", "name": name.strip()})
    if "start_month" in payload or "end_month" in payload:
        start = _month(payload.get("start_month"))
        end = _month(payload.get("end_month"))
        if (start["year"], start["month"]) > (end["year"], end["month"]):
            raise AppError(400, "bad_request", "Start month must not be after end month.")
        operations.append({"type": "set_month_range", "monthRange": {"start": start, "end": end}})
    days = _days(payload["days"]) if "days" in payload else {}
    if not operations and not days:
        raise AppError(400, "bad_request", "Provide a name, a month range, or day changes.")

    settings: Settings = request.app["settings"]
    try:
        result = await apply_calendar_patch(settings.db_path, calendar_id, edit_key, operations, expected_revision=revision, days=days)
    except CalendarRevisionConflict as error:
        raise AppError(409, "revision_conflict", str(error)) from error
    if result is None:
        raise AppError(403, "not_allowed", "Edit access is required.")
    calendar, applied_operations = result
    await request.app["ws_hub"].send_to_calendar(
        calendar_id,
        {
            "type": "calendar.patched",
            "calendar_id": calendar_id,
            "revision": calendar["revision"],
            "snapshot": calendar["snapshot"],
            "operations": applied_operations,
        },
    )
    return ok(_calendar_data(calendar))


def setup_calendar_api_routes(app: web.Application) -> None:
    app.router.add_post("/api/calendars/read", calendars_read)
    app.router.add_post("/api/calendars/update", calendars_update)
