import asyncio
import os
import sqlite3
from io import BytesIO

import httpx
import pytest
from conftest import _dispose_then, new_user, run
from PIL import Image, ImageDraw
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

import app.main as main
from app.config import settings
from app.db import async_session_factory, engine
from app.models import Base, CardCorrection, Scan
from app.services import corrections
from app.services.accounts import delete_account
from app.services.auth_service import issue_session_token
from app.services.card_crop import CROP_QUALITY, CROP_VERSION, warp_quad

RED, GREY = (200, 30, 30), (90, 90, 90)
SOL, MANA, CRYPT = "729877be-4894-4ef5-9e60-de8a8fb2bdc0", "0b9c3a3e-6d3c-4d6e-8d57-2f1b0f8a5c11", "5e1f7c2a-9d44-4c0e-b0a4-7a3d6f2e8b90"


def _table_photo() -> bytes:
    img = Image.new("RGB", (800, 1000), GREY)
    ImageDraw.Draw(img).rectangle((100, 150, 400, 570), fill=RED)
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def _local_card(i=0, **over) -> dict:
    return {
        "id": i, "bbox": [100, 150, 301, 421], "corners": [[100, 150], [400, 150], [400, 570], [100, 570]],
        "crop_b64": "", "bbox_source": "detector", "name_source": "embedding", "name_confidence": 0.7,
        "version_source": "embedding", "foil_source": "default",
        "gemini": {"name": "Sol Ring", "set_code": "cmm", "collector_number": "1", "is_foil": False, "quantity": 1},
        "candidates": [{"scryfall_id": SOL, "name": "Sol Ring", "set": "CMM"}],
        **over,
    }


def _user():
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    return uid, {"Authorization": f"Bearer {issue_session_token(uid)}"}


def _upload(client, me, monkeypatch=None, cards=None):
    if cards is not None:
        async def fake_local(pil):
            return cards
        monkeypatch.setattr(main.settings, "scanner_backend", "local")
        monkeypatch.setattr(main.local_scan, "scan_cards", fake_local)
    r = client.post("/api/scan", files={"image": ("a.jpg", _table_photo(), "image/jpeg")}, headers=me)
    assert r.status_code == 200, r.text
    return r.json()["scan_id"]


def _answer(client, me, scan, card, sid, kind="pick"):
    return client.put(f"/api/scans/{scan}/cards/{card}/correction", headers=me, json={"scryfall_id": sid, "kind": kind})


async def _rows(**where) -> list[CardCorrection]:
    async with async_session_factory() as s:
        return list((await s.scalars(select(CardCorrection).filter_by(**where).order_by(CardCorrection.id))).all())


def rows(**where):
    return run(_dispose_then(_rows(**where)))


def files() -> set[str]:
    return set(os.listdir(settings.corrections_dir))


async def _photo_path(scan) -> str:
    async with async_session_factory() as s:
        return (await s.get(Scan, scan)).image_path


def test_a_pick_keeps_the_flattened_card_and_the_answer(client, monkeypatch):
    uid, me = _user()
    scan = _upload(client, me, monkeypatch, [_local_card()])
    before = files()

    r = client.put(f"/api/scans/{scan}/cards/0/correction", headers=me,
                   json={"scryfall_id": MANA, "kind": "pick", "guess_name": "Black Lotus", "name_confidence": 1.0})
    assert r.status_code == 200 and r.json() == {"kept": True}

    [row] = rows(scan_id=scan)
    assert (row.user_id, row.card_id, row.scryfall_id, row.kind, row.bbox_source, row.crop_version) == (
        uid, 0, MANA, "pick", "detector", CROP_VERSION)
    assert (row.guess_name, row.guess_set_code, row.guess_collector_number,
            row.name_source, row.version_source, row.name_confidence) == ("Sol Ring", "cmm", "1", "embedding", "embedding", 0.7)
    assert files() - before == {row.crop_file}
    crop = Image.open(settings.corrections_dir / row.crop_file)
    assert crop.format == "JPEG" and crop.size == (488, 680)
    for xy in ((244, 340), (10, 10), (477, 669)):
        assert max(abs(a - b) for a, b in zip(crop.getpixel(xy), RED)) < 30, xy
    again = BytesIO()
    warp_quad(Image.open(run(_dispose_then(_photo_path(scan)))).convert("RGB"), _local_card()["corners"]).save(
        again, format="JPEG", quality=CROP_QUALITY)
    assert (settings.corrections_dir / row.crop_file).read_bytes() == again.getvalue()


