"""Runtime settings loaded from env / .env."""

import json
from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parent.parent  # mtg-scanner/backend
DATA_DIR = BACKEND_ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)
# Each scan's photo, as <scan id>.bin.
SCANS_DIR = DATA_DIR / "scans"
SCANS_DIR.mkdir(exist_ok=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Which pipeline /api/scan runs:
    #   "gemini" — cloud model locates + names the cards (classical bbox
    #              assist as configured below). The default: needs only a key.
    #   "local"  — fully offline, and what production runs: YOLO-OBB
    #              detector → DINOv3 embedding retrieval → collector-line OCR
    #              for version + foil. See services/card_scanner.py. Needs the
    #              three files below.
    scanner_backend: str = "gemini"
    # Local scanner files. Not in the repo or the image — they live in data/.
    # README "Local scanner" covers how to produce them.
    detector_model_path: str = str(DATA_DIR / "models" / "card_detector.onnx")
    embedder_model_path: str = str(DATA_DIR / "models" / "card_embedder.onnx")
    card_index_path: str = str(DATA_DIR / "card_index.npz")

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

    corrections_dir: Path = DATA_DIR / "corrections"

    # Database — SQLite, one file in data/
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

    # Free credits each signed-in user gets in any rolling 30-day window. One
    # credit pays for one Gemini call: a claims parse, or a photo scan when the
    # Gemini scanner is on (local scans are free). Solo mode (no Google auth)
    # is never limited. See services/credits.py.
    free_scans_per_window: int = 50

    # Shared secret guarding POST /api/refresh-ck. Empty = endpoint stays open
    # (back-compat). When set, callers must send a matching `X-Refresh-Token`
    # header — the scheduled GitHub Action passes it from a repo secret so
    # nobody who finds the public API URL can trigger 50 MB CK rebuilds.
    refresh_ck_token: str = ""

    # CORS — frontend dev server + same-origin. In production, add the site's
    # own domain via env, since it calls the API cross-origin:
    #   CORS_ORIGINS="https://mtg.haziqhilmi.com"
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
    def use_local_scanner(self) -> bool:
        return self.scanner_backend.strip().lower() == "local"

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
