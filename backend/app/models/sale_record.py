"""Sales records: the prices cards are sold at, at the night market.

One row is one card line of an order at the moment its price was sent to the
buyer (the seller copied or shared the buyer's summary). It records a price
sent to a buyer: the order can still be cancelled later, so for a sale join
`order_item_id` to its order while it exists; when the seller's account is
deleted the order's outcome is copied in first (`order_status`, `paid`).

- Grain: one row per order item per send that changed its qty or price.
  `line_seq` counts a line's sends (1, 2, ...); a send at the same qty and
  price as the line's last row adds nothing. The final price of a line is
  its row with the highest `line_seq`.
- Append-only: rows are never updated or deleted, with one exception.
  Deleting the seller's account clears the links back to them (`user_id`,
  `post_id`, `order_item_id`) and copies in the order's outcome; the card
  and price stay. See services/accounts.py.
- A snapshot: the card and its prices are copied in, so editing or deleting
  the order, the listing or the post later doesn't change history. A link
  is only good while its target row exists (ids are never reused).
- No buyer data: no name, phone, Facebook link or order note.
- Money columns read back as Decimal at 2 places (SQLite stores them as REAL).
- Times are UTC.

Where each column comes from:
- card, qty, unit price: the order item and its listing (the server's own
  data, not what the page sends).
- post_type, price_kind, app_usd, app_mult: what the seller's app priced the
  card from: price on photo or live price, the CK price, the multiplier, and
  whether the price was automatic, the seller's own, or a hand-entered card.
- ck_*: Card Kingdom's NM retail and buylist price for that printing and
  finish from the server's own price list, and when that list was fetched.
"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, SmallInteger, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class SaleRecord(Base):
    __tablename__ = "sale_records"
    __table_args__ = (
        # One row per send of a line; a double-click's second insert is a no-op.
        UniqueConstraint("order_item_id", "line_seq", name="uq_sale_records_line_seq"),
        # Price history of one printing and finish over time.
        Index("ix_sale_records_card_time", "scryfall_id", "is_foil", "recorded_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    # Bumped when the meaning of a column changes, so old rows read right.
    schema_version: Mapped[int] = mapped_column(SmallInteger, default=1)
    channel: Mapped[str] = mapped_column(String(8))  # 'copy' | 'share'

    # Links back to the seller. Cleared when their account is deleted. SQLite
    # here doesn't enforce foreign keys, so that is done in code; the keys
    # document the link.
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    post_id: Mapped[int | None] = mapped_column(ForeignKey("posts.id", ondelete="SET NULL"))
    order_item_id: Mapped[int | None] = mapped_column(ForeignKey("order_items.id", ondelete="SET NULL"))
    line_seq: Mapped[int] = mapped_column(SmallInteger)

    # The order's outcome, copied in when the links are cleared.
    order_status: Mapped[str | None] = mapped_column(String(16))  # 'claimed' | 'cancelled'
    paid: Mapped[bool | None] = mapped_column(Boolean)

    # The card, as sold.
    scryfall_id: Mapped[str | None] = mapped_column(String(64))
    card_name: Mapped[str] = mapped_column(String(255))
    set_code: Mapped[str | None] = mapped_column(String(16))
    set_name: Mapped[str | None] = mapped_column(String(255))
    collector_number: Mapped[str | None] = mapped_column(String(16))
    rarity: Mapped[str | None] = mapped_column(String(16))
    is_foil: Mapped[bool] = mapped_column(Boolean)

    # The price sent.
    qty: Mapped[int]
    unit_price_myr: Mapped[Decimal] = mapped_column(Numeric(10, 2))

    # How the seller priced it.
    post_type: Mapped[str | None] = mapped_column(String(8))    # 'photo' | 'live'
    price_kind: Mapped[str | None] = mapped_column(String(8))   # 'auto' | 'override' | 'manual'
    app_usd: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    app_mult: Mapped[Decimal | None] = mapped_column(Numeric(6, 3))

    # Card Kingdom on the day.
    ck_retail_usd: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    ck_buy_usd: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    ck_as_of: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
