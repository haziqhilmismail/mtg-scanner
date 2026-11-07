"""CRUD for Facebook buyer profiles."""

from fastapi import APIRouter, HTTPException
from sqlalchemy import case, func, select

from ..deps import CurrentUserId, DbSession
from ..models import Buyer, Order, OrderStatus
from ..schemas import BuyerRead, BuyerReadWithStats, BuyerUpdate

router = APIRouter(prefix="/api/buyers", tags=["buyers"])


@router.get("", response_model=list[BuyerReadWithStats])
async def list_buyers(db: DbSession, user_id: CurrentUserId) -> list[BuyerReadWithStats]:
    """Each buyer comes back with cached counts: total orders and open orders
    (where status != cancelled AND not yet both paid + delivered)."""
    # 1 when the order is "open" (not cancelled, and not both paid + delivered), else 0
    is_open = case(
        (Order.status == OrderStatus.cancelled, 0),
        (
            (Order.paid_at.is_not(None)) & (Order.delivered_at.is_not(None)),
            0,
        ),
        else_=1,
    )
    q = (
        select(
            Buyer,
            func.count(Order.id).label("total_orders"),
            func.coalesce(func.sum(is_open), 0).label("open_orders"),
        )
        .outerjoin(Order, Order.buyer_id == Buyer.id)
        .where(Buyer.user_id == user_id)
        .group_by(Buyer.id)
        .order_by(Buyer.fb_name.asc())
    )
    result = await db.execute(q)
    out: list[BuyerReadWithStats] = []
    for buyer, total, open_count in result.all():
        out.append(
            BuyerReadWithStats.model_validate({
                **{c.name: getattr(buyer, c.name) for c in Buyer.__table__.columns},
                "open_orders_count": int(open_count or 0),
                "total_orders_count": int(total or 0),
            })
        )
    return out


@router.patch("/{buyer_id}", response_model=BuyerRead)
async def update_buyer(
    buyer_id: int, payload: BuyerUpdate, db: DbSession, user_id: CurrentUserId,
) -> Buyer:
    buyer = await db.get(Buyer, buyer_id)
    if not buyer or buyer.user_id != user_id:
        raise HTTPException(404, "Buyer not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(buyer, k, v)
    await db.flush()
    await db.refresh(buyer)
    return buyer
