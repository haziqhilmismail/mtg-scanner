"""Captured backend exceptions + frontend error reports.

One row per occurrence — dedup is purely an in-memory Telegram throttle inside
bug_reporter, so the table preserves the full audit trail even when the push
side suppresses repeats.
"""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

if TYPE_CHECKING:
    from .user import User


class BugEvent(Base, TimestampMixin):
    __tablename__ = "bug_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Nullable: an exception thrown during auth or before sign-in won't have a user.
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # "backend" | "frontend"
    source: Mapped[str] = mapped_column(String(16))
    # sha1 of (source, route, exception_type, first stack frame) — used by the
    # in-memory dedup cache in bug_reporter to throttle Telegram pushes.
    fingerprint: Mapped[str] = mapped_column(String(40), index=True)

    # Backend: the FastAPI route path. Frontend: window.location.pathname.
    route: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Backend only; null for frontend reports.
    method: Mapped[str | None] = mapped_column(String(8), nullable=True)
    status_code: Mapped[int | None] = mapped_column(nullable=True)

    exception_type: Mapped[str] = mapped_column(String(128))
    message: Mapped[str] = mapped_column(Text)
    stack: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)

    user: Mapped["User | None"] = relationship()
