"""Users — solo today, multi-user later. Carries each owner's payment + pricing defaults."""

from typing import TYPE_CHECKING, Any

from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

if TYPE_CHECKING:
    from .buyer import Buyer
    from .listing import Listing
    from .order import Order
    from .post import Post
    from .scan import Scan


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)

    # Google OAuth: `sub` is Google's stable per-user identifier. Filled on first
    # Google sign-in and used as the lookup key for subsequent logins so users
    # with the same email but different identity providers don't collide.
    google_sub: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(String(512))

    fb_name: Mapped[str | None] = mapped_column(String(255))

    # Payment info — used to compose the claim message + render QR on listings
    bank_name: Mapped[str | None] = mapped_column(String(64))
    bank_account_number: Mapped[str | None] = mapped_column(String(32))
    bank_account_holder: Mapped[str | None] = mapped_column(String(255))
    qr_image_path: Mapped[str | None] = mapped_column(String(512))

    # Pricing defaults (mirror the current frontend settings panel)
    default_currency: Mapped[str] = mapped_column(String(8), default="RM")
    default_mult_normal: Mapped[float] = mapped_column(Float, default=2.8)
    default_mult_foil: Mapped[float] = mapped_column(Float, default=3.0)
    # The frontend's default pricing settings, opaque to the backend; a post
    # with no pricing of its own uses these.
    pricing: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    # Scan credits (see services/credits.py). Extra scans from vouchers or
    # payments that don't expire, and "no limit until" (naive UTC; year 9999
    # means forever).
    bonus_scan_credits: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    unlimited_scans_until: Mapped[datetime | None] = mapped_column(DateTime)

    # Relationships — back-populates so we can navigate from any side
    scans: Mapped[list["Scan"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    listings: Mapped[list["Listing"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    buyers: Mapped[list["Buyer"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    orders: Mapped[list["Order"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    posts: Mapped[list["Post"]] = relationship(back_populates="user", cascade="all, delete-orphan")
