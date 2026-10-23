"""CRUD for sale listings."""

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from ..deps import CurrentUserId, DbSession
from ..models import (
    Listing,
    ListingStatus,
    Order,
    OrderItem,
    OrderStatus,
    Post,
    PostStatus,
    Scan,
    User,
    listing_post_links,
)
from ..schemas import (
    BulkImportLine,
    BulkImportPayload,
    BulkImportResult,
    ListingCreate,
    ListingRead,
    ListingReadWithAvailability,
    ListingUpdate,
)
from ..services.bulk_import import lookup_lines, parse_line, price_for_card
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
        .where(Order.status != OrderStatus.cancelled)
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


@router.get("/{listing_id}", response_model=ListingReadWithAvailability)
async def get_listing(
    listing_id: int, db: DbSession, user_id: CurrentUserId,
) -> ListingReadWithAvailability:
    q = (
        select(Listing)
        .where(Listing.id == listing_id)
        .options(selectinload(Listing.posts))
    )
    listing = (await db.execute(q)).scalar_one_or_none()
    if not listing or listing.user_id != user_id:
        raise HTTPException(404, "Listing not found")
    committed = await db.scalar(
        select(func.coalesce(func.sum(OrderItem.qty), 0))
        .join(Order, Order.id == OrderItem.order_id)
        .where(OrderItem.listing_id == listing_id)
        .where(Order.status != OrderStatus.cancelled)
    ) or 0
    return _read_with_availability(listing, int(committed))


@router.patch("/{listing_id}", response_model=ListingRead)
async def update_listing(
    listing_id: int, payload: ListingUpdate, db: DbSession, user_id: CurrentUserId,
) -> ListingRead:
    q = (
        select(Listing)
        .where(Listing.id == listing_id)
        .options(selectinload(Listing.posts))
    )
    listing = (await db.execute(q)).scalar_one_or_none()
    if not listing or listing.user_id != user_id:
        raise HTTPException(404, "Listing not found")

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
    listing = await db.get(Listing, listing_id)
    if not listing or listing.user_id != user_id:
        raise HTTPException(404, "Listing not found")
    await drop_listing(db, listing)


@router.post("/bulk-import", response_model=BulkImportResult)
async def bulk_import(
    payload: BulkImportPayload, db: DbSession, user_id: CurrentUserId,
) -> BulkImportResult:
    """Moxfield-style import: parse N lines, look each up on Scryfall, save as
    listings. Parse failures + Scryfall misses are returned in `lines` with
    `ok=false` so the user can fix and retry. Created rows use the user's default
    multipliers and a RM 1 ceiling round; user can edit prices afterwards.

    `post_id` (single) is the post to link every imported listing into. If you
    need multi-post links, edit them on the stock card after import."""

    # Resolve target post (if any) — refuse archived ones up front
    target_post: Post | None = None
    if payload.post_id is not None:
        target_post = await db.get(Post, payload.post_id)
        if not target_post or target_post.user_id != user_id:
            raise HTTPException(404, "Post not found")
        if target_post.status == PostStatus.archived:
            raise HTTPException(400, "Cannot import into an archived post — un-archive it first")

    # Pull the user's pricing defaults
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(500, "User missing")
    mult_normal = user.default_mult_normal
    mult_foil = user.default_mult_foil

    # 1) Parse every line up-front. Each parse error is captured per-line.
    raw_lines = payload.text.splitlines()
    parsed_or_err: list[tuple[int, str, dict | Exception | None]] = []
    for i, raw in enumerate(raw_lines):
        try:
            parsed = parse_line(raw)
        except ValueError as e:
            parsed_or_err.append((i, raw, e))
            continue
        if parsed is None:
            continue  # blank/comment — skip silently
        if payload.apply_foil_to_all:
            parsed["is_foil"] = True
        parsed_or_err.append((i, raw, parsed))

    # 2) Look each successfully-parsed line up on Scryfall in parallel
    lookups = await lookup_lines([(idx, parsed) for idx, _, parsed in parsed_or_err if isinstance(parsed, dict)])

    # 3) Create listings + collect per-line results in input order
    results: list[BulkImportLine] = []
    created = 0
    for idx, raw, parsed in parsed_or_err:
        if isinstance(parsed, Exception):
            results.append(BulkImportLine(raw=raw, ok=False, error=str(parsed)))
            continue
        if not isinstance(parsed, dict):
            continue
        summary = lookups.get(idx)
        if not summary:
            results.append(BulkImportLine(
                raw=raw, ok=False,
                error="Not found on Scryfall",
                name=parsed["name"],
                set_code=parsed.get("set_code"),
                collector_number=parsed.get("collector_number"),
                is_foil=parsed["is_foil"],
                qty=parsed["qty"],
            ))
            continue

        price = price_for_card(summary, parsed["is_foil"], mult_normal, mult_foil)
        listing = Listing(
            user_id=user_id,
            scryfall_id=summary.get("scryfall_id") or None,
            name=summary.get("name") or parsed["name"],
            set_code=(summary.get("set") or parsed.get("set_code") or "").lower() or None,
            set_name=summary.get("set_name") or None,
            collector_number=summary.get("collector_number") or parsed.get("collector_number"),
            rarity=summary.get("rarity") or None,
            is_foil=parsed["is_foil"],
            image_url=summary.get("image_url") or None,
            unit_price_myr=price,
            qty_total=parsed["qty"],
        )
        if target_post is not None:
            listing.posts = [target_post]
        db.add(listing)
        await db.flush()
        created += 1
        results.append(BulkImportLine(
            raw=raw, ok=True,
            listing_id=listing.id,
            name=listing.name,
            set_code=listing.set_code,
            collector_number=listing.collector_number,
            is_foil=listing.is_foil,
            qty=listing.qty_total,
            unit_price_myr=str(price),
            image_url=listing.image_url,
        ))

    return BulkImportResult(
        created=created,
        skipped=len(results) - created,
        lines=results,
    )
