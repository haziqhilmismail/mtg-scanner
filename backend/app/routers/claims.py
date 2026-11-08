"""Claims: read a Facebook comment thread, draft who claimed what, confirm into orders."""

import asyncio

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..deps import CurrentUser, CurrentUserId, DbSession, limiter, owned, owned_many
from ..models import Post, Scan
from ..schemas import OrderRead
from ..schemas.order import ConfirmClaim
from ..schemas.types import Id, as_id
from ..services import claims, credits, orders

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


class ConfirmRequest(BaseModel):
    post_id: Id | None = None
    claims: list[ConfirmClaim] = Field(..., min_length=1, max_length=200)


@router.post("/confirm", response_model=list[OrderRead], status_code=201)
async def confirm_claims(body: ConfirmRequest, db: DbSession, user_id: CurrentUserId):
    """Turn confirmed drafts into orders: one per buyer, in the order given.
    All or nothing — a bad item rolls the whole batch back."""
    post = None if body.post_id is None else await owned(db, Post, body.post_id, user_id)
    scans = await owned_many(db, Scan, {i.scan_id for c in body.claims for i in c.items}, user_id)
    try:
        return await orders.confirm_claims(db, user_id, post, scans, body.claims)
    except ValueError as e:
        raise HTTPException(400, str(e))
