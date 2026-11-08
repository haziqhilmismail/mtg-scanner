"""One scan, from the uploaded photo to the saved cards.

The scanner (Gemini or local, picked once below from SCANNER_BACKEND) finds
the cards; Scryfall and Card Kingdom turn each guess into a priced candidate;
`store` writes the photo and the cards and builds the /api/scan response. The
card record itself is `schemas.scan.ScannedCard`."""

import asyncio
import base64
import copy
import os
import shutil
from io import BytesIO
from pathlib import Path
from typing import Protocol

from PIL import Image, ImageOps
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import Listing, Order, OrderItem, Scan
from ..schemas.scan import Detection, Guess, ScannedCard
from ..schemas.types import PICKS_ERROR
from . import catalogue, gemini_scanner, local_scan
from .catalogue import CKPriceIndex
from .listings import drop_listing


class Scanner(Protocol):
    model: str  # shown by /api/health
    costs_credit: bool  # a Gemini call costs money; the local scanner is free

    def load(self) -> None:
        """Load models (seconds). Called off the event loop at startup."""

    def ready(self) -> str | None:
        """None when scans can run; otherwise what is missing."""

    async def detect(self, pil: Image.Image, jpeg: bytes) -> list[Detection]:
        """The cards in an upright RGB photo (`jpeg` is the same photo encoded)."""


scanner: Scanner = local_scan.LocalScanner() if settings.use_local_scanner else gemini_scanner.GeminiScanner()


# A 12 MP PIL RGB bitmap is ~36 MB, plus Sobel + base64 + thumbnail buffers;
# a couple of scans at once on a small box blow the memory budget. The client
# downscales JPEG/PNG/WebP but not HEIC (non-Safari browsers can't decode it),
# so the cap has to be here.
SCAN_MAX_EDGE = 2000


def decode_upright(raw: bytes) -> Image.Image:
    """Decode a photo and turn it the right way up (EXIF). Raises ValueError
    when the bytes are not an image."""
    try:
        pil = Image.open(BytesIO(raw))
        pil.load()
    except Exception:
        raise ValueError("Could not decode image")
    try:
        pil = ImageOps.exif_transpose(pil)
    except Exception:
        pass
    return pil


def normalise_upload(raw: bytes) -> tuple[Image.Image, bytes]:
    """Decode an uploaded photo, upright it, cap its size; returns the RGB
    image and the JPEG bytes that get stored and sent to the scanner."""
    pil = decode_upright(raw)
    if max(pil.size) > SCAN_MAX_EDGE:
        pil.thumbnail((SCAN_MAX_EDGE, SCAN_MAX_EDGE), Image.LANCZOS)
    pil = pil.convert("RGB")
    buf = BytesIO()
    pil.save(buf, format="JPEG", quality=92)
    return pil, buf.getvalue()


def _jpeg_data_url(pil: Image.Image) -> str:
    buf = BytesIO()
    pil.convert("RGB").save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _thumb_b64(pil: Image.Image, x: int, y: int, x2: int, y2: int) -> str:
    """A card's thumbnail as a data URL. 700 px wide: the row shows it at
    ~78 px, the zoom modal at up to 900 px, from the same bytes."""
    crop = pil.crop((max(0, x), max(0, y), min(pil.width, x2), min(pil.height, y2)))
    if crop.width == 0 or crop.height == 0:
        return ""
    crop.thumbnail((700, 980))
    return _jpeg_data_url(crop)


def _pictures(pil: Image.Image, cards: list[ScannedCard]) -> tuple[str, list[str]]:
    """The scan's preview and one thumbnail per card, as data URLs."""
    preview = pil.copy()
    preview.thumbnail((1400, 1400))
    return _jpeg_data_url(preview), [_thumb_b64(pil, x, y, x + w, y + h) for x, y, w, h in (c.bbox for c in cards)]


