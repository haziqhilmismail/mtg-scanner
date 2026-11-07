"""Pydantic schemas — the wire format for API requests/responses.

PATCH bodies (*Update): a field left out keeps its value. A field typed
`X | MISSING` can't be cleared, so an explicit null is a 422, not a DB error."""

from .bug import BugReportCreate
from .buyer import BuyerRead, BuyerReadWithStats, BuyerUpdate
from .listing import (
    ListingCreate,
    ListingRead,
    ListingReadWithAvailability,
    ListingUpdate,
)
from .order import (
    OrderItemRead,
    OrderRead,
    OrderUpdate,
)
from .post import PostRead, PostReadWithStats, PostUpdate

__all__ = [
    "BugReportCreate",
    "BuyerRead", "BuyerReadWithStats", "BuyerUpdate",
    "ListingCreate", "ListingRead", "ListingReadWithAvailability", "ListingUpdate",
    "OrderRead", "OrderUpdate", "OrderItemRead",
    "PostRead", "PostReadWithStats", "PostUpdate",
]
