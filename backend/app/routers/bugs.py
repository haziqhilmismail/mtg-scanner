"""Bug capture endpoints.

POST /api/bug   — frontend → record an unexpected JS error / React crash.
                  Optional auth: if a JWT is present the user_id is attached,
                  otherwise the report is anonymous. Rate limited.

Reports are read from the bug_events table or the Telegram push, never over the API.
"""

from fastapi import APIRouter, Request

from ..deps import DbSession, OptionalUserId, limiter
from ..schemas import BugReportCreate
from ..services import bug_reporter

router = APIRouter(prefix="/api", tags=["bugs"])


@router.post("/bug", status_code=202)
# Public (errors can fire pre-login), so cap it: a burst is fine for a real
# crash loop, but the hourly ceiling bounds DB bloat from a spammer.
@limiter.limit("30/minute;100/hour")
async def report_bug(
    request: Request,
    payload: BugReportCreate,
    db: DbSession,
    user_id: OptionalUserId,  # a bad token is anonymous, not a 401: the user is mid-bug
) -> dict:
    """Frontend bug report. Returns 202 (accepted) with the persisted event id."""
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

