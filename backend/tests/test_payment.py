"""The seller's payment details and DuitNow QR."""

from io import BytesIO

from conftest import _dispose_then, new_user, run
from PIL import Image

import app.main as main
from app.db import engine
from app.services.auth_service import issue_image_token, issue_session_token


def _png(mode="RGB") -> bytes:
    buf = BytesIO()
    Image.new(mode, (40, 40), "white" if mode == "RGB" else 0).save(buf, format="JPEG" if mode == "CMYK" else "PNG")
    return buf.getvalue()


def test_payment_details_and_qr(client):
    a, b = run(_dispose_then(new_user())), run(_dispose_then(new_user()))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(a)}"}

    empty = client.get("/api/payment", headers=me).json()
    assert empty == {"bank_name": "", "bank_account_number": "", "bank_account_holder": "", "payment_note": "", "qr_version": None}

    saved = client.put("/api/payment", headers=me, json={
        "bank_name": " Maybank ", "bank_account_number": "1234 5678", "bank_account_holder": "Haziq",
        "payment_note": "Please send your name and phone number.",
    }).json()
    assert saved["bank_name"] == "Maybank" and saved["payment_note"].startswith("Please")
    assert client.put("/api/payment", headers=me, json={"bank_account_number": "9" * 33}).status_code == 422

    # QR: stored as PNG, readable with the image token, only by its owner.
    up = client.put("/api/payment/qr", headers=me, files={"image": ("qr.jpg", _png("CMYK"), "image/jpeg")})
    assert up.status_code == 200 and up.json()["qr_version"]
    got = client.get(f"/api/payment/qr?token={issue_image_token(a)}")
    assert got.status_code == 200 and got.headers["content-type"] == "image/png"
    assert client.get(f"/api/payment/qr?token={issue_image_token(b)}").status_code == 404
    assert client.put("/api/payment/qr", headers=me, files={"image": ("x.png", b"not an image", "image/png")}).status_code == 400

    assert client.delete("/api/payment/qr", headers=me).json()["qr_version"] is None
    assert client.get(f"/api/payment/qr?token={issue_image_token(a)}").status_code == 404
    assert client.get("/api/payment").status_code == 401


def test_qr_is_cropped_square_from_the_top(client):
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    # A tall screenshot: the QR (black) on top, the bank app's buttons (white) under it.
    tall = Image.new("RGB", (40, 100), "white")
    tall.paste((0, 0, 0), (0, 0, 40, 40))
    buf = BytesIO()
    tall.save(buf, format="PNG")
    assert client.put("/api/payment/qr", headers=me, files={"image": ("qr.png", buf.getvalue(), "image/png")}).status_code == 200
    got = Image.open(BytesIO(client.get(f"/api/payment/qr?token={issue_image_token(uid)}").content)).convert("RGB")
    assert got.size == (40, 40) and got.getpixel((20, 39)) == (0, 0, 0)


def test_stored_qr_uploaded_again_is_the_same_picture(client):
    # Undo of "Delete my payment details" uploads the stored file again.
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    me = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    url = f"/api/payment/qr?token={issue_image_token(uid)}"
    tall = Image.frombytes("RGBA", (30, 70), bytes((i * 37) % 251 for i in range(30 * 70 * 4)))
    buf = BytesIO()
    tall.save(buf, format="PNG")
    assert client.put("/api/payment/qr", headers=me, files={"image": ("qr.png", buf.getvalue(), "image/png")}).status_code == 200
    first = client.get(url).content
    assert client.delete("/api/payment/qr", headers=me).status_code == 200
    assert client.put("/api/payment/qr", headers=me, files={"image": ("duitnow-qr.png", first, "image/png")}).status_code == 200
    a, b = Image.open(BytesIO(first)), Image.open(BytesIO(client.get(url).content))
    assert a.size == b.size == (30, 30) and a.mode == b.mode
    assert a.tobytes() == b.tobytes()


def test_the_support_qr_is_served_only_when_the_server_has_one(client, monkeypatch, tmp_path):
    monkeypatch.setattr(main, "SUPPORT_QR", tmp_path / "support_qr.png")
    assert client.get("/api/support-qr").status_code == 404
    (tmp_path / "support_qr.png").write_bytes(b"\x89PNG qr")
    r = client.get("/api/support-qr")                   # no sign-in: it is on a public sheet
    assert r.status_code == 200 and r.content == b"\x89PNG qr" and r.headers["content-type"] == "image/png"
