"""Association table for the M:N between listings and posts. A single
stock card can be linked into multiple FB posts (e.g. listed in two drops),
and a post groups many cards — that's the natural relationship."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Table, func

from .base import Base

listing_post_links = Table(
    "listing_post_links",
    Base.metadata,
    Column(
        "listing_id",
        Integer,
        ForeignKey("listings.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "post_id",
        Integer,
        ForeignKey("posts.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    ),
    Column(
        "created_at",
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    ),
)
