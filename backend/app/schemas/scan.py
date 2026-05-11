from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class ScanRead(BaseModel):
    """Minimal view of a stored scan. The full Gemini response is included
    so the frontend can rebuild the review UI from a saved scan."""

    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    filename: str
    image_path: str | None
    width: int
    height: int
    gemini_raw: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime
