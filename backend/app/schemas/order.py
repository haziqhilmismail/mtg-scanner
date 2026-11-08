from datetime import datetime
from decimal import Decimal

from pydantic import MISSING, BaseModel, ConfigDict, Field

from ..models.order import OrderStatus
from .listing import ListingBase
from .types import Id


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


class ConfirmItem(ListingBase):
    """A claimed card: the listing it becomes, where it is in which photo,
    and how many this buyer wants (qty_total is how many the seller has)."""
    scan_id: Id
    card_id: int
    bbox: list[int] = Field(..., min_length=4, max_length=4)
    qty: int = Field(1, ge=1)


class ConfirmClaim(BaseModel):
    buyer: str = Field(..., min_length=1, max_length=255)
    note: str | None = None
    items: list[ConfirmItem] = Field(..., min_length=1)
