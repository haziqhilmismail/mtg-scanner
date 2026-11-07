"""PATCH routes: a column that can't be empty refuses null with a 422."""

import pytest
from conftest import _photo, sign_in


# (route, field that may not be null)
NOT_NULL = [
    ("posts", "status"),
    ("listings", "name"), ("listings", "is_foil"), ("listings", "unit_price_myr"),
    ("listings", "qty_total"), ("listings", "status"),
    ("buyers", "fb_name"),
    ("orders", "status"),
]
CLEARABLE = {"posts": "note", "listings": "notes", "buyers": "phone", "orders": "notes"}


@pytest.mark.parametrize("route,field", NOT_NULL)
def test_null_on_a_required_field_is_a_422(client, route, field):
    _, me = sign_in()
    post = client.post("/api/posts", data={"title": "Friday"}, headers=me).json()["id"]
    scan = client.post("/api/scan", files={"image": ("a.jpg", _photo(), "image/jpeg")}, headers=me).json()["scan_id"]
    item = {"scan_id": scan, "card_id": 0, "bbox": [0, 0, 50, 70], "name": "Sol Ring", "unit_price_myr": "9.00"}
    order = client.post("/api/claims/confirm", json={"claims": [{"buyer": "Aiman", "items": [item]}]}, headers=me).json()[0]
    ids = {"posts": post, "listings": order["items"][0]["listing_id"], "buyers": order["buyer_id"], "orders": order["id"]}
    url = f"/api/{route}/{ids[route]}"
    # Read back through the list route, as the app does.
    read = lambda: next(r for r in client.get(f"/api/{route}", headers=me).json() if r["id"] == ids[route])

    before = read()
    assert client.patch(url, json={field: None}, headers=me).status_code == 422
    assert read()[field] == before[field]
    # Nullable fields still clear, and omitted fields are left alone.
    r = client.patch(url, json={CLEARABLE[route]: None}, headers=me)
    assert r.status_code == 200 and r.json()[field] == before[field]
