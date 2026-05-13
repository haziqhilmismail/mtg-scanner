"""Order workflow: claim from a buyer, with line items + independent paid/delivered status."""

from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..config import DATA_DIR, settings
from ..deps import CurrentUserId, DbSession
from ..models import Buyer, Listing, Order, OrderItem, OrderStatus
from ..schemas import OrderCreate, OrderRead, OrderUpdate
from ..services.auth_service import decode_session_token

router = APIRouter(prefix="/api/orders", tags=["orders"])

# ---------- Delivery-proof photo helpers ----------
# Same on-disk layout as posts: bytes live at data/orders/{id}.bin and the
# orders row stores the absolute path so the data dir can be relocated
# without rewriting rows. The image bytes are served at GET .../delivery-photo
# behind a ?token= query param (browsers don't send Authorization on <img>).

ORDERS_PHOTO_DIR = DATA_DIR / "orders"
ORDERS_PHOTO_DIR.mkdir(exist_ok=True)

ALLOWED_PHOTO_MIME = {
    "image/jpeg", "image/jpg", "image/png", "image/webp",
    "image/heic", "image/heif", "image/gif",
}
MAX_PHOTO_BYTES = 8 * 1024 * 1024  # 8 MiB


def _order_photo_path(order_id: int) -> Path:
    return ORDERS_PHOTO_DIR / f"{order_id}.bin"


async def _load_order(db, order_id: int, user_id: int) -> Order:
    """Fetch an order with items eagerly loaded; 404 if not found or not owned."""
    q = (
        select(Order)
        .where(Order.id == order_id, Order.user_id == user_id)
        .options(selectinload(Order.items))
    )
    order = (await db.execute(q)).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Order not found")
    return order


@router.get("", response_model=list[OrderRead])
async def list_orders(db: DbSession, user_id: CurrentUserId) -> list[Order]:
    """List orders newest first, each with its line items."""
    q = (
        select(Order)
        .where(Order.user_id == user_id)
        .options(selectinload(Order.items))
        .order_by(Order.created_at.desc())
    )
    return list((await db.execute(q)).scalars().all())


async def _resolve_buyer(db, user_id: int, payload: OrderCreate) -> Buyer:
    """Look up an existing buyer by id or by FB name (case-insensitive), or create
    a new one if a name was provided. Raises 400/404 with a helpful message otherwise."""
    phone = (payload.buyer_phone or "").strip() or None

    if payload.buyer_id:
        buyer = await db.get(Buyer, payload.buyer_id)
        if not buyer or buyer.user_id != user_id:
            raise HTTPException(404, "Buyer not found")
        # If extra info was supplied alongside the id, fill in fields that
        # are still empty on the existing buyer (don't overwrite stored data).
        if payload.buyer_fb_url and not buyer.fb_url:
            buyer.fb_url = payload.buyer_fb_url
        if phone and not buyer.phone:
            buyer.phone = phone
        return buyer

    name = (payload.buyer_fb_name or "").strip()
    if not name:
        raise HTTPException(400, "Provide either buyer_id or buyer_fb_name")

    # Case-insensitive name lookup against this user's buyers
    from sqlalchemy import func as sql_func
    existing = (await db.execute(
        select(Buyer).where(
            Buyer.user_id == user_id,
            sql_func.lower(Buyer.fb_name) == name.lower(),
        )
    )).scalar_one_or_none()

    if existing:
        if payload.buyer_fb_url and not existing.fb_url:
            existing.fb_url = payload.buyer_fb_url
        if phone and not existing.phone:
            existing.phone = phone
        return existing

    new_buyer = Buyer(
        user_id=user_id,
        fb_name=name,
        fb_url=(payload.buyer_fb_url or None),
        phone=phone,
    )
    db.add(new_buyer)
    await db.flush()
    return new_buyer


@router.post("", response_model=OrderRead, status_code=201)
async def create_order(
    payload: OrderCreate, db: DbSession, user_id: CurrentUserId,
) -> Order:
    """Create an order with N line items. Each line item snapshots the listing's
    current name/set/price, so the order stays readable even if the listing is later edited.
    Buyer can be referenced by id OR resolved by FB name (looked up case-insensitive,
    created if missing)."""
    buyer = await _resolve_buyer(db, user_id, payload)

    order = Order(
        user_id=user_id,
        buyer_id=buyer.id,
        dropoff_method=payload.dropoff_method or buyer.default_dropoff_method,
        dropoff_address=payload.dropoff_address or buyer.default_dropoff_address,
        notes=payload.notes,
        total_myr=Decimal("0.00"),
    )
    db.add(order)
    await db.flush()  # need order.id before adding items

    total = Decimal("0.00")
    for item_in in payload.items:
        listing = await db.get(Listing, item_in.listing_id)
        if not listing or listing.user_id != user_id:
            raise HTTPException(404, f"Listing {item_in.listing_id} not found")
        unit_price = item_in.unit_price_myr if item_in.unit_price_myr is not None else listing.unit_price_myr
        line_total = unit_price * item_in.qty
        db.add(OrderItem(
            order_id=order.id,
            listing_id=listing.id,
            qty=item_in.qty,
            unit_price_myr=unit_price,
            line_total_myr=line_total,
            name_snapshot=listing.name,
            set_snapshot=listing.set_code,
        ))
        total += line_total

    order.total_myr = total
    await db.flush()
    return await _load_order(db, order.id, user_id)


@router.get("/{order_id}", response_model=OrderRead)
async def get_order(order_id: int, db: DbSession, user_id: CurrentUserId) -> Order:
    return await _load_order(db, order_id, user_id)


