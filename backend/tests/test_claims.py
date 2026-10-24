"""Claims: OCR a thread, draft claims (Gemini mocked), confirm into orders."""

import os
import shutil
from io import BytesIO

import pytest
from conftest import LIMIT, _dispose_then, _photo, new_user, run
from PIL import Image, ImageDraw, ImageFont

from app.db import engine
from app.services import claims, credits
from app.services.auth_service import issue_session_token


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
    text, scan_id, _ = claims.read_screenshot(_thread_png(["Aiman Hakim", "nak no 3", "Siti Nurhaliza", "mine top left"], dark))
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
    sid, box, sure = claims.locate_photo(phone, photos)
    assert sid == 2 and sure and abs(box[0]) < 15 and abs(box[1] - 140) < 15 and abs(box[2] - 1170) < 30
    assert claims._thread_region(phone, box).size[1] < 1400          # the part under the photo
    # PC: photo viewer on the left, thread in a column on the right.
    pc = Image.new("RGB", (1920, 1080), (0, 0, 0))
    pc.paste(photos[3].resize((1300, 975)), (40, 52))
    sid, box, _ = claims.locate_photo(pc, photos)
    assert sid == 3
    assert claims._thread_region(pc, box).size[0] < 700              # the column beside the photo
    # PC, photo inside a comment: room on its right, but the thread is under it.
    inline = Image.new("RGB", (533, 629), (36, 37, 38))
    inline.paste(photos[1].resize((322, 242)), (71, 42))
    sid, box, _ = claims.locate_photo(inline, photos)
    assert sid == 1
    assert claims._thread_region(inline, box).size == (533, 629 - (box[1] + box[3]))
    # No photo in the screenshot, or one we don't have: no match.
    assert claims.locate_photo(Image.new("RGB", (1170, 2400), (36, 37, 38)), photos) == (None, None, False)
    assert claims.locate_photo(phone, {1: photos[1], 3: photos[3]})[0] is None
    assert claims.locate_photo(phone, {}) == (None, None, False)


def test_ocr_rejects_non_images():
    with pytest.raises(ValueError):
        claims.read_screenshot(b"not an image")


def test_parse_only_accepts_cards_that_were_offered(monkeypatch):
    C, P, D, I = claims.CatalogueCard, claims.CataloguePhoto, claims.ClaimDraft, claims.ClaimItemDraft
    photo = P(scan_id=7, label="Photo 1", cards=[C(card_id=0, name="Sol Ring"), C(card_id=1, name="Island")])

    class _Models:
        def generate_content(self, **kw):
            assert "Sol Ring" in kw["contents"][0] and "nak no 1" in kw["contents"][0]
            return type("R", (), {"parsed": claims.ParseResult(claims=[
                D(buyer="Aiman", comment="nak no 1", unclear="", items=[
                    I(scan_id=7, card_id=0, qty=0, said="no 1", unclear=""),      # qty 0 → 1
                    I(scan_id=0, card_id=1, qty=1, said="island", unclear=""),    # one photo: scan filled in
                    I(scan_id=7, card_id=9, qty=1, said="bolt", unclear=""),      # not on offer → unclear
                ]),
                D(buyer="Nobody", comment="pm", unclear="", items=[]),           # nothing claimed → skipped
            ], skipped=["Farah: ada lagi?"])})()
    monkeypatch.setattr(claims, "get_client", lambda: type("Cl", (), {"models": _Models()})())

    result = claims.parse_claims("Aiman\nnak no 1", [photo], "Seller")
    assert [d.buyer for d in result.claims] == ["Aiman"]
    a, b, c = result.claims[0].items
    assert (a.scan_id, a.card_id, a.qty) == (7, 0, 1)
    assert (b.scan_id, b.card_id) == (7, 1)
    assert c.card_id == -1 and c.unclear
    assert result.skipped == ["Farah: ada lagi?", "Nobody: pm"]


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
        sid = sorted(photos)[0] if photos and len(raw) in (2, 6) else None
        return f"page {len(raw)}", sid, len(raw) == 2
    monkeypatch.setattr(claims, "read_screenshot", fake_read)
    scan = client.post("/api/scan", files={"image": ("a.jpg", _photo(), "image/jpeg")}, headers=me).json()["scan_id"]
    r = client.post("/api/claims/read", headers=me, data={"scan_ids": f"{scan},999999"},
                    files=[("images", ("1.png", b"aa", "image/png")), ("images", ("2.png", b"bbbb", "image/png")),
                           ("images", ("3.png", b"cccccc", "image/png"))])
    assert r.json() == {"pages": [
        {"text": "page 2", "scan_id": scan, "guess": None},      # sure
        {"text": "page 4", "scan_id": None, "guess": None},      # no photo in it
        {"text": "page 6", "scan_id": None, "guess": scan},      # a look-alike scored nearly as well
    ]}
    assert seen_photos == [[scan], [scan], [scan]]  # only the caller's own scans are offered

    seen = {}
    def fake_parse(text, photos, seller):
        seen.update(text=text, photos=len(photos), seller=seller)
        return claims.ParseResult(claims=[claims.ClaimDraft(buyer="Aiman", comment="nak 1", unclear="", items=[
            claims.ClaimItemDraft(scan_id=5, card_id=0, qty=1, said="1", unclear="")])], skipped=["Farah: ada lagi?"])
    monkeypatch.setattr(claims, "parse_claims", fake_parse)
    r = client.post("/api/claims/parse", headers=me, json={"text": "Aiman\nnak 1", "photos": [
        {"scan_id": 5, "label": "Photo 1", "cards": [{"card_id": 0, "name": "Sol Ring"}]}]})
    assert r.status_code == 200 and r.json()["claims"][0]["items"][0]["card_id"] == 0
    assert r.json()["skipped"] == ["Farah: ada lagi?"]
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
        return claims.ParseResult(claims=[], skipped=[])
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


