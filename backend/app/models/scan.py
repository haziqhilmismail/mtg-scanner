"""An uploaded photo and its scan result. Listings can reference a scan."""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.orm.attributes import flag_modified

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

    # The /api/scan response (cards and the photo preview, see schemas/scan.py),
    # so GET /api/scans can serve it again without scanning.
    gemini_raw: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    # The seller's per-card edits (foil, price overrides, removed cards...).
    # The frontend owns the shape; the backend reads only `rev` and the lock
    # (`lockedAt`, `locked`). See PATCH .../state.
    ui_state: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    user: Mapped["User"] = relationship(back_populates="scans")
    listings: Mapped[list["Listing"]] = relationship(
        back_populates="scan",
        cascade="save-update, merge",
    )

    @property
    def photo(self) -> Path | None:
        """The photo on disk, or None when it is not there any more."""
        p = Path(self.image_path) if self.image_path else None
        return p if p and p.exists() else None

    @property
    def cards(self) -> list[dict[str, Any]]:
        """The stored cards (`ScannedCard.to_payload`), read-only: change them
        through edit_payload."""
        return (self.gemini_raw or {}).get("cards") or []

    @property
    def preview_b64(self) -> str:
        """The photo preview as a JPEG data URL; "" when there is none."""
        return (self.gemini_raw or {}).get("image_b64", "")

    def card(self, card_id: int) -> dict[str, Any] | None:
        return next((c for c in self.cards if c.get("id") == card_id), None)

    @contextmanager
    def edit_payload(self) -> Iterator[dict[str, Any]]:
        """The stored payload to change in place; saved when the block ends.
        SQLAlchemy does not see in-place changes to a JSON column, so this
        marks it changed."""
        payload = self.gemini_raw if self.gemini_raw is not None else {}
        yield payload
        self.gemini_raw = payload
        flag_modified(self, "gemini_raw")
