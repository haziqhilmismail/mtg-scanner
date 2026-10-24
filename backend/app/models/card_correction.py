"""Card corrections: what a seller said a scanned card really is.

One row is one card of one scan, with the printing the seller said it is, a
crop of the card cut from their photo, and what the scanner had guessed.
Together they are training data for the local scanner. A row is made when
the seller picks a printing for a card (`kind` 'pick') or taps "Looks right"
on the scanner's guess ('confirm'), by
PUT /api/scans/{scan_id}/cards/{card_id}/correction.

- Grain: one row per (scan, card). A different answer for the same card
  replaces the printing, `kind` and `updated_at`; the crop and the guess
  stay, since the photo and the card's box never change. The same printing
  sent again changes nothing, so a later 'confirm' never turns a 'pick' into
  a 'confirm'.
- A pick of the printing the card already shows is sent as 'confirm': it says
  "this is right", not "change it". `kind` is how the seller reached the
  printing, not a verdict on the scanner.
- The guess is copied from the stored card when the row is made:
  `guess_name`, `guess_set_code` and `guess_collector_number` from its
  `gemini` hint (the local scanner's printing, or what Gemini read), and
  `name_source`, `version_source` and `name_confidence`. A saved pick
  replaces the card's first candidate, never these, so the row holds the
  scanner's own guess even when the pick reached the server first. Null
  where the scanner gave no value (Gemini scans have no `version_source`).
- Ids are never reused (AUTOINCREMENT), and neither are scan ids (migration
  a7e3c9d1f5b2), so `scan_id` stays a safe key after its scan is deleted.
- The crop is a file in `settings.corrections_dir`, named by a random uuid
  (`crop_file`). It is not the scan's `crop_b64`, a display thumbnail made at
  scan time; this one is cut later from the stored photo. `bbox_source` says how:
  'detector' (local scanner) is the card's quad flattened to 488 x 680, the
  size the embedder is shown; 'classical' and 'gemini' are the card's box as
  photographed. A card the seller framed by hand ('user') has a placeholder
  box, so it gets no row.
- Why a file and not a column: deploy/backup.sh keeps a full copy of the
  database for each of the last 30 nights, and JPEG bytes do not compress, so
  a crop inside a row would be stored 30 times; the NAS mirror holds a file
  once. A trainer also reads the folder of JPEGs as it is.
- Kept after the seller's account is deleted: deleting it clears the links
  (`user_id`, `scan_id`); the crop, the guess and the printing stay. See
  services/accounts.py. Deleting a scan changes nothing here.
- `scryfall_id` is what the page sent, checked only for its shape. Whoever
  trains on it checks it against their own printing list.
- Not kept: foil, price, buyer data.
- Times are UTC. `crop_version` is card_crop.CROP_VERSION when the crop was
  cut, so rows made by an older recipe can be told apart.
"""

from typing import Literal

from sqlalchemy import Float, ForeignKey, SmallInteger, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin

CorrectionKind = Literal["pick", "confirm"]


class CardCorrection(Base, TimestampMixin):
    __tablename__ = "card_corrections"
    __table_args__ = (
        UniqueConstraint("scan_id", "card_id", name="uq_card_corrections_scan_card"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    crop_version: Mapped[int] = mapped_column(SmallInteger)

    # Link back to the seller. Cleared when the account is deleted. SQLite here
    # doesn't enforce foreign keys, so that is done in code; the key documents
    # the link.
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    scan_id: Mapped[int | None]
    card_id: Mapped[int]

    crop_file: Mapped[str] = mapped_column(String(40))
    bbox_source: Mapped[str] = mapped_column(String(12))  # 'detector' | 'classical' | 'gemini'

    guess_name: Mapped[str | None] = mapped_column(String(255))
    guess_set_code: Mapped[str | None] = mapped_column(String(16))
    guess_collector_number: Mapped[str | None] = mapped_column(String(16))
    name_source: Mapped[str | None] = mapped_column(String(16))  # 'title' | 'embedding' | 'gemini'
    version_source: Mapped[str | None] = mapped_column(String(16))  # 'ocr' | 'embedding'
    name_confidence: Mapped[float | None] = mapped_column(Float)

    scryfall_id: Mapped[str] = mapped_column(String(36))
    kind: Mapped[str] = mapped_column(String(8))  # CorrectionKind
