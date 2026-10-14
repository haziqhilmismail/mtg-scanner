"""Google sign-in + session endpoints.

POST /api/auth/google  — exchange a Google ID token for one of our session JWTs.
GET  /api/auth/me      — return the current user (or 401 if not signed in).
PUT  /api/auth/me/pricing — set the user's default pricing settings.
Both also hand out an image-only token for <img src> URLs ("" in solo mode).
GET  /api/auth/config  — exposes auth_enabled so the frontend can render the
                         login page vs. solo mode without a separate env var.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..config import settings
from ..deps import CurrentUserId, DbSession
from ..models import User
from .posts import check_pricing_size
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


class PricingBody(BaseModel):
    pricing: dict


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

    # Optional allowlist — empty set means anyone can sign in.
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

    # 3) Brand-new account — create a fresh user row with default pricing
    if user is None:
        user = User(
            email=email,
            google_sub=sub,
            name=name,
            avatar_url=picture,
            fb_name=name,
        )
        db.add(user)

    await db.commit()
    await db.refresh(user)

    return AuthResponse(
        token=issue_session_token(user.id),
        image_token=_image_token(user.id),
        user=AuthUser(id=user.id, email=user.email, name=user.name, avatar_url=user.avatar_url),
    )


@router.get("/me", response_model=Me)
async def me(db: DbSession, user_id: CurrentUserId):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(401, "User no longer exists")
    return Me(
        id=user.id, email=user.email, name=user.name, avatar_url=user.avatar_url,
        image_token=_image_token(user.id), pricing=user.pricing,
    )


@router.put("/me/pricing", status_code=204)
async def set_default_pricing(body: PricingBody, db: DbSession, user_id: CurrentUserId):
    check_pricing_size(body.pricing)
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(401, "User no longer exists")
    user.pricing = body.pricing
