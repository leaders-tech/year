"""Handle non-auth JSON endpoints such as health, calendars, notes, and admin user list.

Edit this file when app endpoints outside the auth and websocket groups change.
Copy the route pattern here when you add another endpoint group backed by backend/db code.
"""

from __future__ import annotations

from datetime import UTC, datetime

from aiohttp import web

from backend.auth.access import require_admin, require_user
from backend.config import Settings
from backend.db.calendars import apply_calendar_patch, calendar_can_edit, create_calendar, get_calendar
from backend.db.notes import delete_note, list_notes, save_note
from backend.db.users import list_users
from backend.http.json_api import AppError, ok, read_json
from backend.http.middleware import require_allowed_origin


async def health(request: web.Request) -> web.Response:
    return ok({"status": "ok"})


def _calendar_origin(request: web.Request) -> str:
    settings: Settings = request.app["settings"]
    origin = request.headers.get("Origin", "").rstrip("/")
    if origin and origin in settings.allowed_origins:
        return origin
    return settings.frontend_origin


def _calendar_urls(request: web.Request, calendar_id: str, edit_key: str | None = None) -> dict[str, str]:
    origin = _calendar_origin(request)
    urls = {
        "view_url": f"{origin}/calendar/{calendar_id}",
    }
    if edit_key:
        urls["edit_url"] = f"{origin}/calendar/{calendar_id}/edit/{edit_key}"
    return urls


def _read_calendar_id(payload: dict[str, object]) -> str:
    calendar_id = payload.get("calendar_id")
    if not isinstance(calendar_id, str) or not calendar_id.strip():
        raise AppError(400, "bad_request", "Calendar id is required.")
    return calendar_id.strip()


async def calendars_create(request: web.Request) -> web.Response:
    require_allowed_origin(request)
    payload = await read_json(request)
    name = str(payload.get("name") or "My year").strip()[:120] or "My year"
    year = datetime.now(tz=UTC).year
    created = await create_calendar(request.app["db"], year, name)
    urls = _calendar_urls(request, created.calendar_id, created.edit_key)
    return ok(
        {
            "calendar_id": created.calendar_id,
            "edit_key": created.edit_key,
            "calendar": created.calendar,
            **urls,
        }
    )


async def calendars_load(request: web.Request) -> web.Response:
    payload = await read_json(request)
    calendar_id = _read_calendar_id(payload)
    raw_edit_key = payload.get("edit_key")
    edit_key = raw_edit_key if isinstance(raw_edit_key, str) and raw_edit_key.strip() else None
    calendar = await get_calendar(request.app["db"], calendar_id)
    if calendar is None:
        raise AppError(404, "not_found", "Calendar does not exist.")
    can_edit = await calendar_can_edit(request.app["db"], calendar_id, edit_key)
    return ok(
        {
            "calendar": calendar,
            "can_edit": can_edit,
            **_calendar_urls(request, calendar_id, edit_key if can_edit else None),
        }
    )


async def calendars_patch(request: web.Request) -> web.Response:
    require_allowed_origin(request)
    payload = await read_json(request)
    calendar_id = _read_calendar_id(payload)
    raw_edit_key = payload.get("edit_key")
    if not isinstance(raw_edit_key, str) or not raw_edit_key.strip():
        raise AppError(403, "not_allowed", "Edit access is required.")
    operations = payload.get("operations")
    if not isinstance(operations, list):
        raise AppError(400, "bad_request", "Patch operations are required.")

    try:
        calendar = await apply_calendar_patch(request.app["db"], calendar_id, raw_edit_key, operations)
    except ValueError as error:
        raise AppError(400, "bad_request", str(error)) from error

    if calendar is None:
        raise AppError(403, "not_allowed", "Edit access is required.")

    message = {
        "type": "calendar.patched",
        "calendar_id": calendar_id,
        "revision": calendar["revision"],
        "snapshot": calendar["snapshot"],
        "operations": operations,
    }
    client_id = payload.get("client_id")
    if isinstance(client_id, str) and client_id:
        message["client_id"] = client_id
    await request.app["ws_hub"].send_to_calendar(calendar_id, message)
    return ok({"calendar": calendar})


async def notes_list(request: web.Request) -> web.Response:
    user = require_user(request)
    notes = await list_notes(request.app["db"], user["id"])
    return ok({"notes": notes})


async def notes_save(request: web.Request) -> web.Response:
    require_allowed_origin(request)
    user = require_user(request)
    payload = await read_json(request)
    note_id = payload.get("id")
    text = str(payload.get("text", "")).strip()
    if not text:
        raise AppError(400, "bad_request", "Note text is required.")
    if note_id is not None and not isinstance(note_id, int):
        raise AppError(400, "bad_request", "Note id must be an integer.")
    note = await save_note(request.app["db"], user["id"], text, note_id)
    await request.app["ws_hub"].send_to_user(user["id"], {"type": "notes.changed", "note": note})
    return ok({"note": note})


async def notes_delete(request: web.Request) -> web.Response:
    require_allowed_origin(request)
    user = require_user(request)
    payload = await read_json(request)
    note_id = payload.get("id")
    if not isinstance(note_id, int):
        raise AppError(400, "bad_request", "Note id must be an integer.")
    deleted = await delete_note(request.app["db"], user["id"], note_id)
    if not deleted:
        raise AppError(404, "not_found", "Note does not exist.")
    await request.app["ws_hub"].send_to_user(user["id"], {"type": "notes.changed", "note_id": note_id})
    return ok({"deleted": True, "id": note_id})


async def admin_users_list(request: web.Request) -> web.Response:
    require_admin(request)
    users = await list_users(request.app["db"])
    return ok({"users": users})


def setup_api_routes(app: web.Application) -> None:
    app.router.add_get("/api/health", health)
    app.router.add_post("/api/calendars/create", calendars_create)
    app.router.add_post("/api/calendars/load", calendars_load)
    app.router.add_post("/api/calendars/patch", calendars_patch)
    app.router.add_post("/api/notes/list", notes_list)
    app.router.add_post("/api/notes/save", notes_save)
    app.router.add_post("/api/notes/delete", notes_delete)
    app.router.add_post("/api/admin/users/list", admin_users_list)
