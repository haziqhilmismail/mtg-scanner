"""Google sign-in and session endpoints. The sign-in and /me answers also hand
out an image-only token for <img src> URLs ("" in solo mode).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..config import settings
from ..deps import CurrentUser, DbSession
from ..models import User
from ..schemas.types import Pricing
from ..services.auth_service import (
    issue_image_token,
    issue_session_token,
    verify_google_id_token,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class GoogleLoginRequest(BaseModel):
    # The `credential` string returned by Google Identity Services on the frontend
    credential: str


class AuthUser(BaseModel):
    id: int
    email: str
    name: str | None = None
    avatar_url: str | None = None


class Me(AuthUser):
    image_token: str
    pricing: dict | None = None
    seller_name: str = ""


class SellerName(BaseModel):
    seller_name: str = Field("", max_length=255)


class PricingBody(BaseModel):
    pricing: Pricing


class AuthResponse(BaseModel):
    token: str
    image_token: str
    user: AuthUser


def _image_token(user_id: int) -> str:
    return issue_image_token(user_id) if settings.auth_enabled else ""


class AuthConfig(BaseModel):
    auth_enabled: bool
    google_client_id: str  # echoed so the frontend doesn't need its own env var


@router.get("/config", response_model=AuthConfig)
async def auth_config():
    """Tell the frontend whether to render the login page and which client ID to use."""
    return AuthConfig(
        auth_enabled=settings.auth_enabled,
        google_client_id=settings.google_client_id,
    )


@router.post("/google", response_model=AuthResponse)
async def google_login(req: GoogleLoginRequest, db: DbSession):
    if not settings.auth_enabled:
        raise HTTPException(503, "Google auth not configured on this server")

    try:
        info = verify_google_id_token(req.credential)
    except Exception as e:  # pragma: no cover — surface the error to the client
        raise HTTPException(401, f"Invalid Google credential: {e}") from e

    sub = info.get("sub")
    email = (info.get("email") or "").lower()
    name = info.get("name") or None
    picture = info.get("picture") or None
    if not sub or not email:
        raise HTTPException(401, "Google token missing required claims")

    allowlist = settings.allowed_emails_set
    if allowlist and email not in allowlist:
        raise HTTPException(403, "This email is not allowed to sign in")

    # 1) Returning user — found by Google's stable `sub`
    user = await db.scalar(select(User).where(User.google_sub == sub))

    # 2) First Google sign-in claims the unclaimed solo user, preserving its
    #    existing scans/listings/orders. Triggered only when nobody's linked yet.
    if user is None:
        solo = await db.get(User, settings.solo_user_id)
        if solo is not None and not solo.google_sub:
            solo.google_sub = sub
            solo.email = email
            solo.name = name or solo.name
            solo.avatar_url = picture or solo.avatar_url
            user = solo

    # 3) Brand-new account
    if user is None:
        user = User(
            email=email,
            google_sub=sub,
            name=name,
            avatar_url=picture,
        )
        db.add(user)

    await db.commit()

    return AuthResponse(
        token=issue_session_token(user.id),
        image_token=_image_token(user.id),
        user=AuthUser(id=user.id, email=user.email, name=user.name, avatar_url=user.avatar_url),
    )


@router.get("/me", response_model=Me)
async def me(user: CurrentUser):
    return Me(
        id=user.id, email=user.email, name=user.name, avatar_url=user.avatar_url,
        image_token=_image_token(user.id), pricing=user.pricing, seller_name=user.seller_name,
    )


@router.put("/me/pricing", status_code=204)
async def set_default_pricing(body: PricingBody, user: CurrentUser):
    user.pricing = body.pricing


@router.put("/me/seller-name", response_model=SellerName)
async def set_seller_name(body: SellerName, user: CurrentUser) -> SellerName:
    user.fb_name = body.seller_name.strip() or None
    return SellerName(seller_name=user.seller_name)