def test_looks_right_on_a_gemini_card_keeps_its_box(client):
    uid, me = _user()
    scan = _upload(client, me)
    card = client.get("/api/scans", headers=me).json()[0]["cards"][0]
    assert card["bbox_source"] == "gemini"

    assert _answer(client, me, scan, card["id"], SOL, "confirm").json() == {"kept": True}
    [row] = rows(scan_id=scan)
    assert (row.kind, row.bbox_source, row.scryfall_id) == ("confirm", "gemini", SOL)
    assert (row.guess_name, row.guess_set_code, row.guess_collector_number,
            row.name_source, row.version_source, row.name_confidence) == ("Sol Ring", "cmm", "1", "gemini", None, None)
    assert Image.open(settings.corrections_dir / row.crop_file).size == (card["bbox"][2], card["bbox"][3])


def test_cards_without_a_real_box_keep_nothing(client, monkeypatch):
    uid, me = _user()
    scan = _upload(client, me, monkeypatch, [_local_card()])
    framed = client.post(f"/api/scans/{scan}/frame-card", headers=me,
                         data={"payload": '{"corners": [[300, 400], [400, 400], [400, 540], [300, 540]], "skip_identify": true}'})
    assert framed.json()["bbox_source"] == "user"
    bad = _upload(client, me, monkeypatch, [_local_card(bbox_source="gemini", bbox=[0, 0, 800, 1000])])
    before = files()

    assert _answer(client, me, scan, framed.json()["id"], MANA).json() == {"kept": False}
    assert _answer(client, me, bad, 0, MANA).json() == {"kept": False}
    assert rows(user_id=uid) == []
    assert files() == before
    assert _answer(client, me, scan, 0, MANA).json() == {"kept": True}


def test_a_missing_or_unreadable_photo_keeps_nothing(client, monkeypatch):
    uid, me = _user()
    scans = [_upload(client, me, monkeypatch, [_local_card()]) for _ in range(3)]

    async def break_photos():
        async with async_session_factory() as s:
            await s.execute(update(Scan).where(Scan.id == scans[0]).values(image_path=None))
            await s.commit()
        os.remove(await _photo_path(scans[1]))
        open(await _photo_path(scans[2]), "wb").write(b"not a jpeg")
    run(_dispose_then(break_photos()))
    before = files()

    assert [_answer(client, me, scan, 0, MANA).json() for scan in scans] == [{"kept": False}] * 3
    assert rows(user_id=uid) == [] and files() == before


def test_a_failed_write_leaves_no_stray_crop(client, monkeypatch):
    uid, me = _user()
    scan = _upload(client, me, monkeypatch, [_local_card()])
    before = files()
    real, writes = AsyncSession.scalar, []

    async def locked_on_the_write(self, stmt, *a, **k):
        if stmt.is_insert:
            writes.append(stmt)
            raise RuntimeError("database is locked")
        return await real(self, stmt, *a, **k)
    monkeypatch.setattr(AsyncSession, "scalar", locked_on_the_write)

    with pytest.raises(RuntimeError):
        _answer(client, me, scan, 0, MANA)
    assert len(writes) == 1 and files() == before and rows(user_id=uid) == []


