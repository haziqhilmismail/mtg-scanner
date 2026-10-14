"""Auth helpers: verify Google ID tokens + issue/decode our own session JWTs.

The split is deliberate: Google's ID token is single-use proof that the user
controls a Google account. We trade it for our own short-lived session JWT so
the frontend never has to re-prompt Google on every API call (Google's tokens
expire after ~1 hour and require GIS re-entry to refresh).
"""

from __future__ import annotations

import secrets
import time

import jwt
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from ..config import DATA_DIR, settings

# 7-day session window. Long enough to survive a weekend pasar malam without
# re-logging in, short enough that a stolen token isn't a permanent compromise.
SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
IMAGE_TTL_SECONDS = 30 * 24 * 60 * 60
IMAGE_SCOPE = "img"

_SECRET_PATH = DATA_DIR / "jwt_secret.txt"
_jwt_secret_cache: str | None = None


def _jwt_secret() -> str:
    """Lazy-loads / lazy-generates the session-signing secret.

    Resolution order:
    1. settings.jwt_secret from env (preferred for production)
    2. data/jwt_secret.txt on disk (auto-persisted between restarts)
    3. Generate a fresh one and write it to disk
    """
    global _jwt_secret_cache
    if _jwt_secret_cache is not None:
        return _jwt_secret_cache
    if settings.jwt_secret:
        _jwt_secret_cache = settings.jwt_secret
        return _jwt_secret_cache
    if _SECRET_PATH.exists():
        _jwt_secret_cache = _SECRET_PATH.read_text().strip()
        if _jwt_secret_cache:
            return _jwt_secret_cache
    _jwt_secret_cache = secrets.token_urlsafe(48)
    _SECRET_PATH.write_text(_jwt_secret_cache)
    return _jwt_secret_cache


def verify_google_id_token(token: str) -> dict:
    """Verify a Google-issued ID token. Raises on any failure.

    Returns the claims dict on success: {sub, email, name, picture, ...}.
    Audience is checked against our configured client ID — a token issued for
    a different OAuth client (e.g. someone else's app) is rejected.
    """
    if not settings.google_client_id:
        raise ValueError("Google auth not configured")
    req = google_requests.Request()
    info = id_token.verify_oauth2_token(token, req, settings.google_client_id)
    return info


def issue_session_token(user_id: int, scope: str | None = None) -> str:
    """Issue an HS256 JWT identifying this user. `scope="img"` makes an
    image-only token: it rides in <img src> URLs (which end up in logs and
    history), so it lives longer but opens nothing except the image routes."""
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + (IMAGE_TTL_SECONDS if scope else SESSION_TTL_SECONDS),
    }
    if scope:
        payload["scope"] = scope
    return jwt.encode(payload, _jwt_secret(), algorithm="HS256")


def decode_session_token(token: str, scope: str | None = None) -> int | None:
    """Return the user_id in a JWT of exactly this `scope`, or None if
    invalid/expired/another scope."""
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
        if payload.get("scope") != scope:
            return None
        return int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        return None
