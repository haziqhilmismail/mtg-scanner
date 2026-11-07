"""CRUD for Facebook buyer profiles."""

from fastapi import APIRouter
from sqlalchemy import func, select

from ..deps import CurrentUserId, DbSession, owned
from ..models import Buyer, Order
from ..schemas import BuyerRead, BuyerReadWithStats, BuyerUpdate
from ..schemas.types import Id

router = APIRouter(prefix="/api/buyers", tags=["buyers"])


@router.get("", response_model=list[BuyerReadWithStats])
async def list_buyers(db: DbSession, user_id: CurrentUserId) -> list[BuyerReadWithStats]:
    """Each buyer with their number of orders, cancelled ones included."""
    q = (
        select(Buyer, func.count(Order.id))
        .outerjoin(Order, Order.buyer_id == Buyer.id)
        .where(Buyer.user_id == user_id)
        .group_by(Buyer.id)
        .order_by(Buyer.fb_name.asc())
    )
    result = await db.execute(q)
    out: list[BuyerReadWithStats] = []
    for buyer, total in result.all():
        out.append(
            BuyerReadWithStats.model_validate({
                **{c.name: getattr(buyer, c.name) for c in Buyer.__table__.columns},
                "total_orders_count": int(total or 0),
            })
        )
    return out


@router.patch("/{buyer_id}", response_model=BuyerRead)
async def update_buyer(
    buyer_id: Id, payload: BuyerUpdate, db: DbSession, user_id: CurrentUserId,
) -> Buyer:
    buyer = await owned(db, Buyer, buyer_id, user_id)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(buyer, k, v)
    await db.flush()
    await db.refresh(buyer)
    return buyer
