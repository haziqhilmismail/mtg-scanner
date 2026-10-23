"""Scan credits: usage events, vouchers and who redeemed them."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ScanCreditEvent(Base):
    """One free scan used. The free allowance is "N of these in the last 30
    days", so rows are kept even when the scan itself is deleted — otherwise
    deleting a scan would hand the credit back."""

    __tablename__ = "scan_credit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Naive UTC, set from Python so every comparison uses one format.
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class Voucher(Base):
    """A code that grants extra credits and/or unlimited scanning.
    Created with scripts/make_voucher.py; a payment will later grant credits
    through the same service function a voucher does."""

    __tablename__ = "vouchers"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Stored normalised: upper-case, no dashes or spaces.
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    credits: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    unlimited: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    # With `unlimited`: how long it lasts. NULL = forever.
    unlimited_days: Mapped[int | None] = mapped_column(Integer)
    # Puts the account back on the standard allowance: unlimited off, extra
    # credits cleared, usage wiped so the full free allowance is available.
    # For testing the limited experience on an account that has a bypass.
    resets: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    # Can be redeemed again and again by the same account (max_uses and the
    # once-per-account rule don't apply). Only sensible with `only_user_id`.
    reusable: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    # When set, nobody else can redeem this code.
    only_user_id: Mapped[int | None] = mapped_column(Integer)
    max_uses: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    used_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    note: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime)


class VoucherRedemption(Base):
    __tablename__ = "voucher_redemptions"
    __table_args__ = (UniqueConstraint("voucher_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    voucher_id: Mapped[int] = mapped_column(ForeignKey("vouchers.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime)
