"""Test environment. pytest imports this before any test module, which matters
because the app reads its settings at import time. It also holds what the
test modules share: the schema, the `client` fixture and a few helpers."""

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
    USE_CLASSICAL_BBOX="false",
    # The tests stub the Gemini call; the local scanner needs model files.
    SCANNER_BACKEND="gemini",
)

import asyncio  # noqa: E402
from io import BytesIO  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

import app.main as main  # noqa: E402
from app.db import async_session_factory, engine  # noqa: E402
from app.models import User  # noqa: E402
from app.services.gemini_scanner import CardDetection  # noqa: E402

LIMIT = 10
_emails = iter(f"user{i}@example.com" for i in range(1000))


def run(coro):
    return asyncio.run(coro)


async def _dispose_then(coro):
    # Each asyncio.run() gets a new event loop; drop pooled connections that
    # belong to the previous one.
    await engine.dispose()
    return await coro


@pytest.fixture(scope="session", autouse=True)
def schema():
    # Build the schema the way production does, so the migration is tested too.
    from alembic import command
    from alembic.config import Config
    command.upgrade(Config(str(main.BASE_DIR.parent / "alembic.ini")), "head")
    run(engine.dispose())


async def new_user() -> int:
    async with async_session_factory() as s:
        u = User(email=next(_emails))
        s.add(u)
        await s.commit()
        return u.id


def _photo() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (400, 300), (230, 230, 225)).save(buf, format="JPEG")
    return buf.getvalue()


class _FakeCK:
    matched_scryfall_count = 1
    def lookup(self, sid):
        return {"retail_normal": 1.0, "retail_foil": 2.0, "buy_normal": None, "buy_foil": None,
                "in_stock_normal": True, "in_stock_foil": False, "url_normal": "", "url_foil": ""}


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
    run(engine.dispose())
    with TestClient(main.app) as c:
        c.calls = calls
        yield c
    run(engine.dispose())


def _scan(client, token):
    return client.post("/api/scan", files={"image": ("a.jpg", _photo(), "image/jpeg")},
                       headers={"Authorization": f"Bearer {token}"})


