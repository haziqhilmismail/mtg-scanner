"""Drop-off slips as a PDF."""

import re

from conftest import _dispose_then, new_user, run

from app.db import engine
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
