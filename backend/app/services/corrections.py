import asyncio
import uuid

from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import CardCorrection, Scan
from ..models.card_correction import CorrectionKind
from .card_crop import CROP_QUALITY, CROP_VERSION, card_crop

settings.corrections_dir.mkdir(parents=True, exist_ok=True)


def _save_crop(photo_path: str | None, card: dict) -> str | None:
    if not photo_path:
        return None
    try:
        with Image.open(photo_path) as photo:
            crop = card_crop(photo.convert("RGB"), card)
    except OSError:
        return None
    if crop is None:
        return None
    name = f"{uuid.uuid4().hex}.jpg"
    crop.save(settings.corrections_dir / name, format="JPEG", quality=CROP_QUALITY)
    return name


def _scanner_guess(card: dict) -> dict:
    said = card.get("gemini") or {}
    return {
        "guess_name": said.get("name"),
        "guess_set_code": said.get("set_code"),
        "guess_collector_number": said.get("collector_number"),
        "name_source": card.get("name_source"),
        "version_source": card.get("version_source"),
        "name_confidence": card.get("name_confidence"),
    }


async def keep_answer(db: AsyncSession, scan: Scan, card: dict, scryfall_id: str, kind: CorrectionKind) -> bool:
    crop_file = await db.scalar(select(CardCorrection.crop_file).where(
        CardCorrection.scan_id == scan.id, CardCorrection.card_id == card["id"]))
    fresh = crop_file is None
    if fresh:
        crop_file = await asyncio.to_thread(_save_crop, scan.image_path, card)
        if crop_file is None:
            return False
    row = insert(CardCorrection).values(
        scan_id=scan.id, card_id=card["id"], user_id=scan.user_id, crop_file=crop_file, crop_version=CROP_VERSION,
        bbox_source=card["bbox_source"], **_scanner_guess(card), scryfall_id=scryfall_id, kind=kind,
    )
    took = False
    try:
        kept_file = await db.scalar(row.on_conflict_do_update(
            index_elements=["scan_id", "card_id"],
            set_={"scryfall_id": scryfall_id, "kind": kind, "updated_at": func.now()},
            where=CardCorrection.scryfall_id != scryfall_id,
        ).returning(CardCorrection.crop_file))
        # get_session commits only after the reply has gone out, too late for
        # a failed commit to change it or to remove the new file.
        await db.commit()
        took = kept_file == crop_file
    finally:
        if fresh and not took:
            (settings.corrections_dir / crop_file).unlink(missing_ok=True)
    return True