def test_a_failed_commit_is_not_reported_as_kept(client, monkeypatch):
    uid, me = _user()
    scan = _upload(client, me, monkeypatch, [_local_card()])
    before = files()
    real, calls = AsyncSession.commit, []

    async def locked_once(self):
        calls.append(self)
        if len(calls) == 1:
            raise RuntimeError("database is locked")
        return await real(self)
    monkeypatch.setattr(AsyncSession, "commit", locked_once)

    async def put():
        transport = httpx.ASGITransport(app=client.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            return await c.put(f"/api/scans/{scan}/cards/0/correction", headers=me, json={"scryfall_id": MANA, "kind": "pick"})
    r = run(_dispose_then(put()))

    assert r.status_code == 500 and r.json() == {"detail": "Internal server error"}
    assert files() == before and rows(user_id=uid) == []


def test_the_same_answer_again_changes_nothing(client, monkeypatch):
    uid, me = _user()
    scan = _upload(client, me, monkeypatch, [_local_card()])
    before = files()
    for _ in range(3):
        assert _answer(client, me, scan, 0, MANA, "pick").json() == {"kept": True}
    [first] = rows(scan_id=scan)
    assert len(files() - before) == 1

    assert _answer(client, me, scan, 0, MANA, "confirm").json() == {"kept": True}
    [again] = rows(scan_id=scan)
    assert (again.kind, again.crop_file, again.created_at, again.updated_at) == (first.kind, first.crop_file, first.created_at, first.updated_at) \
        and again.kind == "pick"
    assert len(files() - before) == 1


def test_a_later_answer_replaces_the_printing_and_keeps_the_crop(client, monkeypatch):
    uid, me = _user()
    scan = _upload(client, me, monkeypatch, [_local_card(0), _local_card(1)])
    before = files()
    _answer(client, me, scan, 0, MANA, "pick")
    [first] = rows(scan_id=scan, card_id=0)

    _answer(client, me, scan, 0, CRYPT, "pick")
    _answer(client, me, scan, 1, SOL, "confirm")
    zero, one = rows(scan_id=scan)
    assert (zero.id, zero.crop_file, zero.scryfall_id, zero.kind) == (first.id, first.crop_file, CRYPT, "pick")
    assert (one.card_id, one.scryfall_id, one.kind) == (1, SOL, "confirm") and one.crop_file != zero.crop_file
    assert len(files() - before) == 2


def test_twin_first_answers_keep_one_crop(client, monkeypatch):
    uid, me = _user()
    scan = _upload(client, me, monkeypatch, [_local_card(i) for i in range(4)])
    before = files()

    async def race():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=client.app), base_url="http://t") as c:
            await asyncio.gather(*(
                c.put(f"/api/scans/{scan}/cards/{card}/correction", headers=me, json={"scryfall_id": sid, "kind": "pick"})
                for card in range(4) for sid in (MANA, CRYPT)))
    run(_dispose_then(race()))

    got = rows(scan_id=scan)
    assert sorted(r.card_id for r in got) == [0, 1, 2, 3] and all(r.scryfall_id in (MANA, CRYPT) for r in got)
    assert files() - before == {r.crop_file for r in got}


def test_the_answer_must_be_a_printing_id_and_a_known_kind(client, monkeypatch):
    uid, me = _user()
    scan = _upload(client, me, monkeypatch, [_local_card()])
    put = lambda body: client.put(f"/api/scans/{scan}/cards/0/correction", headers=me, json=body)
    for bad in ({"scryfall_id": "Sol Ring", "kind": "pick"}, {"scryfall_id": "", "kind": "pick"},
                {"scryfall_id": SOL, "kind": "find"}, {"scryfall_id": SOL, "kind": "use-as-is"},
                {"scryfall_id": SOL}, {"kind": "pick"}, {}):
        assert put(bad).status_code == 422, bad
    assert client.put(f"/api/scans/{scan}/cards/zero/correction", headers=me, json={"scryfall_id": SOL, "kind": "pick"}).status_code == 422
    assert rows(scan_id=scan) == []
    assert put({"scryfall_id": SOL.upper(), "kind": "pick"}).status_code == 200
    assert rows(scan_id=scan)[0].scryfall_id == SOL


def test_only_the_owner_can_answer_for_a_card(client, monkeypatch):
    uid, me = _user()
    _, them = _user()
    scan = _upload(client, me, monkeypatch, [_local_card()])
    assert _answer(client, them, scan, 0, MANA).status_code == 404
    assert _answer(client, me, scan, 9, MANA).status_code == 404
    assert _answer(client, me, scan + 1000, 0, MANA).status_code == 404
    for huge in (0, 10**25, -10**25):
        assert _answer(client, me, huge, 0, MANA).status_code == 422
    assert client.put(f"/api/scans/{scan}/cards/0/correction", json={"scryfall_id": MANA, "kind": "pick"}).status_code == 401
    assert rows(scan_id=scan) == []


