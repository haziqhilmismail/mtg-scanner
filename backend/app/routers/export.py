"""Export: a scan's photo with its prices drawn on, one JPEG or many in a zip."""

import asyncio
import re
import zipfile
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import Response

from ..deps import CurrentUserId, DbSession, json_payload, limiter, owned
from ..models import Scan
from ..schemas.types import as_id
from ..services.price_overlay import render_overlay

router = APIRouter(tags=["export"])


async def _resolve_export_image(db: DbSession, user_id: int, image_id: str) -> bytes:
    """The source photo bytes for an export `image_id` (a scan id), from disk
    and only for the scan's owner. Raises 404 otherwise."""
    scan_row = await owned(db, Scan, as_id(image_id), user_id)
    p = Path(scan_row.image_path) if scan_row.image_path else None
    if not p or not p.exists():
        raise HTTPException(404, "image_id not found (re-upload the image)")
    return p.read_bytes()


def _card_shape(c: dict) -> dict | None:
    """A payload card's bbox and corners, checked; None when it has no bbox."""
    bbox = c.get("bbox")
    if not isinstance(bbox, list) or len(bbox) != 4:
        return None
    corners = c.get("corners")
    if not (isinstance(corners, list) and len(corners) == 4
            and all(isinstance(p, list) and len(p) == 2 for p in corners)):
        corners = None
    return {"bbox": bbox, "corners": corners}


def _render_export(data: dict, raw: bytes) -> bytes:
    """Render one priced-overlay JPEG from an export payload dict + source bytes."""
    cards = []
    for c in data.get("cards", []):
        shape = _card_shape(c)
        if not shape:
            continue
        try:
            pill_dx = int(c.get("pill_dx") or 0)
        except (TypeError, ValueError):
            pill_dx = 0
        try:
            pill_dy = int(c.get("pill_dy") or 0)
        except (TypeError, ValueError):
            pill_dy = 0
        cards.append({
            **shape,
            "label": c.get("label_override") or c.get("label") or "",
            "is_foil": bool(c.get("is_foil", False)),
            "pill_dx": pill_dx,
            "pill_dy": pill_dy,
        })

    show_outlines = bool(data.get("show_outlines", False))
    label_position = data.get("label_position", "bottom")
    try:
        font_scale = float(data.get("font_scale", 1.0) or 1.0)
    except (TypeError, ValueError):
        font_scale = 1.0

    # Sold cards on a repost: covered on the photo.
    covers = [shape for c in data.get("covers") or [] if isinstance(c, dict) and (shape := _card_shape(c))]

    return render_overlay(
        raw, cards,
        show_outlines=show_outlines,
        label_position=label_position,
        font_scale=font_scale,
        covers=covers,
    )


def _zip_entry_name(filename: str | None, used: set[str]) -> str:
    """The client's name for a photo ("Friday Post - Photo 01.jpg") as a safe,
    unique `.jpg` zip entry: only the characters no file system takes go."""
    base = re.sub(r"\.[^.]+$", "", filename or "")
    base = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", base).strip(" .") or "photo"
    name = f"{base}.jpg"
    i = 2
    while name in used:
        name = f"{base} ({i}).jpg"
        i += 1
    used.add(name)
    return name


@router.post("/api/export")
@limiter.limit("60/minute")  # Pillow render is CPU-bound; cap to prevent runaway
async def export_overlay(request: Request, db: DbSession, user_id: CurrentUserId, payload: str = Form(...)):
    data = json_payload(payload)

    image_id = data.get("image_id")
    if not image_id:
        raise HTTPException(400, "Missing image_id")

    raw = await _resolve_export_image(db, user_id, image_id)
    jpeg = await asyncio.to_thread(_render_export, data, raw)
    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={"Content-Disposition": "attachment; filename=mtg_prices.jpg"},
    )


@router.post("/api/export-all")
@limiter.limit("12/minute")  # heavier than single export — renders N images per call
async def export_all_overlays(request: Request, db: DbSession, user_id: CurrentUserId, payload: str = Form(...)):
    """Render every supplied image's priced overlay and stream them as one zip.

    Payload: {"images": [{"filename": ..., "image_id": ..., "cards": [...],
    "show_outlines": ..., "label_position": ..., "font_scale": ...}, ...]}.
    Images whose source bytes can't be found are skipped rather than failing
    the whole archive; a 404 is only returned when nothing renders at all.
    """
    data = json_payload(payload)

    images = data.get("images")
    if not isinstance(images, list) or not images:
        raise HTTPException(400, "Missing 'images'")
    if len(images) > 100:
        raise HTTPException(400, "Too many images (max 100)")

    buf = BytesIO()
    used: set[str] = set()
    # ZIP_STORED: the entries are already-compressed JPEGs, so deflate would burn
    # CPU for no size win.
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        for item in images:
            if not isinstance(item, dict):
                continue
            image_id = item.get("image_id")
            if not image_id:
                continue
            try:
                raw = await _resolve_export_image(db, user_id, image_id)
            except HTTPException:
                continue  # one stale id shouldn't sink the whole export
            jpeg = await asyncio.to_thread(_render_export, item, raw)
            zf.writestr(_zip_entry_name(item.get("filename"), used), jpeg)

    if not used:
        raise HTTPException(404, "No exportable images (re-upload and try again)")

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=mtg_prices.zip"},
    )