# The seller's own Facebook post, as OCR hands it over. Replies start with a
# tag of the person answered (the seller), which is not the commenter.
DESKTOP_THREAD = """NF - x2.5
F - 2.8
Dice indicate foil
Drop off CnH NEXT WEEK Tuesday earliest
All comments
30
Haziq Hilmi · 1d
Reply
Haziq Hilmi · 1d
beledros witherbloom JP x2.2
Reply
Amir Rahman · 1d
Haziq Hilmi claim abrupt decay
Reply 👍1
Daniel Tan · 1d
Haziq Hilmi claim Rakdos Charm
Reply 👍1
Write a comment..."""

MOBILE_THREAD = """Haziq Hilmi's post
Haziq Hilmi · 1d
Reply
Haziq Hilmi · 1d
beledros witherbloom JP x2.2
Reply
Amir Rahman · 1d
Haziq Hilmi claim abrupt decay
Reply
1
Daniel Tan · 1d
Haziq Hilmi claim Rakdos Charm
Reply
1
Reply to Haz..."""

TAGGED_PHOTO = claims.CataloguePhoto(scan_id=3, label="Photo 1", cards=[
    claims.CatalogueCard(card_id=0, name="Beledros Witherbloom", price="RM22"),
    claims.CatalogueCard(card_id=1, name="Abrupt Decay", price="RM25"),
    claims.CatalogueCard(card_id=2, name="Rakdos Charm", price="RM3"),
])


@pytest.mark.parametrize("thread", [DESKTOP_THREAD, MOBILE_THREAD])
def test_prompt_explains_seller_tags_in_replies(monkeypatch, thread):
    sent = []

    class _Models:
        def generate_content(self, **kw):
            sent.append(kw["contents"][0])
            return type("R", (), {"parsed": None})()
    monkeypatch.setattr(claims, "get_client", lambda: type("Cl", (), {"models": _Models()})())

    claims.parse_claims(thread, [TAGGED_PHOTO], "Haziq Hilmi")
    prompt = sent[0]
    assert thread in prompt
    # The rule Gemini needs for "Amir Rahman · 1d / Haziq Hilmi claim abrupt decay".
    assert 'The seller\'s own name is "Haziq Hilmi"' in prompt
    assert "name on the line ABOVE the words" in prompt
    assert "leading \"Haziq Hilmi\" is only a tag" in prompt
    assert "merely tags the seller's name is still that buyer's claim" in prompt


