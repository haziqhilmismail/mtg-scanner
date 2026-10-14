from datetime import datetime
from decimal import Decimal

from pydantic import MISSING, BaseModel, ConfigDict, Field

from ..models.listing import ListingStatus


class ListingBase(BaseModel):
    name: str
    scryfall_id: str | None = None
    set_code: str | None = None
    set_name: str | None = None
    collector_number: str | None = None
    rarity: str | None = None
    is_foil: bool = False
    image_url: str | None = None
    ck_url: str | None = None
    unit_price_myr: Decimal = Field(..., ge=0, decimal_places=2)
    qty_total: int = Field(1, ge=1)
    notes: str | None = None


class ListingCreate(ListingBase):
    """Used by both manual creation and scan-derived creation.
    `scan_id` and `bbox` are optional and only set when listing comes from a scan.
    `post_ids` ties the listing to N Facebook post groups (often just one)."""
    scan_id: int | None = None
    post_ids: list[int] = Field(default_factory=list)
    bbox: list[int] | None = None  # [x, y, w, h]
    status: ListingStatus = ListingStatus.active


class ListingUpdate(BaseModel):
    """PATCH-style partial update. When `post_ids` is provided we replace the
    full set of linked posts — pass [] to unlink from every post."""
    name: str | MISSING = MISSING
    set_code: str | None = None
    set_name: str | None = None
    collector_number: str | None = None
    rarity: str | None = None
    is_foil: bool | MISSING = MISSING
    image_url: str | None = None
    ck_url: str | None = None
    unit_price_myr: Decimal | MISSING = Field(MISSING, ge=0, decimal_places=2)
    qty_total: int | MISSING = Field(MISSING, ge=1)
    status: ListingStatus | MISSING = MISSING
    post_ids: list[int] | None = None
    notes: str | None = None


class ListingRead(ListingBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    scan_id: int | None
    post_ids: list[int] = Field(default_factory=list)
    bbox: list[int] | None
    status: ListingStatus
    created_at: datetime
    updated_at: datetime


class BulkImportLine(BaseModel):
    """Result of parsing one Moxfield-style line."""
    raw: str
    ok: bool
    error: str | None = None
    listing_id: int | None = None
    name: str | None = None
    set_code: str | None = None
    collector_number: str | None = None
    is_foil: bool = False
    qty: int = 1
    unit_price_myr: str | None = None
    image_url: str | None = None


class BulkImportPayload(BaseModel):
    """Moxfield-style text dump. Each non-empty line is parsed, looked up on
    Scryfall, priced via the user's default multiplier, and saved as a listing."""
    text: str
    post_id: int | None = None
    apply_foil_to_all: bool = False


class BulkImportResult(BaseModel):
    created: int
    skipped: int
    lines: list[BulkImportLine]


class ListingReadWithAvailability(ListingRead):
    """Same as ListingRead but with computed qty fields. Use for list views
    that need to show how much stock remains."""
    qty_committed: int = 0
    qty_available: int = 0
