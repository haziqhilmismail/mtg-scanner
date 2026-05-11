"""A single uploaded photo + the raw Gemini response. Listings can reference a scan."""

from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

if TYPE_CHECKING:
    from .listing import Listing
    from .user import User


class Scan(Base, TimestampMixin):
    __tablename__ = "scans"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    filename: Mapped[str] = mapped_column(String(255))
    # Original photo lives on disk so /api/export still works after a server restart.
    image_path: Mapped[str | None] = mapped_column(String(512))
    width: Mapped[int]
    height: Mapped[int]

    # Full Gemini response (detections, bboxes, foil guesses, etc.) for replay/debug
    gemini_raw: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    user: Mapped["User"] = relationship(back_populates="scans")
    listings: Mapped[list["Listing"]] = relationship(
        back_populates="scan",
        cascade="save-update, merge",
    )
