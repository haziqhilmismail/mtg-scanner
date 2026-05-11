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
    # lookup-or-create by FB name (case-insensitive). `buyer_fb_url` is optional
    # extra info applied to the buyer record (overwrites existing if provided).
    buyer_id: int | None = None
    buyer_fb_name: str | None = None
    buyer_fb_url: str | None = None
    items: list[OrderItemCreate] = Field(..., min_length=1)
    dropoff_method: str | None = None
    dropoff_address: str | None = None
    notes: str | None = None


class OrderUpdate(BaseModel):
    """PATCH update — drives the paid/delivered transitions.
    Pass an ISO timestamp to mark, or null to unmark."""
    status: OrderStatus | None = None
    paid_at: datetime | None = None
    delivered_at: datetime | None = None
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
    total_myr: Decimal
    dropoff_method: str | None
    dropoff_address: str | None
    notes: str | None
    items: list[OrderItemRead]
    created_at: datetime
    updated_at: datetime