def test_an_answer_does_not_depend_on_when_the_saved_pick_lands(client, monkeypatch):
    uid, me = _user()
    scan = _upload(client, me, monkeypatch, [_local_card(0), _local_card(1)])
    pick = lambda sid: {"scryfall_id": sid, "name": "Sol Ring", "set": "c21"}
    save = lambda picks: client.patch(f"/api/scans/{scan}/state", headers=me, json={"state": {"rev": 1, "picks": picks}})

    assert save([pick(MANA), None]).status_code == 204
    _answer(client, me, scan, 0, MANA, "pick")
    _answer(client, me, scan, 1, CRYPT, "pick")
    assert save([None, pick(CRYPT)]).status_code == 204
    assert [(r.card_id, r.scryfall_id, r.guess_set_code) for r in rows(scan_id=scan)] == [(0, MANA, "cmm"), (1, CRYPT, "cmm")]


def test_scan_ids_are_not_reused_so_a_kept_answer_never_points_at_another_photo(client, monkeypatch):
    uid, me = _user()
    old = _upload(client, me, monkeypatch, [_local_card()])
    _answer(client, me, old, 0, MANA)
    [kept] = rows(scan_id=old)
    assert client.delete(f"/api/scans/{old}", headers=me).status_code == 204

    new = _upload(client, me)
    assert new > old
    assert _answer(client, me, new, 0, CRYPT, "confirm").json() == {"kept": True}
    assert [(r.scan_id, r.scryfall_id) for r in rows(user_id=uid)] == [(old, MANA), (new, CRYPT)]
    assert (settings.corrections_dir / kept.crop_file).exists()


def test_deleting_an_account_unlinks_answers_and_keeps_the_crops(client, monkeypatch):
    uid, me = _user()
    scan = _upload(client, me, monkeypatch, [_local_card()])
    _answer(client, me, scan, 0, MANA)
    [row] = rows(user_id=uid)

    async def go():
        async with async_session_factory() as db:
            counts, removed = await delete_account(db, uid)
            await db.commit()
        left = {}
        async with async_session_factory() as db:
            for table in Base.metadata.sorted_tables:
                if "user_id" in table.c:
                    left[table.name] = await db.scalar(select(func.count()).select_from(table).where(table.c.user_id == uid))
            kept = await db.get(CardCorrection, row.id)
        return counts, removed, left, kept
    counts, removed, left, kept = run(_dispose_then(go()))

    assert set(left.values()) == {0}, left
    assert counts["card_corrections (links cleared)"] == 1
    assert (kept.user_id, kept.scan_id) == (None, None)
    assert (kept.scryfall_id, kept.kind, kept.crop_file, kept.bbox_source) == (MANA, "pick", row.crop_file, "detector")
    assert (settings.corrections_dir / kept.crop_file).exists()
    assert not any(row.crop_file in f for f in removed)
    assert any(f.endswith(".bin") for f in removed)


def test_answers_are_rate_limited_per_user(client, monkeypatch):
    monkeypatch.setattr(main.limiter, "enabled", True)
    uid, me = _user()
    _, other = _user()
    scan = _upload(client, me, monkeypatch, [_local_card(bbox_source="user")])
    codes = [_answer(client, me, scan, 0, MANA).status_code for _ in range(121)]
    assert codes == [200] * 120 + [429]
    assert _answer(client, other, scan, 0, MANA).status_code == 404


def test_cutting_a_crop_does_not_hold_the_databases_write_lock(client, monkeypatch):
    uid, me = _user()
    scan = _upload(client, me, monkeypatch, [_local_card()])
    path = settings.database_url.split("///", 1)[1]
    cut, other_write = corrections._save_crop, []

    def watched(photo_path, card):
        try:
            with sqlite3.connect(path, timeout=0.2) as c:
                c.execute("update users set fb_name = 'free' where id = ?", (uid,))
            other_write.append("done")
        except sqlite3.OperationalError as e:
            other_write.append(str(e))
        return cut(photo_path, card)
    monkeypatch.setattr(corrections, "_save_crop", watched)

    assert _answer(client, me, scan, 0, MANA).json() == {"kept": True}
    assert other_write == ["done"]
