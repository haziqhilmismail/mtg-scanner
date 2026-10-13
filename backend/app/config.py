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
    gemini_model: str = "gemini-3-flash-preview"
    # Gemini 3 Flash bills "thinking" tokens at the output rate ($3/M), and for
    # straightforward structured detection the model thinks more than it needs
    # to. Empirically observed ~2,700 output tokens/scan vs ~700 of actual
    # response = ~2,000 thinking tokens billable. Cap it. Set to 0 to disable
    # thinking entirely; higher values trade more $ for more reasoning headroom
    # on hard cards (foreign printings, foil glare, weird frames). Tune with
    # the [gemini-usage] log lines in /api/scan output.
    gemini_thinking_budget: int = 512

    # Optional classical (PIL + numpy + scipy) bbox refiner. When enabled,
    # /api/scan still asks Gemini for names+sets, but tightens each card's
    # bbox using the classical detector if it confidently locates the card.
    # Falls back to Gemini's bbox on noisy photos.
    use_classical_bbox: bool = True

    # Optional offline card identification via perceptual hashing. When enabled
    # and the pHash index has been built (scripts/build_phash_index.py →
    # data/phash_index.npz), /api/scan hashes each cropped card and tries to
    # name it locally. Confident matches (distance ≤ phash_distance_threshold)
    # skip the Gemini call entirely; unconfident crops still need Gemini.
    use_local_card_id: bool = False
    phash_index_path: str = str(DATA_DIR / "phash_index.npz")
    # Out of 64 bits. Distances much above ~10 land in the noise floor for a
    # 48k-entry index (random cards happen to be that close), so we keep the
    # absolute cap conservative AND require a margin to top-2 (below).
    phash_distance_threshold: int = 12
    # Top-1 must beat top-2 by at least this many bits to count as confident.
    # Filters out tied / cluster-of-similar matches that would otherwise
    # produce false-positive names.
    phash_distance_margin: int = 3

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

    # Free photo scans each signed-in user gets in any rolling 30-day window.
    # Solo mode (no Google auth) is never limited. See services/credits.py.
    free_scans_per_window: int = 10

    # Shared secret guarding POST /api/refresh-ck. Empty = endpoint stays open
    # (back-compat). When set, callers must send a matching `X-Refresh-Token`
    # header — the scheduled GitHub Action passes it from a repo secret so the
    # public Funnel URL can't be used by anyone to trigger 50 MB CK rebuilds.
    refresh_ck_token: str = ""

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

    # Bug reporter → Telegram. Both blank = capture to DB only, skip the push.
    # Get a token from @BotFather, DM the bot once, then visit
    #   https://api.telegram.org/bot<TOKEN>/getUpdates
    # to read off your chat_id.
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    # Identical bug fingerprints within this window only notify once. DB rows
    # are still written every time so the audit log stays complete; only the
    # Telegram push is throttled.
    bug_notify_window_minutes: int = 10

    @property
    def auth_enabled(self) -> bool:
        return bool(self.google_client_id)

    @property
    def telegram_enabled(self) -> bool:
        return bool(self.telegram_bot_token and self.telegram_chat_id)

    @property
    def allowed_emails_set(self) -> set[str]:
        return {e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()}


settings = Settings()
