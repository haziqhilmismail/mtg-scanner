from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class PaymentCreate(BaseModel):
    order_id: int
    amount_myr: Decimal = Field(..., ge=0, decimal_places=2)
    method: str
    reference: str | None = None
    paid_at: datetime | None = None  # defaults to now() server-side
    notes: str | None = None


class PaymentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    order_id: int
    amount_myr: Decimal
    method: str
    reference: str | None
    paid_at: datetime
    notes: str | None
    created_at: datetime
