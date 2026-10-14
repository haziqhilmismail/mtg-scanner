"""Pricing settings per post."""

import json

from conftest import _dispose_then, _photo, new_user, run

from app.db import engine
from app.services.auth_service import issue_session_token

PRICING = {"multNormal": 2.8, "multFoil": 3.0, "currencyLabel": "RM", "roundStep": 0.5}


def _users(n):
    ids = [run(_dispose_then(new_user())) for _ in range(n)]
    run(engine.dispose())
    return [{"Authorization": f"Bearer {issue_session_token(i)}"} for i in ids]


def test_post_pricing(client):
    me, them = _users(2)
    pic = {"image": ("a.jpg", _photo(), "image/jpeg")}
    r = client.post("/api/posts", data={"title": "Friday", "pricing": json.dumps(PRICING)}, files=pic, headers=me)
    assert r.status_code == 201 and r.json()["pricing"] == PRICING
    pid = r.json()["id"]
    plain = client.post("/api/posts", data={"title": "Sunday"}, headers=me).json()
    assert plain["pricing"] is None

    single = lambda: client.get(f"/api/posts/{pid}", headers=me).json()["pricing"]
    listed = lambda: next(p["pricing"] for p in client.get("/api/posts", headers=me).json() if p["id"] == pid)
    assert single() == listed() == PRICING

    for bad in ("not json", "[1, 2]", '"x"'):
        assert client.post("/api/posts", data={"pricing": bad}, headers=me).status_code == 422
    big = json.dumps({"x": "y" * 9000})
    assert client.post("/api/posts", data={"pricing": big}, headers=me).status_code == 413

    patch = lambda body, h=me: client.patch(f"/api/posts/{pid}", json=body, headers=h)
    changed = {**PRICING, "multNormal": 3.5}
    assert patch({"pricing": changed}).json()["pricing"] == changed
    assert patch({"title": "Friday drop"}).json()["pricing"] == changed      # omitted: unchanged
    assert patch({"pricing": [1]}).status_code == 422
    assert patch({"pricing": {"x": "y" * 9000}}).status_code == 413
    assert patch({"pricing": {}}, them).status_code == 404
    assert single() == listed() == changed
    assert patch({"pricing": None}).json()["pricing"] is None                 # null clears
    assert single() is None and listed() is None

