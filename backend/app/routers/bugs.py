"""Bug capture endpoints.

POST /api/bug   — frontend → record an unexpected JS error / React crash.
                  Optional auth: if a JWT is present the user_id is attached,
                  otherwise the report is anonymous. Rate limited.
GET  /api/bugs  — admin list (most recent first). Requires auth in auth mode;
                  in solo mode it just returns the solo user's events.
"""

from fastapi import APIRouter, Header, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select

from ..config import settings
from ..deps import CurrentUserId, DbSession
from ..models import BugEvent
from ..schemas import BugEventRead, BugReportCreate
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
@_limiter.limit("30/minute")
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


@router.get("/bugs", response_model=list[BugEventRead])
async def list_bugs(
    db: DbSession,
    user_id: CurrentUserId,
    limit: int = 100,
    source: str | None = None,
) -> list[BugEvent]:
    """List recent bug events for the current user (solo or signed-in).

    Frontend reports may be anonymous (user_id NULL); they're surfaced to the
    solo user in solo mode so they're never lost.
    """
    if limit < 1 or limit > 500:
        raise HTTPException(422, "limit must be between 1 and 500")
    q = select(BugEvent).order_by(BugEvent.id.desc()).limit(limit)
    if settings.auth_enabled:
        # Auth mode: each user only sees their own + anon reports.
        q = q.where((BugEvent.user_id == user_id) | (BugEvent.user_id.is_(None)))
    if source in ("backend", "frontend"):
        q = q.where(BugEvent.source == source)
    result = await db.execute(q)
    return list(result.scalars().all())
