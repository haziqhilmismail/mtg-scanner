import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from app.services.card_crop import CARD_SIZE, card_crop

RED, GREY = (200, 30, 30), (90, 90, 90)


def _table(card=(100, 150, 400, 570), size=(800, 1000)):
    img = Image.new("RGB", size, GREY)
    ImageDraw.Draw(img).rectangle(card, fill=RED)
    return img


def _quad(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def test_a_local_card_is_its_quad_flattened_to_the_embedder_size():
    crop = card_crop(_table(), {"bbox_source": "detector", "corners": _quad(100, 150, 400, 570),
                                "bbox": [100, 150, 300, 420]})
    assert crop.size == CARD_SIZE
    assert crop.getpixel((5, 5)) == crop.getpixel((480, 670)) == crop.getpixel((244, 340)) == RED


def test_a_tilted_quad_is_flattened_not_boxed():
    img = Image.new("RGB", (800, 1000), GREY)
    quad = [[300, 100], [500, 180], [440, 520], [240, 440]]
    ImageDraw.Draw(img).polygon([tuple(p) for p in quad], fill=RED)
    crop = card_crop(img, {"bbox_source": "detector", "corners": quad, "bbox": [240, 100, 260, 420]})
    assert crop.size == CARD_SIZE
    inside = [crop.getpixel(p) for p in ((20, 20), (468, 20), (468, 660), (20, 660), (244, 340))]
    assert all(max(abs(a - b) for a, b in zip(px, RED)) < 40 for px in inside)


def test_a_gemini_card_is_its_box_at_the_photos_own_pixels():
    for source in ("gemini", "classical"):
        crop = card_crop(_table(), {"bbox_source": source, "bbox": [100, 150, 300, 420],
                                    "corners": _quad(0, 0, 5, 5)})
        assert crop.size == (300, 420) and crop.getpixel((150, 210)) == RED


def test_a_box_past_the_photos_edge_is_cut_to_the_photo():
    crop = card_crop(_table(), {"bbox_source": "gemini", "bbox": [700, 900, 300, 300]})
    assert crop.size == (100, 100)


def test_cards_with_no_real_geometry_have_no_crop():
    photo = _table()
    placeholder = {"bbox_source": "user", "bbox": [100, 150, 300, 420], "corners": _quad(100, 150, 400, 570)}
    whole_photo = {"bbox_source": "gemini", "bbox": [0, 0, 800, 1000]}
    sliver = {"bbox_source": "gemini", "bbox": [10, 10, 4, 400]}
    assert [card_crop(photo, c) for c in (
        placeholder, whole_photo, sliver,
        {"bbox_source": "detector", "corners": _quad(0, 0, 0, 0)},
        {"bbox_source": "detector", "corners": _quad(10, 10, 14, 14)},
        {"bbox_source": "detector", "corners": [[0, 0], [100, 0], [200, 0], [300, 0]]},
        {"bbox_source": "new-source", "bbox": [100, 150, 300, 420]},
        {"bbox": [100, 150, 300, 420]},
    )] == [None] * 8


def test_a_record_without_the_box_its_source_promises_is_a_bug_not_a_decline():
    with pytest.raises(KeyError):
        card_crop(_table(), {"bbox_source": "detector"})


def test_cutting_a_crop_needs_no_onnx_runtime():
    code = "import sys, app.services.card_crop; sys.exit('onnxruntime' in sys.modules)"
    assert subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).parent.parent).returncode == 0
