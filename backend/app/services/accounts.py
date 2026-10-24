"""Deleting an account, as PRIVACY.md promises: everything of the user's goes,
except sales records and card corrections, which stay with nothing that links
them back.

SQLite here doesn't enforce foreign keys, so nothing cascades by itself: each
table is cleared in code, children before parents."""

from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    BugEvent, Buyer, CardCorrection, Listing, Order, OrderItem, Payment, Post, SaleRecord, Scan,
    ScanCreditEvent, User, Voucher, VoucherRedemption, listing_post_links,
)


async def delete_account(db: AsyncSession, user_id: int) -> tuple[dict[str, int], list[str]]:
    """Delete the user's rows in this session (the caller commits). Returns
    the rows touched per table, and the files to remove after the commit:
    photos, post images, delivery photos and the payment QR."""
    user = await db.get(User, user_id)
    if user is None:
        raise LookupError(f"no user {user_id}")

    files = [p for p in [
        user.qr_image_path,
        *(await db.scalars(select(Scan.image_path).where(Scan.user_id == user_id))),
        *(await db.scalars(select(Post.image_path).where(Post.user_id == user_id))),
        *(await db.scalars(select(Order.delivery_photo_path).where(Order.user_id == user_id))),
    ] if p]

    orders = select(Order.id).where(Order.user_id == user_id)
    listings = select(Listing.id).where(Listing.user_id == user_id)
    posts = select(Post.id).where(Post.user_id == user_id)
    own_vouchers = select(Voucher.id).where(Voucher.only_user_id == user_id)
    # A record's order outcome, read through its link before the link goes
    # (SQLite evaluates every SET against the row as it was).
    def of_its_order(col):
        return (select(col).join(OrderItem, OrderItem.order_id == Order.id)
                .where(OrderItem.id == SaleRecord.order_item_id).scalar_subquery())
    steps = {
        "sale_records (links cleared)": update(SaleRecord).where(SaleRecord.user_id == user_id).values(
            order_status=of_its_order(Order.status), paid=of_its_order(Order.paid_at.is_not(None)),
            user_id=None, post_id=None, order_item_id=None),
        "card_corrections (links cleared)": update(CardCorrection).where(CardCorrection.user_id == user_id).values(
            user_id=None, scan_id=None),
        "bug_events (user cleared)": update(BugEvent).where(BugEvent.user_id == user_id).values(user_id=None),
        "payments": delete(Payment).where(Payment.order_id.in_(orders)),
        "order_items": delete(OrderItem).where(OrderItem.order_id.in_(orders)),
        "orders": delete(Order).where(Order.user_id == user_id),
        "buyers": delete(Buyer).where(Buyer.user_id == user_id),
        "listing_post_links": delete(listing_post_links).where(or_(
            listing_post_links.c.listing_id.in_(listings), listing_post_links.c.post_id.in_(posts))),
        "listings": delete(Listing).where(Listing.user_id == user_id),
        "posts": delete(Post).where(Post.user_id == user_id),
        "scans": delete(Scan).where(Scan.user_id == user_id),
        "scan_credit_events": delete(ScanCreditEvent).where(ScanCreditEvent.user_id == user_id),
        "voucher_redemptions": delete(VoucherRedemption).where(or_(
            VoucherRedemption.user_id == user_id, VoucherRedemption.voucher_id.in_(own_vouchers))),
        "vouchers (only for this user)": delete(Voucher).where(Voucher.only_user_id == user_id),
        "users": delete(User).where(User.id == user_id),
    }
    counts = {}
    for name, stmt in steps.items():
        counts[name] = (await db.execute(stmt.execution_options(synchronize_session=False))).rowcount
    return counts, files
