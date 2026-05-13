"""
classical_detector.py
---------------------
Pure PIL + numpy + scipy.ndimage card-bbox detector.

Pipeline:
    grayscale -> Gaussian blur -> Sobel edges -> adaptive threshold ->
    morphological closing -> fill holes -> connected components ->
    filter by area + MTG card aspect ratio (~488:680).

`detect_card_bboxes` returns axis-aligned (x, y, w, h) boxes (kept for callers
that just need a rectangle). `detect_card_quads` extends each kept blob with
its smallest enclosing quadrilateral (4 corner points) via convex hull →
polygon simplification → all-C(n, 4) edge-combination search. The quad is
what the frontend uses to draw a tight outline on tilted/skewed cards and
what `price_overlay.py` uses to draw a 4-point polygon instead of a rectangle.

No neural model is loaded — this is a bbox-refinement pass over Gemini's
detections. It works well on clean photos (uniform background, well-separated
cards) and degrades gracefully (returns fewer boxes) when the scene gets
noisy; callers should treat the absence of a matching classical box as
"trust Gemini's bbox instead."
"""

from io import BytesIO
from itertools import combinations

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull, QhullError

# MTG card pixel aspect: 488 wide / 680 tall ≈ 0.7176. Accept boxes within
# ±0.25 of this (covers slight perspective skew) and treat rotated cards
# (aspect ≈ 1/0.7176 = 1.39) as valid too.
CARD_W_OVER_H = 488.0 / 680.0
AR_TOLERANCE = 0.25

# Minimum blob area as a fraction of the image — anything smaller is noise
# (specks of glare, label text, etc.).
MIN_AREA_FRAC = 0.015

# Solidity: a card-shaped blob should fill its bbox densely. Anything
# below this is probably a fragmented edge rather than a real card.
MIN_SOLIDITY = 0.85

# How aggressively to close edge gaps. Higher = more tolerant of broken
# card borders, but starts merging neighbouring cards.
CLOSE_ITERATIONS = 4

# Quad simplification: stop dropping hull segments once every remaining
# segment is at least this fraction of the perimeter. 0.15 = ~6-vertex
# polygon for a typical card hull.
QUAD_MIN_SEG_FRAC = 0.15


def detect_card_bboxes(image_bytes: bytes) -> list[tuple[int, int, int, int]]:
    """Axis-aligned bboxes only. Returns [(x, y, w, h), ...]. Empty on failure.

    Kept as the legacy entry point — `detect_card_quads` is the full pipeline.
    """
    return [bbox for bbox, _quad in detect_card_quads(image_bytes)]


def detect_card_quads(
    image_bytes: bytes,
) -> list[tuple[tuple[int, int, int, int], list[list[int]]]]:
    """Find card-shaped blobs and return (bbox, quad) for each.

    bbox is the axis-aligned (x, y, w, h) rectangle that encloses the blob;
    quad is a 4-point [[x, y], ...] list of corners (TL, TR, BR, BL in image
    coordinates) following the actual card edges. Empty list on failure.
    """
    try:
        pil = Image.open(BytesIO(image_bytes))
        pil.load()
    except Exception:
        return []

    W, H = pil.size
    if W < 200 or H < 200:
        return []

    gray = pil.convert("L").filter(ImageFilter.GaussianBlur(radius=3))
    g = np.asarray(gray, dtype=np.float32)

    # Sobel magnitude
    gx = ndi.sobel(g, axis=1)
    gy = ndi.sobel(g, axis=0)
    mag = np.hypot(gx, gy)
    if mag.max() == 0:
        return []
    mag = mag / mag.max()

    # Adaptive threshold: mean + 1σ catches real card edges while ignoring
    # background texture (wood grain, table noise).
    thresh = mag > (mag.mean() + mag.std())
    closed = ndi.binary_closing(thresh, iterations=CLOSE_ITERATIONS)
    filled = ndi.binary_fill_holes(closed)

    labels, n = ndi.label(filled)
    if n == 0:
        return []

    min_area = (W * H) * MIN_AREA_FRAC

    # First pass: collect candidate blobs that pass the bbox-level gates.
    # We need the slice (sl) to extract the boundary for the quad step.
    raw: list[tuple[int, int, int, int, int, tuple[slice, slice], int]] = []
    for i, sl in enumerate(ndi.find_objects(labels), start=1):
        if sl is None:
            continue
        ys, xs = sl
        x1, x2 = int(xs.start), int(xs.stop - 1)
        y1, y2 = int(ys.start), int(ys.stop - 1)
        w, h = x2 - x1, y2 - y1
        if w <= 0 or h <= 0:
            continue
        area = w * h
        if area < min_area:
            continue
        ar = w / h
        ar_score = min(abs(ar - CARD_W_OVER_H), abs(ar - 1.0 / CARD_W_OVER_H))
        if ar_score > AR_TOLERANCE:
            continue
        pixel_count = int((labels[sl] == i).sum())
        solidity = pixel_count / area
        if solidity < MIN_SOLIDITY:
            continue
        raw.append((x1, y1, x2, y2, area, sl, i))

    # Sort by area desc, dedupe by IoU > 0.3.
    raw.sort(key=lambda b: -b[4])
    kept: list[tuple[int, int, int, int, int, tuple[slice, slice], int]] = []
    for b in raw:
        if any(_iou_xyxy(b[:4], k[:4]) > 0.3 for k in kept):
            continue
        kept.append(b)

    # Second pass: compute the min-area quadrilateral for each kept blob.
    # If the quad search fails for some reason, fall back to the rectangle.
    out: list[tuple[tuple[int, int, int, int], list[list[int]]]] = []
    for x1, y1, x2, y2, _area, sl, label_id in kept:
        bbox = (x1, y1, x2 - x1, y2 - y1)
        quad = _min_area_quad_for_blob(labels, sl, label_id, W, H)
        if quad is None:
            # Axis-aligned 4 corners — keeps the response shape stable
            # so downstream code can always treat 'corners' as a polygon.
            quad = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
        out.append((bbox, quad))

    return out


