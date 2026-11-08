from datetime import datetime
from typing import Annotated

from pydantic import MISSING, BaseModel, BeforeValidator, ConfigDict

from ..models.post import PostStatus
from .types import Pricing


# A post's free text is stored stripped, and blank text as NULL.
Text = Annotated[str | None, BeforeValidator(lambda v: (v.strip() or None) if isinstance(v, str) else v)]


class PostBase(BaseModel):
    title: Text = None
    fb_url: Text = None
    note: Text = None
    status: PostStatus = PostStatus.active


class PostUpdate(BaseModel):
    title: Text = None
    fb_url: Text = None
    note: Text = None
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
