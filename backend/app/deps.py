"""Common FastAPI dependencies: DB session + current user."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_session
from .services.auth_service import IMAGE_SCOPE, decode_session_token


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
    user_id = decode_session_token(token, IMAGE_SCOPE) if token else None
    if user_id is None:
        raise HTTPException(401, "Missing or invalid image token")
    return user_id


ImageUserId = Annotated[int, Depends(get_image_user_id)]
