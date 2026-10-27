"""CRUD for Facebook post groups. A post is a tiny container: FB URL + optional
reminder image + free-form note. The N cards listed under the post are stored
as regular Listing rows with `post_id` set.

We never query Facebook. The URL is reference-only."""

import asyncio
import copy
import os
import shutil
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field, Json
from sqlalchemy import case, func, select, update
from sqlalchemy.orm import selectinload

from ..config import DATA_DIR, SCANS_DIR
from ..deps import CurrentUserId, DbSession, ImageUserId, check_pricing_size
from ..models import (
    Listing,
    ListingStatus,
    Order,
    OrderItem,
    OrderStatus,
    Post,
    listing_post_links,
    Scan,
)
from ..schemas import PostReadWithStats, PostUpdate
from ..services.cardkingdom_prices import get_index as get_ck_index
from .scans import apply_picks, refresh_prices, scan_out, split_state

router = APIRouter(prefix="/api/posts", tags=["posts"])

POSTS_DIR = DATA_DIR / "posts"
POSTS_DIR.mkdir(exist_ok=True)

ALLOWED_IMAGE_MIME = {
    "image/jpeg", "image/jpg", "image/png", "image/webp",
    "image/heic", "image/heif", "image/gif",
}
MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 8 MiB


def _post_image_path(post_id: int) -> Path:
    return POSTS_DIR / f"{post_id}.bin"


async def _save_image(post: Post, image: UploadFile) -> None:
    """Read image into memory (size-checked), write to disk, stamp the post row."""
    if image.content_type and image.content_type not in ALLOWED_IMAGE_MIME:
        raise HTTPException(400, f"Unsupported image type: {image.content_type}")
    raw = await image.read()
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image too large (max 8 MB)")
    if not raw:
        raise HTTPException(400, "Empty image upload")
    path = _post_image_path(post.id)
    path.write_bytes(raw)
    post.image_path = str(path)
    post.image_mime = image.content_type or "application/octet-stream"


async def _stats_by_post(db, post_ids: list[int]) -> dict:
    """{post_id: (listing count, active count, total qty, total value)}, one
    query for all the posts. A listing linked to two posts contributes its
    qty/value to BOTH posts' totals — that's intentional (each post's
    "inventory under it" is the natural measure for the user). Posts with no
    listings are missing from the dict."""
    rows = (await db.execute(
        select(
            listing_post_links.c.post_id,
            func.count(Listing.id),
            func.sum(case((Listing.status == ListingStatus.active, 1), else_=0)),
            func.coalesce(func.sum(Listing.qty_total), 0),
            func.coalesce(func.sum(Listing.qty_total * Listing.unit_price_myr), Decimal("0.00")),
        )
        .join(listing_post_links, listing_post_links.c.listing_id == Listing.id)
        .where(listing_post_links.c.post_id.in_(post_ids))
        .group_by(listing_post_links.c.post_id)
    )).all()
    return {r[0]: r[1:] for r in rows}


async def _claims_by_post(db, post_ids: list[int]) -> dict[int, tuple[int, int, Decimal]]:
    """{post_id: (buyers, buyers still to pay, RM paid)} over the orders Claims
    shows: not cancelled, not archived. A card is in a post when it is linked
    to it or was scanned in one of its photos, the same rule as the Claims
    page. One row per claimed card, so a card reached both ways counts once."""
    live = (Order.status != OrderStatus.cancelled, Order.archived_at.is_(None))
    item = (Order.buyer_id, Order.paid_at.is_(None), OrderItem.id, OrderItem.line_total_myr)
    linked = (
        select(listing_post_links.c.post_id, *item)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .join(listing_post_links, listing_post_links.c.listing_id == OrderItem.listing_id)
        .where(listing_post_links.c.post_id.in_(post_ids), *live)
    )
    scanned = (
        select(Scan.post_id, *item)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .join(Listing, Listing.id == OrderItem.listing_id)
        .join(Scan, Scan.id == Listing.scan_id)
        .where(Scan.post_id.in_(post_ids), *live)
    )
    buyers: dict[int, set[int]] = {}
    owing: dict[int, set[int]] = {}
    paid: dict[int, Decimal] = {}
    for post_id, buyer_id, is_unpaid, _item_id, line_total in (await db.execute(linked.union(scanned))).all():
        buyers.setdefault(post_id, set()).add(buyer_id)
        if is_unpaid:
            owing.setdefault(post_id, set()).add(buyer_id)
        else:
            paid[post_id] = paid.get(post_id, Decimal("0")) + Decimal(line_total or 0)
    return {p: (len(b), len(owing.get(p, ())), paid.get(p, Decimal("0"))) for p, b in buyers.items()}


