"""Card shape and box arithmetic shared by the scanners and the overlay.

Boxes are (x0, y0, x1, y1) unless a name says xywh."""

from __future__ import annotations

import math
from collections.abc import Callable, Hashable
from typing import TypeVar

import numpy as np

# Scryfall's "normal" card image: the size the index builder embeds and the
# scanner warps every detection to. Real cards are 63 x 88 mm, the same shape.
CARD_SIZE = (488, 680)
CARD_ASPECT = CARD_SIZE[0] / CARD_SIZE[1]  # width / height

Box = tuple[float, float, float, float]
T = TypeVar("T")


def xyxy(box_xywh: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    x, y, w, h = box_xywh
    return x, y, x + w, y + h


def box_around(quad: np.ndarray) -> tuple[int, int, int, int]:
    """Smallest whole-pixel (x, y, w, h) box that contains every corner."""
    x0, y0 = (math.floor(v) for v in quad.min(axis=0))
    x1, y1 = (math.ceil(v) for v in quad.max(axis=0))
    return x0, y0, x1 - x0, y1 - y0


def _intersection(a: Box, b: Box) -> float:
    iw = min(a[2], b[2]) - max(a[0], b[0])
    ih = min(a[3], b[3]) - max(a[1], b[1])
    return iw * ih if iw > 0 and ih > 0 else 0


def _area(a: Box) -> float:
    return (a[2] - a[0]) * (a[3] - a[1])


def iou(a: Box, b: Box) -> float:
    inter = _intersection(a, b)
    return inter / (_area(a) + _area(b) - inter) if inter else 0.0


def overlap_of_smaller(a: Box, b: Box) -> float:
    """Intersection as a fraction of the smaller box: near 1 when one card of
    a stack is boxed inside the other, near 0 for cards side by side."""
    inter = _intersection(a, b)
    return inter / min(_area(a), _area(b)) if inter else 0.0


def merge_same_name(
    items: list[T],
    name: Callable[[T], Hashable | None],
    box: Callable[[T], Box],
    absorb: Callable[[T, T], T],
) -> list[T]:
    """Collapse items with the same `name` whose boxes overlap by at least half
    of the smaller box: one stack seen as several detections. Each item folds
    into the first earlier survivor it matches, and `absorb(kept, item)` returns
    what stays in that slot. A `name` of None never merges."""
    out: list[T] = []
    for item in items:
        key = name(item)
        for i, kept in enumerate(out):
            if key is not None and name(kept) == key and overlap_of_smaller(box(kept), box(item)) >= 0.5:
                out[i] = absorb(kept, item)
                break
        else:
            out.append(item)
    return out