def _unknown_candidate(guess: Guess) -> dict:
    """The candidate shown when Scryfall has no match: the guess, unpriced."""
    return {
        "scryfall_id": guess.scryfall_id,
        "name": guess.name or "(unknown)",
        "set": guess.set_code.upper(),
        "set_name": "",
        "collector_number": guess.collector_number,
        "rarity": "",
        "usd": 0.0, "usd_foil": 0.0,
        "image_url": "",
        "scryfall_uri": "",
        "_lookup_failed": True,
        "price_source_normal": "none",
        "price_source_foil": "none",
    }


def _record(i: int, d: Detection, candidate: dict | None, width: int, height: int) -> ScannedCard:
    x, y, w, h = d.bbox
    x, y = max(0, x), max(0, y)
    x2, y2 = min(width, x + w), min(height, y + h)
    return ScannedCard(
        id=i,
        bbox=[x, y, x2 - x, y2 - y],
        corners=d.corners,
        bbox_source=d.bbox_source,
        name_source=d.name_source,
        name_confidence=None if d.confidence is None else round(d.confidence, 3),
        version_source=d.version_source,
        gemini=d.guess,
        candidates=[candidate or _unknown_candidate(d.guess)],
    )


async def identify(found: list[Detection], width: int, height: int) -> list[ScannedCard]:
    """Look every detection up on Scryfall, price it with Card Kingdom, and
    make the card records, boxes clamped to the photo."""
    cards = await catalogue.look_up([d.guess for d in found])
    return [_record(i, d, c, width, height) for i, (d, c) in enumerate(zip(found, cards))]


async def manual_card(pil: Image.Image, existing: list[dict], corners: list[list[int]]) -> ScannedCard:
    """A card the seller framed by hand (TL, TR, BR, BL in photo pixels),
    with no name: the row's edit controls fill it in. Raises ValueError when
    the frame is too small to be a card."""
    W, H = pil.size
    clamped = [[max(0, min(W, x)), max(0, min(H, y))] for x, y in corners]
    xs = [p[0] for p in clamped]
    ys = [p[1] for p in clamped]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    if x1 - x0 < 16 or y1 - y0 < 16:
        raise ValueError("Frame is too small")
    return ScannedCard(
        id=max((c.get("id", -1) for c in existing), default=-1) + 1,
        bbox=[x0, y0, x1 - x0, y1 - y0],
        corners=clamped,
        crop_b64=await asyncio.to_thread(_thumb_b64, pil, x0, y0, x1, y1),
        bbox_source="user",
        name_source="gemini",  # nothing named it; the UI shows the manual banner
        name_confidence=None,
        gemini=Guess(),
        candidates=[{
            **_unknown_candidate(Guess()),
            "name": "",
            "_manual": True,
            "price_source_normal": "manual",
            "price_source_foil": "manual",
        }],
    )


async def store(
    db: AsyncSession, user_id: int, filename: str | None,
    pil: Image.Image, jpeg: bytes, cards: list[ScannedCard], post_id: int | None,
) -> dict:
    """Persist a finished scan (photo + cards) and build the /api/scan response."""
    W, H = pil.size
    preview_b64, thumbs = await asyncio.to_thread(_pictures, pil, cards)
    for card, thumb in zip(cards, thumbs):
        card.crop_b64 = thumb

    # The whole response (cards + preview) goes in gemini_raw, so GET /api/scans
    # can rehydrate the frontend on refresh without scanning again.
    payload = {
        "image_b64": preview_b64,
        "width": W,
        "height": H,
        "cards": [c.to_payload() for c in cards],
    }
    scan_row = Scan(
        user_id=user_id,
        post_id=post_id,
        filename=filename or "upload.jpg",
        width=W,
        height=H,
        gemini_raw=payload,
    )
    db.add(scan_row)
    await db.flush()
    # The normalized JPEG (downscaled + EXIF-corrected), not the raw upload:
    # its pixels match the W/H and polygon coords of the response, so the
    # frontend and /api/export agree, and export never re-decodes HEIC.
    image_path = photo_path(scan_row.id)
    image_path.write_bytes(jpeg)
    scan_row.image_path = str(image_path)
    await db.flush()
    return scan_out(scan_row, [], lite=False)


