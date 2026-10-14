from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from ..models.order import OrderStatus


class OrderItemCreate(BaseModel):
    listing_id: int
    qty: int = Field(1, ge=1)
    # If omitted, route copies the current listing.unit_price_myr at order time
    unit_price_myr: Decimal | None = Field(None, ge=0, decimal_places=2)


class OrderItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    order_id: int
    listing_id: int
    qty: int
    unit_price_myr: Decimal
    line_total_myr: Decimal
    name_snapshot: str
    set_snapshot: str | None
    created_at: datetime


class OrderCreate(BaseModel):
    # Either pass `buyer_id` to use an existing buyer, OR `buyer_fb_name` to
    # lookup-or-create by FB name (case-insensitive). `buyer_fb_url` and
    # `buyer_phone` are optional — written onto the buyer row if it's new, or
    # filled in on an existing buyer whose field is still null.
    buyer_id: int | None = None
    buyer_fb_name: str | None = None
    buyer_fb_url: str | None = None
    buyer_phone: str | None = None
    items: list[OrderItemCreate] = Field(..., min_length=1)
    dropoff_method: str | None = None
    dropoff_address: str | None = None
    notes: str | None = None


class OrderUpdate(BaseModel):
    """PATCH update — drives the paid/delivered transitions.
    Pass an ISO timestamp to mark, or null to unmark."""
    status: OrderStatus = None  # not nullable: null is a 422, omit it to keep the status
    paid_at: datetime | None = None
    delivered_at: datetime | None = None
    archived_at: datetime | None = None
    dropoff_method: str | None = None
    dropoff_address: str | None = None
    notes: str | None = None


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    buyer_id: int
    status: OrderStatus
    paid_at: datetime | None
    delivered_at: datetime | None
    archived_at: datetime | None
    total_myr: Decimal
    dropoff_method: str | None
    dropoff_address: str | None
    notes: str | None
    # Delivery-proof photo metadata (bytes served separately to keep this
    # JSON small + cacheable; the bool tells the UI whether to show the
    # thumbnail or the "upload photo" affordance).
    has_delivery_photo: bool = False
    delivery_photo_uploaded_at: datetime | None = None
    items: list[OrderItemRead]
    created_at: datetime
    updated_at: datetime