@pytest.mark.skipif(not os.environ.get("GEMINI_LIVE_API_KEY"), reason="set GEMINI_LIVE_API_KEY to run against Gemini")
@pytest.mark.parametrize("thread", [DESKTOP_THREAD, MOBILE_THREAD])
def test_live_gemini_reads_tagged_replies_as_the_buyers_claims(monkeypatch, thread):
    monkeypatch.setattr(claims.settings, "gemini_api_key", os.environ["GEMINI_LIVE_API_KEY"])
    drafts = claims.parse_claims(thread, [TAGGED_PHOTO], "Haziq Hilmi").claims
    got = {d.buyer: [(i.card_id, i.qty) for i in d.items] for d in drafts}
    assert got == {"Amir Rahman": [(1, 1)], "Daniel Tan": [(2, 1)]}, drafts
    assert all("Haziq Hilmi" not in d.comment for d in drafts), drafts


def test_a_finished_photo_keeps_its_posted_prices(client):
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    post = client.post("/api/posts", data={"title": "Friday"}, headers=me).json()["id"]
    scan = client.post("/api/scan", files={"image": ("a.jpg", _photo(), "image/jpeg")}, data={"post_id": str(post)}, headers=me).json()["scan_id"]
    bbox = client.get("/api/scans?lite=1", headers=me).json()[0]["cards"][0]["bbox"]
    item = lambda price: {**_item(scan, 0, "Sol Ring", price), "bbox": bbox}
    listing = client.post("/api/listings", headers=me, json={
        "name": "Sol Ring", "unit_price_myr": "10.00", "scan_id": scan, "bbox": bbox, "post_ids": [post]}).json()["id"]
    price_of = lambda: next(l for l in client.get("/api/listings", headers=me).json() if l["id"] == listing)["unit_price_myr"]

    # Finishing locks the photo: its listing takes the posted price.
    lock = {"lockedAt": "2026-10-23T12:00:00Z", "locked": [{"price": 12, "usd": 4, "mult": 3, "manual": False}]}
    assert client.patch(f"/api/scans/{scan}/state", headers=me, json={"state": lock}).status_code == 204
    assert price_of() == "12.00"

    # A claim sells at that price, whatever the client sends.
    r = client.post("/api/claims/confirm", headers=me, json={"post_id": post, "claims": [{"buyer": "Aiman", "items": [item("99.00")]}]})
    assert r.status_code == 201 and r.json()[0]["total_myr"] == "12.00"
    assert price_of() == "12.00"

    # Edit prices unlocks it: claims follow the photo again.
    assert client.patch(f"/api/scans/{scan}/state", headers=me, json={"state": {"lockedAt": None, "locked": [None]}}).status_code == 204
    r = client.post("/api/claims/confirm", headers=me, json={"post_id": post, "claims": [{"buyer": "Siti", "items": [item("15.00")]}]})
    assert r.json()[0]["total_myr"] == "15.00" and price_of() == "15.00"


def test_live_prices_change_until_sent(client):
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    scan = client.post("/api/scan", files={"image": ("a.jpg", _photo(), "image/jpeg")}, headers=me).json()["scan_id"]
    order = client.post("/api/claims/confirm", headers=me, json={"claims": [
        {"buyer": "Aiman", "items": [_item(scan, 0, "Sol Ring", "9.00", qty=2, qty_total=2)]}]}).json()[0]
    item = order["items"][0]["id"]
    assert order["prices_sent_at"] is None

    # Refresh prices: today's CK price, still an estimate.
    r = client.put(f"/api/orders/{order['id']}/prices", headers=me, json={"items": [{"id": item, "unit_price_myr": "10.00"}]}).json()
    assert (r["total_myr"], r["prices_sent_at"]) == ("20.00", None)
    # Copied for the buyer: the price is sent and stays.
    r = client.put(f"/api/orders/{order['id']}/prices", headers=me, json={"items": [{"id": item, "unit_price_myr": "11.00"}], "sent": True}).json()
    assert r["total_myr"] == "22.00" and r["prices_sent_at"]
    assert client.put(f"/api/orders/{order['id']}/prices", headers=me, json={"items": [{"id": item, "unit_price_myr": "1.00"}]}).status_code == 409
    # Resend at today's price.
    assert client.delete(f"/api/orders/{order['id']}/prices-sent", headers=me).json()["prices_sent_at"] is None
    assert client.put(f"/api/orders/{order['id']}/prices", headers=me, json={"items": [{"id": item, "unit_price_myr": "12.00"}]}).json()["total_myr"] == "24.00"
