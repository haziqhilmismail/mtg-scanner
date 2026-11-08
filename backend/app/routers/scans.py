"""Scans: POST /api/scan makes one from a photo; /api/scans/... lists saved
scans and edits their cards, filing, pictures, prices. The pipeline and the
card record live in services/scans.py."""

import asyncio
import base64
from contextlib import nullcontext
from io import BytesIO
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update

from ..deps import CurrentUserId, DbSession, ImageUserId, json_payload, limiter, owned
from ..models import Listing, ListingStatus, Post, Scan
from ..models.card_correction import CorrectionKind
from ..schemas.types import CardEdits, Id
from ..services import catalogue, corrections, credits, scans
from ..services.listings import locked_prices
from ..services.scans import apply_picks, refresh_prices, scan_out, split_state

router = APIRouter(tags=["scans"])

@router.post("/api/scan")
@limiter.limit("10/minute;100/hour")  # local scans load the home server's CPU; Gemini scans cost money
async def scan(
    request: Request,
    db: DbSession,
    user_id: CurrentUserId,
    image: UploadFile = File(...),
    post_id: Id | None = Form(default=None),
):
    # Which post to file the photo under. Checked before anything costly.
    if post_id is not None:
        await owned(db, Post, post_id, user_id)
    if problem := scans.scanner.ready():
        raise HTTPException(503, problem)
    raw = await image.read()
    # Reject oversized uploads before the expensive decode. 25 MB is generous
    # for a phone photo (even a 48 MP HEIC is a few MB); anything bigger is
    # either a mistake or an attempt to exhaust memory on the box.
    MAX_UPLOAD_BYTES = 25 * 1024 * 1024
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image too large (max 25 MB)")
    try:
        pil, jpeg = await asyncio.to_thread(scans.normalise_upload, raw)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # A scan that costs a credit hands it back if anything below fails.
    async with credits.spend(db, user_id) if scans.scanner.costs_credit else nullcontext():
        try:
            found = await scans.scanner.detect(pil, jpeg)
        except Exception as e:
            raise HTTPException(500, f"Scan failed: {e}")
        cards = await scans.identify(found, *pil.size)
        result = await scans.store(db, user_id, image.filename, pil, jpeg, cards, post_id)
    result["credits"] = await credits.status(db, user_id)
    return result


@router.post("/api/scans/{scan_id}/frame-card")
@limiter.limit("30/minute")
async def frame_card(
    request: Request,
    scan_id: Id,
    db: DbSession,
    user_id: CurrentUserId,
    payload: str = Form(...),
):
    """User-drawn frame around a card the detector missed (typically two
    cards merged into one bbox). Body: {corners: [[x,y]*4]} in source-image
    pixels, TL/TR/BR/BL order. Returns a "manual" card the user fills in via
    the row's edit controls. Appended to the scan's stored cards JSON so it
    survives refresh."""
    scan_row = await owned(db, Scan, scan_id, user_id)

    corners = json_payload(payload).get("corners")
    if not (isinstance(corners, list) and len(corners) == 4
            and all(isinstance(p, list) and len(p) == 2 for p in corners)):
        raise HTTPException(400, "Missing/invalid 'corners' — need 4 [x,y] points")
    try:
        corners_int = [[int(round(p[0])), int(round(p[1]))] for p in corners]
    except (TypeError, ValueError):
        raise HTTPException(400, "Corners must be numeric")

    if not (photo := scan_row.photo):
        raise HTTPException(404, "image_id not found (re-upload the image)")
    pil = await asyncio.to_thread(scans.decode_upright, photo.read_bytes())

    try:
        new_card = (await scans.manual_card(pil, scan_row.cards, corners_int)).to_payload()
    except ValueError as e:
        raise HTTPException(400, str(e))
    with scan_row.edit_payload() as payload:
        payload["cards"] = [*scan_row.cards, new_card]
    await db.flush()
    return new_card


