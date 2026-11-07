"""Test environment. pytest imports this before any test module, which matters
because the app reads its settings at import time. It also holds what the
test modules share: the schema, the `client` fixture and a few helpers."""

import os
import tempfile

# A throwaway data folder (database and uploads), and Google auth switched
# on (credits are only enforced when it is).
os.environ.update(
    DATA_DIR=tempfile.mkdtemp(),
    GOOGLE_CLIENT_ID="test-client-id",
    JWT_SECRET="test-secret",
    GEMINI_API_KEY="x",
    TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="",
    USE_CLASSICAL_BBOX="false",
    # The tests stub the Gemini call; the local scanner needs model files.
    SCANNER_BACKEND="gemini",
    FREE_SCANS_PER_WINDOW="10",  # small, so the out-of-credits tests stay fast
)

import asyncio  # noqa: E402
from io import BytesIO  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

import app.main as main  # noqa: E402
from app.db import async_session_factory  # noqa: E402
from app.models import User  # noqa: E402
from app.schemas.scan import Detection, Guess  # noqa: E402
from app.services import catalogue, scans  # noqa: E402
from app.services.cardkingdom_prices import CKPrice  # noqa: E402
from app.services.auth_service import issue_session_token  # noqa: E402

LIMIT = 10
_emails = iter(f"user{i}@example.com" for i in range(1000))


# Each run() and each TestClient has its own event loop, and a pooled
# connection must not outlive the loop that opened it. NullPool keeps none.
async_session_factory.configure(bind=create_async_engine(main.settings.database_url, poolclass=NullPool))


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(scope="session", autouse=True)
def schema():
    # Build the schema the way production does, so the migration is tested too.
    from alembic import command
    from alembic.config import Config
    command.upgrade(Config(str(main.BASE_DIR.parent / "alembic.ini")), "head")
    main.settings.make_data_dirs()


async def new_user() -> int:
    async with async_session_factory() as s:
        u = User(email=next(_emails))
        s.add(u)
        await s.commit()
        return u.id


def sign_in() -> tuple[int, dict]:
    """A fresh signed-in user: their id and the headers that carry their session."""
    uid = run(new_user())
    return uid, {"Authorization": f"Bearer {issue_session_token(uid)}"}


def _photo() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (400, 300), (230, 230, 225)).save(buf, format="JPEG")
    return buf.getvalue()


class _FakeCK:
    matched_scryfall_count, fetched_at = 1, None

    def price(self, sid, foil):
        return CKPrice(retail=2.0 if foil else 1.0)


def sol_ring(**over) -> Detection:
    """A Gemini-style detection of Sol Ring, boxed in the 400x300 test photo."""
    return Detection(**{
        "guess": Guess(name="Sol Ring", set_code="cmm", collector_number="1"),
        "bbox": (40, 30, 120, 120), "corners": [[40, 30], [160, 30], [160, 150], [40, 150]],
        "bbox_source": "gemini", "name_source": "gemini", **over,
    })


class FakeScanner:
    """Stands in for the scanner behind /api/scan (`client.scanner`). A test
    sets `cards`, `fail` or `costs_credit`; `calls` counts the scans run."""
    model = "fake"

    def __init__(self):
        self.calls, self.fail, self.costs_credit = 0, False, True
        self.cards = [sol_ring()]

    def load(self):
        pass

    def ready(self):
        return None

    async def detect(self, pil, jpeg):
        self.calls += 1
        if self.fail:
            raise RuntimeError("gemini is down")
        return self.cards


@pytest.fixture()
def client(monkeypatch):
    async def fake_lookup(guesses):
        # Scryfall knows every named card; a nameless guess gets the "no match" candidate.
        return [{"scryfall_id": "abc", "name": g.name, "set": g.set_code} if g.name else None for g in guesses]

    async def fake_ck():
        return _FakeCK()

    scanner = FakeScanner()
    monkeypatch.setattr(scans, "scanner", scanner)
    monkeypatch.setattr(catalogue, "scryfall_cards", fake_lookup)
    monkeypatch.setattr(catalogue, "ck_index", fake_ck)
    monkeypatch.setattr(main.limiter, "enabled", False)
    with TestClient(main.app) as c:
        c.scanner = scanner
        yield c


def _scan(client, token):
    return client.post("/api/scan", files={"image": ("a.jpg", _photo(), "image/jpeg")},
                       headers={"Authorization": f"Bearer {token}"})


