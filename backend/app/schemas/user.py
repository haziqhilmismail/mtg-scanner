from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr


class UserBase(BaseModel):
    email: EmailStr
    fb_name: str | None = None
    bank_name: str | None = None
    bank_account_number: str | None = None
    bank_account_holder: str | None = None
    qr_image_path: str | None = None
    default_currency: str = "RM"
    default_mult_normal: float = 2.8
    default_mult_foil: float = 3.0


class UserUpdate(BaseModel):
    """All fields optional — PATCH-style partial update."""
    fb_name: str | None = None
    bank_name: str | None = None
    bank_account_number: str | None = None
    bank_account_holder: str | None = None
    qr_image_path: str | None = None
    default_currency: str | None = None
    default_mult_normal: float | None = None
    default_mult_foil: float | None = None


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime
