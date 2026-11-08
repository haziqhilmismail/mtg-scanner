"""An API call records when the user was last seen, at most once an hour."""

from datetime import datetime, timedelta, timezone

from conftest import run, sign_in

from app.db import async_session_factory
from app.models import User

EDITED = datetime(2026, 1, 1, 8, 0)


async def _seen(user_id):
    async with async_session_factory() as s:
        u = await s.get(User, user_id)
        return u.last_seen_at, u.updated_at


def _set_seen(user_id, when):
    async def go():
        async with async_session_factory() as s:
            u = await s.get(User, user_id)
            u.last_seen_at, u.updated_at = when, EDITED
            await s.commit()
    run(go())


def test_last_seen(client):
    uid, auth = sign_in()
    _set_seen(uid, None)
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    assert client.get("/api/auth/me", headers=auth).status_code == 200
    seen, updated = run(_seen(uid))
    assert abs(seen - now) < timedelta(minutes=1)
    assert updated == EDITED  # being seen is not an edit of the account

    _set_seen(uid, datetime(2026, 1, 1, 9, 30))
    client.get("/api/auth/me", headers=auth)
    assert abs(run(_seen(uid))[0] - now) < timedelta(minutes=1)

    recent = now.replace(microsecond=0)
    _set_seen(uid, recent)
    client.get("/api/auth/me", headers=auth)
    assert run(_seen(uid))[0] == recent
