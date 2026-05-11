"""Facebook buyers. Default dropoff settings are hints for new orders, not enforced."""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

if TYPE_CHECKING:
    from .order import Order
    from .user import User


class Buyer(Base, TimestampMixin):
    __tablename__ = "buyers"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    fb_name: Mapped[str] = mapped_column(String(255))
    fb_url: Mapped[str | None] = mapped_column(String(512))
    phone: Mapped[str | None] = mapped_column(String(32))

    # Defaults that pre-fill new orders for this buyer
    default_dropoff_method: Mapped[str | None] = mapped_column(String(32))
    default_dropoff_address: Mapped[str | None] = mapped_column(Text)

    notes: Mapped[str | None] = mapped_column(Text)

    user: Mapped["User"] = relationship(back_populates="buyers")
    orders: Mapped[list["Order"]] = relationship(
        back_populates="buyer", cascade="all, delete-orphan"
    )
