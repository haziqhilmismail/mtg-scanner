"""CRUD for sale listings."""

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from ..deps import CurrentUserId, DbSession, owned
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
from ..services.listings import drop_listing

router = APIRouter(prefix="/api/listings", tags=["listings"])


def _serialize_listing(listing: Listing) -> dict:
    """ORM instance → dict ready for ListingRead.model_validate. Pulls
    post_ids out of the .posts relationship since the column was removed."""
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


async def _resolve_posts(db, user_id: int, post_ids: list[int]) -> list[Post]:
    """Look up the user's posts by id, validating ownership in a single round-trip."""
    if not post_ids:
        return []
    rows = (await db.execute(
        select(Post).where(Post.id.in_(post_ids), Post.user_id == user_id)
    )).scalars().all()
    found = {p.id for p in rows}
    missing = [pid for pid in post_ids if pid not in found]
    if missing:
        raise HTTPException(404, f"Post(s) not found: {missing}")
    return list(rows)


async def _check_scan(db, user_id: int, scan_id: int | None) -> None:
    """A listing may only point at its owner's own scan: deleting that scan
    deletes the listing."""
    if scan_id is not None and await db.scalar(
        select(Scan.id).where(Scan.id == scan_id, Scan.user_id == user_id)
    ) is None:
        raise HTTPException(404, "Scan not found")


@router.get("", response_model=list[ListingReadWithAvailability])
async def list_listings(
    db: DbSession,
    user_id: CurrentUserId,
    status: ListingStatus | None = Query(None, description="Filter by listing status"),
    post_id: int | None = Query(None, description="Filter to one post; pass 0 for unlinked listings"),
) -> list[ListingReadWithAvailability]:
    """Each listing is annotated with qty_committed (sum of qty across non-cancelled
    order items) and qty_available (qty_total − committed)."""
    # Subquery: per-listing committed qty across active orders
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
            # listings with no post link at all
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
    posts = await _resolve_posts(db, user_id, post_ids)
    await _check_scan(db, user_id, payload.scan_id)

    listing = Listing(**data, user_id=user_id)
    listing.posts = posts
    db.add(listing)
    await db.flush()
    await db.refresh(listing)
    return _read(listing)


@router.patch("/{listing_id}", response_model=ListingRead)
async def update_listing(
    listing_id: int, payload: ListingUpdate, db: DbSession, user_id: CurrentUserId,
) -> ListingRead:
    listing = await owned(db, Listing, listing_id, user_id, selectinload(Listing.posts))

    updates = payload.model_dump(exclude_unset=True)
    post_ids = updates.pop("post_ids", None)  # None = unchanged, [] = unlink all
    await _check_scan(db, user_id, updates.get("scan_id"))
    for k, v in updates.items():
        setattr(listing, k, v)

    if post_ids is not None:
        listing.posts = await _resolve_posts(db, user_id, post_ids)

    await db.flush()
    await db.refresh(listing)
    return _read(listing)


@router.delete("/{listing_id}", status_code=204)
async def remove_listing(listing_id: int, db: DbSession, user_id: CurrentUserId) -> None:
    """Remove listing (see drop_listing). Either way the row stops appearing
    in the active stock view; this matters only for users digging into
    archived inventory."""
    listing = await owned(db, Listing, listing_id, user_id)
    await drop_listing(db, listing)
