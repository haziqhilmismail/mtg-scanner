from pydantic import BaseModel, Field


class BugReportCreate(BaseModel):
    """Frontend → POST /api/bug. Only `message` is required; everything else
    is best-effort context the reporter wants to include if available."""

    message: str = Field(min_length=1, max_length=2000)
    exception_type: str = Field(default="Error", max_length=128)
    stack: str | None = Field(default=None, max_length=20_000)
    route: str | None = Field(default=None, max_length=512)

