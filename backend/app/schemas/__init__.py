"""Pydantic schemas — the wire format for API requests/responses.

PATCH bodies (*Update): a field left out keeps its value. A field typed
`X | MISSING` can't be cleared, so an explicit null is a 422, not a DB error."""

from .bug import BugReportCreate
from .buyer import BuyerCreate, BuyerRead, BuyerReadWithStats, BuyerUpdate
from .listing import (
    BulkImportLine,
    BulkImportPayload,
    BulkImportResult,
    ListingCreate,
    ListingRead,
    ListingReadWithAvailability,
    ListingUpdate,
)
from .order import (
    OrderCreate,
    OrderItemCreate,
    OrderItemRead,
    OrderRead,
    OrderUpdate,
)
from .post import PostCreate, PostRead, PostReadWithStats, PostUpdate

__all__ = [
    "BugReportCreate",
    "BuyerCreate", "BuyerRead", "BuyerReadWithStats", "BuyerUpdate",
    "BulkImportLine", "BulkImportPayload", "BulkImportResult",
    "ListingCreate", "ListingRead", "ListingReadWithAvailability", "ListingUpdate",
    "OrderCreate", "OrderRead", "OrderUpdate",
    "OrderItemCreate", "OrderItemRead",
    "PostCreate", "PostRead", "PostReadWithStats", "PostUpdate",
]
