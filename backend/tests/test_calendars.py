"""Test calendar create, load, patch, permissions, and realtime broadcasts.

Edit this file when calendar API or websocket sync behavior changes.
Copy a test pattern here when you add another shared document endpoint.
"""

from __future__ import annotations

import pytest


async def _create_calendar(client, headers: dict[str, str]) -> dict[str, object]:
    response = await client.post("/api/calendars/create", json={"name": "School year"}, headers=headers)
    assert response.status == 200
    return (await response.json())["data"]


@pytest.mark.asyncio
async def test_calendar_create_and_load_links(client, auth_headers) -> None:
    created = await _create_calendar(client, auth_headers)
    calendar_id = created["calendar_id"]
    edit_key = created["edit_key"]

    view_response = await client.post("/api/calendars/load", json={"calendar_id": calendar_id})
    assert view_response.status == 200
    view_data = (await view_response.json())["data"]
    assert view_data["can_edit"] is False
    assert view_data["calendar"]["snapshot"]["name"] == "School year"
    assert view_data["view_url"].endswith(f"/calendar/{calendar_id}")
    assert "edit_url" not in view_data

    edit_response = await client.post("/api/calendars/load", json={"calendar_id": calendar_id, "edit_key": edit_key})
    assert edit_response.status == 200
    edit_data = (await edit_response.json())["data"]
    assert edit_data["can_edit"] is True
    assert edit_data["edit_url"].endswith(f"/calendar/{calendar_id}/edit/{edit_key}")


@pytest.mark.asyncio
async def test_calendar_patch_requires_edit_key(client, auth_headers) -> None:
    created = await _create_calendar(client, auth_headers)
    calendar_id = created["calendar_id"]

    missing_response = await client.post(
        "/api/calendars/patch",
        json={"calendar_id": calendar_id, "operations": [{"type": "set_name", "name": "Nope"}]},
        headers=auth_headers,
    )
    assert missing_response.status == 403

    wrong_response = await client.post(
        "/api/calendars/patch",
        json={"calendar_id": calendar_id, "edit_key": "wrong", "operations": [{"type": "set_name", "name": "Nope"}]},
        headers=auth_headers,
    )
    assert wrong_response.status == 403


@pytest.mark.asyncio
async def test_cell_patches_do_not_overwrite_unrelated_cells(client, auth_headers) -> None:
    created = await _create_calendar(client, auth_headers)
    calendar_id = created["calendar_id"]
    edit_key = created["edit_key"]

    first_response = await client.post(
        "/api/calendars/patch",
        json={
            "calendar_id": calendar_id,
            "edit_key": edit_key,
            "operations": [{"type": "set_cell", "date_key": "2026-0-1", "cell": {"color": "blue"}}],
        },
        headers=auth_headers,
    )
    assert first_response.status == 200

    second_response = await client.post(
        "/api/calendars/patch",
        json={
            "calendar_id": calendar_id,
            "edit_key": edit_key,
            "operations": [{"type": "set_cell", "date_key": "2026-0-2", "cell": {"customText": "Exam"}}],
        },
        headers=auth_headers,
    )
    assert second_response.status == 200

    load_response = await client.post("/api/calendars/load", json={"calendar_id": calendar_id})
    snapshot = (await load_response.json())["data"]["calendar"]["snapshot"]
    assert snapshot["dateCells"]["2026-0-1"] == {"color": "blue"}
    assert snapshot["dateCells"]["2026-0-2"] == {"customText": "Exam"}


@pytest.mark.asyncio
async def test_metadata_patch_updates_revision(client, auth_headers) -> None:
    created = await _create_calendar(client, auth_headers)
    calendar_id = created["calendar_id"]
    edit_key = created["edit_key"]
    initial_revision = created["calendar"]["revision"]

    response = await client.post(
        "/api/calendars/patch",
        json={
            "calendar_id": calendar_id,
            "edit_key": edit_key,
            "operations": [
                {"type": "set_name", "name": "Renamed year"},
                {"type": "set_selected_view", "selectedView": "Classic"},
            ],
        },
        headers=auth_headers,
    )
    assert response.status == 200
    calendar = (await response.json())["data"]["calendar"]
    assert calendar["revision"] == initial_revision + 1
    assert calendar["snapshot"]["name"] == "Renamed year"
    assert calendar["snapshot"]["selectedView"] == "Classic"


@pytest.mark.asyncio
async def test_calendar_patch_broadcasts_to_anonymous_websocket(client, auth_headers) -> None:
    created = await _create_calendar(client, auth_headers)
    calendar_id = created["calendar_id"]
    edit_key = created["edit_key"]

    ws = await client.ws_connect("/ws")
    ready = await ws.receive_json()
    assert ready["type"] == "ws.ready"
    assert ready["user_id"] is None

    await ws.send_json({"type": "calendar.subscribe", "calendar_id": calendar_id})
    subscribed = await ws.receive_json()
    assert subscribed["type"] == "calendar.subscribed"

    response = await client.post(
        "/api/calendars/patch",
        json={
            "calendar_id": calendar_id,
            "edit_key": edit_key,
            "client_id": "test-client",
            "operations": [{"type": "set_cell", "date_key": "2026-0-3", "cell": {"texture": "polka-dots"}}],
        },
        headers=auth_headers,
    )
    assert response.status == 200

    message = await ws.receive_json()
    assert message["type"] == "calendar.patched"
    assert message["calendar_id"] == calendar_id
    assert message["client_id"] == "test-client"
    assert message["snapshot"]["dateCells"]["2026-0-3"] == {"texture": "polka-dots"}

    await ws.close()
