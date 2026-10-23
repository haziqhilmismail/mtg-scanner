"""The pricing migration upgrades and downgrades a populated database in place."""

import sqlite3

from alembic import command
from alembic.config import Config

import app.main as main
from app.config import settings


def test_pricing_migration_keeps_the_data(tmp_path, monkeypatch):
    db = tmp_path / "app.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db}")
    cfg = Config(str(main.BASE_DIR.parent / "alembic.ini"))
    sql = lambda q: sqlite3.connect(db).execute(q).fetchall()
    cols = lambda t: [r[1] for r in sql(f"pragma table_info({t})")]

    command.upgrade(cfg, "e5b8a2d71c39")
    with sqlite3.connect(db) as c:
        c.execute("insert into users (id, email, default_currency, default_mult_normal, default_mult_foil, created_at, updated_at)"
                  " values (1, 'a@b.c', 'RM', 2.8, 3.0, '2026-01-01', '2026-01-01')")
        c.execute("insert into posts (id, user_id, title, status, created_at, updated_at)"
                  " values (7, 1, 'Friday', 'active', '2026-01-01', '2026-01-01')")

    command.upgrade(cfg, "f3c7a1d9b8e2")
    assert sql("select title, pricing from posts") == [("Friday", None)]
    assert sql("select email, pricing from users") == [("a@b.c", None)]
    with sqlite3.connect(db) as c:
        c.execute("""update posts set pricing = '{"multNormal": 3}'""")

    command.downgrade(cfg, "e5b8a2d71c39")
    assert "pricing" not in cols("posts") and "pricing" not in cols("users")
    assert sql("select id, user_id, title from posts") == [(7, 1, "Friday")]
    assert sql("select id, email from users") == [(1, "a@b.c")]
