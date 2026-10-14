"""Centralised bug capture: write a row to `bug_events`, push to Telegram.

Two entry points:
  * `report_exception(request, exc)` — called by main.py's global
    exception handler when an uncaught backend exception bubbles up.
  * `report_frontend(payload, ...)` — called by the POST /api/bug route
    when the React error boundary / window.onerror handler reports.

Telegram is throttled by an in-memory fingerprint cache so a single bad
deploy doesn't fire 100 notifications. DB writes are NOT throttled — the
audit log stays complete.
"""

from __future__ import annotations

import asyncio
import hashlib
import traceback
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

import aiohttp
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import async_session_factory
from ..models import BugEvent

if TYPE_CHECKING:
    from fastapi import Request


# fingerprint → (window_start_utc, suppressed_count_during_window)
_DEDUP: dict[str, tuple[datetime, int]] = {}

# The event loop only holds weak references to tasks; keep pending pushes
# here so one can't be garbage-collected before it is sent.
_PUSHES: set[asyncio.Task] = set()


def _push(event: BugEvent) -> None:
    task = asyncio.create_task(_send_telegram(_format_push(event)))
    _PUSHES.add(task)
    task.add_done_callback(_PUSHES.discard)


def _fingerprint(source: str, route: str | None, exc_type: str, top_frame: str) -> str:
    raw = f"{source}|{route or ''}|{exc_type}|{top_frame}".encode()
    return hashlib.sha1(raw).hexdigest()


def _top_frame(stack: str | None) -> str:
    """Best-effort: pick the first line that looks like a real frame ref.

    Both Python tracebacks and JS stack traces have one identifying line near
    the top — for Python `File "x.py", line N, in fn`; for JS `at fn (x.js:N)`.
    Anything is fine as long as it's stable across repeats of the same bug.
    """
    if not stack:
        return ""
    for line in stack.splitlines():
        s = line.strip()
        if s.startswith(("File ", "at ")):
            return s[:200]
    # Fall back to first non-empty line.
    for line in stack.splitlines():
        s = line.strip()
        if s:
            return s[:200]
    return ""


def _should_notify(fingerprint: str) -> tuple[bool, int]:
    """Returns (should_send_push, count_in_window). Always call this AFTER
    writing the DB row — the cache is the throttle, not the source of truth."""
    if not settings.telegram_enabled:
        return False, 0
    now = datetime.now(timezone.utc)
    window = timedelta(minutes=settings.bug_notify_window_minutes)
    entry = _DEDUP.get(fingerprint)
    if entry is None or (now - entry[0]) > window:
        _DEDUP[fingerprint] = (now, 1)
        return True, 1
    start, count = entry
    _DEDUP[fingerprint] = (start, count + 1)
    return False, count + 1


def _truncate(text: str | None, limit: int) -> str | None:
    if text is None:
        return None
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…[+{len(text) - limit} chars]"


async def _persist(db: AsyncSession | None, event: BugEvent) -> None:
    if db is not None:
        db.add(event)
        await db.flush()
        return
    # No active session (e.g. exception happened before DbSession was bound) —
    # open a fresh one.
    async with async_session_factory() as s:
        s.add(event)
        await s.commit()


async def _send_telegram(text: str) -> None:
    if not settings.telegram_enabled:
        return
    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
    payload = {
        "chat_id": settings.telegram_chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    try:
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    print(
                        f"[bug-reporter] Telegram returned {resp.status}: {body[:200]}",
                        flush=True,
                    )
    except Exception as e:
        print(f"[bug-reporter] Telegram push failed: {e}", flush=True)


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _format_push(event: BugEvent) -> str:
    where = []
    if event.method and event.route:
        where.append(f"{_esc(event.method)} {_esc(event.route)}")
    elif event.route:
        where.append(_esc(event.route))
    location = " · ".join(where) if where else "(no route)"
    user_line = f"user {event.user_id}" if event.user_id is not None else "anon"
    body = _truncate(event.message, 400) or ""

    # User feedback piggybacks on the bug-reporter endpoint but isn't a bug —
    # render it with a friendlier prefix + drop the stack frame so the push
    # reads like "someone said this" instead of "the app exploded".
    if event.exception_type == "UserFeedback":
        return "\n".join([
            f"💬 <b>Feedback</b> · <i>{location}</i> · {user_line}",
            f"<pre>{_esc(body)}</pre>",
        ])

    head_frame = _top_frame(event.stack)
    lines = [
        f"🚨 <b>[{event.source}]</b> <code>{_esc(event.exception_type)}</code>",
        f"<i>{location}</i> · {user_line}",
        f"<pre>{_esc(body)}</pre>",
    ]
    if head_frame:
        lines.append(f"<code>{_esc(head_frame)}</code>")
    return "\n".join(lines)


async def report_exception(
    request: "Request | None",
    exc: BaseException,
    *,
    db: AsyncSession | None = None,
    user_id: int | None = None,
) -> None:
    """Capture an uncaught backend exception. Safe to call from a global handler."""
    exc_type = type(exc).__name__
    stack = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    route = request.url.path if request is not None else None
    method = request.method if request is not None else None
    user_agent = request.headers.get("user-agent") if request is not None else None
    head = _top_frame(stack)
    fp = _fingerprint("backend", route, exc_type, head)

    event = BugEvent(
        user_id=user_id,
        source="backend",
        fingerprint=fp,
        route=route,
        method=method,
        status_code=500,
        exception_type=exc_type[:128],
        message=str(exc)[:2000] or exc_type,
        stack=_truncate(stack, 20_000),
        user_agent=_truncate(user_agent, 512) if user_agent else None,
    )
    try:
        await _persist(db, event)
    except Exception as e:
        print(f"[bug-reporter] DB write failed: {e}", flush=True)

    notify, _ = _should_notify(fp)
    if notify:
        # Fire-and-forget — never block the response on Telegram I/O.
        _push(event)


async def report_frontend(
    *,
    message: str,
    exception_type: str,
    stack: str | None,
    route: str | None,
    user_agent: str | None,
    user_id: int | None,
    db: AsyncSession | None = None,
) -> BugEvent:
    """Capture a frontend report. Returns the persisted event so the route
    handler can echo back an id if it wants."""
    head = _top_frame(stack)
    fp = _fingerprint("frontend", route, exception_type, head)

    event = BugEvent(
        user_id=user_id,
        source="frontend",
        fingerprint=fp,
        route=_truncate(route, 512),
        method=None,
        status_code=None,
        exception_type=exception_type[:128] or "Error",
        message=message[:2000] or exception_type or "Error",
        stack=_truncate(stack, 20_000),
        user_agent=_truncate(user_agent, 512) if user_agent else None,
    )
    await _persist(db, event)

    notify, _ = _should_notify(fp)
    if notify:
        _push(event)
    return event
