"""Orders: making them from buyers' claims, and their running total."""

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import Buyer, Listing, ListingStatus, Order, OrderItem, Post, Scan
from ..schemas.order import ConfirmClaim, ConfirmItem
from .listings import locked_prices


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


async def _listing_for(db: AsyncSession, user_id: int, post: Post | None, item: ConfirmItem) -> Listing:
    """The stock listing behind a scanned card, created the first time the
    card is claimed. A card is recognised by its scan and its box in the photo."""
    rows = (await db.execute(
        select(Listing)
        .where(Listing.user_id == user_id, Listing.scan_id == item.scan_id)
        .options(selectinload(Listing.posts))
    )).scalars().all()
    listing = next((l for l in rows if l.bbox == item.bbox and l.is_foil == item.is_foil), None)
    if listing is None:
        listing = Listing(
            **item.model_dump(exclude={"card_id", "qty"}), user_id=user_id, status=ListingStatus.active,
        )
        listing.posts = [post] if post else []
        db.add(listing)
        await db.flush()
        return listing
    # Seen before: keep it in step with what the seller is showing now.
    listing.unit_price_myr = item.unit_price_myr
    listing.qty_total = max(listing.qty_total or 1, item.qty_total)
    if post and post not in listing.posts:
        listing.posts.append(post)
    return listing


async def confirm_claims(
    db: AsyncSession, user_id: int, post: Post | None, scans: dict[int, Scan], claims: list[ConfirmClaim],
) -> list[Order]:
    """Orders for confirmed claims: one per buyer, in the order given. `scans`
    holds this user's photos the items are on, by id. A card of a finished
    photo sells at the price it was posted with. ValueError when a buyer name
    is empty."""
    locked = {sid: locked_prices(s.ui_state, s.cards) for sid, s in scans.items()}
    out = []
    for claim in claims:
        lines = []
        for item in claim.items:
            if (price := locked[item.scan_id].get(tuple(item.bbox))) is not None:
                item = item.model_copy(update={"unit_price_myr": price})
            lines.append((await _listing_for(db, user_id, post, item), item.qty, item.unit_price_myr))
        out.append(await create_order(db, user_id, claim.buyer, lines, notes=claim.note))
    return out
