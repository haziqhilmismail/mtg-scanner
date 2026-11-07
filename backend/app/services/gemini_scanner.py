"""
gemini_scanner.py
-----------------
The Gemini scanner (SCANNER_BACKEND=gemini, the code default) behind the
`Scanner` interface of services/scans.py.

Gemini does both jobs in one call:
  - Locates each card (returns bounding box in normalized [0,1000] coords)
  - Identifies it (card name, set code, collector number)
  - Tells us if it looks foil

Output format follows Google's recommended bounding-box convention:
  box_2d = [ymin, xmin, ymax, xmax] in 0-1000 scale

The classical detector (classical_detector.py) then tightens each box to a
card-shaped blob when one matches, and supplies the card's corner quad.
"""

import asyncio

from google.genai import types
from PIL import Image
from pydantic import BaseModel

from ..config import settings
from ..schemas.scan import Detection, Guess
from . import gemini
from .card_geometry import iou, merge_same_name, xyxy
from .classical_detector import detect_card_quads


# Gemini's answer for one card. Structured outputs don't support
# Optional/Union types, so empty strings mean "unknown" instead of null.
class GeminiCard(BaseModel):
    name: str          # exact card name as printed (English)
    set_code: str      # 3-letter Scryfall set code, lowercase, or "" if unknown
    collector_number: str  # collector number from card bottom, or "" if unknown
    is_foil: bool      # true if rainbow shimmer / holographic treatment visible
    quantity: int      # 1 for a single card; N for N stacked-with-offset copies
    box_2d: list[int]  # [ymin, xmin, ymax, xmax] normalized 0-1000


PROMPT = """You are an expert at identifying Magic: The Gathering trading cards.

Look at this image carefully. It contains one or more MTG cards arranged in a grid (or scattered).

For EACH card visible in the image, return a JSON object with these exact fields:

- name: The exact English card name as printed on the card. Return the English name even if the card is in a non-English language. Be precise — "Lightning Bolt" not "lightning bolt".

  HOW TO READ THE NAME:
  * Look for short, prominent printed text. Card names are 1-5 words typically.
  * Capitalize in Title Case: "Sol Ring", not "sol ring" or "SOL RING".
  * It's printed in a distinct font that stands out from the rules text.
  * Read character-by-character — don't guess from context.

  COMMON MISTAKES TO AVOID:
  * Do NOT return the creature type or subtype as the name (e.g., NOT "Legendary Creature — Human Warrior")
  * Do NOT return flavor text (italic, in the rules-text box, often a quote)
  * Do NOT return rules text (game effects in the text box)
  * Do NOT return the artist credit (small print at the bottom)
  * If the name is in stylized typography or split across decorative elements (banners, ribbons, art-integrated), still read the actual letters.

  CRITICAL — name placement varies by frame:
    * Standard frame: name is at the TOP of the card in a title bar
    * Borderless, showcase, extended-art, and cinematic frames: name is often in the MIDDLE of the card, integrated into the art, printed on a banner, or styled in unusual typography. This is common in recent sets — Edge of Eternities (EOE), Final Fantasy (FIN), Tarkir: Dragonstorm (TDM), Modern Horizons 3 (MH3) showcases, Bloomburrow (BLB) full-art lands, and many Universes Beyond sets.
    * Full-art and stellar-sights basic lands: name may sit on a small horizontal banner near the middle or be otherwise stylized.
    * Token cards: name is usually at the top but in a different font.

  Search the WHOLE card for the printed name. Do NOT confuse it with:
    * Flavor text (italicized, in the lower text box)
    * Rules text (game-text in the lower text box)
    * Subtitle / type line (usually has creature type, e.g., "Legendary Creature — Human Warrior")
    * Mana cost icons in the top-right
    * Artist credit in the small footer
  If the printed text appears stylized, decorative, or in a unique typeface, that is still the card name — read it as-is.

- set_code: The 3-letter Scryfall set code (lowercase) if you can identify the set from the set symbol (usually mid-right of the card, between art and text box) or expansion name (often printed near the bottom).
  Recent sets to recognize: "eoe" (Edge of Eternities), "fin" (Final Fantasy), "tdm" (Tarkir: Dragonstorm), "dft" (Aetherdrift), "fdn" (Foundations), "dsk" (Duskmourn), "blb" (Bloomburrow), "mh3" (Modern Horizons 3), "otj" (Outlaws of Thunder Junction), "mkm" (Murders at Karlov Manor), "lci" (Lost Caverns of Ixalan), "woe" (Wilds of Eldraine), "mat" (March of the Machine: The Aftermath), "mom" (March of the Machine), "neo" (Kamigawa: Neon Dynasty), "mh2" (Modern Horizons 2).
  Return empty string "" if you cannot identify the set with confidence.

- collector_number: The collector number printed in the small footer at the bottom of the card (e.g., "161", "042", "T1"). It usually appears as "161/350" — return just the first part, "161". Return "" if not visible.
  This number is HIGH PRIORITY — set symbols can be worn, glared, or stylized in ways that mislead set identification, but the collector number is small printed text and is the most reliable cross-check for which set+printing a card actually is. Read it carefully even if the set symbol is obvious.

- is_foil: true if you observe rainbow shimmer, holographic effects, or characteristic foil-card light reflections. false otherwise. When uncertain, return false.

- quantity: How many physical copies of this specific card the seller has.
  * Cards laid out FLAT side-by-side, in a grid, or scattered → return ONE detection per card with quantity=1.
  * Cards STACKED with a small offset so multiple title bars or names of the same card peek out from under the top one → return ONE detection covering the stack with quantity equal to the number of visible copies (typically 2 or 3).
  Stacked-with-offset is the seller's shorthand for "I have multiple copies of this card." Do NOT return a separate detection per stacked card — collapse them into a single entry with the right quantity.
  If you cannot tell whether a card is alone or stacked, default to quantity=1.

- box_2d: The bounding box of this specific card as [ymin, xmin, ymax, xmax], with all four values as integers in normalized 0-1000 coordinates (0,0 is top-left, 1000,1000 is bottom-right of the image).
  CRITICAL — make the box TIGHT against the card's printed border:
  * The four edges of your box should align with the card's actual outer edge (the dark rounded rectangle that frames every MTG card).
  * Do NOT include empty table/background space, neighboring cards or partial cards, shadows, or glare.
  * Magic cards have roughly a 488:680 width-to-height ratio (~0.72). If your box's aspect ratio looks very different from this, you're including non-card area — tighten until proportions match a real card.
  * Loose boxes cause the price label to be placed off the card in downstream rendering. Tightness matters.
  For a single card: tight around just that card.
  For a stacked group (quantity > 1): cover the union of the whole visible stack.

Order the array in reading order: top-to-bottom, then left-to-right.

Return ONLY the JSON array. No markdown fences, no explanation, no preamble."""


