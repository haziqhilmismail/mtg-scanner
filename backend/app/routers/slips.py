"""Printable drop-off slips (see services/slips.py)."""

import asyncio

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from ..deps import CurrentUserId, DbSession, limiter
from ..models import User
from ..services import slips

router = APIRouter(prefix="/api/slips", tags=["slips"])


class Slip(BaseModel):
    # Either may be empty: the slip then has a line to write it on. A buyer
    # name is as long as a stored one; the PDF shrinks or wraps it.
    buyer: str = Field("", max_length=255)
    phone: str = Field("", max_length=32)


class SlipsRequest(BaseModel):
    slips: list[Slip] = Field(default_factory=list, max_length=200)


@router.post("")
@limiter.limit("20/minute")
async def slips_pdf(request: Request, body: SlipsRequest, db: DbSession, user_id: CurrentUserId) -> Response:
    rows = [(s.buyer.strip(), s.phone.strip()) for s in body.slips]
    user = await db.get(User, user_id)
    # About a second a page: off the event loop.
    pdf = await asyncio.to_thread(slips.render, rows, user.seller_name if user else "")
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="drop-off-slips.pdf"'})
