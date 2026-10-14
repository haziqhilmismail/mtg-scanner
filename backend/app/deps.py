"""Common FastAPI dependencies: DB session + current user."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_session
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


def get_current_user_id(authorization: str | None = Header(default=None)) -> int:
    """Resolve the current user.

    - When Google auth is not configured (`GOOGLE_CLIENT_ID` empty), every call
      is attributed to the solo user — this keeps local dev working without
      forcing OAuth setup.
    - Otherwise, require an `Authorization: Bearer <jwt>` header issued by
      `/api/auth/google`. Missing, expired or image-only tokens return 401.
    """
    if not settings.auth_enabled:
        return settings.solo_user_id
    user_id = bearer_user_id(authorization)
    if user_id is None:
        raise HTTPException(401, "Missing, invalid or expired token")
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
    """Per signed-in user; strangers by address. Behind Tailscale Funnel every
    request shares one address, so keying by it alone made all limits global."""
    user_id = bearer_user_id(request.headers.get("authorization"))
    return f"user:{user_id}" if user_id is not None else get_remote_address(request)


# The one limiter every route decorates with; main.py registers it on the app.
limiter = Limiter(key_func=_rate_limit_key)
