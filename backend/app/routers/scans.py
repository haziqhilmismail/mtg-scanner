"""Saved scans: list, per-card edits, filing under posts, pictures, delete, re-pricing.
POST /api/scan (making one) and frame-card stay in main.py with the scan pipeline."""

import asyncio
import base64
import json
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm.attributes import flag_modified

from ..deps import CurrentUserId, DbSession, ImageUserId, limiter
from ..models import Listing, ListingStatus, Order, OrderItem, OrderStatus, Post, Scan
from ..services.listings import drop_listing
from ..services.cardkingdom_prices import enrich as enrich_with_ck
from ..services.cardkingdom_prices import get_index as get_ck_index

router = APIRouter(prefix="/api/scans", tags=["scans"])


@router.get("")
async def list_scans(
    db: DbSession, user_id: CurrentUserId,
    limit: int = Query(default=30, ge=1, le=500), lite: bool = False,
    before: int | None = None,
):
    """Most-recent-first list of saved scans, with the full response baked in.
    Frontend uses this to rehydrate batches after a page refresh.

    `lite=1` leaves out the embedded images (the photo preview and every
    card's thumbnail, as base64). With them, 30 scans is ~22 MB in a single
    response that has to finish before anything shows; without, ~0.3 MB. The
    client then loads each picture from /preview and /crops/{id} below, only
    when it is on screen, and the browser caches them.

    `before=<scan id>` pages back: the scans with a smaller id than that one.

    `listed` holds the bbox of each card of the scan that is on the checklist,
    so the client can tell which cards are not added yet."""
    q = (
        select(Scan)
        .where(Scan.user_id == user_id)
        .order_by(Scan.id.desc())
        .limit(limit)
    )
    if before is not None:
        q = q.where(Scan.id < before)
    rows = (await db.execute(q)).scalars().all()
    listed: dict[int, list[list[int]]] = {}
    for scan_id, bbox in (await db.execute(
        select(Listing.scan_id, Listing.bbox)
        .where(Listing.scan_id.in_([s.id for s in rows]), Listing.bbox.is_not(None),
               Listing.status != ListingStatus.archived)
        .order_by(Listing.id)
    )).all():
        listed.setdefault(scan_id, []).append(bbox)
    out = []
    for s in rows:
        payload = s.gemini_raw or {}
        cards = payload.get("cards", [])
        if lite:
            cards = [{**c, "crop_b64": ""} for c in cards]
        out.append({
            "image_id": str(s.id),
            "scan_id": s.id,
            "post_id": s.post_id,
            "filename": s.filename,
            "image_b64": "" if lite else payload.get("image_b64", ""),
            "width": s.width,
            "height": s.height,
            "cards": cards,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "ui_state": s.ui_state,
            "listed": listed.get(s.id, []),
        })
    return out


class ScanState(BaseModel):
    state: dict


@router.patch("/{scan_id}/state", status_code=204)
async def save_scan_state(scan_id: int, body: ScanState, db: DbSession, user_id: CurrentUserId):
    """Store the seller's per-card edits for this scan. Last write wins, except
    a state whose integer rev is below the stored one is ignored (late arrival).

    `picks` (one entry per card, null or a candidate) are printings the seller
    chose for a card. They are not kept in ui_state: each one replaces the
    card's first candidate in the saved scan, so every later read sees it."""
    scan_row = await db.get(Scan, scan_id)
    if not scan_row or scan_row.user_id != user_id:
        raise HTTPException(404, "Scan not found")
    if len(json.dumps(body.state)) > 64 * 1024:
        raise HTTPException(413, "State too large (max 64 KB)")
    state = dict(body.state)
    picks = state.pop("picks", None)
    if picks is not None and not (
        isinstance(picks, list)
        and len(picks) <= len((scan_row.gemini_raw or {}).get("cards", []))
        and all(p is None or (isinstance(p, dict) and isinstance(p.get("name"), str)) for p in picks)
    ):
        raise HTTPException(400, "picks must be a list of null or a candidate with a name, one per card")
    # One conditional UPDATE, so two saves arriving together can't both pass a
    # read-then-compare and leave the older one stored.
    rev = state.get("rev")
    newer = Scan.id == scan_id
    if type(rev) is int:
        stored_is_int = func.coalesce(func.json_type(Scan.ui_state, "$.rev"), "") == "integer"
        newer = newer & ~(stored_is_int & (func.json_extract(Scan.ui_state, "$.rev") > rev))
    result = await db.execute(update(Scan).where(newer).values(ui_state=state).execution_options(synchronize_session=False))
    if result.rowcount != 1 or not any(picks or []):  # most saves pick nothing: leave gemini_raw (and its photo) alone
        return
    # The UPDATE holds SQLite's write lock until the session commits, so this
    # re-read and write can't interleave with another writer of this scan.
    await db.refresh(scan_row, ["gemini_raw"])
    payload = scan_row.gemini_raw
    for card, pick in zip(payload["cards"], picks):
        if pick is not None:
            card["candidates"] = [pick, *(card.get("candidates") or [])[1:]]
    scan_row.gemini_raw = payload
    flag_modified(scan_row, "gemini_raw")


class MoveScans(BaseModel):
    scan_ids: list[int]
    post_id: int | None = None  # None = unfile


