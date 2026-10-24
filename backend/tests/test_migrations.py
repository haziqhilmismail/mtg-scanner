"""Migrations upgrade and downgrade a populated database in place."""

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


def test_scans_keep_their_ids_and_stop_reusing_them(tmp_path, monkeypatch):
    db = tmp_path / "app.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db}")
    cfg = Config(str(main.BASE_DIR.parent / "alembic.ini"))
    sql = lambda q: sqlite3.connect(db).execute(q).fetchall()
    scans_sql = lambda: sql("select sql from sqlite_master where name = 'scans'")[0][0]

    command.upgrade(cfg, "d4a9e2f7c1b3")
    with sqlite3.connect(db) as c:
        c.execute("insert into users (id, email, default_currency, default_mult_normal, default_mult_foil, created_at, updated_at)"
                  " values (1, 'a@b.c', 'RM', 2.8, 3.0, '2026-01-01', '2026-01-01')")
        for sid in (2, 5, 9):
            c.execute("insert into scans (id, user_id, filename, width, height, gemini_raw, ui_state, created_at, updated_at)"
                      " values (?, 1, 'a.jpg', 400, 300, '{\"cards\": []}', '{\"rev\": 3}', '2026-01-01', '2026-01-01')", (sid,))
        c.execute("insert into listings (user_id, scan_id, name, is_foil, unit_price_myr, qty_total, status, created_at, updated_at)"
                  " values (1, 9, 'Sol Ring', 0, 5, 1, 'active', '2026-01-01', '2026-01-01')")
    assert "AUTOINCREMENT" not in scans_sql()

    command.upgrade(cfg, "a7e3c9d1f5b2")
    assert sql("select id, user_id, filename, gemini_raw, ui_state from scans order by id") == [
        (i, 1, "a.jpg", '{"cards": []}', '{"rev": 3}') for i in (2, 5, 9)]
    assert sql("select scan_id from listings") == [(9,)]
    assert "AUTOINCREMENT" in scans_sql()
    assert sql("select name from sqlite_master where type = 'index' and tbl_name = 'scans' order by name") == [
        ("ix_scans_post_id",), ("ix_scans_user_id",)]

    with sqlite3.connect(db) as c:
        c.execute("delete from scans where id = 9")
        c.execute("insert into scans (user_id, filename, width, height, created_at, updated_at)"
                  " values (1, 'b.jpg', 400, 300, '2026-01-02', '2026-01-02')")
    assert sql("select max(id) from scans") == [(10,)]

    command.downgrade(cfg, "d4a9e2f7c1b3")
    assert sql("select id from scans order by id") == [(2,), (5,), (10,)]
    assert "AUTOINCREMENT" not in scans_sql()
