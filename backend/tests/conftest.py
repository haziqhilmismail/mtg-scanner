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
from app.services.auth_service import issue_session_token  # noqa: E402
from app.services.gemini_scanner import CardDetection  # noqa: E402

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
    matched_scryfall_count = 1
    def lookup(self, sid):
        return {"retail_normal": 1.0, "retail_foil": 2.0, "buy_normal": None, "buy_foil": None,
                "url_normal": "", "url_foil": ""}


@pytest.fixture()
def client(monkeypatch):
    calls = {"gemini": 0, "fail": False}

    def fake_scan(image_bytes, *a, **k):
        calls["gemini"] += 1
        if calls["fail"]:
            raise RuntimeError("gemini is down")
        return [CardDetection(name="Sol Ring", set_code="cmm", collector_number="1",
                              is_foil=False, quantity=1, box_2d=[100, 100, 500, 400])]

    async def fake_lookup(dets):
        return [{"scryfall_id": "abc", "name": d.name, "set": d.set_code} for d in dets]

    async def fake_ck():
        return _FakeCK()

    monkeypatch.setattr(main, "scan_image", fake_scan)
    monkeypatch.setattr(main, "lookup_all", fake_lookup)
    monkeypatch.setattr(main, "get_ck_index", fake_ck)
    monkeypatch.setattr(main.limiter, "enabled", False)
    with TestClient(main.app) as c:
        c.calls = calls
        yield c


def _scan(client, token):
    return client.post("/api/scan", files={"image": ("a.jpg", _photo(), "image/jpeg")},
                       headers={"Authorization": f"Bearer {token}"})


