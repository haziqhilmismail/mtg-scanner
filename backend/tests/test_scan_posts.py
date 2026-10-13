"""Scans are filed under posts: upload into one, move between them, unfile on delete."""

from test_credits import (  # noqa: F401  (fixtures are used by name)
    _dispose_then, _photo, client, engine, issue_session_token, new_user, run, schema,
)


def _upload(client, headers, post_id=None):
    data = {"post_id": str(post_id)} if post_id is not None else {}
    r = client.post("/api/scan", files={"image": ("a.jpg", _photo(), "image/jpeg")}, data=data, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _by_post(client, headers):
    return {s["scan_id"]: s["post_id"] for s in client.get("/api/scans?lite=1&limit=500", headers=headers).json()}


def test_scans_follow_their_post(client):
    uid, other = run(_dispose_then(new_user())), run(_dispose_then(new_user()))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    them = {"Authorization": f"Bearer {issue_session_token(other)}"}

    friday = client.post("/api/posts", data={"title": "Friday"}, headers=me).json()["id"]
    sunday = client.post("/api/posts", data={"title": "Sunday"}, headers=me).json()["id"]
    theirs = client.post("/api/posts", data={"title": "Not mine"}, headers=them).json()["id"]

    a = _upload(client, me, friday)
    b = _upload(client, me, friday)
    c = _upload(client, me)                      # no post: unfiled
    assert (a["post_id"], c["post_id"]) == (friday, None)
    assert _by_post(client, me) == {a["scan_id"]: friday, b["scan_id"]: friday, c["scan_id"]: None}

    # Can't file into someone else's post, on upload or by moving.
    r = client.post("/api/scan", files={"image": ("a.jpg", _photo(), "image/jpeg")}, data={"post_id": str(theirs)}, headers=me)
    assert r.status_code == 404
    assert client.post("/api/scans/move", json={"scan_ids": [a["scan_id"]], "post_id": theirs}, headers=me).status_code == 404
    # ...and can't move someone else's scans.
    assert client.post("/api/scans/move", json={"scan_ids": [a["scan_id"]], "post_id": None}, headers=them).status_code == 204
    assert _by_post(client, me)[a["scan_id"]] == friday

    assert client.post("/api/scans/move", json={"scan_ids": [b["scan_id"], c["scan_id"]], "post_id": sunday}, headers=me).status_code == 204
    assert _by_post(client, me) == {a["scan_id"]: friday, b["scan_id"]: sunday, c["scan_id"]: sunday}

    # Deleting a post unfiles its photos; they are not deleted.
    assert client.delete(f"/api/posts/{sunday}", headers=me).status_code == 204
    assert _by_post(client, me) == {a["scan_id"]: friday, b["scan_id"]: None, c["scan_id"]: None}
