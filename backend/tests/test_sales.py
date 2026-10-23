"""Sales records: kept when a seller copies or shares a buyer's summary, and
left without a link to the seller when their account is deleted."""

from decimal import Decimal

from conftest import _dispose_then, _photo, new_user, run
from sqlalchemy import func, select

from app.db import async_session_factory, engine
from app.models import Base, SaleRecord
from app.services import cardkingdom_prices
from app.services.accounts import delete_account
from app.services.auth_service import issue_session_token


class _CK:
    fetched_at = None

    def lookup(self, sid):
        return {"retail_normal": 4.49, "retail_foil": 9.99, "buy_normal": 2.5, "buy_foil": None,
                "in_stock_normal": True, "in_stock_foil": False, "url_normal": "", "url_foil": ""}


async def _records(order_item_id: int) -> list[SaleRecord]:
    async with async_session_factory() as s:
        return list((await s.scalars(select(SaleRecord).where(SaleRecord.order_item_id == order_item_id)
                                     .order_by(SaleRecord.line_seq))).all())


def _sold_order(client, monkeypatch):
    """A user with a post, one scanned photo and an order for 2 x Sol Ring at RM12."""
    async def ck():
        return _CK()
    monkeypatch.setattr(cardkingdom_prices, "get_index", ck)
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    post = client.post("/api/posts", data={"title": "Friday"}, headers=me).json()["id"]
    scan = client.post("/api/scan", files={"image": ("a.jpg", _photo(), "image/jpeg")},
                       data={"post_id": str(post)}, headers=me).json()["scan_id"]
    item = {"scan_id": scan, "card_id": 0, "bbox": [0, 0, 50, 70], "name": "Sol Ring", "scryfall_id": "abc",
            "set_code": "cmm", "set_name": "Commander Masters", "collector_number": "1", "rarity": "uncommon",
            "unit_price_myr": "12.00", "qty": 2, "qty_total": 2}
    order = client.post("/api/claims/confirm", headers=me, json={"post_id": post, "claims": [
        {"buyer": "Aiman Hakim", "note": "after 8pm", "items": [item]}]}).json()[0]
    return uid, me, post, order


def test_each_send_that_changes_a_line_is_kept_once(client, monkeypatch):
    uid, me, post, order = _sold_order(client, monkeypatch)
    oid, item = order["id"], order["items"][0]["id"]
    line = {"order_item_id": item, "app_usd": "4.49", "app_mult": "2.5", "price_kind": "auto"}
    send = lambda: client.post("/api/sales", headers=me, json={
        "channel": "copy", "post_id": post, "post_type": "live", "lines": [line]}).json()
    price = lambda p, sent=True: client.put(f"/api/orders/{oid}/prices", headers=me,
                                            json={"items": [{"id": item, "unit_price_myr": p}], "sent": sent})

    assert send() == {"recorded": 1}
    [r] = run(_dispose_then(_records(item)))
    assert (r.user_id, r.post_id, r.line_seq, r.channel, r.schema_version) == (uid, post, 1, "copy", 1)
    assert (r.card_name, r.scryfall_id, r.set_code, r.collector_number, r.rarity, r.is_foil) == (
        "Sol Ring", "abc", "cmm", "1", "uncommon", False)
    assert (r.qty, r.unit_price_myr, r.post_type, r.price_kind) == (2, Decimal("12.00"), "live", "auto")
    assert (r.app_usd, r.app_mult, r.ck_retail_usd, r.ck_buy_usd) == (
        Decimal("4.49"), Decimal("2.500"), Decimal("4.49"), Decimal("2.50"))
    # Nothing about the buyer is kept.
    assert "Aiman" not in repr([getattr(r, c.key) for c in SaleRecord.__table__.columns])
    assert not any(w in c.key for c in SaleRecord.__table__.columns for w in ("buyer", "phone", "note"))

    # Sent again unchanged: still one record.
    assert send() == {"recorded": 0}
    # Resent at a new price, then back at the first one: every send counts.
    client.delete(f"/api/orders/{oid}/prices-sent", headers=me)
    price("13.00")
    assert send() == {"recorded": 1}
    client.delete(f"/api/orders/{oid}/prices-sent", headers=me)
    price("12.00")
    assert send() == {"recorded": 1}
    rows = run(_dispose_then(_records(item)))
    assert [(r.line_seq, r.unit_price_myr) for r in rows] == [(1, Decimal("12.00")), (2, Decimal("13.00")), (3, Decimal("12.00"))]


def test_cancelled_orders_and_others_lines_are_not_kept(client, monkeypatch):
    _, me, post, order = _sold_order(client, monkeypatch)
    line = {"order_item_id": order["items"][0]["id"]}
    other = run(_dispose_then(new_user()))
    run(engine.dispose())
    them = {"Authorization": f"Bearer {issue_session_token(other)}"}
    assert client.post("/api/sales", headers=them, json={"channel": "share", "lines": [line]}).status_code == 404
    assert client.post("/api/sales", headers=them, json={"channel": "share", "post_id": post, "lines": [line]}).status_code == 404
    assert client.post("/api/sales", headers=me, json={"channel": "fax", "lines": [line]}).status_code == 422
    assert client.post("/api/sales", headers=me, json={"channel": "copy", "lines": []}).status_code == 422

    client.patch(f"/api/orders/{order['id']}", headers=me, json={"status": "cancelled"})
    assert client.post("/api/sales", headers=me, json={"channel": "copy", "lines": [line]}).json() == {"recorded": 0}


def test_deleting_an_account_leaves_nothing_but_unlinked_sales(client, monkeypatch):
    uid, me, post, order = _sold_order(client, monkeypatch)
    item = order["items"][0]["id"]
    client.post("/api/sales", headers=me, json={"channel": "copy", "post_id": post, "lines": [{"order_item_id": item}]})

    async def go():
        async with async_session_factory() as db:
            counts, files = await delete_account(db, uid)
            await db.commit()
        left = {}
        async with async_session_factory() as db:
            # Every table that holds a user id: nothing of theirs is left.
            for table in Base.metadata.sorted_tables:
                if "user_id" in table.c:
                    left[table.name] = await db.scalar(select(func.count()).select_from(table).where(table.c.user_id == uid))
            kept = (await db.scalars(select(SaleRecord).where(
                SaleRecord.card_name == "Sol Ring", SaleRecord.user_id.is_(None), SaleRecord.order_status.is_not(None)))).all()
        return counts, files, left, kept
    counts, files, left, kept = run(_dispose_then(go()))

    assert set(left.values()) == {0}, left
    assert counts["users"] == 1 and counts["orders"] == 1 and counts["buyers"] == 1
    assert any(f.endswith(".bin") for f in files)                   # the photo, removed by the caller
    [r] = [r for r in kept if r.unit_price_myr == Decimal("12.00") and r.qty == 2]
    assert (r.post_id, r.order_item_id) == (None, None)
    assert (r.order_status, r.paid) == ("claimed", False)           # the outcome, copied in first

    # Their token still decodes, but the account is gone; and the next
    # account gets a new id, not theirs.
    assert client.get("/api/posts", headers=me).status_code == 401
    assert run(_dispose_then(new_user())) > uid
