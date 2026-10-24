"""The labelled photos a seller shares or downloads: JPEGs, named for their
place in the post so they sort in post order."""

import json
import zipfile
from io import BytesIO

from conftest import _dispose_then, _scan, new_user, run
from PIL import Image

from app.db import engine
from app.services.auth_service import issue_session_token


def test_export_is_a_jpeg_and_the_zip_keeps_the_post_order_names(client):
    uid = run(_dispose_then(new_user()))
    run(engine.dispose())
    headers = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    sid = str(_scan(client, headers["Authorization"][7:]).json()["scan_id"])
    cards = [{"bbox": [40, 40, 120, 168], "is_foil": False, "label_override": "RM13"},
             {"bbox": [200, 40, 120, 168], "is_foil": True, "label_override": "RM13F"}]

    one = client.post("/api/export", headers=headers, data={"payload": json.dumps({"image_id": sid, "cards": cards})})
    assert one.status_code == 200
    assert one.headers["content-type"] == "image/jpeg"
    assert Image.open(BytesIO(one.content)).format == "JPEG"

    names = ["Friday Post - Photo 09.jpg", "Friday Post - Photo 10.jpg", 'Jumaat: <b>Clearance</b> & 50% off? - Photo 11.jpg', ""]
    images = [{"image_id": sid, "cards": cards, "filename": n} for n in names]
    images.append({"image_id": "999999", "cards": [], "filename": "Gone - Photo 12.jpg"})
    resp = client.post("/api/export-all", headers=headers, data={"payload": json.dumps({"images": images})})
    assert resp.status_code == 200
    with zipfile.ZipFile(BytesIO(resp.content)) as zf:
        assert zf.namelist() == [
            "Friday Post - Photo 09.jpg",
            "Friday Post - Photo 10.jpg",
            "Jumaat_ _b_Clearance__b_ & 50% off_ - Photo 11.jpg",
            "photo.jpg",
        ]
        assert all(Image.open(BytesIO(zf.read(n))).format == "JPEG" for n in zf.namelist())
