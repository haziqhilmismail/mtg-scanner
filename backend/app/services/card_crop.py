from __future__ import annotations

import numpy as np
from PIL import Image

# Scryfall's "normal" card image: the size the index builder embeds and the
# scanner warps every detection to.
CARD_SIZE = (488, 680)
MIN_SIDE = 16
CROP_VERSION = 1
CROP_QUALITY = 95


def warp_quad(
    img: Image.Image,
    quad: np.ndarray | list[list[float]],
    out_size: tuple[int, int] = CARD_SIZE,
) -> Image.Image:
    """Flatten the quadrilateral `quad` (TL, TR, BR, BL) to an axis-aligned
    card-shaped image, so the embedder and OCR see a head-on view of the card
    regardless of how it was tilted in the photo. Pure PIL — no cv2."""
    src = np.asarray(quad, dtype=float).reshape(4, 2)
    W, H = out_size
    dst = np.array([[0, 0], [W, 0], [W, H], [0, H]], dtype=float)
    # PIL.Image.PERSPECTIVE wants the inverse mapping (dst → src).
    rows: list[list[float]] = []
    for (xd, yd), (xs, ys) in zip(dst, src):
        rows.append([xd, yd, 1, 0, 0, 0, -xd * xs, -yd * xs])
        rows.append([0, 0, 0, xd, yd, 1, -xd * ys, -yd * ys])
    coeffs = np.linalg.solve(np.asarray(rows), src.reshape(8)).tolist()
    return img.transform(out_size, Image.PERSPECTIVE, coeffs, Image.BICUBIC)


def _warped(photo: Image.Image, card: dict) -> Image.Image | None:
    quad = np.asarray(card["corners"], dtype=float).reshape(4, 2)
    if min(np.linalg.norm(quad[1] - quad[0]), np.linalg.norm(quad[3] - quad[0])) < MIN_SIDE:
        return None
    return warp_quad(photo, quad)


def _boxed(photo: Image.Image, card: dict) -> Image.Image | None:
    x, y, w, h = card["bbox"]
    box = (max(0, x), max(0, y), min(photo.width, x + w), min(photo.height, y + h))
    if box[2] - box[0] < MIN_SIDE or box[3] - box[1] < MIN_SIDE:
        return None
    if box == (0, 0, photo.width, photo.height):
        return None
    return photo.crop(box)


# By `bbox_source`. A source that is not here has no crop: "user" boxes are a
# placeholder in the middle of the photo (Scanner.tsx addMissingCard), so a
# crop of one shows no card.
_CUTS = {"detector": _warped, "classical": _boxed, "gemini": _boxed}


def card_crop(photo: Image.Image, card: dict) -> Image.Image | None:
    cut = _CUTS.get(card.get("bbox_source"))
    if cut is None:
        return None
    try:
        return cut(photo, card)
    except np.linalg.LinAlgError:
        return None
