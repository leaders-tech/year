"""Handle the websocket endpoint, ping messages, and calendar subscriptions.

Edit this file when websocket auth, message types, or connection flow changes.
Copy the route pattern here when you add another websocket endpoint.
"""

from __future__ import annotations

import json

from aiohttp import WSMsgType, web

from backend.auth.access import current_user
from backend.http.middleware import require_allowed_origin


async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
    require_allowed_origin(request)
    user = current_user(request)
    ws = web.WebSocketResponse(heartbeat=30.0)
    await ws.prepare(request)

    hub = request.app["ws_hub"]
    if user is not None:
        hub.add(user["id"], ws)
    await ws.send_json(
        {
            "type": "ws.ready",
            "user_id": user["id"] if user is not None else None,
            "connections": hub.count_for_user(user["id"]) if user is not None else 0,
        }
    )

    try:
        async for message in ws:
            if message.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(message.data)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "code": "bad_request", "message": "WebSocket message must be valid JSON."})
                continue
            if not isinstance(data, dict):
                await ws.send_json({"type": "error", "code": "bad_request", "message": "WebSocket message must be an object."})
                continue
            message_type = data.get("type")
            if message_type == "ping":
                await ws.send_json({"type": "pong"})
            elif message_type == "calendar.subscribe":
                calendar_id = data.get("calendar_id")
                if not isinstance(calendar_id, str) or not calendar_id.strip():
                    await ws.send_json({"type": "error", "code": "bad_request", "message": "Calendar id is required."})
                    continue
                calendar_id = calendar_id.strip()
                hub.subscribe_calendar(calendar_id, ws)
                await ws.send_json(
                    {
                        "type": "calendar.subscribed",
                        "calendar_id": calendar_id,
                        "connections": hub.count_for_calendar(calendar_id),
                    }
                )
    finally:
        if user is not None:
            hub.remove(user["id"], ws)
        hub.unsubscribe_all_calendars(ws)

    return ws


def setup_ws_routes(app: web.Application) -> None:
    app.router.add_get("/ws", websocket_handler)
