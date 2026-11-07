from datetime import datetime

from pydantic import MISSING, BaseModel, ConfigDict

from ..models.post import PostStatus
from .types import Pricing


class PostBase(BaseModel):
    title: str | None = None
    fb_url: str | None = None
    note: str | None = None
    status: PostStatus = PostStatus.active


class PostUpdate(BaseModel):
    title: str | None = None
    fb_url: str | None = None
    note: str | None = None
    status: PostStatus | MISSING = MISSING
    pricing: Pricing | None = None  # null clears: the post follows the user's default


class PostRead(PostBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    pricing: dict | None
    created_at: datetime
    updated_at: datetime


class PostReadWithStats(PostRead):
    """Same as PostRead with counts computed at list time."""
    listing_count: int = 0
    active_listing_count: int = 0
    total_qty: int = 0
    total_value_myr: str = "0.00"
    # Buyers with claims on the post, and how many of them still have to pay.
    buyer_count: int = 0
    unpaid_buyer_count: int = 0
    # RM from the post's claims that buyers have paid.
    paid_myr: str = "0.00"
