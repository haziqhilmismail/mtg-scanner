"""Cards & Hobbies drop-off slips as a PDF."""

import re

from conftest import _dispose_then, new_user, run

from app.db import engine
from app.services import slips
from app.services.auth_service import issue_session_token


def _pages(pdf: bytes) -> int:
    return len(re.findall(rb"/Type\s*/Page\b", pdf))


def test_slips_fill_whole_a4_pages(client):
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(uid)}"}

    r = client.post("/api/slips", headers=me, json={"seller": "Haziq", "slips": [{"buyer": "Calvin", "phone": "0123456789"}], "blank": 10})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF") and _pages(r.content) == 2                    # 11 slips: two pages of 10
    assert re.search(rb"MediaBox \[ 0 0 595\.\d+ 841\.\d+ \]", r.content)               # A4 upright

    assert _pages(client.post("/api/slips", headers=me, json={}).content) == 1          # all blank: one page to write on
    assert client.post("/api/slips", headers=me, json={"slips": [{"buyer": "x" * 61}]}).status_code == 422
    assert client.post("/api/slips", json={}).status_code == 401


def test_a_slip_is_about_six_by_ten_and_a_half_cm():
    assert round(slips.SLIP_LONG / slips.CM, 2) == 10.5 and abs(slips.SLIP_SHORT / slips.CM - 6.0) < 0.1
    assert slips.COLS * slips.SLIP_LONG <= slips.PAGE_W + 1 and slips.ROWS * slips.SLIP_SHORT <= slips.PAGE_H + 1
