"""Read calendars consistently and commit calendar patches in isolated transactions.

Edit this file when calendar revisions, partial day updates, or transaction rules change.
Copy this file when another shared document needs safe batch updates.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.db.calendars import apply_calendar_operations, calendar_can_edit, get_calendar
from backend.db.connection import open_db


class CalendarRevisionConflict(Exception):
    def __init__(self, revision: int) -> None:
        super().__init__(f"Calendar has changed. Read it again before updating. Current revision: {revision}.")


async def read_calendar(db_path: Path, calendar_id: str) -> dict[str, Any] | None:
    db = await open_db(db_path)
    try:
        await db.execute("BEGIN")
        return await get_calendar(db, calendar_id)
    finally:
        await db.close()


async def apply_calendar_patch(
    db_path: Path,
    calendar_id: str,
    edit_key: str,
    operations: list[Any],
    *,
    expected_revision: int | None = None,
    days: dict[str, dict[str, Any] | None] | None = None,
) -> tuple[dict[str, Any], list[Any]] | None:
    db = await open_db(db_path)
    try:
        # The write lock covers the key check, revision check, merge, and commit.
        await db.execute("BEGIN IMMEDIATE")
        if not await calendar_can_edit(db, calendar_id, edit_key):
            await db.rollback()
            return None
        calendar = await get_calendar(db, calendar_id)
        assert calendar is not None
        if expected_revision is not None and calendar["revision"] != expected_revision:
            raise CalendarRevisionConflict(calendar["revision"])

        applied_operations = list(operations)
        for date_key, changes in (days or {}).items():
            if changes is None:
                applied_operations.append({"type": "delete_cell", "date_key": date_key})
                continue
            cell = {**calendar["snapshot"]["dateCells"].get(date_key, {}), **changes}
            if changes.get("color") is not None:
                cell.pop("texture", None)
            if changes.get("texture") is not None:
                cell.pop("color", None)
            applied_operations.append({"type": "set_cell", "date_key": date_key, "cell": cell})

        await apply_calendar_operations(db, calendar_id, applied_operations)
        calendar = await get_calendar(db, calendar_id)
        assert calendar is not None
        await db.commit()
        return calendar, applied_operations
    except Exception:
        await db.rollback()
        raise
    finally:
        await db.close()
