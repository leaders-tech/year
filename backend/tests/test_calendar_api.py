"""Test ISO calendar reads, partial updates, edit keys, conflicts, and atomic writes.

Edit this file when the calendar integration API or transaction behavior changes.
Copy these tests when another document API needs safe updates without browser login.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from backend.db.calendar_patches import apply_calendar_patch


pytestmark = pytest.mark.asyncio


async def create(client):
    response = await client.post("/api/calendars/create", json={"name": "API year", "year": 2026})
    assert response.status == 200
    return (await response.json())["data"]


async def read(client, calendar_id):
    response = await client.post("/api/calendars/read", json={"calendar_id": calendar_id})
    assert response.status == 200
    return (await response.json())["data"]


async def update(client, created, revision=1, **changes):
    return await client.post(
        "/api/calendars/update",
        headers={"Authorization": f"Bearer {created['edit_key']}"},
        json={"calendar_id": created["calendar_id"], "expected_revision": revision, **changes},
    )


async def test_read_converts_browser_cells_to_sorted_iso_days(client):
    created = await create(client)
    response = await client.post(
        "/api/calendars/patch",
        json={
            "calendar_id": created["calendar_id"],
            "edit_key": created["edit_key"],
            "operations": [
                {"type": "set_cell", "date_key": "2026-9-8", "cell": {"color": "blue", "customText": "Exam"}},
                {"type": "set_cell", "date_key": "2026-0-1", "cell": {"texture": "polka-dots"}},
            ],
        },
    )
    assert response.status == 200
    data = await read(client, created["calendar_id"])
    assert data["calendar_id"] == created["calendar_id"]
    assert data["name"] == "API year"
    assert data["revision"] == 2
    assert data["start_month"] == "2026-01"
    assert data["end_month"] == "2026-12"
    assert list(data["days"]) == ["2026-01-01", "2026-10-08"]
    assert data["days"]["2026-10-08"] == {"color": "blue", "text": "Exam"}
    assert data["days"]["2026-01-01"] == {"texture": "polka-dots"}
    assert data["created_at"]
    assert data["updated_at"]
    assert created["edit_key"] not in json.dumps(data)


async def test_batch_update_preserves_omitted_fields_and_unrelated_days(client):
    created = await create(client)
    first = await update(client, created, days={"2026-10-08": {"color": "blue", "text": "Exam"}, "2026-10-09": {"text": "Keep"}})
    assert first.status == 200
    second = await update(
        client,
        created,
        revision=2,
        name="New name",
        start_month="2026-09",
        end_month="2027-08",
        days={"2026-10-08": {"text": "Updated"}, "2027-01-01": {"texture": "square-net"}},
    )
    assert second.status == 200
    data = (await second.json())["data"]
    assert data["revision"] == 3
    assert data["name"] == "New name"
    assert data["start_month"] == "2026-09"
    assert data["end_month"] == "2027-08"
    assert data["days"] == {
        "2026-10-08": {"color": "blue", "text": "Updated"},
        "2026-10-09": {"text": "Keep"},
        "2027-01-01": {"texture": "square-net"},
    }
    assert await read(client, created["calendar_id"]) == data


async def test_clear_fields_switch_fill_and_clear_whole_day(client):
    created = await create(client)
    response = await update(client, created, days={"2026-10-08": {"color": "red", "text": "Trip"}})
    assert response.status == 200
    response = await update(client, created, revision=2, days={"2026-10-08": {"texture": "diagonal-stripes", "text": None}})
    assert (await response.json())["data"]["days"] == {"2026-10-08": {"texture": "diagonal-stripes"}}
    response = await update(client, created, revision=3, days={"2026-10-08": {"color": "green"}})
    assert (await response.json())["data"]["days"] == {"2026-10-08": {"color": "green"}}
    response = await update(client, created, revision=4, days={"2026-10-08": {"color": None}})
    assert (await response.json())["data"]["days"] == {}
    response = await update(client, created, revision=5, days={"2026-10-08": {"text": "Clear me"}})
    assert response.status == 200
    response = await update(client, created, revision=6, days={"2026-10-08": None})
    assert (await response.json())["data"]["days"] == {}


async def test_leap_day_and_text_limits(client):
    created = await create(client)
    response = await update(client, created, name="a" * 120, days={"2028-02-29": {"text": "a" * 500}})
    assert response.status == 200
    assert (await response.json())["data"]["days"]["2028-02-29"]["text"] == "a" * 500
    response = await update(client, created, revision=2, days={"2028-02-29": {"text": "   "}})
    assert (await response.json())["data"]["days"] == {}


@pytest.mark.parametrize("authorization", [None, "Bearer wrong", "Basic wrong", "Bearer", "Bearer "])
async def test_update_requires_bearer_edit_key(client, authorization):
    created = await create(client)
    headers = {} if authorization is None else {"Authorization": authorization}
    response = await client.post(
        "/api/calendars/update",
        headers=headers,
        json={"calendar_id": created["calendar_id"], "expected_revision": 1, "name": "No access"},
    )
    assert response.status == 403
    assert (await read(client, created["calendar_id"]))["revision"] == 1


async def test_edit_key_is_scoped_to_its_calendar(client):
    first = await create(client)
    second = await create(client)
    response = await update(client, {**second, "edit_key": first["edit_key"]}, name="No access")
    assert response.status == 403
    missing = await update(client, {**first, "calendar_id": "missing"}, name="No access")
    assert missing.status == 403
    assert (await read(client, second["calendar_id"]))["revision"] == 1


async def test_stale_revision_rejects_all_changes_after_browser_patch(client):
    created = await create(client)
    response = await client.post(
        "/api/calendars/patch",
        json={"calendar_id": created["calendar_id"], "edit_key": created["edit_key"], "operations": [{"type": "set_name", "name": "Browser name"}]},
    )
    assert response.status == 200
    response = await update(client, created, name="Stale name", days={"2026-10-08": {"text": "Stale day"}})
    assert response.status == 409
    assert (await response.json())["error"]["code"] == "revision_conflict"
    data = await read(client, created["calendar_id"])
    assert data["name"] == "Browser name"
    assert data["revision"] == 2
    assert data["days"] == {}


async def test_concurrent_updates_with_same_revision_have_one_winner(client):
    created = await create(client)
    responses = await asyncio.gather(update(client, created, name="First"), update(client, created, name="Second"))
    assert sorted(response.status for response in responses) == [200, 409]
    data = await read(client, created["calendar_id"])
    assert data["revision"] == 2
    assert data["name"] in {"First", "Second"}


@pytest.mark.parametrize(
    "changes",
    [
        {},
        {"unexpected": True},
        {"days": {}},
        {"days": []},
        {"days": None},
        {"days": {"2026-10-08": {}}},
        {"days": {"2026-10-08": []}},
        {"days": {"2026-02-29": {"text": "Invalid"}}},
        {"days": {"2026-13-01": None}},
        {"days": {"2026-1-1": None}},
        {"days": {"20261008": None}},
        {"days": {"2026-10-08": {"customText": "Wrong field"}}},
        {"days": {"2026-10-08": {"color": "black"}}},
        {"days": {"2026-10-08": {"color": []}}},
        {"days": {"2026-10-08": {"texture": {}}}},
        {"days": {"2026-10-08": {"color": "blue", "texture": "polka-dots"}}},
        {"days": {"2026-10-08": {"text": 1}}},
        {"days": {"2026-10-08": {"text": "a" * 501}}},
        {"name": " "},
        {"name": 1},
        {"name": "a" * 121},
        {"start_month": "2026-01"},
        {"end_month": "2026-12"},
        {"start_month": "2026-13", "end_month": "2027-01"},
        {"start_month": "2026-1", "end_month": "2027-01"},
        {"start_month": "2026-10", "end_month": "2026-09"},
        {"expected_revision": None, "name": "Valid"},
        {"expected_revision": True, "name": "Valid"},
        {"expected_revision": 0, "name": "Valid"},
        {"expected_revision": 1.0, "name": "Valid"},
        {"calendar_id": None, "name": "Valid"},
    ],
)
async def test_invalid_updates_return_400_without_writes(client, changes):
    created = await create(client)
    payload = {"calendar_id": created["calendar_id"], "expected_revision": 1, **changes}
    response = await client.post("/api/calendars/update", headers={"Authorization": f"Bearer {created['edit_key']}"}, json=payload)
    assert response.status == 400
    assert (await response.json())["error"]["code"] == "bad_request"
    data = await read(client, created["calendar_id"])
    assert data["revision"] == 1
    assert data["name"] == "API year"
    assert data["days"] == {}


async def test_invalid_day_keeps_other_valid_changes_atomic(client):
    created = await create(client)
    response = await update(client, created, name="Do not save", days={"2026-10-08": {"text": "Do not save"}, "2026-02-30": None})
    assert response.status == 400
    assert (await read(client, created["calendar_id"]))["revision"] == 1


async def test_db_error_rolls_back_legacy_batch_and_releases_write_lock(client, test_settings):
    created = await create(client)
    with pytest.raises(ValueError):
        await apply_calendar_patch(
            test_settings.db_path,
            created["calendar_id"],
            created["edit_key"],
            [{"type": "set_name", "name": "Rolled back"}, {"type": "unknown"}],
        )
    assert (await read(client, created["calendar_id"]))["name"] == "API year"
    response = await update(client, created, name="After rollback")
    assert response.status == 200
    assert (await response.json())["data"]["revision"] == 2


async def test_read_errors_and_invalid_json_use_shared_envelope(client):
    response = await client.post("/api/calendars/read", json={"calendar_id": "missing"})
    assert response.status == 404
    assert (await response.json())["error"]["code"] == "not_found"
    for payload in [{}, {"calendar_id": 1}, {"calendar_id": "x", "extra": True}, []]:
        response = await client.post("/api/calendars/read", json=payload)
        assert response.status == 400
    for body, content_type in [("{", "application/json"), ("{}", "text/plain")]:
        response = await client.post("/api/calendars/read", data=body, headers={"Content-Type": content_type})
        assert response.status == 400
        assert (await response.json())["error"]["code"] == "bad_request"


@pytest.mark.parametrize("year", [True, 0, 10000, "2026", 2026.5, None])
async def test_create_rejects_invalid_years(client, year):
    response = await client.post("/api/calendars/create", json={"year": year})
    assert response.status == 400


@pytest.mark.parametrize("payload", [{"name": None}, {"name": 1}, {"name": " "}, {"name": "a" * 121}, {"extra": True}])
async def test_create_rejects_invalid_names_and_unknown_fields(client, payload):
    response = await client.post("/api/calendars/create", json=payload)
    assert response.status == 400
    assert (await response.json())["error"]["code"] == "bad_request"


async def test_create_without_login_returns_edit_key_and_requested_year(client):
    response = await client.post("/api/calendars/create", json={"name": "  Future year  ", "year": 2028})
    assert response.status == 200
    data = (await response.json())["data"]
    assert data["edit_key"]
    assert data["edit_url"].endswith(f"/calendar/{data['calendar_id']}/edit/{data['edit_key']}")
    assert data["view_url"].endswith(f"/calendar/{data['calendar_id']}")
    calendar = await read(client, data["calendar_id"])
    assert calendar["name"] == "Future year"
    assert calendar["start_month"] == "2028-01"
    assert calendar["end_month"] == "2028-12"
    assert calendar["revision"] == 1
    assert calendar["days"] == {}


async def test_update_keeps_origin_checks(client):
    created = await create(client)
    response = await client.post(
        "/api/calendars/update",
        headers={"Authorization": f"Bearer {created['edit_key']}", "Origin": "https://other.example"},
        json={"calendar_id": created["calendar_id"], "expected_revision": 1, "name": "Blocked"},
    )
    assert response.status == 403
    assert (await response.json())["error"]["code"] == "forbidden_origin"


async def test_update_broadcasts_merged_browser_snapshot_without_edit_key(client):
    created = await create(client)
    ws = await client.ws_connect("/ws")
    await ws.receive_json()
    await ws.send_json({"type": "calendar.subscribe", "calendar_id": created["calendar_id"]})
    await ws.receive_json()
    response = await update(client, created, days={"2026-10-08": {"color": "blue", "text": "API day"}})
    assert response.status == 200
    message = await ws.receive_json(timeout=2)
    assert message["type"] == "calendar.patched"
    assert message["calendar_id"] == created["calendar_id"]
    assert message["revision"] == 2
    assert message["snapshot"]["dateCells"] == {"2026-9-8": {"color": "blue", "customText": "API day"}}
    assert message["operations"] == [{"type": "set_cell", "date_key": "2026-9-8", "cell": {"color": "blue", "customText": "API day"}}]
    assert created["edit_key"] not in json.dumps(message)
    await ws.close()
