"""Runtime settings loaded from env / .env."""

import json
from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parent.parent  # mtg-scanner/backend
DATA_DIR = BACKEND_ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Gemini
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    # Database — SQLite by default, swap to a postgres URL when going multi-user
    database_url: str = f"sqlite+aiosqlite:///{DATA_DIR / 'app.db'}"

    # Solo-mode owner: when google_client_id is empty every API call is attributed
    # to this user_id (no login required). Once google_client_id is set, the
    # first Google sign-in claims this row and subsequent logins come from JWT.
    solo_user_id: int = 1

    # Google sign-in. Empty = solo mode (no auth). Set to a Web OAuth client ID
    # to require Google login on every API call.
    google_client_id: str = ""

    # Comma-separated allowlist. Empty = anyone with a Google account can sign in.
    allowed_emails: str = ""

    # Symmetric secret for our own session JWTs. Auto-generated on first run if blank.
    jwt_secret: str = ""

    # CORS — frontend dev server + same-origin. In production, append the
    # Vercel URL via env: CORS_ORIGINS="https://my-app.vercel.app,http://..."
    # NoDecode disables pydantic-settings' JSON pre-parser so the validator
    # below can accept both comma-separated and JSON-array forms.
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://localhost:8000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8000",
    ]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, v):
        if isinstance(v, str):
            s = v.strip()
            if s.startswith("["):
                return json.loads(s)
            return [item.strip() for item in s.split(",") if item.strip()]
        return v

    @property
    def auth_enabled(self) -> bool:
        return bool(self.google_client_id)

    @property
    def allowed_emails_set(self) -> set[str]:
        return {e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()}


settings = Settings()