def _read_with_stats(post: Post, stats: dict, claims: dict[int, tuple[int, int, Decimal]]) -> PostReadWithStats:
    listing_count, active_count, total_qty, total_value = stats.get(post.id, (0, 0, 0, 0))
    buyer_count, unpaid_buyer_count, paid = claims.get(post.id, (0, 0, Decimal("0")))
    return PostReadWithStats.model_validate({
        **{c.name: getattr(post, c.name) for c in Post.__table__.columns},
        "listing_count": int(listing_count or 0),
        "active_listing_count": int(active_count or 0),
        "total_qty": int(total_qty or 0),
        "total_value_myr": f"{Decimal(total_value or 0):.2f}",
        "has_image": bool(post.image_path) and _post_image_path(post.id).exists(),
        "buyer_count": buyer_count,
        "unpaid_buyer_count": unpaid_buyer_count,
        "paid_myr": f"{paid:.2f}",
    })


async def _build_read_with_stats(db, post: Post) -> PostReadWithStats:
    """Build the read schema with computed stats (listing counts, total qty, value)."""
    return _read_with_stats(post, await _stats_by_post(db, [post.id]), await _claims_by_post(db, [post.id]))


@router.get("", response_model=list[PostReadWithStats])
async def list_posts(
    db: DbSession,
    user_id: CurrentUserId,
    include_archived: bool = False,
) -> list[PostReadWithStats]:
    """List posts newest-first. Archived posts are hidden by default; the
    settings page can pass include_archived=true to see them for un-archive."""
    q = (
        select(Post)
        .where(Post.user_id == user_id)
        .order_by(Post.created_at.desc())
    )
    if not include_archived:
        from ..models import PostStatus as _PS
        q = q.where(Post.status != _PS.archived)
    rows = (await db.execute(q)).scalars().all()
    ids = [p.id for p in rows]
    stats, claims = await _stats_by_post(db, ids), await _claims_by_post(db, ids)
    return [_read_with_stats(p, stats, claims) for p in rows]


@router.post("", response_model=PostReadWithStats, status_code=201)
async def create_post(
    db: DbSession,
    user_id: CurrentUserId,
    title: str | None = Form(None),
    fb_url: str | None = Form(None),
    note: str | None = Form(None),
    pricing: Json[dict] | None = Form(None),
    image: UploadFile | None = File(None),
) -> PostReadWithStats:
    """Create a post. Image is optional — supply it now or upload later via
    POST /api/posts/{id}/image. Empty strings become NULL. `pricing` is a JSON
    object as a string."""
    check_pricing_size(pricing)
    post = Post(
        user_id=user_id,
        title=(title or None) and title.strip() or None,
        fb_url=(fb_url or None) and fb_url.strip() or None,
        note=(note or None) and note.strip() or None,
        pricing=pricing,
    )
    db.add(post)
    await db.flush()  # need post.id before writing image file

    if image is not None and image.filename:
        await _save_image(post, image)
        await db.flush()

    # Refresh through the async session so subsequent attribute access
    # (in _build_read_with_stats) doesn't trigger a sync lazy-load outside
    # the greenlet bridge.
    await db.refresh(post)
    return await _build_read_with_stats(db, post)


class RepostPhoto(BaseModel):
    scan_id: int
    # The copy's per-card edits, built by the client, which owns their shape:
    # the sold cards removed and marked sold, so the photo covers them.
    state: dict


