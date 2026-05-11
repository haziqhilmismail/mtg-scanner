"""Order from a buyer. paid_at and delivered_at are independent — buyers can drop off
before paying ("on credit") or pay before pickup; the model handles both naturally."""

import enum
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

if TYPE_CHECKING:
    from .buyer import Buyer
    from .order_item import OrderItem
    from .payment import Payment
    from .user import User


class OrderStatus(str, enum.Enum):
    """Top-level lifecycle. paid_at + delivered_at are tracked separately."""

    claimed = "claimed"      # buyer has agreed to take these cards
    cancelled = "cancelled"  # cancelled by either party


class Order(Base, TimestampMixin):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    buyer_id: Mapped[int] = mapped_column(
        ForeignKey("buyers.id", ondelete="RESTRICT"), index=True
    )

    status: Mapped[OrderStatus] = mapped_column(
        Enum(OrderStatus), default=OrderStatus.claimed, index=True
    )

    # Independent flags — either may be set without the other.
    # delivered_at without paid_at = "took on credit, hasn't paid yet"
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Cached running total of order items (recompute on item add/remove)
    total_myr: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), default=Decimal("0.00")
    )

    # Snapshot from buyer at time of claim, but editable per-order
    dropoff_method: Mapped[str | None] = mapped_column(String(32))
    dropoff_address: Mapped[str | None] = mapped_column(Text)

    notes: Mapped[str | None] = mapped_column(Text)

    user: Mapped["User"] = relationship(back_populates="orders")
    buyer: Mapped["Buyer"] = relationship(back_populates="orders")
    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )
