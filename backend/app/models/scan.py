"""A single uploaded photo + the raw Gemini response. Listings can reference a scan."""

from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

if TYPE_CHECKING:
    from .listing import Listing
    from .user import User


class Scan(Base, TimestampMixin):
    __tablename__ = "scans"
    # Ids are never reused (see migration a7e3c9d1f5b2).
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    # The post this photo is filed under in the Scans gallery. NULL = unfiled.
    # Deleting a post unfiles its photos (see routers/posts.py); it never
    # deletes them.
    post_id: Mapped[int | None] = mapped_column(Integer, index=True)
    # Its place in the post, as the seller ordered the photos (their order on
    # Facebook): Photo 1, 2, 3 everywhere. NULL = not placed yet, so after the
    # placed ones, oldest scan first.
    position: Mapped[int | None] = mapped_column(Integer)
    filename: Mapped[str] = mapped_column(String(255))
    # Original photo lives on disk so /api/export still works after a server restart.
    image_path: Mapped[str | None] = mapped_column(String(512))
    width: Mapped[int]
    height: Mapped[int]

    # Full Gemini response (detections, bboxes, foil guesses, etc.) for replay/debug
    gemini_raw: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    # The seller's per-card edits (foil, price overrides, removed cards...),
    # opaque to the backend: the frontend owns the shape. See PATCH .../state.
    ui_state: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    user: Mapped["User"] = relationship(back_populates="scans")
    listings: Mapped[list["Listing"]] = relationship(
        back_populates="scan",
        cascade="save-update, merge",
    )
