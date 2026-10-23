"""
card_detector.py
----------------
Locate every card in a photo with a YOLO11n oriented-bounding-box model
(ONNX, CPU). Each detection is a rotated rectangle, so tilted cards get a
tight 4-corner quad instead of a loose axis-aligned box.

The model only knows card *geometry* — it says "there is a card here", not
which card. Naming happens in card_embedder.py on the warped crop.

Model: matteot11/collector-mtg-pkm-detector-yolo11n-obb (AGPL-3.0, fine-tuned
from Ultralytics yolo11n-obb). Exported with
`YOLO("best.pt").export(format="onnx", imgsz=640)`; raw output is
(1, 4 + nc + 1, 8400) = [cx, cy, w, h, class scores…, angle] per anchor, in
letterboxed input pixels, angle in radians.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

INPUT_SIZE = 640
PAD_VALUE = 114

# Minimum class score to keep a detection.
CONF_THRESHOLD = 0.35
# Rotated-box overlap (probabilistic IoU) above which the lower-scoring box is
# treated as a duplicate of the same card.
NMS_THRESHOLD = 0.45
# MTG cards are 63x88 mm (0.716). Boxes far from that are two cards merged
# into one, a card mostly out of frame, or not a card at all.
MIN_ASPECT = 0.50
MAX_ASPECT = 0.95


@dataclass
class Detection:
    quad: np.ndarray  # (4, 2) float corners, clockwise, short edge first
    score: float

    @property
    def bbox(self) -> tuple[int, int, int, int]:
        """Axis-aligned (x, y, w, h) around the quad."""
        x0, y0 = self.quad.min(axis=0)
        x1, y1 = self.quad.max(axis=0)
        return int(x0), int(y0), int(round(x1 - x0)), int(round(y1 - y0))


def _covariance(boxes: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Gaussian covariance terms (a, b, c) of [cx, cy, w, h, angle] boxes."""
    a = boxes[:, 2] ** 2 / 12.0
    b = boxes[:, 3] ** 2 / 12.0
    cos, sin = np.cos(boxes[:, 4]), np.sin(boxes[:, 4])
    return a * cos**2 + b * sin**2, a * sin**2 + b * cos**2, (a - b) * cos * sin


def _probiou(box: np.ndarray, others: np.ndarray) -> np.ndarray:
    """Probabilistic IoU of one rotated box against many (arXiv 2106.06072),
    the same overlap measure Ultralytics uses for OBB NMS."""
    eps = 1e-7
    a1, b1, c1 = _covariance(box[None])
    a2, b2, c2 = _covariance(others)
    dx, dy = others[:, 0] - box[0], others[:, 1] - box[1]
    denom = (a1 + a2) * (b1 + b2) - (c1 + c2) ** 2 + eps
    t1 = ((a1 + a2) * dy**2 + (b1 + b2) * dx**2) / denom * 0.25
    t2 = ((c1 + c2) * -dx * dy) / denom * 0.5
    det1 = np.clip(a1 * b1 - c1**2, 0, None)
    det2 = np.clip(a2 * b2 - c2**2, 0, None)
    t3 = 0.5 * np.log(denom / (4 * np.sqrt(det1 * det2) + eps) + eps)
    bd = np.clip(t1 + t2 + t3, eps, 100.0)
    return 1.0 - np.sqrt(1.0 - np.exp(-bd) + eps)


def _nms(boxes: np.ndarray, scores: np.ndarray) -> list[int]:
    order = list(np.argsort(-scores))
    keep: list[int] = []
    while order:
        i = order.pop(0)
        keep.append(i)
        if not order:
            break
        rest = np.array(order)
        order = list(rest[_probiou(boxes[i], boxes[rest]) < NMS_THRESHOLD])
    return keep


def _to_quad(cx: float, cy: float, w: float, h: float, angle: float) -> np.ndarray:
    """Rotated rect → 4 corners, clockwise in image space, starting so that
    edge 0→1 is a SHORT edge (a candidate for the card's top edge)."""
    if w > h:  # make `w` the short side by turning the box a quarter turn
        w, h, angle = h, w, angle + np.pi / 2
    cos, sin = np.cos(angle), np.sin(angle)
    ux, uy = np.array([cos, sin]) * w / 2, np.array([-sin, cos]) * h / 2
    c = np.array([cx, cy])
    return np.array([c - ux - uy, c + ux - uy, c + ux + uy, c - ux + uy])


class CardDetector:
    def __init__(self, model_path: Path):
        self.session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name

    def detect(self, img: Image.Image) -> list[Detection]:
        """Find cards in an RGB image. Returns detections in reading order."""
        W, H = img.size
        scale = INPUT_SIZE / max(W, H)
        nw, nh = max(1, round(W * scale)), max(1, round(H * scale))
        px, py = (INPUT_SIZE - nw) // 2, (INPUT_SIZE - nh) // 2
        canvas = np.full((INPUT_SIZE, INPUT_SIZE, 3), PAD_VALUE, dtype=np.uint8)
        canvas[py:py + nh, px:px + nw] = np.asarray(img.resize((nw, nh), Image.BILINEAR))
        blob = (canvas.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]

        pred = self.session.run(None, {self.input_name: blob})[0][0].T  # (8400, 4+nc+1)
        scores = pred[:, 4:-1].max(axis=1)  # best of the card classes (mtg / pokemon)
        mask = scores >= CONF_THRESHOLD
        if not mask.any():
            return []
        boxes = np.concatenate([pred[mask, :4], pred[mask, -1:]], axis=1)
        scores = scores[mask]

        out: list[Detection] = []
        for i in _nms(boxes, scores):
            cx, cy, w, h, angle = boxes[i]
            short, long = sorted((w, h))
            if long <= 0 or not MIN_ASPECT <= short / long <= MAX_ASPECT:
                continue
            quad = _to_quad(cx, cy, w, h, angle)
            quad = (quad - [px, py]) / scale  # undo the letterbox
            out.append(Detection(quad=quad, score=float(scores[i])))

        # Reading order: rows top-to-bottom, then left-to-right. Cards whose
        # centres sit within half a card height of each other share a row.
        if out:
            centres = np.array([d.quad.mean(axis=0) for d in out])
            row_h = float(np.median([d.bbox[3] for d in out])) * 0.5
            rows = np.round(centres[:, 1] / max(row_h, 1.0))
            out = [out[i] for i in np.lexsort((centres[:, 0], rows))]
        return out


def warp_quad(
    img: Image.Image,
    quad: np.ndarray | list[list[float]],
    out_size: tuple[int, int] = (488, 680),
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
