from datetime import datetime

from pydantic import BaseModel, ConfigDict


class BuyerBase(BaseModel):
    fb_name: str
    fb_url: str | None = None
    phone: str | None = None
    default_dropoff_method: str | None = None
    default_dropoff_address: str | None = None
    notes: str | None = None


class BuyerCreate(BuyerBase):
    pass


class BuyerUpdate(BaseModel):
    fb_name: str | None = None
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
    """BuyerRead + aggregates. Used by list views that show order counts."""
    open_orders_count: int = 0
    total_orders_count: int = 0
