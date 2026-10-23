"""Listings shared by several routes: removing one, and the prices a finished
(posted) photo locked its cards at."""

from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select

from ..models import Listing, ListingStatus, OrderItem


async def drop_listing(db, listing: Listing) -> None:
    """Hard-deletes a listing no order_item references (true cleanup for
    never-sold stock). If any order_item exists, archives it instead:
    RESTRICT on the FK preserves order history."""
    has_history = (await db.scalar(
        select(func.count(OrderItem.id)).where(OrderItem.listing_id == listing.id)
    )) or 0
    if has_history:
        listing.status = ListingStatus.archived
    else:
        await db.delete(listing)
    await db.flush()


def locked_prices(ui_state: dict | None, gemini_raw: dict | None) -> dict[tuple[int, ...], Decimal]:
    """The price of each card of a photo the seller finished (added to the post
    and downloaded or shared), by its box. Claims and the photo's listings use
    these, not whatever the client sends: they are the prices buyers saw on
    Facebook. Empty while the photo is not locked."""
    state = ui_state or {}
    if not state.get("lockedAt"):
        return {}
    out = {}
    for card, lock in zip((gemini_raw or {}).get("cards", []), state.get("locked") or []):
        price = lock.get("price") if isinstance(lock, dict) else None
        if isinstance(price, (int, float)) and not isinstance(price, bool) and price > 0 and card.get("bbox"):
            try:
                out[tuple(card["bbox"])] = Decimal(str(price)).quantize(Decimal("0.01"))
            except InvalidOperation:
                continue
    return out