class Repost(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    photos: list[RepostPhoto] = Field(..., min_length=1, max_length=100)
    # A new post is a new day: today's CK prices, unless the seller keeps the old post's.
    new_prices: bool = True


@router.post("/{post_id}/repost", status_code=201)
async def repost(post_id: int, body: Repost, db: DbSession, user_id: CurrentUserId) -> dict:
    """A new post of this post's photos, for the cards still unsold: each photo
    copied (its picture on disk too) with the edits the client sends, checked
    as PATCH /api/scans/{id}/state checks them. The new post takes this post's
    pricing, and its cards today's CK prices unless `new_prices` is off. The copies have no cards on the post yet: the seller finishes
    them, as on any new post. Returns the new post and its photos as
    GET /api/scans lists them (lite)."""
    post = await db.get(Post, post_id)
    if not post or post.user_id != user_id:
        raise HTTPException(404, "Post not found")
    ids = [p.scan_id for p in body.photos]
    if len(set(ids)) != len(ids):
        raise HTTPException(400, "A photo is listed twice")
    found = {s.id: s for s in (await db.execute(
        select(Scan).where(Scan.id.in_(ids), Scan.user_id == user_id, Scan.post_id == post_id)
    )).scalars().all()}
    if len(found) != len(ids):
        raise HTTPException(404, "Photo not found in this post")
    if any(not (s.image_path and Path(s.image_path).exists()) for s in found.values()):
        raise HTTPException(409, "A photo's picture is missing on the server")

    new_post = Post(user_id=user_id, title=body.title.strip(), pricing=copy.deepcopy(post.pricing))
    db.add(new_post)
    await db.flush()
    ck_index = await get_ck_index() if body.new_prices else None
    copies: list[Scan] = []
    written: list[Path] = []
    try:
        for photo in body.photos:
            src = found[photo.scan_id]
            payload = copy.deepcopy(src.gemini_raw) or {}
            state, picks = split_state(photo.state, len(payload.get("cards", [])))
            apply_picks(payload, picks)
            if ck_index:
                refresh_prices(payload, ck_index)
            dup = Scan(
                user_id=user_id, post_id=new_post.id, position=src.position, filename=src.filename,
                width=src.width, height=src.height, gemini_raw=payload, ui_state=state,
            )
            db.add(dup)
            await db.flush()
            dst = SCANS_DIR / f"{dup.id}.bin"
            # A scan's picture never changes once saved, so a hard link is a
            # full copy that takes no time and no space.
            try:
                os.link(src.image_path, dst)
            except OSError:
                await asyncio.to_thread(shutil.copyfile, src.image_path, dst)
            written.append(dst)
            dup.image_path = str(dst)
            copies.append(dup)
        await db.flush()
    except BaseException:
        # The rows roll back with the request; their pictures go too.
        for path in written:
            path.unlink(missing_ok=True)
        raise
    await db.refresh(new_post)
    for dup in copies:
        await db.refresh(dup)
    return {
        "post": await _build_read_with_stats(db, new_post),
        "scans": [scan_out(dup, [], lite=True) for dup in copies],
    }


@router.get("/{post_id}", response_model=PostReadWithStats)
async def get_post(post_id: int, db: DbSession, user_id: CurrentUserId) -> PostReadWithStats:
    post = await db.get(Post, post_id)
    if not post or post.user_id != user_id:
        raise HTTPException(404, "Post not found")
    return await _build_read_with_stats(db, post)


@router.patch("/{post_id}", response_model=PostReadWithStats)
async def update_post(
    post_id: int, payload: PostUpdate, db: DbSession, user_id: CurrentUserId,
) -> PostReadWithStats:
    post = await db.get(Post, post_id)
    if not post or post.user_id != user_id:
        raise HTTPException(404, "Post not found")
    updates = payload.model_dump(exclude_unset=True)
    check_pricing_size(updates.get("pricing"))
    for k, v in updates.items():
        if k == "status":
            # status is an enum — never empty-string-coerced
            setattr(post, k, v)
        else:
            # Normalise empty strings to NULL so the UI doesn't have to
            setattr(post, k, v.strip() if isinstance(v, str) and v.strip() else (v if not isinstance(v, str) else None))
    await db.flush()
    await db.refresh(post)
    return await _build_read_with_stats(db, post)


@router.post("/{post_id}/image", response_model=PostReadWithStats)
async def upload_post_image(
    post_id: int,
    db: DbSession,
    user_id: CurrentUserId,
    image: UploadFile = File(...),
) -> PostReadWithStats:
    """Replace the post's reminder image. Used by the paste/upload UI in the form."""
    post = await db.get(Post, post_id)
    if not post or post.user_id != user_id:
        raise HTTPException(404, "Post not found")
    await _save_image(post, image)
    await db.flush()
    await db.refresh(post)
    return await _build_read_with_stats(db, post)


@router.get("/{post_id}/image")
async def get_post_image(
    post_id: int,
    db: DbSession,
    user_id: ImageUserId,
) -> Response:
    """Serve the post's reminder image (auth: ?token=<image token>)."""
    post = await db.get(Post, post_id)
    if not post or post.user_id != user_id:
        raise HTTPException(404, "Post not found")
    if not post.image_path:
        raise HTTPException(404, "No image attached")
    p = Path(post.image_path)
    if not p.exists():
        raise HTTPException(404, "Image file missing")
    return Response(
        content=p.read_bytes(),
        media_type=post.image_mime or "application/octet-stream",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.delete("/{post_id}/image", status_code=204)
async def delete_post_image(post_id: int, db: DbSession, user_id: CurrentUserId) -> None:
    post = await db.get(Post, post_id)
    if not post or post.user_id != user_id:
        raise HTTPException(404, "Post not found")
    if post.image_path:
        try:
            Path(post.image_path).unlink(missing_ok=True)
        except Exception:
            pass
    post.image_path = None
    post.image_mime = None
    await db.flush()


class PostListingsPayload(BaseModel):
    listing_ids: list[int]


@router.put("/{post_id}/listings", response_model=PostReadWithStats)
async def set_post_listings(
    post_id: int,
    payload: PostListingsPayload,
    db: DbSession,
    user_id: CurrentUserId,
) -> PostReadWithStats:
    """Replace the full set of listings linked to this post. Used by the
    "Add cards from stock" picker — checkboxes drive set membership. Listings
    that the user owns get linked; ones already linked but not in the payload
    get unlinked. Other posts' links are unaffected (we only touch this post's
    rows in the join table)."""
    q = (
        select(Post)
        .where(Post.id == post_id, Post.user_id == user_id)
        .options(selectinload(Post.listings))
    )
    post = (await db.execute(q)).scalar_one_or_none()
    if not post:
        raise HTTPException(404, "Post not found")

    if not payload.listing_ids:
        new_listings: list[Listing] = []
    else:
        rows = (await db.execute(
            select(Listing).where(
                Listing.id.in_(payload.listing_ids),
                Listing.user_id == user_id,
            )
        )).scalars().all()
        found = {l.id for l in rows}
        missing = [lid for lid in payload.listing_ids if lid not in found]
        if missing:
            raise HTTPException(404, f"Listing(s) not found: {missing}")
        new_listings = list(rows)

    post.listings = new_listings
    await db.flush()
    await db.refresh(post)
    return await _build_read_with_stats(db, post)


@router.delete("/{post_id}", status_code=204)
async def delete_post(post_id: int, db: DbSession, user_id: CurrentUserId) -> None:
    """Delete the post. Its image is removed; the join table rows are dropped
    via CASCADE, but the underlying listings stay intact (and may still be
    linked to other posts). Refuses delete if any of the listings are
    currently committed to an open order — caller should cancel those first."""
    post = await db.get(Post, post_id)
    if not post or post.user_id != user_id:
        raise HTTPException(404, "Post not found")

    open_commit = await db.scalar(
        select(func.count(OrderItem.id))
        .join(Listing, Listing.id == OrderItem.listing_id)
        .join(listing_post_links, listing_post_links.c.listing_id == Listing.id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(listing_post_links.c.post_id == post_id, Order.status != OrderStatus.cancelled)
    ) or 0
    if open_commit:
        raise HTTPException(409, f"{open_commit} item(s) under this post still claimed in active orders")

    if post.image_path:
        try:
            Path(post.image_path).unlink(missing_ok=True)
        except Exception:
            pass
    # Photos filed under this post become unfiled; deleting a post never
    # deletes scans.
    await db.execute(update(Scan).where(Scan.post_id == post_id).values(post_id=None))
    await db.delete(post)