def scan_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> list[GeminiCard]:
    """Send the image to Gemini and parse out card detections."""
    parsed = gemini.generate_json(
        [types.Part.from_bytes(data=image_bytes, mime_type=mime_type), PROMPT],
        list[GeminiCard],
        temperature=0.1,  # low temp for accuracy
    )
    if parsed is None:
        raise RuntimeError("Could not parse Gemini response")

    # Post-process: Gemini sometimes ignores the "stacked = one detection with qty=N"
    # instruction and returns two separate detections for stacked-with-offset cards.
    # We catch this by looking for overlapping same-name bboxes and collapsing them.
    return _merge_stacked_detections(parsed)


def _stack(kept: GeminiCard, card: GeminiCard) -> GeminiCard:
    """Fold `card` into `kept`: quantities add up and the box covers both."""
    kept.quantity = max(1, kept.quantity) + max(1, card.quantity)
    a, b = kept.box_2d, card.box_2d
    kept.box_2d = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
    return kept


def _merge_stacked_detections(dets: list[GeminiCard]) -> list[GeminiCard]:
    return merge_same_name(
        dets,
        name=lambda d: (d.name or "").strip().lower() or None,
        box=lambda d: (d.box_2d[1], d.box_2d[0], d.box_2d[3], d.box_2d[2]),
        absorb=_stack,
    )


class GeminiScanner:
    model = settings.gemini_model
    costs_credit = True

    def load(self) -> None:
        pass

    def ready(self) -> str | None:
        try:
            gemini.client()
        except Exception as e:
            return str(e)
        return None

    async def detect(self, pil: Image.Image, jpeg: bytes) -> list[Detection]:
        W, H = pil.size

        # Card-shaped blobs: a tight axis-aligned bbox (for IoU matching
        # against Gemini) and a 4-corner quad following the card edges.
        classical_boxes: list[tuple[int, int, int, int]] = []
        classical_quads: list[list[list[int]]] = []
        if settings.use_classical_bbox:
            try:
                for bbox, quad in await asyncio.to_thread(detect_card_quads, jpeg):
                    classical_boxes.append(bbox)
                    classical_quads.append(quad)
            except Exception as e:
                print(f"[scan] classical detector failed: {e}", flush=True)

        # The Gemini SDK call is synchronous and takes several seconds; run it
        # in a worker thread so the event loop keeps serving other requests.
        cards = await asyncio.to_thread(scan_image, jpeg)

        out: list[Detection] = []
        classical_consumed = [False] * len(classical_boxes)
        for card in cards:
            try:
                ymin, xmin, ymax, xmax = card.box_2d
            except (ValueError, TypeError):
                ymin, xmin, ymax, xmax = 0, 0, 1000, 1000

            x = int(xmin / 1000 * W)
            y = int(ymin / 1000 * H)
            x2 = int(xmax / 1000 * W)
            y2 = int(ymax / 1000 * H)
            x, y = max(0, x), max(0, y)
            x2, y2 = min(W, x2), min(H, y2)
            if x2 <= x or y2 <= y:
                x, y, x2, y2 = 0, 0, W, H

            bbox_source = "gemini"
            matched_quad: list[list[int]] | None = None
            if classical_boxes:
                # Match against ALL classical boxes. If the best one was already
                # taken by an earlier Gemini detection, this one is a duplicate of
                # the same card; otherwise refine to it and mark it taken.
                best_iou, best_idx = 0.0, -1
                for ci, cb in enumerate(classical_boxes):
                    cur = iou((x, y, x2, y2), xyxy(cb))
                    if cur > best_iou:
                        best_iou, best_idx = cur, ci
                if best_idx >= 0 and best_iou >= 0.4:
                    if classical_consumed[best_idx]:
                        continue
                    cx, cy, cw, ch = classical_boxes[best_idx]
                    x, y = cx, cy
                    x2, y2 = cx + cw, cy + ch
                    classical_consumed[best_idx] = True
                    bbox_source = "classical"
                    matched_quad = classical_quads[best_idx]

            out.append(Detection(
                guess=Guess(**card.model_dump(exclude={"box_2d"})),
                bbox=(x, y, x2 - x, y2 - y),
                # The classical quad when one matched; otherwise the box as a
                # rectangle, so `corners` is always a 4-point polygon.
                corners=matched_quad or [[x, y], [x2, y], [x2, y2], [x, y2]],
                bbox_source=bbox_source,
                name_source="gemini",
            ))
        return out