def _iou_xyxy(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    """IoU between two (x1, y1, x2, y2) boxes."""
    ix1 = max(a[0], b[0]); iy1 = max(a[1], b[1])
    ix2 = min(a[2], b[2]); iy2 = min(a[3], b[3])
    iw = max(0, ix2 - ix1); ih = max(0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    ua = (a[2] - a[0]) * (a[3] - a[1])
    ub = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (ua + ub - inter)


def iou_xywh(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    """IoU between two (x, y, w, h) boxes. Used by the matcher in main.py."""
    ax1, ay1, aw, ah = a
    bx1, by1, bw, bh = b
    ax2, ay2 = ax1 + aw, ay1 + ah
    bx2, by2 = bx1 + bw, by1 + bh
    ix1 = max(ax1, bx1); iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2); iy2 = min(ay2, by2)
    iw = max(0, ix2 - ix1); ih = max(0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    return inter / (aw * ah + bw * bh - inter)


# ---------- min-area quadrilateral helpers ----------
# Geometry ported from notebook §25. The quad search reduces each blob's
# convex hull to a 5–8 vertex polygon by dropping its shortest segments,
# then brute-forces all 4-subsets of edges to find the smallest enclosing
# quadrilateral. C(8, 4) = 70 candidates — cheap.


def _line_intersection(
    p1: np.ndarray, p2: np.ndarray, p3: np.ndarray, p4: np.ndarray
) -> np.ndarray | None:
    """Intersection of the infinite line through (p1, p2) with line (p3, p4)."""
    denom = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0])
    if abs(denom) < 1e-9:
        return None
    t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / denom
    return np.array([p1[0] + t * (p2[0] - p1[0]),
                     p1[1] + t * (p2[1] - p1[1])])


def _point_in_polygon(pt: np.ndarray, poly: np.ndarray) -> bool:
    """Crossing-number test. poly is (N, 2)."""
    x, y = pt
    n = len(poly)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi
        ):
            inside = not inside
        j = i
    return inside


def _simplify_polygon(poly: np.ndarray, min_frac: float = QUAD_MIN_SEG_FRAC) -> np.ndarray:
    """Drop shortest segments until every remaining segment is >= min_frac
    of perimeter, or we're down to 4 vertices. Each drop replaces a segment's
    two endpoints with the intersection of the neighbouring extended edges."""
    poly = np.asarray(poly, dtype=float).copy()
    safety = 0
    while len(poly) > 4 and safety < 50:
        safety += 1
        d = np.linalg.norm(np.roll(poly, -1, axis=0) - poly, axis=1)
        if d.min() / (d.sum() + 1e-9) >= min_frac:
            break
        k = int(np.argmin(d))
        n = len(poly)
        a, b = poly[(k - 1) % n], poly[k]
        c, e = poly[(k + 1) % n], poly[(k + 2) % n]
        inter = _line_intersection(a, b, c, e)
        if inter is None:
            poly = np.delete(poly, k, axis=0)
            continue
        keep = np.ones(n, dtype=bool)
        keep[k] = False
        keep[(k + 1) % n] = False
        poly = np.vstack([poly[keep], inter])
        c0 = poly.mean(axis=0)
        ang = np.arctan2(poly[:, 1] - c0[1], poly[:, 0] - c0[0])
        poly = poly[np.argsort(ang)]
    return poly


