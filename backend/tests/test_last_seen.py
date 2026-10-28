"""An API call records when the user was last seen, at most once an hour."""

from datetime import datetime, timezone

from conftest import _dispose_then, new_user, run

from app.db import async_session_factory, engine
from app.models import User
from app.services.auth_service import issue_session_token


async def _seen(user_id):
    async with async_session_factory() as s:
        u = await s.get(User, user_id)
        return u.last_seen_at, u.updated_at


def _set_seen(user_id, when):
    async def go():
        async with async_session_factory() as s:
            (await s.get(User, user_id)).last_seen_at = when
            await s.commit()
    run(_dispose_then(go()))


def test_last_seen(client):
    uid = run(_dispose_then(new_user()))
    auth = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    _, updated = run(_dispose_then(_seen(uid)))

    assert client.get("/api/auth/me", headers=auth).status_code == 200
    seen, after = run(_dispose_then(_seen(uid)))
    assert seen is not None and after == updated

    _set_seen(uid, datetime(2026, 1, 1, 9, 30))
    client.get("/api/auth/me", headers=auth)
    assert run(_dispose_then(_seen(uid)))[0] > datetime(2026, 1, 1, 9, 30)

    recent = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    _set_seen(uid, recent)
    client.get("/api/auth/me", headers=auth)
    assert run(_dispose_then(_seen(uid)))[0] == recent
    run(engine.dispose())
