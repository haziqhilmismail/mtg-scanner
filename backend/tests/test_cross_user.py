"""One user can never reach another user's scans, posts or orders."""

import json

import pytest
from conftest import _dispose_then, _photo, new_user, run

from app.db import engine
from app.services.auth_service import issue_session_token

# (method, url, body) — {scan}/{post}/{order} are the owner's ids. "img" routes
# authenticate with ?token=<image token>, the rest with the bearer header.
CASES = {
    "export": ("post", "/api/export", lambda ids: {"data": {"payload": json.dumps({"image_id": str(ids["scan"]), "cards": []})}}),
    "export-all": ("post", "/api/export-all", lambda ids: {"data": {"payload": json.dumps({"images": [{"image_id": str(ids["scan"]), "cards": []}]})}}),
    "scan state": ("patch", "/api/scans/{scan}/state", lambda ids: {"json": {"state": {}}}),
    "frame card": ("post", "/api/scans/{scan}/frame-card", lambda ids: {"data": {"payload": json.dumps({"corners": [[0, 0], [99, 0], [99, 99], [0, 99]], "skip_identify": True})}}),
    "card correction": ("put", "/api/scans/{scan}/cards/0/correction", lambda ids: {"json": {"scryfall_id": "729877be-4894-4ef5-9e60-de8a8fb2bdc0", "kind": "pick"}}),
    "order": ("get", "/api/orders/{order}", None),
    "scan preview": ("img", "/api/scans/{scan}/preview", None),
    "scan crop": ("img", "/api/scans/{scan}/crops/0", None),
    "post image": ("img", "/api/posts/{post}/image", None),
    "delivery photo": ("img", "/api/orders/{order}/delivery-photo", None),
}


@pytest.mark.parametrize("case", CASES)
def test_other_users_get_404(client, case):
    owner, other = run(_dispose_then(new_user())), run(_dispose_then(new_user()))
    run(engine.dispose())
    a = {"Authorization": f"Bearer {issue_session_token(owner)}"}
    b = {"Authorization": f"Bearer {issue_session_token(other)}"}
    pic = lambda: {"image": ("a.jpg", _photo(), "image/jpeg")}

    post = client.post("/api/posts", data={"title": "Friday"}, files=pic(), headers=a).json()["id"]
    scan = client.post("/api/scan", files=pic(), headers=a).json()["scan_id"]
    item = {"scan_id": scan, "card_id": 0, "bbox": [0, 0, 50, 70], "name": "Sol Ring", "unit_price_myr": "9.00"}
    order = client.post("/api/claims/confirm", json={"claims": [{"buyer": "Aiman", "items": [item]}]}, headers=a).json()[0]["id"]
    assert client.post(f"/api/orders/{order}/delivery-photo", files=pic(), headers=a).status_code == 200
    ids = {"scan": scan, "post": post, "order": order}

    method, url, body = CASES[case]
    url = url.format(**ids)

    def call(headers):
        if method == "img":
            token = client.get("/api/auth/me", headers=headers).json()["image_token"]
            return client.get(f"{url}?token={token}")
        return client.request(method.upper(), url, headers=headers, **(body(ids) if body else {}))

    assert call(a).status_code in (200, 204)
    assert call(b).status_code == 404