def photo_path(scan_id: int) -> Path:
    """Where a scan's photo is stored."""
    return settings.scans_dir / f"{scan_id}.bin"


async def copy_scans(
    db: AsyncSession, sources: list[tuple[Scan, dict]], post_id: int, ck: CKPriceIndex | None,
) -> list[Scan]:
    """A copy of each scan under `post_id`, its picture on disk too, with the
    per-card edits given beside it (see split_state), and today's prices when
    `ck` is given. ValueError when edits do not fit their scan; then no copied
    picture is left on disk."""
    copies: list[Scan] = []
    try:
        for src, edits in sources:
            state, picks = split_state(edits, len(src.cards))
            dup = Scan(
                user_id=src.user_id, post_id=post_id, position=src.position, filename=src.filename,
                width=src.width, height=src.height, gemini_raw=copy.deepcopy(src.gemini_raw), ui_state=state,
            )
            with dup.edit_payload() as payload:
                apply_picks(payload, picks)
                if ck:
                    refresh_prices(payload, ck)
            db.add(dup)
            await db.flush()
            dst = photo_path(dup.id)
            # A scan's picture never changes once saved, so a hard link is a
            # full copy that takes no time and no space.
            try:
                os.link(src.image_path, dst)
            except OSError:
                await asyncio.to_thread(shutil.copyfile, src.image_path, dst)
            dup.image_path = str(dst)
            copies.append(dup)
        await db.flush()
    except BaseException:
        # The rows roll back with the request; their pictures go too.
        for dup in copies:
            photo_path(dup.id).unlink(missing_ok=True)
        raise
    return copies


async def delete(db: AsyncSession, scan: Scan) -> None:
    """Delete a scan, its photo on disk, and the listings added from it. A
    listing in an open order stays (unlinked from the scan), so no buyer's
    claim is lost."""
    claimed = (
        select(OrderItem.listing_id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.holds_stock)
    )
    for listing in (await db.scalars(
        select(Listing).where(Listing.scan_id == scan.id, Listing.id.not_in(claimed))
    )).all():
        await drop_listing(db, listing)
    if scan.image_path:
        try:
            Path(scan.image_path).unlink(missing_ok=True)
        except Exception:
            pass
    await db.delete(scan)


def scan_out(s: Scan, listed: list[list[int]], lite: bool) -> dict:
    """A saved scan as the client rehydrates it (see list_scans)."""
    cards = s.cards
    if lite:
        cards = [{**c, "crop_b64": ""} for c in cards]
    return {
        "image_id": str(s.id),
        "scan_id": s.id,
        "post_id": s.post_id,
        "filename": s.filename,
        "image_b64": "" if lite else s.preview_b64,
        "width": s.width,
        "height": s.height,
        "cards": cards,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "position": s.position,
        "ui_state": s.ui_state,
        "listed": listed,
    }


def split_state(state: dict, n_cards: int) -> tuple[dict, list | None]:
    """A client's per-card edits (`schemas.types.CardEdits`): the state to
    store, and the picks taken out of it (see save_scan_state). ValueError
    when there are more picks than cards."""
    state = dict(state)
    picks = state.pop("picks", None)
    if picks is not None and len(picks) > n_cards:
        raise ValueError(PICKS_ERROR)
    return state, picks


def apply_picks(payload: dict, picks: list | None) -> None:
    """Each pick becomes its card's first candidate in the saved scan."""
    for card, pick in zip(payload["cards"], picks or []):
        if pick is not None:
            card["candidates"] = [pick, *(card.get("candidates") or [])[1:]]


def refresh_prices(payload: dict, ck: CKPriceIndex) -> int:
    """Today's CK prices on every candidate of a scan's payload, in place.
    Returns how many candidates got a price row."""
    cards = payload.get("cards", []) or []
    updated = 0
    for card in cards:
        cands = card.get("candidates", []) or []
        for i, cand in enumerate(cands):
            if not cand:
                continue
            new_cand = catalogue.priced(cand, ck)
            if new_cand:
                cands[i] = new_cand
                updated += 1
    return updated
