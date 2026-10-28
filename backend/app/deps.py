"""Common FastAPI dependencies: DB session + current user."""

import json
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_session
from .models import User
from .services.auth_service import decode_image_token, decode_session_token


async def get_db() -> AsyncIterator[AsyncSession]:
    async for session in get_session():
        yield session


DbSession = Annotated[AsyncSession, Depends(get_db)]


def bearer_user_id(authorization: str | None) -> int | None:
    """User id from an `Authorization: Bearer <session jwt>` header, or None."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return decode_session_token(authorization.split(" ", 1)[1].strip())


def get_optional_user_id(authorization: str | None = Header(default=None)) -> int | None:
    """The signed-in user, or None (anonymous) when the token is missing,
    expired or image-only. When Google auth is not configured
    (`GOOGLE_CLIENT_ID` empty), every call is the solo user — this keeps
    local dev working without forcing OAuth setup."""
    if not settings.auth_enabled:
        return settings.solo_user_id
    return bearer_user_id(authorization)


OptionalUserId = Annotated[int | None, Depends(get_optional_user_id)]


async def get_current_user_id(user_id: OptionalUserId, db: DbSession) -> int:
    """The signed-in user (an `Authorization: Bearer <jwt>` header issued by
    `/api/auth/google`); 401 without one. Solo user when auth is off."""
    if user_id is None:
        raise HTTPException(401, "Missing, invalid or expired token")
    if not settings.auth_enabled:
        return user_id
    user = await db.get(User, user_id)
    # A deleted account's token stays valid for days; its user row is gone.
    if user is None:
        raise HTTPException(401, "Account not found")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    # At most one write an hour, committed now so a slow route (a Gemini scan)
    # does not hold the SQLite write lock. updated_at is kept, so it still
    # means the user changed something.
    if user.last_seen_at is None or now - user.last_seen_at > timedelta(hours=1):
        await db.execute(update(User).where(User.id == user_id).values(last_seen_at=now, updated_at=User.updated_at))
        await db.commit()
    return user_id


CurrentUserId = Annotated[int, Depends(get_current_user_id)]


def get_image_user_id(token: str | None = Query(default=None)) -> int:
    """The user behind an <img src>. A browser image request can't send an
    `Authorization` header, so the image-only token from /api/auth/me comes as
    `?token=...`. Session tokens are refused here. Solo mode needs no token."""
    if not settings.auth_enabled:
        return settings.solo_user_id
    user_id = decode_image_token(token) if token else None
    if user_id is None:
        raise HTTPException(401, "Missing or invalid image token")
    return user_id


ImageUserId = Annotated[int, Depends(get_image_user_id)]


def _rate_limit_key(request: Request) -> str:
    """Per signed-in user; strangers by address. Behind the Cloudflare Tunnel
    every request shares one address, so keying by it alone made all limits global."""
    user_id = bearer_user_id(request.headers.get("authorization"))
    return f"user:{user_id}" if user_id is not None else get_remote_address(request)


# The one limiter every route decorates with; main.py registers it on the app.
limiter = Limiter(key_func=_rate_limit_key)


def check_pricing_size(pricing: dict | None) -> None:
    """Pricing settings are a small opaque object; cap what a client may store."""
    if pricing is not None and len(json.dumps(pricing)) > 8 * 1024:
        raise HTTPException(413, "Pricing too large (max 8 KB)")
