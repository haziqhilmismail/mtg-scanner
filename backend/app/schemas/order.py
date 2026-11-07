from datetime import datetime
from decimal import Decimal

from pydantic import MISSING, BaseModel, ConfigDict

from ..models.order import OrderStatus


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


class OrderUpdate(BaseModel):
    """PATCH update — drives the paid/delivered transitions.
    Pass an ISO timestamp to mark, or null to unmark."""
    status: OrderStatus | MISSING = MISSING
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
    archived_at: datetime | None
    prices_sent_at: datetime | None = None
    total_myr: Decimal
    dropoff_method: str | None
    dropoff_address: str | None
    notes: str | None
    items: list[OrderItemRead]
    created_at: datetime
    updated_at: datetime
