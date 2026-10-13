"""Scan-credit balance and voucher redemption."""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..deps import CurrentUserId, DbSession
from ..services import credits

router = APIRouter(prefix="/api", tags=["credits"])

# Local limiter, same pattern as routers/bugs.py.
_limiter = Limiter(key_func=get_remote_address)


class RedeemRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=64)


@router.get("/credits")
async def get_credits(db: DbSession, user_id: CurrentUserId):
    return await credits.status(db, user_id)


@router.post("/vouchers/redeem")
@_limiter.limit("10/hour")  # a typo or two is fine; guessing codes is not
async def redeem_voucher(request: Request, body: RedeemRequest, db: DbSession, user_id: CurrentUserId):
    try:
        voucher = await credits.redeem(db, user_id, body.code)
    except credits.VoucherError as e:
        raise HTTPException(400, detail={"code": e.code})
    return {
        "granted": {
            "credits": voucher.credits,
            "unlimited": voucher.unlimited,
            "unlimited_days": voucher.unlimited_days,
            "reset": voucher.resets,
        },
        "credits": await credits.status(db, user_id),
    }
