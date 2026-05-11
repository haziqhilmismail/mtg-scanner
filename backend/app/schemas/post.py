from datetime import datetime

from pydantic import BaseModel, ConfigDict

from ..models.post import PostStatus


class PostBase(BaseModel):
    title: str | None = None
    fb_url: str | None = None
    note: str | None = None
    status: PostStatus = PostStatus.active


class PostCreate(PostBase):
    pass


class PostUpdate(BaseModel):
    title: str | None = None
    fb_url: str | None = None
    note: str | None = None
    status: PostStatus | None = None


class PostRead(PostBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    image_path: str | None
    image_mime: str | None
    created_at: datetime
    updated_at: datetime


class PostReadWithStats(PostRead):
    """Same as PostRead with counts computed at list time."""
    listing_count: int = 0
    active_listing_count: int = 0
    total_qty: int = 0
    total_value_myr: str = "0.00"
    has_image: bool = False
