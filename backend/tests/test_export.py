"""The labelled photos a seller shares or downloads: JPEGs, named for their
place in the post so they sort in post order."""

import json
import zipfile
from io import BytesIO

from conftest import _scan, sign_in
from PIL import Image


def test_export_is_a_jpeg_and_the_zip_keeps_the_post_order_names(client):
    _, headers = sign_in()
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


def test_only_the_owner_can_export_a_photo(client):
    _, mine = sign_in()
    _, theirs = sign_in()
    sid = str(_scan(client, mine["Authorization"][7:]).json()["scan_id"])
    export = lambda headers, payload: client.post(f"/api/{payload[0]}", headers=headers,
                                                  data={"payload": json.dumps(payload[1])}).status_code
    single = ("export", {"image_id": sid, "cards": []})
    every = ("export-all", {"images": [{"image_id": sid, "cards": []}]})
    assert (export(mine, single), export(mine, every)) == (200, 200)
    assert (export(theirs, single), export(theirs, every)) == (404, 404)


def test_a_sold_card_is_blurred_and_darkened_and_the_rest_of_the_photo_is_not():
    from PIL import ImageStat

    from app.services.price_overlay import render_overlay

    # Fine black-and-white stripes: sharp, so a blur shows as lost contrast.
    photo = Image.new("RGB", (600, 400), "white")
    for x in range(0, 600, 4):
        photo.paste((0, 0, 0), (x, 0, x + 2, 400))
    buf = BytesIO()
    photo.save(buf, format="PNG")

    out = Image.open(BytesIO(render_overlay(buf.getvalue(), [], covers=[{"bbox": [40, 40, 140, 196]}]))).convert("L")
    # Inside the sold card, away from its SOLD pill; then a patch outside it.
    sold = ImageStat.Stat(out.crop((50, 50, 170, 90)))
    kept = ImageStat.Stat(out.crop((400, 50, 520, 90)))
    assert sold.stddev[0] < kept.stddev[0] / 4      # the stripes are gone
    assert sold.mean[0] < kept.mean[0] - 20         # and it is darker
    assert kept.stddev[0] > 100                     # the rest stays sharp
