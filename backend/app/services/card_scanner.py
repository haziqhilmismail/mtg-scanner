"""
card_scanner.py
---------------
The experimental local scan pipeline: photo in, identified cards out, with no
cloud model involved. Enabled with SCANNER_BACKEND=local (see local_scan.py
for the FastAPI glue); the default pipeline is still Gemini.

  1. DETECT   card_detector.py   YOLO11n-OBB finds every card as a rotated quad.
  2. NAME     card_embedder.py   each quad is warped flat, embedded, and matched
                                 against one embedding per Scryfall printing;
              collector_ocr.py   the title bar is OCR'd and, when it reads as
                                 a real card name, overrules a look-alike.
  3. VERSION  collector_ocr.py   the collector line (set code + number) is
                                 OCR'd and used to pick the exact printing
                                 among the reprints of that card.
  4. FOIL     the ★ / • glyph on the collector line, or the printing's
              Scryfall `finishes` when it only exists in one finish.
  Quantity is always 1 — the seller sets it for stacks in the UI.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
from PIL import Image
from pydantic import BaseModel

from .card_detector import CardDetector, Detection, warp_quad
from .card_embedder import CardIndex, Embedder, Printing, normalize_name
from .collector_ocr import (
    STRIP_SIZE, TITLE_SIZE, CollectorLine, CollectorReader, strip_quad, title_quad,
)

CARD_ASPECT = 488.0 / 680.0  # width / height

# Cosine similarity below which a detection is dropped as "not a card we
# know" (keyboard, phone, a card too cropped or glared to recognise).
MIN_MATCH_SCORE = 0.38
# A detection more elongated than this is a stack of offset cards, not one
# card: the full card sits at one end and is located by trying both.
STACK_ASPECT = 0.64
# Cards narrower than this in the photo have an illegible collector line —
# skip the OCR rather than pay for a guaranteed miss.
MIN_OCR_CARD_WIDTH = 180
# The OCR'd set + number may point at a different card than the embedding's
# best match. Trust it only if that card also looks plausible.
OCR_OVERRIDE_MARGIN = 0.12

# Title OCR (see `pick_card`). A title that isn't an exact card name is
# fuzzy-matched against the names of the embedding's nearest neighbours.
TITLE_NEIGHBOURS = 200
TITLE_MIN_RATIO = 0.78
# An exact title match is ignored if that card looks nothing like the crop —
# it means OCR picked up some other text that happens to be a card name.
TITLE_MAX_SCORE_GAP = 0.35
# Without a collector line, printings of the chosen card scoring within this
# of the best are a coin flip for the embedding; prefer a regular set
# printing over a promo among them.
PRINTING_TIE_MARGIN = 0.04


class CardDetection(BaseModel):
    """One identified card. Field names are the contract with the frontend
    (which reads this under each card's `gemini` key) and with
    scryfall_lookup.lookup_all — empty string means "unknown"."""

    name: str
    set_code: str  # Scryfall set code, lowercase
    collector_number: str
    is_foil: bool
    quantity: int  # always 1 from the scanner; the seller sets stacks in the UI
    scryfall_id: str = ""


@dataclass
class ScannedCard:
    det: CardDetection
    quad: np.ndarray  # (4, 2) TL, TR, BR, BL of the upright card, image pixels
    score: float  # cosine similarity of the embedding match
    name_source: str  # "title" (OCR'd name agreed or overruled) | "embedding"
    version_source: str  # "ocr" | "embedding"
    foil_source: str  # "ocr" | "finishes" | "default"

    @property
    def bbox(self) -> tuple[int, int, int, int]:
        """Axis-aligned (x, y, w, h) around the quad."""
        x0, y0 = np.floor(self.quad.min(axis=0))
        x1, y1 = np.ceil(self.quad.max(axis=0))
        return int(x0), int(y0), int(x1 - x0), int(y1 - y0)


def _candidate_quads(quad: np.ndarray) -> list[np.ndarray]:
    """Upright-card hypotheses (TL, TR, BR, BL) for a detected quad.

    A rotated box doesn't say which short edge is the card's top, so a plain
    card gets two hypotheses 180° apart. A stack gets four: the full card is
    at either end of the box, either way up.
    """
    q0, q1, q2, q3 = quad
    short = np.linalg.norm(q1 - q0)
    long = np.linalg.norm(q2 - q1)
    if long <= 0 or short / long >= STACK_ASPECT:
        return [quad, quad[[2, 3, 0, 1]]]
    v = (q2 - q1) / long * (short / CARD_ASPECT)  # one card length along the box
    near = np.array([q0, q1, q1 + v, q0 + v])
    far = np.array([q3 - v, q2 - v, q2, q3])
    return [near, near[[2, 3, 0, 1]], far, far[[2, 3, 0, 1]]]


def _digits(collector_number: str) -> str:
    return re.sub(r"\D", "", collector_number).lstrip("0")


def pick_card(index: CardIndex, scores: np.ndarray, titles: list[str]) -> tuple[int, str]:
    """Decide WHICH CARD a crop is. Returns (index row, "title" | "embedding").

    The embedding's nearest neighbour is right most of the time, but its
    mistakes are confident look-alikes (same frame, similar art) that no
    score threshold catches. The title bar is the tie-breaker: big text,
    legible even when the card is small in the photo.
    """
    top = int(np.argmax(scores))
    for title in titles:
        if len(normalize_name(title)) < 3:
            continue
        rows = index.rows_named(title)
        if rows:
            best = int(rows[int(np.argmax(scores[rows]))])
            if scores[best] >= scores[top] - TITLE_MAX_SCORE_GAP:
                return best, "title"

    # No exact name. OCR drops or swaps the odd letter, so compare against
    # the names of the nearest neighbours and accept a close-enough one.
    k = min(TITLE_NEIGHBOURS, len(scores) - 1)
    near = np.argpartition(-scores, k)[:k]
    near = near[np.argsort(-scores[near])]
    best_ratio, best_row = 0.0, top
    seen: set[bytes] = set()
    for row in near:
        raw = bytes(index.name[row])
        if raw in seen:
            continue
        seen.add(raw)
        for face in raw.decode("utf-8").split("//"):
            face = normalize_name(face)
            for title in titles:
                ratio = SequenceMatcher(None, normalize_name(title), face).ratio()
                if ratio > best_ratio:
                    best_ratio, best_row = ratio, int(row)
    if best_ratio >= TITLE_MIN_RATIO:
        return best_row, "title"
    return top, "embedding"


def pick_printing(
    index: CardIndex, scores: np.ndarray, top: int, line: CollectorLine | None,
    name_confirmed: bool = False,
) -> tuple[Printing, str]:
    """Choose the exact printing for one crop.

    `scores` is the crop's similarity to every index row and `top` the row
    `pick_card` settled on; the collector line then picks among that card's
    printings. Returns (printing, "ocr" | "embedding").
    """
    rows = index.same_card_rows(top)

    def by_look() -> tuple[Printing, str]:
        # Near-identical reprints: take a regular printing over a promo.
        best_score = float(scores[rows].max())
        tied = [r for r in rows if scores[r] >= best_score - PRINTING_TIE_MARGIN]
        row = int(max(tied, key=lambda r: (-int(index.promo[r]), scores[r])))
        return index.printing(row, scores[row]), "embedding"

    if not line:
        return by_look()

    def points(row: int) -> int:
        set_code = index.set[row].decode()
        number = index.collector_number[row].decode().lower()
        p = 0
        if line.set_code:
            if set_code == line.set_code:
                p += 4
            # Promo sets print the parent set's code: `pdmu` cards say DMU.
            elif len(set_code) == len(line.set_code) + 1 and set_code.endswith(line.set_code):
                p += 3
        if number.lstrip("0") in line.numbers:
            p += 4
        elif _digits(number) and _digits(number) in line.numbers:
            p += 2  # "123" printed, Scryfall lists it as 123s / 123p / 123★
        return p

    ranked = sorted(rows, key=lambda r: (points(r), -int(index.promo[r]), scores[r]), reverse=True)
    best = int(ranked[0])
    best_points = points(best)
    if best_points >= 6:  # set and number both agree
        return index.printing(best, scores[best]), "ocr"

    # Set + number read cleanly but match no printing of the chosen card: the
    # embedding may have named a look-alike. Believe the text if the card it
    # points at is also a close visual match — unless the title already
    # confirmed the name.
    if line.set_code and not name_confirmed:
        for number in line.numbers:
            for row in index.rows_for(line.set_code, number):
                if scores[row] >= scores[top] - OCR_OVERRIDE_MARGIN:
                    return index.printing(int(row), scores[row]), "ocr"

    if best_points >= 3:
        # Only one of the two agreed — enough to narrow the field; promo
        # status and then the embedding break the tie, which `ranked` did.
        return index.printing(best, scores[best]), "ocr"
    return by_look()


def _overlap_of_smaller(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    """Intersection of two (x, y, w, h) boxes as a fraction of the smaller."""
    iw = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
    ih = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    if iw <= 0 or ih <= 0:
        return 0.0
    return iw * ih / max(1, min(a[2] * a[3], b[2] * b[3]))


def _merge_duplicates(cards: list[ScannedCard]) -> list[ScannedCard]:
    """Collapse same-name detections that overlap by more than half of the
    smaller box — the detector occasionally boxes a stack and the card on top
    of it separately. The better match survives with the larger quantity."""
    out: list[ScannedCard] = []
    for card in cards:
        for i, kept in enumerate(out):
            if (kept.det.name == card.det.name
                    and _overlap_of_smaller(kept.bbox, card.bbox) >= 0.5):
                winner, loser = (kept, card) if kept.score >= card.score else (card, kept)
                winner.det.quantity = max(winner.det.quantity, loser.det.quantity)
                out[i] = winner
                break
        else:
            out.append(card)
    return out


class CardScanner:
    def __init__(self, detector_path: Path, embedder_path: Path, index_path: Path):
        self.detector = CardDetector(detector_path)
        self.embedder = Embedder(embedder_path)
        self.index = CardIndex(index_path)
        self.reader = CollectorReader()

    def scan(self, img: Image.Image) -> list[ScannedCard]:
        """Find and identify every card in an RGB photo, in reading order."""
        detections = self.detector.detect(img)
        cards = self._identify(img, [_candidate_quads(d.quad) for d in detections])
        return _merge_duplicates([c for c in cards if c is not None])

    def identify_quad(self, img: Image.Image, quad: list[list[int]]) -> ScannedCard | None:
        """Identify the card inside a user-drawn quad (TL, TR, BR, BL)."""
        q = np.asarray(quad, dtype=float)
        return self._identify(img, [[q, q[[2, 3, 0, 1]]]])[0]

    def _identify(
        self, img: Image.Image, hypotheses: list[list[np.ndarray]],
    ) -> list[ScannedCard | None]:
        flat = [q for group in hypotheses for q in group]
        if not flat:
            return []
        vectors = self.embedder.embed_images([warp_quad(img, q) for q in flat])
        scores = self.index.scores(vectors)

        out: list[ScannedCard | None] = []
        start = 0
        for group in hypotheses:
            group_scores = scores[start:start + len(group)]
            start += len(group)
            if float(group_scores.max()) < MIN_MATCH_SCORE:
                out.append(None)
                continue

            # Which way up is the card? The embedding's favourite orientation
            # is usually right, but an upside-down card can look more like
            # some other card than like itself. A title that reads as a real
            # card name settles it, so try each orientation, best first, until
            # one does.
            order = np.argsort(-group_scores.max(axis=1))
            quad, row_scores = group[order[0]], group_scores[order[0]]
            top, name_source = int(np.argmax(row_scores)), "embedding"
            for h in order:
                try:
                    titles = self.reader.read_title(warp_quad(img, title_quad(group[h]), TITLE_SIZE))
                except Exception as e:
                    print(f"[scan] title OCR failed: {e}", flush=True)
                    continue
                h_top, h_source = pick_card(self.index, group_scores[h], titles)
                if h_source == "title":
                    quad, row_scores = group[h], group_scores[h]
                    top, name_source = h_top, h_source
                    break

            line = None
            if np.linalg.norm(quad[1] - quad[0]) >= MIN_OCR_CARD_WIDTH:
                try:
                    line = self.reader.read(warp_quad(img, strip_quad(quad), STRIP_SIZE))
                except Exception as e:
                    print(f"[scan] collector OCR failed: {e}", flush=True)
            printing, version_source = pick_printing(
                self.index, row_scores, top, line, name_confirmed=name_source == "title",
            )

            if printing.foil_only:
                is_foil, foil_source = True, "finishes"
            elif printing.nonfoil_only:
                is_foil, foil_source = False, "finishes"
            elif line is not None and line.foil is not None:
                is_foil, foil_source = line.foil, "ocr"
            else:
                is_foil, foil_source = False, "default"

            out.append(ScannedCard(
                det=CardDetection(
                    name=printing.name,
                    set_code=printing.set,
                    collector_number=printing.collector_number,
                    is_foil=is_foil,
                    quantity=1,
                    scryfall_id=printing.scryfall_id,
                ),
                quad=quad,
                score=printing.score,
                name_source=name_source,
                version_source=version_source,
                foil_source=foil_source,
            ))
        return out