@router.patch("/{order_id}", response_model=OrderRead)
async def update_order(
    order_id: int, payload: OrderUpdate, db: DbSession, user_id: CurrentUserId,
) -> Order:
    """Update top-level order fields. Paid/delivered timestamps can be set, cleared,
    or left as-is — they're independent so 'took on credit' (delivered without paid) is valid."""
    order = await _load_order(db, order_id, user_id)
    updates = payload.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(order, k, v)
    await db.flush()
    return await _load_order(db, order.id, user_id)


@router.post("/{order_id}/mark-paid", response_model=OrderRead)
async def mark_paid(order_id: int, db: DbSession, user_id: CurrentUserId) -> Order:
    """Convenience: stamp paid_at to now. Idempotent if already set."""
    order = await _load_order(db, order_id, user_id)
    if order.paid_at is None:
        order.paid_at = datetime.now(timezone.utc)
        await db.flush()
    return await _load_order(db, order.id, user_id)


@router.post("/{order_id}/mark-delivered", response_model=OrderRead)
async def mark_delivered(order_id: int, db: DbSession, user_id: CurrentUserId) -> Order:
    """Convenience: stamp delivered_at to now. Idempotent."""
    order = await _load_order(db, order_id, user_id)
    if order.delivered_at is None:
        order.delivered_at = datetime.now(timezone.utc)
        await db.flush()
    return await _load_order(db, order.id, user_id)


@router.post("/{order_id}/cancel", response_model=OrderRead)
async def cancel_order(order_id: int, db: DbSession, user_id: CurrentUserId) -> Order:
    order = await _load_order(db, order_id, user_id)
    order.status = OrderStatus.cancelled
    await db.flush()
    return await _load_order(db, order.id, user_id)


@router.post("/{order_id}/restore", response_model=OrderRead)
async def restore_order(order_id: int, db: DbSession, user_id: CurrentUserId) -> Order:
    """Un-cancel a cancelled order. Items return to the active claim; paid_at and
    delivered_at timestamps are preserved so the order lands back in its previous
    kanban column (unpaid/paid/credit/done) on its own."""
    order = await _load_order(db, order_id, user_id)
    if order.status != OrderStatus.cancelled:
        return await _load_order(db, order.id, user_id)
    order.status = OrderStatus.claimed
    await db.flush()
    return await _load_order(db, order.id, user_id)


# ---------- Delivery-proof photo endpoints ----------
# UI uses these to attach a photo of the cards being handed over for any
# delivered order (paid+delivered "Done", or delivered-only "On credit").
# The order itself doesn't *require* a photo — it's an optional record the
# user keeps for their own peace of mind / dispute resolution.


@router.post("/{order_id}/delivery-photo", response_model=OrderRead)
async def upload_delivery_photo(
    order_id: int,
    db: DbSession,
    user_id: CurrentUserId,
    image: UploadFile = File(...),
) -> Order:
    """Upload (or replace) the delivery-proof photo for an order. The order
    doesn't need to be delivered yet — the frontend gates which cards show
    the upload affordance, but the backend doesn't enforce that so we don't
    create chicken-and-egg problems when the photo is taken before
    `mark-delivered` fires."""
    order = await _load_order(db, order_id, user_id)
    if image.content_type and image.content_type not in ALLOWED_PHOTO_MIME:
        raise HTTPException(400, f"Unsupported image type: {image.content_type}")
    raw = await image.read()
    if len(raw) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "Image too large (max 8 MB)")
    if not raw:
        raise HTTPException(400, "Empty image upload")
    path = _order_photo_path(order.id)
    path.write_bytes(raw)
    order.delivery_photo_path = str(path)
    order.delivery_photo_mime = image.content_type or "application/octet-stream"
    order.delivery_photo_uploaded_at = datetime.now(timezone.utc)
    await db.flush()
    return await _load_order(db, order.id, user_id)


@router.get("/{order_id}/delivery-photo")
async def get_delivery_photo(
    order_id: int,
    db: DbSession,
    token: str | None = Query(default=None),
) -> Response:
    """Serve the delivery-proof photo. Auth handled inline via ?token=... so
    `<img src=...>` can fetch it (no Authorization header support). Mirrors
    the posts image endpoint."""
    if settings.auth_enabled:
        if not token:
            raise HTTPException(401, "Missing token query parameter")
        user_id = decode_session_token(token)
        if user_id is None:
            raise HTTPException(401, "Invalid or expired token")
    else:
        user_id = settings.solo_user_id

    order = await db.get(Order, order_id)
    if not order or order.user_id != user_id:
        raise HTTPException(404, "Order not found")
    if not order.delivery_photo_path:
        raise HTTPException(404, "No delivery photo attached")
    p = Path(order.delivery_photo_path)
    if not p.exists():
        raise HTTPException(404, "Image file missing")
    return Response(
        content=p.read_bytes(),
        media_type=order.delivery_photo_mime or "application/octet-stream",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.delete("/{order_id}/delivery-photo", status_code=204)
async def delete_delivery_photo(
    order_id: int, db: DbSession, user_id: CurrentUserId,
) -> None:
    order = await _load_order(db, order_id, user_id)
    if order.delivery_photo_path:
        try:
            Path(order.delivery_photo_path).unlink(missing_ok=True)
        except Exception:
            pass
    order.delivery_photo_path = None
    order.delivery_photo_mime = None
    order.delivery_photo_uploaded_at = None
    await db.flush()