@router.get("/api/scans")
async def list_scans(
    db: DbSession, user_id: CurrentUserId,
    limit: int = Query(default=30, ge=1, le=500), lite: bool = False,
    before: Id | None = None,
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
    return [scan_out(s, listed.get(s.id, []), lite) for s in rows]


class ScanState(BaseModel):
    state: CardEdits


@router.patch("/api/scans/{scan_id}/state", status_code=204)
async def save_scan_state(scan_id: Id, body: ScanState, db: DbSession, user_id: CurrentUserId):
    """Store the seller's per-card edits for this scan. Last write wins, except
    a state whose integer rev is below the stored one is ignored (late arrival).

    `picks` (one entry per card, null or a candidate) are printings the seller
    chose for a card. They are not kept in ui_state: each one replaces the
    card's first candidate in the saved scan, so every later read sees it."""
    scan_row = await owned(db, Scan, scan_id, user_id)
    try:
        state, picks = split_state(body.state, len(scan_row.cards))
    except ValueError as e:
        raise HTTPException(400, str(e))
    # One conditional UPDATE, so two saves arriving together can't both pass a
    # read-then-compare and leave the older one stored.
    rev = state.get("rev")
    newer = Scan.id == scan_id
    if type(rev) is int:
        stored_is_int = func.coalesce(func.json_type(Scan.ui_state, "$.rev"), "") == "integer"
        newer = newer & ~(stored_is_int & (func.json_extract(Scan.ui_state, "$.rev") > rev))
    result = await db.execute(update(Scan).where(newer).values(ui_state=state).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        return
    # A finished photo: its stock listings carry the prices it was posted with.
    if prices := locked_prices(state, scan_row.cards):
        for listing in (await db.scalars(select(Listing).where(
            Listing.scan_id == scan_id, Listing.status != ListingStatus.archived,
        ))).all():
            if listing.bbox and tuple(listing.bbox) in prices:
                listing.unit_price_myr = prices[tuple(listing.bbox)]
    if not any(picks or []):  # most saves pick nothing: leave the stored cards (and photo) alone
        return
    # The UPDATE holds SQLite's write lock until the session commits, so this
    # re-read and write can't interleave with another writer of this scan.
    await db.refresh(scan_row, ["gemini_raw"])
    with scan_row.edit_payload() as payload:
        apply_picks(payload, picks)


class Answer(BaseModel):
    scryfall_id: UUID
    kind: CorrectionKind


@router.put("/api/scans/{scan_id}/cards/{card_id}/correction")
@limiter.limit("120/minute")
async def correct_card(
    request: Request, scan_id: Id, card_id: int, body: Answer, db: DbSession, user_id: CurrentUserId,
) -> dict:
    """The seller says this card is the printing `scryfall_id`: they picked it
    (`kind` "pick"), or tapped "Looks right" on the one it shows ("confirm").
    The card's crop and the answer are kept as training data for the local
    scanner. Sending the same answer again changes nothing; a different one
    replaces it. `kept` is false when the card has no usable crop, for example
    one the seller framed by hand."""
    scan_row = await owned(db, Scan, scan_id, user_id)
    card = scan_row.card(card_id)
    if card is None:
        raise HTTPException(404, "Card not found")
    return {"kept": await corrections.keep_answer(db, scan_row, card, str(body.scryfall_id), body.kind)}


class MoveScans(BaseModel):
    scan_ids: list[Id]
    post_id: Id | None = None  # None = unfile


@router.post("/api/scans/move", status_code=204)
async def move_scans(body: MoveScans, db: DbSession, user_id: CurrentUserId):
    """File photos under a post (or unfile them). Other people's scans in
    `scan_ids` are silently left alone."""
    if body.post_id is not None:
        await owned(db, Post, body.post_id, user_id)
    await db.execute(
        update(Scan)
        .where(Scan.id.in_(body.scan_ids), Scan.user_id == user_id)
        # Into another post: after its photos, until the seller places it.
        .values(post_id=body.post_id, position=None)
    )


class ScanOrder(BaseModel):
    scan_ids: list[Id] = Field(..., max_length=500)


@router.put("/api/scans/order", status_code=204)
async def order_scans(body: ScanOrder, db: DbSession, user_id: CurrentUserId):
    """Save the order of a post's photos: the first id is Photo 1. Other
    people's scans in `scan_ids` are silently left alone."""
    for position, scan_id in enumerate(body.scan_ids):
        await db.execute(
            update(Scan).where(Scan.id == scan_id, Scan.user_id == user_id).values(position=position)
        )


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


@router.get("/api/scans/{scan_id}/preview")
async def scan_preview(
    scan_id: Id,
    db: DbSession,
    user_id: ImageUserId,
    w: int | None = Query(default=None, ge=32, le=1400),
):
    """The scan's photo preview. `w` caps the longest edge, for the small
    thumbnails in the scan strip."""
    scan_row = await owned(db, Scan, scan_id, user_id)
    return await asyncio.to_thread(_data_url_jpeg, scan_row.preview_b64, w)


@router.get("/api/scans/{scan_id}/crops/{card_id}")
async def scan_card_crop(
    scan_id: Id, card_id: int, db: DbSession, user_id: ImageUserId,
):
    """One detected card's thumbnail, cut from the photo at scan time."""
    scan_row = await owned(db, Scan, scan_id, user_id)
    if card := scan_row.card(card_id):
        return _data_url_jpeg(card.get("crop_b64", ""))
    raise HTTPException(404, "Card not found")


@router.delete("/api/scans/{scan_id}", status_code=204)
async def delete_scan(scan_id: Id, db: DbSession, user_id: CurrentUserId):
    """Drop a scan from the dashboard. Removes the DB row, the image bytes on
    disk, and the checklist cards added from it. A card in an open order
    stays (unlinked from the scan), so no buyer's claim is lost."""
    await scans.delete(db, await owned(db, Scan, scan_id, user_id))


@router.post("/api/scans/{scan_id}/relookup-prices")
@limiter.limit("30/minute")
async def relookup_scan_prices(
    request: Request, scan_id: Id, db: DbSession, user_id: CurrentUserId,
):
    """Re-run CK price enrichment for every candidate in a saved scan. Cards
    themselves (names, sets, scryfall_ids, bboxes) are unchanged — only the
    pricing fields (usd/usd_foil/price_source_*/ck_*) are refreshed from
    the current ck_index.db. Cheap (local SQLite lookups, no network).
    Returns the scan's picture and repriced cards, and `updated`: how many
    candidates got a price row."""
    scan_row = await owned(db, Scan, scan_id, user_id)

    ck = await catalogue.ck_index()
    with scan_row.edit_payload() as payload:
        updated = refresh_prices(payload, ck)
    return {**scan_out(scan_row, [], lite=False), "updated": updated}
