"""Saved scans load as a light list plus per-picture URLs (not one huge JSON)."""

import base64
from io import BytesIO

from conftest import _dispose_then, _scan, new_user, run
from PIL import Image

from app.db import engine
from app.services.auth_service import issue_image_token, issue_session_token


def test_lite_list_drops_embedded_pictures_and_serves_them_by_url(client):
    uid = run(_dispose_then(new_user()))
    other = run(_dispose_then(new_user()))
    run(engine.dispose())
    session = issue_session_token(uid)
    headers = {"Authorization": f"Bearer {session}"}
    token = client.get("/api/auth/me", headers=headers).json()["image_token"]
    scan = _scan(client, session).json()
    sid, card = scan["scan_id"], scan["cards"][0]

    full = client.get("/api/scans", headers=headers).json()[0]
    lite = client.get("/api/scans?lite=1", headers=headers).json()[0]
    assert full["image_b64"].startswith("data:image/jpeg;base64,") and full["cards"][0]["crop_b64"]
    assert lite["image_b64"] == "" and lite["cards"][0]["crop_b64"] == ""
    # Everything else is the same.
    strip = lambda s: {**s, "image_b64": "", "cards": [{**c, "crop_b64": ""} for c in s["cards"]]}
    assert strip(full) == lite

    # The pictures the list left out, byte for byte, with a long cache life.
    preview = client.get(f"/api/scans/{sid}/preview?token={token}")
    assert preview.status_code == 200 and preview.headers["content-type"] == "image/jpeg"
    assert preview.content == base64.b64decode(full["image_b64"].split(",", 1)[1])
    assert "immutable" in preview.headers["cache-control"]
    crop = client.get(f"/api/scans/{sid}/crops/{card['id']}?token={token}")
    assert crop.content == base64.b64decode(card["crop_b64"].split(",", 1)[1])

    thumb = client.get(f"/api/scans/{sid}/preview?w=160&token={token}")
    assert max(Image.open(BytesIO(thumb.content)).size) == 160
    assert len(thumb.content) < len(preview.content)

    # Only the owner, and only signed in.
    assert client.get(f"/api/scans/{sid}/preview").status_code == 401
    assert client.get(f"/api/scans/{sid}/preview?token=nonsense").status_code == 401
    assert client.get(f"/api/scans/{sid}/preview?token={issue_image_token(other)}").status_code == 404
    assert client.get(f"/api/scans/{sid}/crops/999?token={token}").status_code == 404
    assert client.get(f"/api/scans/{sid}/preview?w=5000&token={token}").status_code == 422


def test_image_tokens_and_session_tokens_are_not_interchangeable(client):
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    session = issue_session_token(uid)
    image = client.get("/api/auth/me", headers={"Authorization": f"Bearer {session}"}).json()["image_token"]
    sid = _scan(client, session).json()["scan_id"]

    assert client.get(f"/api/scans/{sid}/preview?token={image}").status_code == 200
    # A session token never goes in a URL: image routes refuse it...
    for url in (f"/api/scans/{sid}/preview", f"/api/scans/{sid}/crops/0", "/api/posts/1/image", "/api/orders/1/delivery-photo"):
        assert client.get(f"{url}?token={session}").status_code == 401, url
    # ...and the image token opens nothing else.
    assert client.get("/api/scans", headers={"Authorization": f"Bearer {image}"}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {image}"}).status_code == 401


def test_ui_state_round_trip(client):
    uid, other = run(_dispose_then(new_user())), run(_dispose_then(new_user()))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    them = {"Authorization": f"Bearer {issue_session_token(other)}"}
    sid = _scan(client, issue_session_token(uid)).json()["scan_id"]
    state_of = lambda: next(s["ui_state"] for s in client.get("/api/scans?lite=1", headers=me).json() if s["scan_id"] == sid)

    assert state_of() is None
    edits = {"isFoil": [True], "priceOverride": [None], "removed": [False]}
    assert client.patch(f"/api/scans/{sid}/state", json={"state": edits}, headers=me).status_code == 204
    assert state_of() == edits
    assert client.get("/api/scans", headers=me).json()[0]["ui_state"] == edits     # full list too

    assert client.patch(f"/api/scans/{sid}/state", json={"state": {"x": "y" * 70_000}}, headers=me).status_code == 413
    assert client.patch(f"/api/scans/{sid}/state", json={"state": [1, 2]}, headers=me).status_code == 422
    assert client.patch(f"/api/scans/{sid}/state", json={"state": {}}, headers=them).status_code == 404
    assert state_of() == edits


def test_before_pages_back_through_scans(client):
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    token = issue_session_token(uid)
    me = {"Authorization": f"Bearer {token}"}
    ids = [_scan(client, token).json()["scan_id"] for _ in range(5)]

    page = lambda q: [s["scan_id"] for s in client.get(f"/api/scans?lite=1&{q}", headers=me).json()]
    assert page("limit=2") == ids[:-3:-1]
    assert page(f"limit=2&before={ids[3]}") == [ids[2], ids[1]]
    assert page(f"limit=2&before={ids[1]}") == [ids[0]]
    assert page(f"limit=2&before={ids[0]}") == []
