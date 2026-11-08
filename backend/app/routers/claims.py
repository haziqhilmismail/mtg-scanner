"""Claims: read a Facebook comment thread, draft who claimed what, confirm into orders."""

import asyncio

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..deps import CurrentUser, CurrentUserId, DbSession, limiter, owned, owned_many
from ..models import Listing, ListingStatus, Post, Scan
from ..schemas import OrderRead
from ..schemas.listing import ListingBase
from ..schemas.types import Id, as_id
from ..services import claims, credits, orders
from ..services.listings import locked_prices

router = APIRouter(prefix="/api/claims", tags=["claims"])

MAX_SCREENSHOTS = 12
MAX_PHOTOS = 60          # candidate photos to match a screenshot against
MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024


@router.post("/read")
@limiter.limit("20/minute")
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
    ids = [i for x in scan_ids.split(",") if (i := as_id(x.strip())) is not None][:MAX_PHOTOS]
    photos = {}
    if ids:
        # Not owned_many: an id that is not this user's photo is skipped, not a 404.
        rows = (await db.scalars(select(Scan).where(Scan.id.in_(ids), Scan.user_id == user_id))).all()
        photos = await asyncio.to_thread(
            claims.decode_photos, {s.id: s.preview_b64 for s in rows})
    pages = []
    for image in images:
        raw = await image.read()
        if len(raw) > MAX_SCREENSHOT_BYTES:
            raise HTTPException(413, "Screenshot too large (max 15 MB)")
        try:
            text, scan_id, sure = await asyncio.to_thread(claims.read_screenshot, raw, photos)
        except ValueError as e:
            raise HTTPException(400, str(e))
        except RuntimeError as e:
            raise HTTPException(503, str(e))
        # A look-alike photo scored nearly as well: offered as a guess to check.
        pages.append({"text": text, "scan_id": scan_id if sure else None, "guess": None if sure else scan_id})
    return {"pages": pages}


class ParseRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=30_000)
    photos: list[claims.CataloguePhoto] = Field(..., min_length=1, max_length=60)


@router.post("/parse")
@limiter.limit("20/minute")
async def parse_thread(request: Request, body: ParseRequest, db: DbSession, user: CurrentUser):
    """Draft claims from thread text (typed, pasted or OCR'd) against the cards
    the client says are on sale, and list the comments read as no claim.
    Saves nothing. Costs one scan credit (it is a Gemini call), handed back if
    the call fails."""
    async with credits.spend(db, user.id):
        try:
            result = await asyncio.to_thread(claims.parse_claims, body.text, body.photos, user.seller_name)
        except Exception as e:
            raise HTTPException(502, f"Could not work out the claims: {e}")
    return {"claims": [d.model_dump() for d in result.claims], "skipped": result.skipped,
            "credits": await credits.status(db, user.id)}


class ConfirmItem(ListingBase):
    """A claimed card: the listing it becomes, where it is in which photo,
    and how many this buyer wants (qty_total is how many the seller has)."""
    scan_id: Id
    card_id: int
    bbox: list[int] = Field(..., min_length=4, max_length=4)
    qty: int = Field(1, ge=1)


class ConfirmClaim(BaseModel):
    buyer: str = Field(..., min_length=1, max_length=255)
    note: str | None = None
    items: list[ConfirmItem] = Field(..., min_length=1)


class ConfirmRequest(BaseModel):
    post_id: Id | None = None
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
            **item.model_dump(exclude={"card_id", "qty"}), user_id=user_id, status=ListingStatus.active,
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
    post = None if body.post_id is None else await owned(db, Post, body.post_id, user_id)
    scan_ids = {i.scan_id for c in body.claims for i in c.items}
    scans = await owned_many(db, Scan, scan_ids, user_id)
    # A card of a finished photo sells at the price it was posted with.
    locked = {sid: locked_prices(s.ui_state, s.cards) for sid, s in scans.items()}

    out = []
    for claim in body.claims:
        lines = []
        for item in claim.items:
            if (price := locked[item.scan_id].get(tuple(item.bbox))) is not None:
                item = item.model_copy(update={"unit_price_myr": price})
            lines.append((await _listing_for(db, user_id, post, item), item.qty, item.unit_price_myr))
        try:
            out.append(await orders.create_order(db, user_id, claim.buyer, lines, notes=claim.note))
        except ValueError as e:
            raise HTTPException(400, str(e))
    return out
