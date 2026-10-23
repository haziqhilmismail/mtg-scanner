"""A Facebook post — the unit the user actually advertises. One post groups
the N cards sold under it. The FB URL is stored for reference; we never query
Facebook. The image (if any) lives on disk at data/posts/{id}.bin.

A card can live in many posts (e.g. it was re-listed in a follow-up drop), so
the listings relationship goes through the listing_post_links join table."""

import enum
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin
from .listing_post_link import listing_post_links

if TYPE_CHECKING:
    from .listing import Listing
    from .user import User


class PostStatus(str, enum.Enum):
    """Lifecycle:
        active   — visible in selectors, the default for new posts
        inactive — still visible everywhere but flagged as wound-down;
                   user can choose to archive it next.
        archived — hidden from new-stock / scanner selectors. Existing
                   listings stay linked; you have to un-archive to re-use it.
    """
    active = "active"
    inactive = "inactive"
    archived = "archived"


class Post(Base, TimestampMixin):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    title: Mapped[str | None] = mapped_column(String(255))
    fb_url: Mapped[str | None] = mapped_column(String(512))
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[PostStatus] = mapped_column(
        Enum(PostStatus), default=PostStatus.active, server_default="active",
    )

    # On-disk reminder image — saved by the upload endpoint, not the user's hand
    image_path: Mapped[str | None] = mapped_column(String(512))
    image_mime: Mapped[str | None] = mapped_column(String(64))

    # The frontend's pricing settings for this post's photos, opaque to the
    # backend. NULL = follow the user's default (User.pricing).
    pricing: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    user: Mapped["User"] = relationship(back_populates="posts")
    listings: Mapped[list["Listing"]] = relationship(
        secondary=listing_post_links, back_populates="posts", lazy="selectin",
    )
