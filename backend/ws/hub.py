"""Track live websocket connections by user or calendar and send messages to them.

Edit this file when websocket connection storage or fan-out behavior changes.
Copy the helper style here when you add another small websocket utility.
"""

from __future__ import annotations

from collections import defaultdict
from weakref import WeakSet

from aiohttp import web


class WebSocketHub:
    def __init__(self) -> None:
        self._connections: dict[int, WeakSet[web.WebSocketResponse]] = defaultdict(WeakSet)
        self._calendar_connections: dict[str, WeakSet[web.WebSocketResponse]] = defaultdict(WeakSet)

    def add(self, user_id: int, ws: web.WebSocketResponse) -> None:
        self._connections[user_id].add(ws)

    def remove(self, user_id: int, ws: web.WebSocketResponse) -> None:
        sockets = self._connections.get(user_id)
        if sockets is None:
            return
        sockets.discard(ws)
        if len(sockets) == 0:
            self._connections.pop(user_id, None)

    async def send_to_user(self, user_id: int, message: dict[str, object]) -> None:
        sockets = list(self._connections.get(user_id, ()))
        for ws in sockets:
            if ws.closed:
                self.remove(user_id, ws)
                continue
            await ws.send_json(message)

    def count_for_user(self, user_id: int) -> int:
        return len(self._connections.get(user_id, ()))

    def subscribe_calendar(self, calendar_id: str, ws: web.WebSocketResponse) -> None:
        self._calendar_connections[calendar_id].add(ws)

    def unsubscribe_all_calendars(self, ws: web.WebSocketResponse) -> None:
        empty_calendar_ids: list[str] = []
        for calendar_id, sockets in self._calendar_connections.items():
            sockets.discard(ws)
            if len(sockets) == 0:
                empty_calendar_ids.append(calendar_id)
        for calendar_id in empty_calendar_ids:
            self._calendar_connections.pop(calendar_id, None)

    async def send_to_calendar(self, calendar_id: str, message: dict[str, object]) -> None:
        sockets = list(self._calendar_connections.get(calendar_id, ()))
        for ws in sockets:
            if ws.closed:
                self.unsubscribe_all_calendars(ws)
                continue
            await ws.send_json(message)

    def count_for_calendar(self, calendar_id: str) -> int:
        return len(self._calendar_connections.get(calendar_id, ()))
