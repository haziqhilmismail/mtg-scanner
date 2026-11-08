"""CRUD for sale listings."""

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from ..deps import CurrentUserId, DbSession, owned, owned_many
from ..models import (
    Listing,
    ListingStatus,
    Order,
    OrderItem,
    Post,
    Scan,
    listing_post_links,
)
from ..schemas import (
    ListingCreate,
    ListingRead,
    ListingReadWithAvailability,
    ListingUpdate,
)
from ..schemas.types import Id
from ..services.listings import drop_listing

router = APIRouter(prefix="/api/listings", tags=["listings"])


def _serialize_listing(listing: Listing) -> dict:
    """ORM listing → dict for ListingRead, with post_ids from the .posts relationship."""
    return {
        **{c.name: getattr(listing, c.name) for c in Listing.__table__.columns},
        "post_ids": sorted(p.id for p in listing.posts),
    }


def _read(listing: Listing) -> ListingRead:
    return ListingRead.model_validate(_serialize_listing(listing))


def _read_with_availability(listing: Listing, committed: int) -> ListingReadWithAvailability:
    qty_total = listing.qty_total or 0
    return ListingReadWithAvailability.model_validate({
        **_serialize_listing(listing),
        "qty_committed": committed,
        "qty_available": max(0, qty_total - committed),
    })


@router.get("", response_model=list[ListingReadWithAvailability])
async def list_listings(
    db: DbSession,
    user_id: CurrentUserId,
    status: ListingStatus | None = Query(None, description="Filter by listing status"),
    post_id: int | None = Query(None, ge=0, le=2**63 - 1, description="Filter to one post (an Id); pass 0 for unlinked listings"),
) -> list[ListingReadWithAvailability]:
    """Each listing is annotated with qty_committed (sum of qty across non-cancelled
    order items) and qty_available (qty_total − committed)."""
    committed_subq = (
        select(
            OrderItem.listing_id.label("lid"),
            func.coalesce(func.sum(OrderItem.qty), 0).label("committed"),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.holds_stock)
        .group_by(OrderItem.listing_id)
        .subquery()
    )

    q = (
        select(Listing, func.coalesce(committed_subq.c.committed, 0))
        .outerjoin(committed_subq, committed_subq.c.lid == Listing.id)
        .where(Listing.user_id == user_id)
        .options(selectinload(Listing.posts))
        .order_by(Listing.created_at.desc())
    )
    if status:
        q = q.where(Listing.status == status)
    if post_id is not None:
        if post_id == 0:
            q = q.where(~Listing.id.in_(select(listing_post_links.c.listing_id)))
        else:
            q = q.where(Listing.id.in_(
                select(listing_post_links.c.listing_id).where(listing_post_links.c.post_id == post_id)
            ))

    result = await db.execute(q)
    return [_read_with_availability(listing, int(committed)) for listing, committed in result.all()]


@router.post("", response_model=ListingRead, status_code=201)
async def create_listing(
    payload: ListingCreate, db: DbSession, user_id: CurrentUserId,
) -> ListingRead:
    """Create a listing optionally linked to N posts."""
    data = payload.model_dump()
    post_ids: list[int] = data.pop("post_ids", []) or []
    posts = list((await owned_many(db, Post, post_ids, user_id)).values())
    # A listing may only point at its owner's own scan: deleting that scan deletes the listing.
    if payload.scan_id is not None:
        await owned(db, Scan, payload.scan_id, user_id)

    listing = Listing(**data, user_id=user_id)
    listing.posts = posts
    db.add(listing)
    await db.flush()
    return _read(listing)


@router.patch("/{listing_id}", response_model=ListingRead)
async def update_listing(
    listing_id: Id, payload: ListingUpdate, db: DbSession, user_id: CurrentUserId,
) -> ListingRead:
    listing = await owned(db, Listing, listing_id, user_id, selectinload(Listing.posts))

    updates = payload.model_dump(exclude_unset=True)
    post_ids = updates.pop("post_ids", None)  # None = unchanged, [] = unlink all
    if updates.get("scan_id") is not None:
        await owned(db, Scan, updates["scan_id"], user_id)
    for k, v in updates.items():
        setattr(listing, k, v)

    if post_ids is not None:
        listing.posts = list((await owned_many(db, Post, post_ids, user_id)).values())

    await db.flush()
    return _read(listing)


@router.delete("/{listing_id}", status_code=204)
async def remove_listing(listing_id: Id, db: DbSession, user_id: CurrentUserId) -> None:
    """Remove a listing (see drop_listing)."""
    listing = await owned(db, Listing, listing_id, user_id)
    await drop_listing(db, listing)
