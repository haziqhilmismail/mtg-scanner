"""Scan credits: the free rolling allowance, vouchers, and /api/scan's use of them.

Run with:  python -m pytest tests
"""

import asyncio
import os
import tempfile
from datetime import timedelta
from io import BytesIO

# Settings are read at import time, so point them at a throwaway database and
# switch Google auth on (credits are only enforced when auth is) first.
os.environ.update(
    DATABASE_URL=f"sqlite+aiosqlite:///{tempfile.mkdtemp()}/test.db",
    GOOGLE_CLIENT_ID="test-client-id",
    JWT_SECRET="test-secret",
    GEMINI_API_KEY="x",
    TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="",
    USE_CLASSICAL_BBOX="false", USE_LOCAL_CARD_ID="false",
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

import app.main as main  # noqa: E402
from app.db import async_session_factory, engine  # noqa: E402
from app.models import ScanCreditEvent, User, Voucher  # noqa: E402
from app.services import credits  # noqa: E402
from app.services.auth_service import issue_session_token  # noqa: E402
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


async def make_voucher(**kw) -> str:
    code = credits.new_code()
    async with async_session_factory() as s:
        s.add(Voucher(code=credits.normalise_code(code), created_at=credits._now(), **kw))
        await s.commit()
    return code


async def redeem(user_id: int, code: str):
    async with async_session_factory() as s:
        v = await credits.redeem(s, user_id, code)
        await s.commit()
        return v


async def get_status(user_id: int) -> dict:
    async with async_session_factory() as s:
        return await credits.status(s, user_id)


async def add_events(user_id: int, days_ago: float, n: int):
    async with async_session_factory() as s:
        when = credits._now() - timedelta(days=days_ago)
        s.add_all(ScanCreditEvent(user_id=user_id, created_at=when) for _ in range(n))
        await s.commit()


def test_free_allowance_stops_at_the_limit():
    async def go():
        uid = await new_user()
        got = [await credits.reserve(uid) for _ in range(LIMIT + 2)]
        assert got == [credits.FREE] * LIMIT + [None, None]
        st = await get_status(uid)
        assert (st["used"], st["remaining"], st["unlimited"]) == (LIMIT, 0, False)
    run(_dispose_then(go()))


def test_parallel_scans_cannot_overshoot():
    async def go():
        uid = await new_user()
        got = await asyncio.gather(*(credits.reserve(uid) for _ in range(LIMIT + 8)))
        assert got.count(credits.FREE) == LIMIT and got.count(None) == 8
    run(_dispose_then(go()))


def test_refund_gives_the_credit_back():
    async def go():
        uid = await new_user()
        for _ in range(LIMIT):
            await credits.reserve(uid)
        assert await credits.reserve(uid) is None
        await credits.refund(uid, credits.FREE)
        assert (await get_status(uid))["remaining"] == 1
        assert await credits.reserve(uid) == credits.FREE
    run(_dispose_then(go()))


def test_window_rolls_after_30_days():
    async def go():
        uid = await new_user()
        await add_events(uid, days_ago=31, n=LIMIT)     # all outside the window
        assert (await get_status(uid))["remaining"] == LIMIT
        await add_events(uid, days_ago=29, n=LIMIT)     # all inside it
        st = await get_status(uid)
        assert st["remaining"] == 0 and await credits.reserve(uid) is None
        # The first of those comes back in about a day.
        from datetime import datetime
        back = datetime.fromisoformat(st["next_free_at"].rstrip("Z")) - credits._now()
        assert timedelta(hours=23) < back < timedelta(hours=25)
    run(_dispose_then(go()))


def test_voucher_credits_are_used_after_the_free_ones():
    async def go():
        uid = await new_user()
        await redeem(uid, await make_voucher(credits=3))
        assert (await get_status(uid))["remaining"] == LIMIT + 3
        got = [await credits.reserve(uid) for _ in range(LIMIT + 4)]
        assert got == [credits.FREE] * LIMIT + [credits.BONUS] * 3 + [None]
        await credits.refund(uid, credits.BONUS)
        assert (await get_status(uid))["bonus"] == 1
    run(_dispose_then(go()))


def test_unlimited_voucher_switches_the_limit_off():
    async def go():
        uid = await new_user()
        await redeem(uid, await make_voucher(unlimited=True))
        got = [await credits.reserve(uid) for _ in range(LIMIT * 3)]
        assert set(got) == {credits.UNLIMITED}
        st = await get_status(uid)
        assert st["unlimited"] is True and st["remaining"] is None
        async with async_session_factory() as s:
            assert await s.scalar(select(func.count()).select_from(ScanCreditEvent).where(ScanCreditEvent.user_id == uid)) == 0
    run(_dispose_then(go()))


def test_timed_unlimited_vouchers_stack_and_lapse():
    async def go():
        uid = await new_user()
        await redeem(uid, await make_voucher(unlimited=True, unlimited_days=30))
        await redeem(uid, await make_voucher(unlimited=True, unlimited_days=30))
        async with async_session_factory() as s:
            u = await s.get(User, uid)
            left = u.unlimited_scans_until - credits._now()
            assert timedelta(days=59) < left < timedelta(days=61)
            u.unlimited_scans_until = credits._now() - timedelta(seconds=1)   # lapsed
            await s.commit()
        assert await credits.reserve(uid) == credits.FREE
    run(_dispose_then(go()))


def test_voucher_rejections():
    async def go():
        a, b = await new_user(), await new_user()

        async def reason(uid, code):
            with pytest.raises(credits.VoucherError) as e:
                await redeem(uid, code)
            return e.value.code

        assert await reason(a, "MTG-NOPE-NOPE-NOPE") == "invalid"
        assert await reason(a, await make_voucher(credits=5, expires_at=credits._now() - timedelta(days=1))) == "expired"

        single = await make_voucher(credits=5)                       # max_uses defaults to 1
        await redeem(a, single.lower().replace("-", " "))            # typed loosely: still matches
        assert await reason(a, single) == "already_redeemed"
        assert await reason(b, single) == "used_up"

        shared = await make_voucher(credits=5, max_uses=2)
        await redeem(a, shared)
        await redeem(b, shared)
        assert (await get_status(b))["bonus"] == 5
        assert (await get_status(a))["bonus"] == 10
    run(_dispose_then(go()))


# ---------- /api/scan ----------

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


def test_scan_spends_a_credit_and_refuses_when_out(client):
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    token = issue_session_token(uid)
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/api/credits", headers=headers).json()["remaining"] == LIMIT
    first = _scan(client, token)
    assert first.status_code == 200 and first.json()["credits"]["remaining"] == LIMIT - 1

    for _ in range(LIMIT - 1):
        assert _scan(client, token).status_code == 200
    gemini_calls = client.calls["gemini"]

    refused = _scan(client, token)
    assert refused.status_code == 402
    assert refused.json()["detail"]["code"] == "out_of_credits"
    assert refused.json()["detail"]["credits"]["remaining"] == 0
    assert client.calls["gemini"] == gemini_calls        # refused before any Gemini call

    # Deleting a scan does not hand the credit back.
    client.delete(f"/api/scans/{first.json()['scan_id']}", headers=headers)
    assert _scan(client, token).status_code == 402


def test_failed_scan_costs_nothing(client):
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    token = issue_session_token(uid)
    client.calls["fail"] = True
    assert _scan(client, token).status_code == 500
    bad = client.post("/api/scan", files={"image": ("a.jpg", b"not an image", "image/jpeg")},
                      headers={"Authorization": f"Bearer {token}"})
    assert bad.status_code == 400
    assert client.get("/api/credits", headers={"Authorization": f"Bearer {token}"}).json()["remaining"] == LIMIT


def test_redeem_endpoint(client):
    uid = run(_dispose_then(new_user()))
    code = run(_dispose_then(make_voucher(unlimited=True)))
    run(engine.dispose())
    headers = {"Authorization": f"Bearer {issue_session_token(uid)}"}

    wrong = client.post("/api/vouchers/redeem", json={"code": "MTG-XXXX-XXXX-XXXX"}, headers=headers)
    assert wrong.status_code == 400 and wrong.json()["detail"]["code"] == "invalid"

    ok = client.post("/api/vouchers/redeem", json={"code": code}, headers=headers)
    assert ok.status_code == 200 and ok.json()["credits"]["unlimited"] is True
    assert client.post("/api/vouchers/redeem", json={"code": code}, headers=headers).json()["detail"]["code"] == "already_redeemed"
    assert client.post("/api/vouchers/redeem", json={"code": code}).status_code == 401
