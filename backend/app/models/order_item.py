"""Line items on an order. Stores price + name snapshots so deleting the source
listing later doesn't corrupt historical orders."""

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

if TYPE_CHECKING:
    from .listing import Listing
    from .order import Order


class OrderItem(Base, TimestampMixin):
    __tablename__ = "order_items"
    # Ids are never reused (see migration e6c1f8a3b5d2).
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    # RESTRICT: don't let a listing be deleted while it's referenced on an order.
    # Use Listing.status = archived instead of deleting.
    listing_id: Mapped[int] = mapped_column(
        ForeignKey("listings.id", ondelete="RESTRICT"), index=True
    )

    qty: Mapped[int] = mapped_column(default=1)
    unit_price_myr: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    line_total_myr: Mapped[Decimal] = mapped_column(Numeric(10, 2))

    # Snapshots so the order is readable even if the listing is later edited/removed
    name_snapshot: Mapped[str] = mapped_column(String(255))
    set_snapshot: Mapped[str | None] = mapped_column(String(64))

    order: Mapped["Order"] = relationship(back_populates="items")
    listing: Mapped["Listing"] = relationship(back_populates="order_items")
