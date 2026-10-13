"""
credits.py
----------
Scan credits. Each signed-in user gets `settings.free_scans_per_window` free
photo scans in any rolling 30-day window; a voucher (and later a payment) can
add extra credits that don't expire, or switch the limit off.

A scan *reserves* a credit before the Gemini call and hands it back if the
scan fails, so three photos sent at once can't overshoot the limit and a
failed scan costs nothing. Reserve/refund use their own short transactions:
the request's session stays open across the multi-second Gemini call, and
holding SQLite's write lock that long would stall every other writer.
"""

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import DateTime, delete, func, insert, literal, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import async_session_factory
from ..models import ScanCreditEvent, User, Voucher, VoucherRedemption

WINDOW = timedelta(days=30)
FOREVER = datetime(9999, 12, 31)

# What reserve() hands back and refund() takes.
UNLIMITED, FREE, BONUS = "unlimited", "free", "bonus"

# No 0/O or 1/I/L: codes get read off a screen and typed on a phone.
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


class VoucherError(Exception):
    """`code` is one of: invalid, expired, used_up, already_redeemed."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _free_used(user_id: int, now: datetime):
    return (
        select(func.count())
        .select_from(ScanCreditEvent)
        .where(ScanCreditEvent.user_id == user_id, ScanCreditEvent.created_at > now - WINDOW)
        .scalar_subquery()
    )


async def reserve(user_id: int) -> str | None:
    """Take one credit for `user_id`. Returns where it came from, or None when
    the user has none left."""
    if not settings.auth_enabled:
        return UNLIMITED  # solo mode: there is nobody to limit
    now = _now()
    async with async_session_factory() as s:
        user = await s.get(User, user_id)
        if user is None:
            return None
        if user.unlimited_scans_until and user.unlimited_scans_until > now:
            return UNLIMITED
        # One statement, so the check and the insert can't be split by a
        # parallel scan from the same user.
        took_free = await s.execute(
            insert(ScanCreditEvent).from_select(
                ["user_id", "created_at"],
                select(literal(user_id), literal(now, DateTime())).where(
                    _free_used(user_id, now) < settings.free_scans_per_window
                ),
            )
        )
        if took_free.rowcount:
            await s.commit()
            return FREE
        took_bonus = await s.execute(
            update(User)
            .where(User.id == user_id, User.bonus_scan_credits > 0)
            .values(bonus_scan_credits=User.bonus_scan_credits - 1)
        )
        await s.commit()
        return BONUS if took_bonus.rowcount else None


async def refund(user_id: int, source: str) -> None:
    """Hand back a credit taken by reserve() — the scan it paid for failed."""
    async with async_session_factory() as s:
        if source == FREE:
            newest = (
                select(func.max(ScanCreditEvent.id))
                .where(ScanCreditEvent.user_id == user_id)
                .scalar_subquery()
            )
            await s.execute(delete(ScanCreditEvent).where(ScanCreditEvent.id == newest))
        elif source == BONUS:
            await s.execute(
                update(User)
                .where(User.id == user_id)
                .values(bonus_scan_credits=User.bonus_scan_credits + 1)
            )
        await s.commit()


async def status(db: AsyncSession, user_id: int) -> dict:
    """What the UI shows: how many scans are left and when the next comes back."""
    limit = settings.free_scans_per_window
    if not settings.auth_enabled:
        return {"enforced": False, "unlimited": True, "limit": limit, "used": 0,
                "bonus": 0, "remaining": None, "next_free_at": None}
    now = _now()
    user = await db.get(User, user_id)
    in_window = (
        await db.scalars(
            select(ScanCreditEvent.created_at)
            .where(ScanCreditEvent.user_id == user_id, ScanCreditEvent.created_at > now - WINDOW)
            .order_by(ScanCreditEvent.created_at)
        )
    ).all()
    used = len(in_window)
    bonus = user.bonus_scan_credits if user else 0
    unlimited = bool(user and user.unlimited_scans_until and user.unlimited_scans_until > now)
    return {
        "enforced": True,
        "unlimited": unlimited,
        "limit": limit,
        "used": min(used, limit),
        "bonus": bonus,
        "remaining": None if unlimited else max(0, limit - used) + bonus,
        # The oldest scan in the window is the next one to drop out of it.
        "next_free_at": (in_window[0] + WINDOW).isoformat() + "Z" if in_window else None,
    }


def normalise_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def new_code() -> str:
    """A fresh voucher code as shown to people: MTG-XXXX-XXXX-XXXX."""
    groups = ["".join(secrets.choice(_CODE_ALPHABET) for _ in range(4)) for _ in range(3)]
    return "MTG-" + "-".join(groups)


async def grant(db: AsyncSession, user_id: int, *, credits: int = 0,
                unlimited: bool = False, unlimited_days: int | None = None) -> None:
    """Add extra credits and/or unlimited scanning to a user. Vouchers call
    this; a payment will too."""
    user = await db.get(User, user_id)
    if credits:
        user.bonus_scan_credits += credits
    if unlimited:
        if unlimited_days is None:
            user.unlimited_scans_until = FOREVER
        else:
            # Extend from whatever is left, so two 30-day vouchers make 60.
            start = max(user.unlimited_scans_until or _now(), _now())
            user.unlimited_scans_until = min(FOREVER, start + timedelta(days=unlimited_days))


async def redeem(db: AsyncSession, user_id: int, code: str) -> Voucher:
    """Apply a voucher to `user_id`. Raises VoucherError when it can't be."""
    now = _now()
    voucher = await db.scalar(select(Voucher).where(Voucher.code == normalise_code(code)))
    if voucher is None:
        raise VoucherError("invalid")
    if voucher.expires_at and voucher.expires_at <= now:
        raise VoucherError("expired")
    already = await db.scalar(
        select(VoucherRedemption.id).where(
            VoucherRedemption.voucher_id == voucher.id, VoucherRedemption.user_id == user_id
        )
    )
    if already:
        raise VoucherError("already_redeemed")
    # Conditional update so two people racing for the last use can't both win.
    claimed = await db.execute(
        update(Voucher)
        .where(Voucher.id == voucher.id, Voucher.used_count < Voucher.max_uses)
        .values(used_count=Voucher.used_count + 1)
    )
    if not claimed.rowcount:
        raise VoucherError("used_up")
    db.add(VoucherRedemption(voucher_id=voucher.id, user_id=user_id, created_at=now))
    try:
        await db.flush()
    except IntegrityError:
        raise VoucherError("already_redeemed")
    await grant(db, user_id, credits=voucher.credits, unlimited=voucher.unlimited,
                unlimited_days=voucher.unlimited_days)
    return voucher
