from datetime import datetime

from pydantic import MISSING, BaseModel, ConfigDict


class BuyerBase(BaseModel):
    fb_name: str
    fb_url: str | None = None
    phone: str | None = None
    default_dropoff_method: str | None = None
    default_dropoff_address: str | None = None
    notes: str | None = None


class BuyerUpdate(BaseModel):
    fb_name: str | MISSING = MISSING
    fb_url: str | None = None
    phone: str | None = None
    default_dropoff_method: str | None = None
    default_dropoff_address: str | None = None
    notes: str | None = None


class BuyerRead(BuyerBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime


class BuyerReadWithStats(BuyerRead):
    """BuyerRead + the buyer's order count."""
    total_orders_count: int = 0