@router.post("/move", status_code=204)
async def move_scans(body: MoveScans, db: DbSession, user_id: CurrentUserId):
    """File photos under a post (or unfile them). Other people's scans in
    `scan_ids` are silently left alone."""
    if body.post_id is not None:
        post = await db.get(Post, body.post_id)
        if not post or post.user_id != user_id:
            raise HTTPException(404, "Post not found")
    await db.execute(
        update(Scan)
        .where(Scan.id.in_(body.scan_ids), Scan.user_id == user_id)
        .values(post_id=body.post_id)
    )


async def _scan_for_image(db: DbSession, scan_id: int, user_id: int) -> Scan:
    """The scan behind an <img src>, 404 unless it is `user_id`'s."""
    scan_row = await db.get(Scan, scan_id)
    if not scan_row or scan_row.user_id != user_id:
        raise HTTPException(404, "Scan not found")
    return scan_row


def _data_url_jpeg(data_url: str, max_edge: int | None = None) -> Response:
    """A stored `data:image/jpeg;base64,...` string as an image response,
    optionally shrunk. A scan's pictures never change once saved, so the
    browser may keep them for good."""
    if not data_url:
        raise HTTPException(404, "No image")
    raw = base64.b64decode(data_url.split(",", 1)[-1])
    if max_edge:
        img = Image.open(BytesIO(raw))
        img.thumbnail((max_edge, max_edge))
        buf = BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=80)
        raw = buf.getvalue()
    return Response(
        content=raw,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.get("/{scan_id}/preview")
async def scan_preview(
    scan_id: int,
    db: DbSession,
    user_id: ImageUserId,
    w: int | None = Query(default=None, ge=32, le=1400),
):
    """The scan's photo preview. `w` caps the longest edge, for the small
    thumbnails in the scan strip."""
    scan_row = await _scan_for_image(db, scan_id, user_id)
    # Resizing for ?w= is a decode + re-encode; a strip of thumbnails is many at once.
    return await asyncio.to_thread(_data_url_jpeg, (scan_row.gemini_raw or {}).get("image_b64", ""), w)


@router.get("/{scan_id}/crops/{card_id}")
async def scan_card_crop(
    scan_id: int, card_id: int, db: DbSession, user_id: ImageUserId,
):
    """One detected card's thumbnail, cut from the photo at scan time."""
    scan_row = await _scan_for_image(db, scan_id, user_id)
    for card in (scan_row.gemini_raw or {}).get("cards", []):
        if card.get("id") == card_id:
            return _data_url_jpeg(card.get("crop_b64", ""))
    raise HTTPException(404, "Card not found")


@router.delete("/{scan_id}", status_code=204)
async def delete_scan(scan_id: int, db: DbSession, user_id: CurrentUserId):
    """Drop a scan from the dashboard. Removes the DB row, the image bytes on
    disk, and the checklist cards added from it. A card in an open order
    stays (unlinked from the scan), so no buyer's claim is lost."""
    scan_row = await db.get(Scan, scan_id)
    if not scan_row or scan_row.user_id != user_id:
        raise HTTPException(404, "Scan not found")
    claimed = (
        select(OrderItem.listing_id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.status != OrderStatus.cancelled)
    )
    for listing in (await db.execute(
        select(Listing).where(Listing.scan_id == scan_id, Listing.id.not_in(claimed))
    )).scalars().all():
        await drop_listing(db, listing)
    if scan_row.image_path:
        try:
            Path(scan_row.image_path).unlink(missing_ok=True)
        except Exception:
            pass
    await db.delete(scan_row)


@router.post("/{scan_id}/relookup-prices")
@limiter.limit("30/minute")
async def relookup_scan_prices(
    request: Request, scan_id: int, db: DbSession, user_id: CurrentUserId,
):
    """Re-run CK price enrichment for every candidate in a saved scan. Cards
    themselves (names, sets, scryfall_ids, bboxes) are unchanged — only the
    pricing fields (usd/usd_foil/price_source_*/ck_*) are refreshed from
    the current ck_index.db. Cheap (local SQLite lookups, no network).
    Returns the same shape as GET /api/scans for in-place rehydration."""
    scan_row = await db.get(Scan, scan_id)
    if not scan_row or scan_row.user_id != user_id:
        raise HTTPException(404, "Scan not found")

    payload = scan_row.gemini_raw or {}
    cards = payload.get("cards", [])
    ck_index = await get_ck_index()

    updated = 0
    for card in cards:
        cands = card.get("candidates", []) or []
        for i, cand in enumerate(cands):
            if not cand:
                continue
            new_cand = enrich_with_ck(cand, ck_index)
            if new_cand:
                cands[i] = new_cand
                updated += 1
        card["candidates"] = cands

    payload["cards"] = cards
    scan_row.gemini_raw = payload
    # JSON column needs an explicit mark — SQLAlchemy doesn't detect
    # in-place dict mutation.
    flag_modified(scan_row, "gemini_raw")
    await db.commit()

    return {
        "image_id": str(scan_row.id),
        "scan_id": scan_row.id,
        "filename": scan_row.filename,
        "image_b64": payload.get("image_b64", ""),
        "width": scan_row.width,
        "height": scan_row.height,
        "cards": cards,
        "updated": updated,
    }
