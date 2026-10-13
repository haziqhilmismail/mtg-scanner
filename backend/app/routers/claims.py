"""Claims: read a Facebook comment thread, draft who claimed what, confirm into orders."""

import asyncio
import base64
from decimal import Decimal
from io import BytesIO

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from PIL import Image
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..deps import CurrentUserId, DbSession
from ..models import Listing, ListingStatus, Post, Scan, User
from ..schemas import OrderCreate, OrderItemCreate, OrderRead
from ..services import claims
from . import orders as orders_router

router = APIRouter(prefix="/api/claims", tags=["claims"])

# Local limiter, same pattern as routers/bugs.py.
_limiter = Limiter(key_func=get_remote_address)

MAX_SCREENSHOTS = 12
MAX_PHOTOS = 60          # candidate photos to match a screenshot against
MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024


@router.post("/read")
@_limiter.limit("20/minute")
async def read_screenshots(
    request: Request, db: DbSession, user_id: CurrentUserId,
    images: list[UploadFile] = File(...),
    scan_ids: str = Form(default=""),
):
    """Read screenshots of a comment thread, in the order given. For each one:
    the thread's text (OCR) and, when the screenshot shows one of the photos
    in `scan_ids` (comma-separated), which. Nothing is interpreted yet — the
    seller checks both first."""
    if len(images) > MAX_SCREENSHOTS:
        raise HTTPException(400, f"Too many screenshots (max {MAX_SCREENSHOTS})")
    ids = [int(x) for x in scan_ids.split(",") if x.strip().isdigit()][:MAX_PHOTOS]
    photos: dict[int, Image.Image] = {}
    if ids:
        rows = (await db.scalars(select(Scan).where(Scan.id.in_(ids), Scan.user_id == user_id))).all()
        for scan in rows:
            data_url = (scan.gemini_raw or {}).get("image_b64", "")
            if data_url:
                try:
                    photos[scan.id] = Image.open(BytesIO(base64.b64decode(data_url.split(",", 1)[-1]))).convert("RGB")
                except Exception:
                    pass  # an unreadable preview just can't be matched
    pages = []
    for image in images:
        raw = await image.read()
        if len(raw) > MAX_SCREENSHOT_BYTES:
            raise HTTPException(413, "Screenshot too large (max 15 MB)")
        try:
            # Matching + Tesseract take a few seconds per screenshot; keep the loop free.
            text, scan_id = await asyncio.to_thread(claims.read_screenshot, raw, photos)
        except ValueError as e:
            raise HTTPException(400, str(e))
        except RuntimeError as e:
            raise HTTPException(503, str(e))
        pages.append({"text": text, "scan_id": scan_id})
    return {"pages": pages}


class ParseRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=30_000)
    photos: list[claims.CataloguePhoto] = Field(..., min_length=1, max_length=60)


@router.post("/parse")
@_limiter.limit("20/minute")
async def parse_thread(request: Request, body: ParseRequest, db: DbSession, user_id: CurrentUserId):
    """Draft claims from thread text (typed, pasted or OCR'd) against the cards
    the client says are on sale. Saves nothing."""
    user = await db.get(User, user_id)
    seller = (user.fb_name or user.name or "") if user else ""
    try:
        drafts = await asyncio.to_thread(claims.parse_claims, body.text, body.photos, seller)
    except Exception as e:
        raise HTTPException(502, f"Could not work out the claims: {e}")
    return {"claims": [d.model_dump() for d in drafts]}


class ConfirmItem(BaseModel):
    scan_id: int
    card_id: int
    bbox: list[int] = Field(..., min_length=4, max_length=4)
    name: str
    scryfall_id: str | None = None
    set_code: str | None = None
    set_name: str | None = None
    collector_number: str | None = None
    rarity: str | None = None
    is_foil: bool = False
    image_url: str | None = None
    ck_url: str | None = None
    unit_price_myr: Decimal = Field(..., ge=0, decimal_places=2)
    # How many of this card the seller has (from the scan), and how many this buyer wants.
    qty_total: int = Field(1, ge=1)
    qty: int = Field(1, ge=1)


class ConfirmClaim(BaseModel):
    buyer: str = Field(..., min_length=1, max_length=255)
    note: str | None = None
    items: list[ConfirmItem] = Field(..., min_length=1)


class ConfirmRequest(BaseModel):
    post_id: int | None = None
    claims: list[ConfirmClaim] = Field(..., min_length=1, max_length=200)


async def _listing_for(db, user_id: int, post: Post | None, item: ConfirmItem) -> Listing:
    """The stock listing behind a scanned card, created the first time the
    card is claimed. A card is recognised by its scan and its box in the photo."""
    rows = (await db.execute(
        select(Listing)
        .where(Listing.user_id == user_id, Listing.scan_id == item.scan_id)
        .options(selectinload(Listing.posts))
    )).scalars().all()
    listing = next((l for l in rows if l.bbox == item.bbox and l.is_foil == item.is_foil), None)
    if listing is None:
        listing = Listing(
            user_id=user_id, scan_id=item.scan_id, bbox=item.bbox,
            name=item.name, scryfall_id=item.scryfall_id, set_code=item.set_code,
            set_name=item.set_name, collector_number=item.collector_number, rarity=item.rarity,
            is_foil=item.is_foil, image_url=item.image_url, ck_url=item.ck_url,
            unit_price_myr=item.unit_price_myr, qty_total=item.qty_total,
            status=ListingStatus.active,
        )
        listing.posts = [post] if post else []
        db.add(listing)
        await db.flush()
        return listing
    # Seen before: keep it in step with what the seller is showing now.
    listing.unit_price_myr = item.unit_price_myr
    listing.qty_total = max(listing.qty_total or 1, item.qty_total)
    if post and post not in listing.posts:
        listing.posts.append(post)
    return listing


@router.post("/confirm", response_model=list[OrderRead], status_code=201)
async def confirm_claims(body: ConfirmRequest, db: DbSession, user_id: CurrentUserId):
    """Turn confirmed drafts into orders: one per buyer, in the order given.
    All or nothing — a bad item rolls the whole batch back."""
    post = None
    if body.post_id is not None:
        post = await db.get(Post, body.post_id)
        if not post or post.user_id != user_id:
            raise HTTPException(404, "Post not found")
    scan_ids = {i.scan_id for c in body.claims for i in c.items}
    owned = set((await db.scalars(
        select(Scan.id).where(Scan.id.in_(scan_ids), Scan.user_id == user_id)
    )).all())
    if scan_ids - owned:
        raise HTTPException(404, "Scan not found")

    orders = []
    for claim in body.claims:
        lines: list[OrderItemCreate] = []
        for item in claim.items:
            listing = await _listing_for(db, user_id, post, item)
            lines.append(OrderItemCreate(listing_id=listing.id, qty=item.qty, unit_price_myr=item.unit_price_myr))
        orders.append(await orders_router.create_order(
            OrderCreate(buyer_fb_name=claim.buyer.strip(), items=lines, notes=claim.note),
            db, user_id,
        ))
    return orders
