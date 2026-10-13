"""Saved scans load as a light list plus per-picture URLs (not one huge JSON)."""

import base64
from io import BytesIO

from PIL import Image

from test_credits import (  # noqa: F401  (fixtures are used by name)
    _dispose_then, _scan, client, engine, issue_session_token, new_user, run, schema,
)


def test_lite_list_drops_embedded_pictures_and_serves_them_by_url(client):
    uid = run(_dispose_then(new_user()))
    other = run(_dispose_then(new_user()))
    run(engine.dispose())
    token = issue_session_token(uid)
    headers = {"Authorization": f"Bearer {token}"}
    scan = _scan(client, token).json()
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
    assert client.get(f"/api/scans/{sid}/preview?token={issue_session_token(other)}").status_code == 404
    assert client.get(f"/api/scans/{sid}/crops/999?token={token}").status_code == 404
    assert client.get(f"/api/scans/{sid}/preview?w=5000&token={token}").status_code == 422
