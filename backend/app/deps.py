"""Common FastAPI dependencies: DB session + current user."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_session
from .services.auth_service import decode_session_token


async def get_db() -> AsyncIterator[AsyncSession]:
    async for session in get_session():
        yield session


DbSession = Annotated[AsyncSession, Depends(get_db)]


def get_current_user_id(authorization: str | None = Header(default=None)) -> int:
    """Resolve the current user.

    - When Google auth is not configured (`GOOGLE_CLIENT_ID` empty), every call
      is attributed to the solo user — this keeps local dev working without
      forcing OAuth setup.
    - Otherwise, require an `Authorization: Bearer <jwt>` header issued by
      `/api/auth/google`. Missing or expired tokens return 401.
    """
    if not settings.auth_enabled:
        return settings.solo_user_id

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    user_id = decode_session_token(token)
    if user_id is None:
        raise HTTPException(401, "Invalid or expired token")
    return user_id


CurrentUserId = Annotated[int, Depends(get_current_user_id)]
