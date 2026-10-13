"""Test environment. pytest imports this before any test module, which matters
because the app reads its settings at import time."""

import os
import tempfile

# A throwaway database, and Google auth switched on (credits are only
# enforced when it is).
os.environ.update(
    DATABASE_URL=f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db",
    GOOGLE_CLIENT_ID="test-client-id",
    JWT_SECRET="test-secret",
    GEMINI_API_KEY="x",
    TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="",
    USE_CLASSICAL_BBOX="false", USE_LOCAL_CARD_ID="false",
)
