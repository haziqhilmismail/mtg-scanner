"""An id too big for SQLite is a 422, not a 500, wherever an id comes in."""

from conftest import sign_in

HUGE = 2**63


def test_an_id_past_int64_is_turned_away(client):
    _, me = sign_in()
    assert client.patch(f"/api/orders/{HUGE}", json={}, headers=me).status_code == 422
    assert client.delete(f"/api/posts/{HUGE}", headers=me).status_code == 422
    assert client.get(f"/api/scans?before={HUGE}", headers=me).status_code == 422
    assert client.post("/api/scans/move", json={"scan_ids": [HUGE]}, headers=me).status_code == 422
    assert client.post("/api/sales", json={"channel": "copy", "lines": [{"order_item_id": HUGE}]}, headers=me).status_code == 422
    # A hand-parsed payload id names no scan.
    assert client.post("/api/export", data={"payload": f'{{"image_id": "{HUGE}"}}'}, headers=me).status_code == 404
    # The usual ids still pass, and 0 still means "no post" in the listings filter.
    assert client.patch("/api/orders/1", json={}, headers=me).status_code == 404
    assert client.get("/api/listings?post_id=0", headers=me).status_code == 200
