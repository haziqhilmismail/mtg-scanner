"""Bug capture endpoints.

POST /api/bug   — frontend → record an unexpected JS error / React crash.
                  Optional auth: if a JWT is present the user_id is attached,
                  otherwise the report is anonymous. Rate limited.

Reports are read from the bug_events table or the Telegram push, never over the API.
"""

from fastapi import APIRouter, Header, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..config import settings
from ..deps import DbSession
from ..schemas import BugReportCreate
from ..services import bug_reporter
from ..services.auth_service import decode_session_token

router = APIRouter(prefix="/api", tags=["bugs"])

# Re-use a local limiter — the app-level one is wired in main.py but the
# limit decorator just needs *a* Limiter instance with the same key_func.
_limiter = Limiter(key_func=get_remote_address)


def _resolve_user_id(authorization: str | None) -> int | None:
    """Best-effort user attribution for the public POST /api/bug endpoint.

    Solo mode → always the solo user.
    Auth mode → decode the bearer token if present; on failure attribute as
    anon rather than 401-ing (the user is mid-bug, no point gating).
    """
    if not settings.auth_enabled:
        return settings.solo_user_id
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    return decode_session_token(token)


@router.post("/bug", status_code=202)
# Public (errors can fire pre-login), so cap it: a burst is fine for a real
# crash loop, but the hourly ceiling bounds DB bloat from a spammer. Behind the
# Funnel slowapi sees one shared IP, so these limits are effectively global —
# acceptable for a solo deployment.
@_limiter.limit("30/minute;100/hour")
async def report_bug(
    request: Request,
    payload: BugReportCreate,
    db: DbSession,
    authorization: str | None = Header(default=None),
) -> dict:
    """Frontend bug report. Returns 202 (accepted) with the persisted event id."""
    user_id = _resolve_user_id(authorization)
    event = await bug_reporter.report_frontend(
        message=payload.message,
        exception_type=payload.exception_type,
        stack=payload.stack,
        route=payload.route,
        user_agent=request.headers.get("user-agent"),
        user_id=user_id,
        db=db,
    )
    return {"id": event.id}

