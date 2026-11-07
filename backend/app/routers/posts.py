"""CRUD for Facebook post groups. A post is a tiny container: FB URL +
free-form note. Its cards are listings linked through listing_post_links
(a card can be in several posts).

We never query Facebook. The URL is reference-only."""

import asyncio
import copy
import os
import shutil
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Form, HTTPException
from pydantic import BaseModel, Field, Json
from sqlalchemy import case, func, select, update

from ..config import settings
from ..deps import CurrentUserId, DbSession, owned
from ..models import (
    Listing,
    ListingStatus,
    Order,
    OrderItem,
    Post,
    listing_post_links,
    Scan,
)
from ..schemas import PostReadWithStats, PostUpdate
from ..schemas.types import Id, Pricing
from ..services import catalogue
from ..services.scans import apply_picks, refresh_prices, scan_out, split_state

router = APIRouter(prefix="/api/posts", tags=["posts"])


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
    live = (Order.holds_stock, Order.archived_at.is_(None))
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
        "buyer_count": buyer_count,
        "unpaid_buyer_count": unpaid_buyer_count,
        "paid_myr": f"{paid:.2f}",
    })


async def _build_read_with_stats(db, post: Post) -> PostReadWithStats:
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
    pricing: Json[Pricing] | None = Form(None),
) -> PostReadWithStats:
    """Create a post. Empty strings become NULL. `pricing` is a JSON object as
    a string."""
    post = Post(
        user_id=user_id,
        title=(title or None) and title.strip() or None,
        fb_url=(fb_url or None) and fb_url.strip() or None,
        note=(note or None) and note.strip() or None,
        pricing=pricing,
    )
    db.add(post)
    await db.flush()

    # Refresh through the async session so subsequent attribute access
    # (in _build_read_with_stats) doesn't trigger a sync lazy-load outside
    # the greenlet bridge.
    await db.refresh(post)
    return await _build_read_with_stats(db, post)


class RepostPhoto(BaseModel):
    scan_id: Id
    # The copy's per-card edits, built by the client, which owns their shape:
    # the sold cards removed and marked sold, so the photo covers them.
    state: dict


class Repost(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    photos: list[RepostPhoto] = Field(..., min_length=1, max_length=100)
    # A new post is a new day: today's CK prices, unless the seller keeps the old post's.
    new_prices: bool = True


@router.post("/{post_id}/repost", status_code=201)
async def repost(post_id: Id, body: Repost, db: DbSession, user_id: CurrentUserId) -> dict:
    """A new post of this post's photos, for the cards still unsold: each photo
    copied (its picture on disk too) with the edits the client sends, checked
    as PATCH /api/scans/{id}/state checks them. The new post takes this post's
    pricing, and its cards today's CK prices unless `new_prices` is off. The copies have no cards on the post yet: the seller finishes
    them, as on any new post. Returns the new post and its photos as
    GET /api/scans lists them (lite)."""
    post = await owned(db, Post, post_id, user_id)
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
    ck_index = await catalogue.ck_index() if body.new_prices else None
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
            dst = settings.scans_dir / f"{dup.id}.bin"
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


@router.patch("/{post_id}", response_model=PostReadWithStats)
async def update_post(
    post_id: Id, payload: PostUpdate, db: DbSession, user_id: CurrentUserId,
) -> PostReadWithStats:
    post = await owned(db, Post, post_id, user_id)
    updates = payload.model_dump(exclude_unset=True)
    for k, v in updates.items():
        if k == "status":
            setattr(post, k, v)
        else:
            setattr(post, k, v.strip() if isinstance(v, str) and v.strip() else (v if not isinstance(v, str) else None))
    await db.flush()
    await db.refresh(post)
    return await _build_read_with_stats(db, post)


@router.delete("/{post_id}", status_code=204)
async def delete_post(post_id: Id, db: DbSession, user_id: CurrentUserId) -> None:
    """Delete the post. The join table rows are dropped
    via CASCADE, but the underlying listings stay intact (and may still be
    linked to other posts). Refuses delete if any of the listings are
    currently committed to an open order — caller should cancel those first."""
    post = await owned(db, Post, post_id, user_id)

    open_commit = await db.scalar(
        select(func.count(OrderItem.id))
        .join(Listing, Listing.id == OrderItem.listing_id)
        .join(listing_post_links, listing_post_links.c.listing_id == Listing.id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(listing_post_links.c.post_id == post_id, Order.holds_stock)
    ) or 0
    if open_commit:
        raise HTTPException(409, f"{open_commit} item(s) under this post still claimed in active orders")

    # Older posts can still have a reminder image on disk.
    if post.image_path:
        try:
            Path(post.image_path).unlink(missing_ok=True)
        except Exception:
            pass
    # Photos filed under this post become unfiled; deleting a post never
    # deletes scans.
    await db.execute(update(Scan).where(Scan.post_id == post_id).values(post_id=None))
    await db.delete(post)
