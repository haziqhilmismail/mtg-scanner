"""Order workflow: claim from a buyer, with line items + independent paid/delivered status."""

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..deps import CurrentUserId, DbSession, owned
from ..models import Order, OrderStatus
from ..schemas import OrderRead, OrderUpdate
from ..schemas.types import Id
from ..services.orders import recompute_total

router = APIRouter(prefix="/api/orders", tags=["orders"])

async def _load_order(db, order_id: int, user_id: int) -> Order:
    """This user's order with its items loaded; 404 otherwise."""
    return await owned(db, Order, order_id, user_id, selectinload(Order.items))


@router.get("", response_model=list[OrderRead])
async def list_orders(
    db: DbSession,
    user_id: CurrentUserId,
    include_archived: bool = Query(False, description="Include archived orders in the result"),
) -> list[Order]:
    """List orders newest first, each with its line items. Archived orders
    are excluded by default so the kanban stays focused — opt in via
    `?include_archived=true` to fetch them for the Archived section UI."""
    q = (
        select(Order)
        .where(Order.user_id == user_id)
        .options(selectinload(Order.items))
        .order_by(Order.created_at.desc())
    )
    if not include_archived:
        q = q.where(Order.archived_at.is_(None))
    return list((await db.execute(q)).scalars().all())


@router.patch("/{order_id}", response_model=OrderRead)
async def update_order(
    order_id: Id, payload: OrderUpdate, db: DbSession, user_id: CurrentUserId,
) -> Order:
    """Update top-level order fields. Paid/delivered timestamps can be set, cleared,
    or left as-is — they're independent so 'took on credit' (delivered without paid) is valid."""
    order = await _load_order(db, order_id, user_id)
    updates = payload.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(order, k, v)
    await db.flush()
    return await _load_order(db, order.id, user_id)


class ItemPrice(BaseModel):
    id: Id
    unit_price_myr: Decimal = Field(..., ge=0, decimal_places=2)


class OrderPrices(BaseModel):
    items: list[ItemPrice] = Field(default_factory=list, max_length=500)
    # Also mark them sent to the buyer, which fixes them.
    sent: bool = False


@router.put("/{order_id}/prices", response_model=OrderRead)
async def set_prices(order_id: Id, body: OrderPrices, db: DbSession, user_id: CurrentUserId) -> Order:
    """Live-price posts: put today's prices on an order whose prices were not
    sent yet (Refresh prices), and optionally mark them sent (the seller just
    copied or shared the buyer's total). 409 once sent: the buyer was told."""
    order = await _load_order(db, order_id, user_id)
    if order.prices_sent_at is not None:
        raise HTTPException(409, "These prices were already sent to the buyer")
    price = {p.id: p.unit_price_myr for p in body.items}
    for item in order.items:
        if item.id in price:
            item.unit_price_myr = price[item.id]
            item.line_total_myr = price[item.id] * item.qty
    recompute_total(order)
    if body.sent:
        order.prices_sent_at = datetime.now(timezone.utc)
    await db.flush()
    return await _load_order(db, order.id, user_id)


@router.delete("/{order_id}/prices-sent", response_model=OrderRead)
async def unsend_prices(order_id: Id, db: DbSession, user_id: CurrentUserId) -> Order:
    """Resend at today's price: the prices are an estimate again."""
    order = await _load_order(db, order_id, user_id)
    order.prices_sent_at = None
    await db.flush()
    return await _load_order(db, order.id, user_id)


@router.post("/{order_id}/mark-paid", response_model=OrderRead)
async def mark_paid(order_id: Id, db: DbSession, user_id: CurrentUserId) -> Order:
    order = await _load_order(db, order_id, user_id)
    if order.paid_at is None:
        order.paid_at = datetime.now(timezone.utc)
        await db.flush()
    return await _load_order(db, order.id, user_id)


@router.post("/{order_id}/mark-delivered", response_model=OrderRead)
async def mark_delivered(order_id: Id, db: DbSession, user_id: CurrentUserId) -> Order:
    order = await _load_order(db, order_id, user_id)
    if order.delivered_at is None:
        order.delivered_at = datetime.now(timezone.utc)
        await db.flush()
    return await _load_order(db, order.id, user_id)


@router.post("/{order_id}/cancel", response_model=OrderRead)
async def cancel_order(order_id: Id, db: DbSession, user_id: CurrentUserId) -> Order:
    order = await _load_order(db, order_id, user_id)
    order.status = OrderStatus.cancelled
    await db.flush()
    return await _load_order(db, order.id, user_id)


@router.post("/{order_id}/restore", response_model=OrderRead)
async def restore_order(order_id: Id, db: DbSession, user_id: CurrentUserId) -> Order:
    """Un-cancel a cancelled order. Items return to the active claim; paid_at and
    delivered_at timestamps are preserved so the order lands back in its previous
    kanban column (unpaid/paid/credit/done) on its own."""
    order = await _load_order(db, order_id, user_id)
    if order.status != OrderStatus.cancelled:
        return await _load_order(db, order.id, user_id)
    order.status = OrderStatus.claimed
    await db.flush()
    return await _load_order(db, order.id, user_id)
