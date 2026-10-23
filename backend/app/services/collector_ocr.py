"""
collector_ocr.py
----------------
Read the collector line printed in the bottom-left corner of a card:

    R 0209                241/261 R
    TLA ★ EN  ARTIST      DMR • EN  ARTIST

It carries the two facts an image embedding can't reliably tell apart:

  - which PRINTING this is — set code + collector number. Reprints sharing
    the same art sit almost on top of each other in embedding space.
  - whether the card is FOIL — since 2015 the glyph between the set code and
    the language is a star (★) on foils and a dot (•) on non-foils.

OCR is PP-OCR (det + rec) through RapidOCR on onnxruntime. The line is ~1.4 mm
tall on the card, so it is only legible when the card is reasonably large in
the photo; callers should treat an empty result as "unknown", not "absent".
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np
from PIL import Image
from rapidocr import RapidOCR

# Region of the upright card holding the collector line: the left part of the
# bottom border, as fractions of card width / height.
STRIP_TOP = 0.915
STRIP_RIGHT = 0.62
# Size the strip is warped to for OCR. ~2x a typical in-photo card, so PP-OCR's
# detector sees text tall enough to segment without paying for more pixels.
STRIP_SIZE = (605, 116)
# The title bar: card name, top-left. Generous vertically because detected
# quads are a few percent loose or tight around the real card edge.
TITLE_BOX = (0.04, 0.02, 0.86, 0.13)  # left, top, right, bottom
TITLE_SIZE = (640, 120)

_LANGS = "EN|JP|JA|FR|DE|IT|ES|SP|PT|RU|KO|KR|ZHS|ZHT|CS|CT|PH"
# "<SET><sep><LANG>" — sep is whatever glyph OCR made of the dot / star.
_SET_LANG = re.compile(rf"(?<![A-Z0-9])([A-Z0-9]{{3,5}})\s*([^A-Z0-9\s]?)\s*(?:{_LANGS})(?![A-Z])")
# "241/261" or "0209" — the part before a slash; totals after it are skipped.
_NUMBER = re.compile(r"(?<![\d/])(\d{1,4})(?:\s*/\s*\d{1,4})?")
_FOIL_SEPS = set("*★☆✩✭✶")


@dataclass
class CollectorLine:
    numbers: list[str] = field(default_factory=list)  # leading zeros stripped
    set_code: str = ""  # lowercase, "" when not read
    foil: bool | None = None  # None = separator glyph not read
    text: str = ""  # raw OCR, for logs

    def __bool__(self) -> bool:
        return bool(self.numbers or self.set_code)


def parse(lines: list[str]) -> CollectorLine:
    out = CollectorLine(text=" | ".join(lines))
    for line in lines:
        upper = line.upper()
        m = _SET_LANG.search(upper)
        if m and not out.set_code:
            out.set_code = m.group(1).lower()
            if m.group(2):
                out.foil = m.group(2) in _FOIL_SEPS
        for n in _NUMBER.findall(upper):
            n = n.lstrip("0") or "0"
            if n not in out.numbers:
                out.numbers.append(n)
    return out


def sub_quad(quad: np.ndarray, box: tuple[float, float, float, float]) -> np.ndarray:
    """Corners (TL, TR, BR, BL) of the region `box` = (left, top, right,
    bottom), in card fractions, inside an upright card quad. Bilinear
    interpolation — close enough to the true perspective for the
    near-top-down photos this is used on."""
    tl, tr, br, bl = np.asarray(quad, dtype=float)

    def at(u: float, v: float) -> np.ndarray:
        top, bot = tl + (tr - tl) * u, bl + (br - bl) * u
        return top + (bot - top) * v

    left, top, right, bottom = box
    return np.array([at(left, top), at(right, top), at(right, bottom), at(left, bottom)])


def strip_quad(quad: np.ndarray) -> np.ndarray:
    """The collector-line region of an upright card quad."""
    return sub_quad(quad, (0.0, STRIP_TOP, STRIP_RIGHT, 1.0))


def title_quad(quad: np.ndarray) -> np.ndarray:
    """The title-bar region of an upright card quad."""
    return sub_quad(quad, TITLE_BOX)


class CollectorReader:
    def __init__(self):
        self.engine = RapidOCR(params={
            "Global.log_level": "error",
            # Orientation is already known from the embedding match.
            "Global.use_cls": False,
            # Default is `min`/736, which upscales our thin strip ~6x and
            # takes seconds per card. Capping the long side instead is ~10x
            # faster and reads small text better.
            "Det.limit_type": "max",
            "Det.limit_side_len": 960,
        })

    def read(self, strip: Image.Image) -> CollectorLine:
        """`strip` is the upright collector-line region (see `strip_quad`)."""
        result = self.engine(np.asarray(strip.convert("RGB")))
        return parse(list(result.txts or []))

    def read_title(self, strip: Image.Image) -> list[str]:
        """Text found in the title-bar region (see `title_quad`), longest
        first — the card name, possibly with mana-cost noise as extra items."""
        result = self.engine(np.asarray(strip.convert("RGB")))
        return sorted((t.strip() for t in result.txts or [] if t.strip()), key=len, reverse=True)
