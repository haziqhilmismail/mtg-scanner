"""The cards of a scan, as the frontend reads them and the `scans.gemini_raw`
column stores them. Both scanners (Gemini and local) hand the pipeline a
`Detection`; `services/scans.py` turns each one into a `ScannedCard`."""

from typing import Literal

from pydantic import BaseModel

# Which pipeline drew the box: Gemini's own box, the classical detector's
# tighter one, the local YOLO detector, or a frame the seller drew by hand.
BboxSource = Literal["gemini", "classical", "detector", "user"]
# Which pipeline named the card. The local scanner read its title, or matched
# only its picture. A hand-framed card says "gemini" too: nothing named it.
NameSource = Literal["gemini", "title", "embedding"]
# Local scanner only: the printing was read off the collector line, or is a
# best visual guess the seller should check.
VersionSource = Literal["ocr", "embedding"]


class Guess(BaseModel):
    """What the scanner thinks the card is. Stored under each card's `gemini`
    key (the frontend reads its foil and quantity defaults from it) and passed
    to the Scryfall lookup. Empty string means unknown."""

    name: str = ""
    set_code: str = ""  # Scryfall set code, lowercase
    collector_number: str = ""
    is_foil: bool = False
    quantity: int = 1  # Gemini counts stacks; the local scanner always says 1
    scryfall_id: str = ""  # the local scanner's index match, when it has one


class Detection(BaseModel):
    """One card a scanner found: where it is in the photo and its guess."""

    guess: Guess
    bbox: tuple[int, int, int, int]  # x, y, w, h in photo pixels
    corners: list[list[int]]  # TL, TR, BR, BL in photo pixels
    bbox_source: BboxSource
    name_source: NameSource
    confidence: float | None = None  # local scanner: cosine similarity of the match, 0..1
    version_source: VersionSource | None = None


class ScannedCard(BaseModel):
    """One card of a saved scan. Field order is the order of the stored JSON."""

    id: int
    bbox: list[int]
    corners: list[list[int]]
    crop_b64: str = ""  # the card's thumbnail, cut from the photo when the scan is stored
    bbox_source: BboxSource
    name_source: NameSource
    name_confidence: float | None
    version_source: VersionSource | None = None
    gemini: Guess
    candidates: list[dict]  # Scryfall summaries with CK prices; the first is the card as shown

    def to_payload(self) -> dict:
        # The stored guess never carried the local scanner's index match, and
        # Gemini and hand-framed cards never carried `version_source`.
        d = self.model_dump(exclude={"gemini": {"scryfall_id"}})
        if d["version_source"] is None:
            del d["version_source"]
        return d