def _polygon_area(poly: np.ndarray) -> float:
    x, y = poly[:, 0], poly[:, 1]
    return 0.5 * abs(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def _min_area_quad(poly: np.ndarray) -> np.ndarray | None:
    """All C(n, 4) edge combinations → corner intersections → filter by
    containment of the (slightly shrunk) input polygon → smallest area wins."""
    n = len(poly)
    if n < 4:
        return None
    edges = [(poly[i], poly[(i + 1) % n]) for i in range(n)]
    centroid = poly.mean(axis=0)
    shrunk = centroid + (poly - centroid) * 0.9999
    best_area, best_q = float("inf"), None
    for combo in combinations(range(n), 4):
        e = [edges[i] for i in combo]
        corners: list[np.ndarray] = []
        ok = True
        for k in range(4):
            inter = _line_intersection(
                e[k][0], e[k][1], e[(k + 1) % 4][0], e[(k + 1) % 4][1]
            )
            if inter is None:
                ok = False; break
            corners.append(inter)
        if not ok:
            continue
        q = np.asarray(corners)
        if not all(_point_in_polygon(p, q) for p in shrunk):
            continue
        a = _polygon_area(q)
        if a < best_area:
            best_area, best_q = a, q
    return best_q


def _order_quad_corners(q: np.ndarray) -> np.ndarray:
    """Sort 4 corners to (TL, TR, BR, BL) by position. Robust for cards with
    mild skew (<45°). For sideways cards we rotate by 90° CCW so the long
    edge is vertical (portrait), matching the orientation pHash and the
    frontend overlay expect.

    Earlier draft used angle-around-centroid + chirality flip; that swapped
    TL ↔ TR on some cyclic inputs of `_min_area_quad`, which would mirror
    the polygon outline in the rendered overlay."""
    q = np.asarray(q, dtype=float)
    by_y = q[np.argsort(q[:, 1])]
    top, bot = by_y[:2], by_y[2:]
    TL, TR = top[np.argsort(top[:, 0])]
    BL, BR = bot[np.argsort(bot[:, 0])]
    out = np.array([TL, TR, BR, BL])
    top_len = float(np.linalg.norm(TR - TL))
    left_len = float(np.linalg.norm(BL - TL))
    if top_len > left_len:
        out = out[[3, 0, 1, 2]]
    return out


def perspective_warp(
    pil_rgb: Image.Image,
    corners: list[list[int]] | np.ndarray,
    out_size: tuple[int, int] = (488, 680),
) -> Image.Image:
    """Flatten the quadrilateral region defined by `corners` to an axis-aligned
    card-shaped image. `corners` is the 4-point [TL, TR, BR, BL] array we ship
    in `/api/scan`'s `corners` field — same orientation as `_order_quad_corners`
    produces.

    Used in front of pHash hashing so the index (built from upright Scryfall
    images) sees a head-on view of the card regardless of how skewed the photo
    was. Empirically lifts clean-photo top-1 accuracy from 1/4 → 4/4 in
    notebook §27. Pure PIL — no cv2.
    """
    src = np.asarray(corners, dtype=float).reshape(4, 2)
    W, H = out_size
    dst = np.array([[0, 0], [W, 0], [W, H], [0, H]], dtype=float)
    # PIL.Image.PERSPECTIVE wants the inverse mapping (dst → src).
    rows: list[list[float]] = []
    for (xd, yd), (xs, ys) in zip(dst, src):
        rows.append([xd, yd, 1, 0, 0, 0, -xd * xs, -yd * xs])
        rows.append([0, 0, 0, xd, yd, 1, -xd * ys, -yd * ys])
    coeffs = np.linalg.solve(np.asarray(rows), src.reshape(8)).tolist()
    return pil_rgb.transform(out_size, Image.PERSPECTIVE, coeffs, Image.BICUBIC)


def _min_area_quad_for_blob(
    labels: np.ndarray,
    sl: tuple[slice, slice],
    label_id: int,
    W: int,
    H: int,
) -> list[list[int]] | None:
    """Wrap the geometry helpers for a single labelled blob. Returns
    [[x, y], [x, y], [x, y], [x, y]] in (TL, TR, BR, BL) order, or None
    if the quad search fails."""
    region = (labels[sl] == label_id)
    boundary = region & ~ndi.binary_erosion(region)
    ys, xs = np.where(boundary)
    if len(xs) < 8:
        return None
    xs = xs + sl[1].start
    ys = ys + sl[0].start
    pts = np.column_stack([xs, ys]).astype(float)
    try:
        hull = ConvexHull(pts)
    except QhullError:
        return None
    hull_pts = pts[hull.vertices]
    simp = _simplify_polygon(hull_pts)
    if len(simp) < 4:
        return None
    quad = _min_area_quad(simp)
    if quad is None:
        return None
    ordered = _order_quad_corners(quad)
    # Clamp to image bounds; cast to int for the response.
    out: list[list[int]] = []
    for x, y in ordered:
        out.append([int(np.clip(round(x), 0, W - 1)),
                    int(np.clip(round(y), 0, H - 1))])
    return out
