"""PATCH routes: a column that can't be empty refuses null with a 422."""

import pytest
from conftest import _dispose_then, new_user, run

from app.db import engine
from app.services.auth_service import issue_session_token

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
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    post = client.post("/api/posts", data={"title": "Friday"}, headers=me).json()["id"]
    listing = client.post("/api/listings", json={"name": "Sol Ring", "unit_price_myr": "9.00"}, headers=me).json()["id"]
    buyer = client.post("/api/buyers", json={"fb_name": "Aiman"}, headers=me).json()["id"]
    order = client.post("/api/orders", json={"buyer_id": buyer, "items": [{"listing_id": listing}]}, headers=me).json()["id"]
    url = f"/api/{route}/{ {'posts': post, 'listings': listing, 'buyers': buyer, 'orders': order}[route] }"

    before = client.get(url, headers=me).json()
    assert client.patch(url, json={field: None}, headers=me).status_code == 422
    assert client.get(url, headers=me).json()[field] == before[field]
    # Nullable fields still clear, and omitted fields are left alone.
    r = client.patch(url, json={CLEARABLE[route]: None}, headers=me)
    assert r.status_code == 200 and r.json()[field] == before[field]
