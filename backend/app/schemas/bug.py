from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class BugReportCreate(BaseModel):
    """Frontend → POST /api/bug. Only `message` is required; everything else
    is best-effort context the reporter wants to include if available."""

    message: str = Field(min_length=1, max_length=2000)
    exception_type: str = Field(default="Error", max_length=128)
    stack: str | None = Field(default=None, max_length=20_000)
    route: str | None = Field(default=None, max_length=512)


class BugEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int | None
    source: str
    fingerprint: str
    route: str | None
    method: str | None
    status_code: int | None
    exception_type: str
    message: str
    stack: str | None
    user_agent: str | None
    created_at: datetime
