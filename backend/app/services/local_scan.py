"""
local_scan.py
-------------
FastAPI-side glue for the experimental local scanner (SCANNER_BACKEND=local).

Keeps the heavy imports (onnxruntime, rapidocr) out of the default Gemini
deployment: card_scanner is only imported once `load()` runs, so a server on
SCANNER_BACKEND=gemini doesn't need those packages installed at all.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from fastapi import HTTPException
from PIL import Image

from ..config import settings
from .cardkingdom_prices import get_index as get_ck_index
from .scryfall_lookup import lookup_all

if TYPE_CHECKING:
    from .card_scanner import CardScanner, ScannedCard

MODEL_NAME = "yolo11n-obb + dinov3-vits16 + pp-ocr"

_scanner: "CardScanner | None" = None
# The pipeline is CPU-bound and already uses every core; running two scans at
# once only makes both slower, so uploads queue here.
_lock = asyncio.Lock()


def load() -> int:
    """Load the models + card index. Returns the number of indexed printings."""
    global _scanner
    from .card_scanner import CardScanner

    _scanner = CardScanner(
        Path(settings.detector_model_path),
        Path(settings.embedder_model_path),
        Path(settings.card_index_path),
    )
    return len(_scanner.index)


def is_loaded() -> bool:
    return _scanner is not None


def _require() -> "CardScanner":
    if _scanner is None:
        raise HTTPException(503, "Local scanner is not loaded — models or card index missing on the server")
    return _scanner


async def scan_cards(
    pil: Image.Image,
    enrich_with_ck: Callable[[dict | None, object], dict | None],
    make_thumb_b64: Callable[[Image.Image, int, int, int, int], str],
) -> list[dict]:
    """Run the local pipeline on an RGB photo and return the `cards` list of
    the /api/scan response — same shape the Gemini path produces."""
    scanner = _require()
    async with _lock:
        t0 = time.perf_counter()
        try:
            scanned = await asyncio.to_thread(scanner.scan, pil)
        except Exception as e:
            raise HTTPException(500, f"Scan failed: {e}")
    print(f"[scan] local: {len(scanned)} cards in {time.perf_counter() - t0:.1f}s", flush=True)

    summaries = await lookup_all([c.det for c in scanned])
    ck_index = await get_ck_index()
    summaries = [enrich_with_ck(s, ck_index) for s in summaries]

    W, H = pil.size
    cards_out = []
    for i, (card, sf) in enumerate(zip(scanned, summaries)):
        x, y, w, h = card.bbox
        x, y = max(0, x), max(0, y)
        x2, y2 = min(W, x + w), min(H, y + h)

        if sf is None:
            sf = {
                "scryfall_id": card.det.scryfall_id,
                "name": card.det.name or "(unknown)",
                "set": card.det.set_code.upper(),
                "set_name": "",
                "collector_number": card.det.collector_number,
                "rarity": "",
                "usd": 0.0, "usd_foil": 0.0,
                "image_url": "",
                "scryfall_uri": "",
                "_lookup_failed": True,
                "price_source_normal": "none",
                "price_source_foil": "none",
            }

        cards_out.append({
            "id": i,
            "bbox": [x, y, x2 - x, y2 - y],
            # The card's own quad (TL, TR, BR, BL), so outlines follow its tilt.
            "corners": [[int(round(px)), int(round(py))] for px, py in card.quad],
            "crop_b64": make_thumb_b64(pil, x, y, x2, y2),
            "bbox_source": "detector",
            "name_source": card.name_source,  # "title" | "embedding"
            # Cosine similarity of the embedding match, 0..1. Higher = better.
            "name_confidence": round(card.score, 3),
            "version_source": card.version_source,
            "foil_source": card.foil_source,
            # Key name is shared with the Gemini path — the frontend reads its
            # foil / quantity defaults from here.
            "gemini": {
                "name": card.det.name,
                "set_code": card.det.set_code,
                "collector_number": card.det.collector_number,
                "is_foil": card.det.is_foil,
                "quantity": card.det.quantity,
            },
            "candidates": [sf],
        })
    return cards_out


async def identify_quad(pil: Image.Image, quad: list[list[int]]) -> "ScannedCard | None":
    """Identify the card inside a user-drawn quad (TL, TR, BR, BL), or None."""
    scanner = _require()
    async with _lock:
        return await asyncio.to_thread(scanner.identify_quad, pil, quad)
