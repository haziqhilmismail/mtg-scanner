"""Orders: making one from a buyer's claim, and its running total."""

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Buyer, Listing, Order, OrderItem


async def _buyer(db: AsyncSession, user_id: int, name: str) -> Buyer:
    """This user's buyer with this FB name (case-insensitive), or a new one."""
    existing = await db.scalar(
        select(Buyer).where(Buyer.user_id == user_id, func.lower(Buyer.fb_name) == name.lower())
    )
    if existing:
        return existing
    buyer = Buyer(user_id=user_id, fb_name=name)
    db.add(buyer)
    await db.flush()
    return buyer


def recompute_total(order: Order) -> None:
    order.total_myr = sum((item.line_total_myr for item in order.items), Decimal("0.00"))


async def create_order(
    db: AsyncSession, user_id: int, buyer: str,
    lines: list[tuple[Listing, int, Decimal]], notes: str | None = None,
) -> Order:
    """An order for `buyer` (found by FB name, or created) of `lines`, each a
    (listing, qty, unit price). A line snapshots the listing's name and set,
    so the order stays readable if the listing is edited later. ValueError
    when the buyer name is empty. Returns the order with its items loaded."""
    name = buyer.strip()
    if not name:
        raise ValueError("Buyer name is empty")
    found = await _buyer(db, user_id, name)
    order = Order(
        user_id=user_id, buyer_id=found.id, notes=notes,
        dropoff_method=found.default_dropoff_method, dropoff_address=found.default_dropoff_address,
        items=[
            OrderItem(
                listing_id=listing.id, qty=qty, unit_price_myr=price, line_total_myr=price * qty,
                name_snapshot=listing.name, set_snapshot=listing.set_code,
            )
            for listing, qty, price in lines
        ],
    )
    recompute_total(order)
    db.add(order)
    await db.flush()
    return order
