"""Drop-off slips as a PDF."""

import re

from conftest import _dispose_then, new_user, run

from app.db import async_session_factory, engine
from app.models import User
from app.services import slips
from app.services.auth_service import issue_session_token

LONGEST = ("Siti Nur Aisyah Az-Zahra binti Wan Ahmad Fauzi " * 6)[:255]


def _pages(pdf: bytes) -> int:
    return len(re.findall(rb"/Type\s*/Page\b", pdf))


def test_slips_fill_whole_a4_pages(client):
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(uid)}"}

    eleven = [{"buyer": f"Buyer {n}", "phone": "012-345 6789" if n % 2 else ""} for n in range(11)]
    r = client.post("/api/slips", headers=me, json={"slips": eleven})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF") and _pages(r.content) == 2                    # 11 slips: two pages of 10
    assert re.search(rb"MediaBox \[ 0 0 595\.\d+ 841\.\d+ \]", r.content)               # A4 upright

    assert _pages(client.post("/api/slips", headers=me, json={}).content) == 1          # none chosen: one page to write on
    # A stored name can be 255 characters: it fits the slip instead of failing.
    assert client.post("/api/slips", headers=me, json={"slips": [{"buyer": LONGEST}]}).status_code == 200
    assert client.post("/api/slips", headers=me, json={"slips": [{"buyer": "x" * 256}]}).status_code == 422
    assert client.post("/api/slips", json={}).status_code == 401


def test_a_long_name_shrinks_then_wraps_and_never_prints_under_12px():
    width = 221 * slips.PX
    font, lines = slips.fit_value("Tan Wei Jie", width, slips.NAME_LINES)
    assert (font.size, lines) == (round(17 * slips.PX), ["Tan Wei Jie"])

    font, lines = slips.fit_value("Kavitha a/p Subramaniam", width, slips.NAME_LINES)        # shrinks to stay on one line
    assert len(lines) == 1 and round(14 * slips.PX) <= font.size < round(17 * slips.PX)

    font, lines = slips.fit_value("Siti Nur Aisyah Az-Zahra binti Wan Ahmad Fauzi", width, slips.NAME_LINES)
    assert len(lines) == 2 and font.size >= round(12 * slips.PX)
    assert " ".join(lines) == "Siti Nur Aisyah Az-Zahra binti Wan Ahmad Fauzi"

    font, lines = slips.fit_value(LONGEST, width, slips.NAME_LINES)
    assert font.size == round(12 * slips.PX) and len(lines) == slips.NAME_LINES == 5
    assert lines[-1].endswith("…") and all(font.getlength(line) <= width for line in lines)

    # No spaces to break at: it breaks between letters.
    font, lines = slips.fit_value("Asmoranomardicadaistinaculdacar" * 2, width, slips.NAME_LINES)
    assert "".join(lines) == "Asmoranomardicadaistinaculdacar" * 2 and all(font.getlength(line) <= width for line in lines)


def test_cut_lines_run_between_slips_only():
    img = slips.page([("Tan Wei Jie", "0123456789")])
    assert img.size == (slips.PAGE_W, slips.PAGE_H)
    ink = lambda box: img.crop(box).getextrema()[0]                                     # darkest pixel in a box
    middle, first_cut = round(slips.SLIP_W), round(slips.SLIP_H)
    assert ink((middle - 1, 0, middle + 2, slips.PAGE_H)) == slips.LINE_INK              # down the middle
    assert ink((0, first_cut - 1, slips.PAGE_W, first_cut + 2)) == slips.LINE_INK        # between the rows
    # Nothing runs along the page's own edges (away from where the cuts meet them).
    assert ink((0, 0, middle - 10, 4)) == 255 and ink((0, slips.PAGE_H - 4, middle - 10, slips.PAGE_H)) == 255
    assert ink((0, 10, 4, first_cut - 10)) == 255 and ink((slips.PAGE_W - 4, 10, slips.PAGE_W, first_cut - 10)) == 255


def test_characters_the_font_lacks_are_left_out_not_printed_as_boxes():
    assert slips.printable("Aina 🌸") == "Aina"
    assert slips.printable("Zoë  Ñúñez") == "Zoë Ñúñez"
    assert slips.printable("王小明") == ""                                            # nothing printable: a write-in line


async def _google_user(name: str) -> int:
    async with async_session_factory() as s:
        u = User(email=f"{name.replace(' ', '.')}@example.com", name=name)
        s.add(u)
        await s.commit()
        return u.id


def test_the_seller_name_set_on_profile_prints_on_the_slips(client, monkeypatch):
    uid = run(_dispose_then(_google_user("Aiman Google")))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    seller = lambda: client.get("/api/auth/me", headers=me).json()["seller_name"]
    set_seller = lambda name: client.put("/api/auth/me/seller-name", headers=me, json={"seller_name": name})

    assert seller() == "Aiman Google"                                                # until set: the Google name
    assert set_seller("  Kedai Kad Aiman ").json() == {"seller_name": "Kedai Kad Aiman"}
    assert seller() == "Kedai Kad Aiman"
    assert set_seller("").json() == {"seller_name": "Aiman Google"}                  # cleared: the Google name again
    assert set_seller("x" * 256).status_code == 422
    assert client.put("/api/auth/me/seller-name", json={"seller_name": "x"}).status_code == 401

    set_seller("Kedai Kad Aiman")
    printed = []
    monkeypatch.setattr(slips, "render", lambda rows, seller: printed.append(seller) or b"%PDF")
    client.post("/api/slips", headers=me, json={"slips": [{"buyer": "Farah"}]})
    assert printed == ["Kedai Kad Aiman"]


def test_every_slip_on_the_page_carries_the_seller_name():
    def seller_row_ink(img, n):
        left, top = (n % slips.COLS) * slips.SLIP_W, (n // slips.COLS) * slips.SLIP_H
        label_end = left + slips.PAD_X + 120 * slips.PX                              # past "Seller's name:"
        baseline = top + slips.BASELINES[2]
        return img.crop((round(label_end), round(baseline - 20 * slips.PX), round(left + slips.SLIP_W - slips.PAD_X), round(baseline + 2))).getextrema()[0]

    named = slips.page([("Tan Wei Jie", "0123456789"), ("", "")], seller="Kedai Kad Aiman")
    assert seller_row_ink(named, 0) == slips.INK and seller_row_ink(named, 1) == slips.INK   # a blank spare slip too
    assert seller_row_ink(slips.page([("Tan Wei Jie", "0123456789")]), 0) == slips.LINE_INK  # no name: a line to write on
