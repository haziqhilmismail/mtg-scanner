"""Printable Cards & Hobbies drop-off slips (see services/slips.py)."""

import asyncio

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from ..deps import CurrentUserId, limiter
from ..services import slips

router = APIRouter(prefix="/api/slips", tags=["slips"])


class Slip(BaseModel):
    # Each may be empty: the slip then has a line to write it on.
    buyer: str = Field("", max_length=60)
    phone: str = Field("", max_length=32)


class SlipsRequest(BaseModel):
    seller: str = Field("", max_length=60)
    slips: list[Slip] = Field(default_factory=list, max_length=200)
    blank: int = Field(0, ge=0, le=80)          # extra slips with only the seller's name


@router.post("")
@limiter.limit("20/minute")
async def slips_pdf(request: Request, body: SlipsRequest, user_id: CurrentUserId) -> Response:
    seller = body.seller.strip()
    rows = [(s.buyer.strip(), s.phone.strip(), seller) for s in body.slips] + [("", "", seller)] * body.blank
    # About a second a page: off the event loop.
    pdf = await asyncio.to_thread(slips.render, rows, seller)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="ch-dropoff-slips.pdf"'})
