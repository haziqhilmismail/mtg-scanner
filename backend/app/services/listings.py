"""Removing a listing, shared by deleting one and deleting the scan it came from."""

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
