"""Scan credits: the free rolling allowance, vouchers, and /api/scan's use of them.

Run with:  python -m pytest tests
"""

import asyncio
from datetime import timedelta

import pytest
from conftest import LIMIT, _dispose_then, _scan, new_user, run
from sqlalchemy import func, select

import app.main as main
from app.db import async_session_factory, engine
from app.models import ScanCreditEvent, User, Voucher
from app.services import credits
from app.services.auth_service import issue_session_token


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


def test_spend_refunds_when_the_block_fails_or_is_cancelled():
    async def go():
        uid = await new_user()
        async with async_session_factory() as s:
            with pytest.raises(RuntimeError):
                async with credits.spend(s, uid):
                    raise RuntimeError("gemini is down")

            async def slow_call():
                async with credits.spend(s, uid):
                    await asyncio.sleep(10)
            task = asyncio.create_task(slow_call())
            await asyncio.sleep(0.2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            await asyncio.sleep(0.2)       # the shielded refund finishes
            assert (await get_status(uid))["remaining"] == LIMIT

            for _ in range(LIMIT):
                await credits.reserve(uid)
            with pytest.raises(credits.OutOfCredits) as e:
                async with credits.spend(s, uid):
                    pytest.fail("ran without a credit")
            assert e.value.credits["remaining"] == 0
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

        # Already unlimited for good: a timed voucher leaves that alone.
        await redeem(uid, await make_voucher(unlimited=True))
        await redeem(uid, await make_voucher(unlimited=True, unlimited_days=30, credits=2))
        st = await get_status(uid)
        assert st["unlimited"] is True and st["bonus"] == 2
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


def test_owner_testing_pair_toggles_between_unlimited_and_a_fresh_limit():
    async def go():
        me, other = await new_user(), await new_user()
        on = await make_voucher(unlimited=True, reusable=True, only_user_id=me)
        off = await make_voucher(resets=True, reusable=True, only_user_id=me)

        for _ in range(4):                       # leave some usage and extras behind
            await credits.reserve(me)
        await redeem(me, await make_voucher(credits=7))

        for _ in range(2):                       # both codes work again and again
            await redeem(me, on)
            assert (await get_status(me))["unlimited"] is True
            await redeem(me, off)
            st = await get_status(me)
            assert (st["unlimited"], st["used"], st["bonus"], st["remaining"]) == (False, 0, 0, LIMIT)
            got = [await credits.reserve(me) for _ in range(LIMIT + 1)]
            assert got == [credits.FREE] * LIMIT + [None]

        # Bound to one account: to anyone else the codes don't exist.
        for code in (on, off):
            with pytest.raises(credits.VoucherError) as e:
                await redeem(other, code)
            assert e.value.code == "invalid"
        assert (await get_status(other))["unlimited"] is False
    run(_dispose_then(go()))


# ---------- /api/scan ----------

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
    status = client.get("/api/credits", headers=headers).json()
    assert refused.json() == {"detail": {"code": "out_of_credits", "credits": status}}
    assert status["remaining"] == 0
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


def test_rate_limits_are_per_user_and_bad_refresh_tokens_do_not_count(client, monkeypatch):
    monkeypatch.setattr(main.limiter, "enabled", True)
    a, b = run(_dispose_then(new_user())), run(_dispose_then(new_user()))
    run(engine.dispose())
    redeem_as = lambda uid: client.post("/api/vouchers/redeem", json={"code": "MTG-XXXX-XXXX-XXXX"},
                                        headers={"Authorization": f"Bearer {issue_session_token(uid)}"})
    assert [redeem_as(a).status_code for _ in range(11)] == [400] * 10 + [429]
    assert redeem_as(b).status_code == 400          # a's guesses don't lock b out

    monkeypatch.setattr(main.settings, "refresh_ck_token", "right")
    for _ in range(5):
        assert client.post("/api/refresh-ck", headers={"X-Refresh-Token": "wrong"}).status_code == 403

    # Scryfall lookups need a login now.
    assert client.post("/api/relookup", data={"payload": '{"name": "Sol Ring"}'}).status_code == 401
    assert client.post("/api/printings", data={"payload": '{"name": "Sol Ring"}'}).status_code == 401
