"""Claims: OCR a thread, draft claims (Gemini mocked), confirm into orders."""

import shutil
from io import BytesIO

import pytest
from PIL import Image, ImageDraw, ImageFont

from app.services import claims
from test_credits import (  # noqa: F401  (fixtures are used by name)
    LIMIT, _dispose_then, _photo, client, credits, engine, issue_session_token, new_user, run, schema,
)


def _thread_png(lines, dark=False) -> bytes:
    bg, fg = ((36, 37, 38), (228, 230, 235)) if dark else ((255, 255, 255), (5, 5, 5))
    img = Image.new("RGB", (900, 60 + 70 * len(lines)), bg)
    font = ImageFont.truetype("DejaVuSans.ttf", 40)
    d = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        d.text((30, 30 + 70 * i), line, fill=fg, font=font)
    buf = BytesIO(); img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="tesseract not installed")
@pytest.mark.parametrize("dark", [False, True])
def test_ocr_reads_light_and_dark_screenshots(dark):
    text, scan_id = claims.read_screenshot(_thread_png(["Aiman Hakim", "nak no 3", "Siti Nurhaliza", "mine top left"], dark))
    assert scan_id is None
    assert "Aiman Hakim" in text and "nak no 3" in text and "mine top left" in text


def _noise(seed, size=(800, 600)):
    import numpy as np
    rng = np.random.default_rng(seed)
    small = rng.integers(0, 255, (size[1] // 20, size[0] // 20, 3), dtype=np.uint8)
    return Image.fromarray(small).resize(size, Image.BICUBIC)


def test_locates_the_right_photo_in_phone_and_pc_layouts():
    photos = {1: _noise(1), 2: _noise(2), 3: _noise(3)}
    # Phone: the photo across the top, thread underneath.
    phone = Image.new("RGB", (1170, 2400), (36, 37, 38))
    phone.paste(photos[2].resize((1170, 878)), (0, 140))
    sid, box = claims.locate_photo(phone, photos)
    assert sid == 2 and abs(box[0]) < 15 and abs(box[1] - 140) < 15 and abs(box[2] - 1170) < 30
    assert claims._thread_region(phone, box).size[1] < 1400          # the part under the photo
    # PC: photo viewer on the left, thread in a column on the right.
    pc = Image.new("RGB", (1920, 1080), (0, 0, 0))
    pc.paste(photos[3].resize((1300, 975)), (40, 52))
    sid, box = claims.locate_photo(pc, photos)
    assert sid == 3
    assert claims._thread_region(pc, box).size[0] < 700              # the column beside the photo
    # No photo in the screenshot, or one we don't have: no match.
    assert claims.locate_photo(Image.new("RGB", (1170, 2400), (36, 37, 38)), photos) == (None, None)
    assert claims.locate_photo(phone, {1: photos[1], 3: photos[3]})[0] is None
    assert claims.locate_photo(phone, {}) == (None, None)


def test_ocr_rejects_non_images():
    with pytest.raises(ValueError):
        claims.read_screenshot(b"not an image")


def test_parse_only_accepts_cards_that_were_offered(monkeypatch):
    C, P, D, I = claims.CatalogueCard, claims.CataloguePhoto, claims.ClaimDraft, claims.ClaimItemDraft
    photo = P(scan_id=7, label="Photo 1", cards=[C(card_id=0, name="Sol Ring"), C(card_id=1, name="Island")])

    class _Models:
        def generate_content(self, **kw):
            assert "Sol Ring" in kw["contents"][0] and "nak no 1" in kw["contents"][0]
            return type("R", (), {"parsed": [
                D(buyer="Aiman", comment="nak no 1", unclear="", items=[
                    I(scan_id=7, card_id=0, qty=0, said="no 1", unclear=""),      # qty 0 → 1
                    I(scan_id=0, card_id=1, qty=1, said="island", unclear=""),    # one photo: scan filled in
                    I(scan_id=7, card_id=9, qty=1, said="bolt", unclear=""),      # not on offer → unclear
                ]),
                D(buyer="Nobody", comment="pm", unclear="", items=[]),           # nothing claimed → dropped
            ]})()
    monkeypatch.setattr(claims, "get_client", lambda: type("Cl", (), {"models": _Models()})())

    drafts = claims.parse_claims("Aiman\nnak no 1", [photo], "Seller")
    assert [d.buyer for d in drafts] == ["Aiman"]
    a, b, c = drafts[0].items
    assert (a.scan_id, a.card_id, a.qty) == (7, 0, 1)
    assert (b.scan_id, b.card_id) == (7, 1)
    assert c.card_id == -1 and c.unclear


def _item(scan_id, card_id, name, price, qty=1, qty_total=1, foil=False):
    return {"scan_id": scan_id, "card_id": card_id, "bbox": [10 * card_id, 0, 50, 70], "name": name,
            "is_foil": foil, "unit_price_myr": price, "qty": qty, "qty_total": qty_total}


def test_confirm_makes_orders_and_reuses_listings(client):
    uid, other = run(_dispose_then(new_user())), run(_dispose_then(new_user()))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    them = {"Authorization": f"Bearer {issue_session_token(other)}"}
    post = client.post("/api/posts", data={"title": "Friday"}, headers=me).json()["id"]
    scan = client.post("/api/scan", files={"image": ("a.jpg", _photo(), "image/jpeg")}, data={"post_id": str(post)}, headers=me).json()["scan_id"]

    r = client.post("/api/claims/confirm", headers=me, json={"post_id": post, "claims": [
        {"buyer": "Aiman Hakim", "items": [_item(scan, 0, "Sol Ring", "9.00"), _item(scan, 1, "Island", "2.00", qty=2, qty_total=4)]},
        {"buyer": "Siti", "note": "top left", "items": [_item(scan, 1, "Island", "2.00", qty_total=4)]},
    ]})
    assert r.status_code == 201, r.text
    aiman, siti = r.json()
    assert (aiman["status"], aiman["total_myr"], siti["total_myr"]) == ("claimed", "13.00", "2.00")
    assert siti["notes"] == "top left"
    assert client.patch(f"/api/orders/{siti['id']}", json={"status": None}, headers=me).status_code == 422
    assert client.patch(f"/api/orders/{siti['id']}", json={"status": "cancelled"}, headers=me).json()["status"] == "cancelled"
    assert client.post(f"/api/orders/{siti['id']}/restore", headers=me).status_code == 200

    listings = client.get("/api/listings", headers=me).json()
    assert len(listings) == 2                                    # Island shared by both buyers
    island = next(l for l in listings if l["name"] == "Island")
    assert (island["scan_id"], island["qty_total"], island["post_ids"]) == (scan, 4, [post])
    assert {i["listing_id"] for o in (aiman, siti) for i in o["items"]} == {l["id"] for l in listings}

    # A second batch reuses the same listings and the same buyer.
    again = client.post("/api/claims/confirm", headers=me, json={"post_id": post, "claims": [
        {"buyer": "aiman hakim", "items": [_item(scan, 1, "Island", "3.00", qty_total=4)]}]})
    assert again.status_code == 201
    assert again.json()[0]["buyer_id"] == aiman["buyer_id"]
    assert len(client.get("/api/listings", headers=me).json()) == 2

    # Not your scan, not your post.
    assert client.post("/api/claims/confirm", headers=them, json={"claims": [{"buyer": "X", "items": [_item(scan, 0, "Sol Ring", "9.00")]}]}).status_code == 404
    assert client.post("/api/claims/confirm", headers=them, json={"post_id": post, "claims": [{"buyer": "X", "items": [_item(scan, 0, "Sol Ring", "9.00")]}]}).status_code == 404
    assert client.post("/api/claims/confirm", json={"claims": []}).status_code == 401


def test_read_and_parse_endpoints(client, monkeypatch):
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    seen_photos = []
    def fake_read(raw, photos):
        seen_photos.append(sorted(photos))
        return f"page {len(raw)}", (sorted(photos)[0] if photos and len(raw) == 2 else None)
    monkeypatch.setattr(claims, "read_screenshot", fake_read)
    scan = client.post("/api/scan", files={"image": ("a.jpg", _photo(), "image/jpeg")}, headers=me).json()["scan_id"]
    r = client.post("/api/claims/read", headers=me, data={"scan_ids": f"{scan},999999"},
                    files=[("images", ("1.png", b"aa", "image/png")), ("images", ("2.png", b"bbbb", "image/png"))])
    assert r.json() == {"pages": [{"text": "page 2", "scan_id": scan}, {"text": "page 4", "scan_id": None}]}
    assert seen_photos == [[scan], [scan]]          # only the caller's own scans are offered

    seen = {}
    def fake_parse(text, photos, seller):
        seen.update(text=text, photos=len(photos), seller=seller)
        return [claims.ClaimDraft(buyer="Aiman", comment="nak 1", unclear="", items=[
            claims.ClaimItemDraft(scan_id=5, card_id=0, qty=1, said="1", unclear="")])]
    monkeypatch.setattr(claims, "parse_claims", fake_parse)
    r = client.post("/api/claims/parse", headers=me, json={"text": "Aiman\nnak 1", "photos": [
        {"scan_id": 5, "label": "Photo 1", "cards": [{"card_id": 0, "name": "Sol Ring"}]}]})
    assert r.status_code == 200 and r.json()["claims"][0]["items"][0]["card_id"] == 0
    assert seen["text"] == "Aiman\nnak 1" and seen["photos"] == 1
    assert client.post("/api/claims/parse", json={"text": "x", "photos": []}).status_code in (401, 422)


def test_parse_spends_a_credit_and_refuses_when_out(client, monkeypatch):
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    body = {"text": "Aiman\nnak 1", "photos": [{"scan_id": 5, "label": "Photo 1", "cards": [{"card_id": 0, "name": "Sol Ring"}]}]}
    calls = []
    def fake_parse(text, photos, seller):
        calls.append(text)
        if text == "fail":
            raise RuntimeError("gemini is down")
        return []
    monkeypatch.setattr(claims, "parse_claims", fake_parse)
    remaining = lambda: client.get("/api/credits", headers=me).json()["remaining"]

    assert client.post("/api/claims/parse", headers=me, json=body).status_code == 200
    assert remaining() == LIMIT - 1
    assert client.post("/api/claims/parse", headers=me, json={**body, "text": "fail"}).status_code == 502
    assert remaining() == LIMIT - 1                      # a failed call is handed back

    for _ in range(LIMIT - 1):
        run(_dispose_then(credits.reserve(uid)))
    run(engine.dispose())
    calls.clear()
    out = client.post("/api/claims/parse", headers=me, json=body)
    assert out.status_code == 402 and out.json()["detail"]["code"] == "out_of_credits"
    assert out.json()["detail"]["credits"]["remaining"] == 0
    assert calls == []                                   # refused before any Gemini call
