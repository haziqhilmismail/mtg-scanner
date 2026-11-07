"""Sales records: the page reports which order lines a seller just sent to a
buyer (copied or shared their summary); each line is kept as a sale record.
See models/sale_record.py for what a record holds and why."""

from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import selectinload

from ..deps import CurrentUserId, DbSession, limiter, owned
from ..models import Order, OrderItem, Post, SaleRecord
from ..services import catalogue

router = APIRouter(prefix="/api/sales", tags=["sales"])


class SentLine(BaseModel):
    order_item_id: int
    # How the seller's app priced the card; context only. The price itself is
    # read from the order.
    app_usd: Decimal | None = Field(None, ge=0, le=100_000, decimal_places=2)
    app_mult: Decimal | None = Field(None, ge=0, le=1_000, decimal_places=3)
    price_kind: Literal["auto", "override", "manual"] | None = None


class SentSummary(BaseModel):
    channel: Literal["copy", "share"]
    post_id: int | None = None
    # The post's kind as the app resolves it (its own pricing, or the
    # seller's default); the backend treats pricing as the app's.
    post_type: Literal["photo", "live"] | None = None
    lines: list[SentLine] = Field(..., min_length=1, max_length=500)


def _usd(v: float | None) -> Decimal | None:
    return Decimal(str(v)).quantize(Decimal("0.01")) if v else None


@router.post("", status_code=201)
@limiter.limit("120/minute")
async def record_sales(request: Request, body: SentSummary, db: DbSession, user_id: CurrentUserId) -> dict:
    """Keep each line as sent. A line whose qty and price are the same as its
    last record is skipped, so sending a summary twice counts once; lines of
    cancelled orders are skipped too. 404 if a line or the post isn't the
    caller's."""
    if body.post_id is not None:
        await owned(db, Post, body.post_id, user_id)

    wanted = {line.order_item_id: line for line in body.lines}
    items = (await db.scalars(
        select(OrderItem).join(Order)
        .where(OrderItem.id.in_(wanted), Order.user_id == user_id)
        .options(selectinload(OrderItem.listing), selectinload(OrderItem.order))
    )).all()
    if len(items) != len(wanted):
        raise HTTPException(404, "Order line not found")

    last = {}  # order_item_id -> its latest record's (line_seq, qty, price)
    for r in (await db.execute(
        select(SaleRecord.order_item_id, SaleRecord.line_seq, SaleRecord.qty, SaleRecord.unit_price_myr)
        .where(SaleRecord.order_item_id.in_(wanted)).order_by(SaleRecord.line_seq)
    )).all():
        last[r.order_item_id] = (r.line_seq, r.qty, r.unit_price_myr)

    ck = await catalogue.ck_index()
    rows = []
    for item in items:
        seq, qty, price = last.get(item.id, (0, None, None))
        if not item.order.holds_stock or (qty, price) == (item.qty, item.unit_price_myr):
            continue
        line, listing = wanted[item.id], item.listing
        ck_price = ck.price(listing.scryfall_id, listing.is_foil)
        retail, buy = _usd(ck_price.retail), _usd(ck_price.buy)
        rows.append({
            "channel": body.channel, "user_id": user_id, "post_id": body.post_id,
            "order_item_id": item.id, "line_seq": seq + 1,
            "scryfall_id": listing.scryfall_id, "card_name": item.name_snapshot or listing.name,
            "set_code": listing.set_code, "set_name": listing.set_name,
            "collector_number": listing.collector_number, "rarity": listing.rarity,
            "is_foil": listing.is_foil, "qty": item.qty, "unit_price_myr": item.unit_price_myr,
            "post_type": body.post_type, "price_kind": line.price_kind,
            "app_usd": line.app_usd or None, "app_mult": line.app_mult or None,
            "ck_retail_usd": retail, "ck_buy_usd": buy,
            "ck_as_of": ck.fetched_at if retail or buy else None,
        })
    if not rows:
        return {"recorded": 0}
    # A double-click's second request computes the same line_seq: a no-op.
    result = await db.execute(
        insert(SaleRecord).values(rows).on_conflict_do_nothing(index_elements=["order_item_id", "line_seq"])
    )
    return {"recorded": result.rowcount}
