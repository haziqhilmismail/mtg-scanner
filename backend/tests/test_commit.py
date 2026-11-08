"""A write that fails when the session commits answers an error, not a 2xx."""

from fastapi.testclient import TestClient
from sqlalchemy import text

from conftest import main, run, sign_in

from app.db import async_session_factory
from app.models import User


async def _sql(stmt):
    async with async_session_factory() as s:
        await s.execute(text(stmt))
        await s.commit()


async def _seller_name(uid):
    async with async_session_factory() as s:
        return (await s.get(User, uid)).fb_name


def test_failed_commit_is_a_500(client):
    uid, auth = sign_in()
    # The route only sets the attribute, so its UPDATE first runs at commit.
    run(_sql("CREATE TRIGGER fail_commit BEFORE UPDATE OF fb_name ON users "
             "WHEN NEW.fb_name = 'boom' BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END"))
    try:
        quiet = TestClient(main.app, raise_server_exceptions=False)
        r = quiet.put("/api/auth/me/seller-name", headers=auth, json={"seller_name": "boom"})
    finally:
        run(_sql("DROP TRIGGER fail_commit"))
    assert r.status_code == 500
    assert run(_seller_name(uid)) is None
