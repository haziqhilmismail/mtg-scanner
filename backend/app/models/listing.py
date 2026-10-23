"""A card put up for sale. Card identity fields are denormalized so listings stay
valid even if Scryfall/CK pricing data later changes."""

import enum
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Boolean, Enum, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

from .listing_post_link import listing_post_links

if TYPE_CHECKING:
    from .order_item import OrderItem
    from .post import Post
    from .scan import Scan
    from .user import User


class ListingStatus(str, enum.Enum):
    """Listing lifecycle. Quantity availability is computed from active order items —
    `status` only tracks whether the listing itself is on sale or archived."""

    active = "active"      # available for sale (some qty may already be in orders)
    archived = "archived"  # taken off the listings (sold out, used as a name placard, etc.)


class Listing(Base, TimestampMixin):
    __tablename__ = "listings"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Nullable: listings can also be created manually without a scan
    scan_id: Mapped[int | None] = mapped_column(
        ForeignKey("scans.id", ondelete="SET NULL"), index=True
    )

    # Where this card sits on the source photo, if from a scan: [x, y, w, h]
    bbox: Mapped[list[int] | None] = mapped_column(JSON)

    # Card identity (denormalized snapshot from Scryfall/CK)
    scryfall_id: Mapped[str | None] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(255))
    set_code: Mapped[str | None] = mapped_column(String(16))
    set_name: Mapped[str | None] = mapped_column(String(255))
    collector_number: Mapped[str | None] = mapped_column(String(16))
    rarity: Mapped[str | None] = mapped_column(String(16))
    is_foil: Mapped[bool] = mapped_column(Boolean, default=False)

    # Reference URLs (display only; pricing lives in `unit_price_myr`)
    image_url: Mapped[str | None] = mapped_column(String(512))
    ck_url: Mapped[str | None] = mapped_column(String(512))

    # Pricing — locked at listing time so price changes upstream don't change posted prices
    unit_price_myr: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    qty_total: Mapped[int] = mapped_column(default=1)

    status: Mapped[ListingStatus] = mapped_column(
        Enum(ListingStatus), default=ListingStatus.active, index=True
    )

    notes: Mapped[str | None] = mapped_column(Text)

    user: Mapped["User"] = relationship(back_populates="listings")
    scan: Mapped["Scan | None"] = relationship(back_populates="listings")
    posts: Mapped[list["Post"]] = relationship(
        secondary=listing_post_links, back_populates="listings", lazy="selectin",
    )
    order_items: Mapped[list["OrderItem"]] = relationship(back_populates="listing")
