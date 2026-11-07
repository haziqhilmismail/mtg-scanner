"""
local_scan.py
-------------
The local scanner (SCANNER_BACKEND=local) behind the `Scanner` interface of
services/scans.py.

Keeps the heavy imports (onnxruntime, rapidocr) out of the default Gemini
deployment: card_scanner is only imported once `load()` runs, so a server on
SCANNER_BACKEND=gemini doesn't need those packages installed at all.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import TYPE_CHECKING

from PIL import Image

from ..config import settings
from ..schemas.scan import Detection

if TYPE_CHECKING:
    from .card_scanner import CardScanner


class LocalScanner:
    model = "yolo11n-obb + dinov3-vits16 + pp-ocr"
    costs_credit = False  # the rate limit and the lock below guard the CPU

    def __init__(self) -> None:
        self._scanner: CardScanner | None = None
        # The pipeline is CPU-bound and already uses every core; running two
        # scans at once only makes both slower, so uploads queue here.
        self._lock = asyncio.Lock()

    def load(self) -> None:
        """Load the models + card index (seconds; call off the event loop)."""
        from .card_scanner import CardScanner

        self._scanner = CardScanner(
            Path(settings.detector_model_path),
            Path(settings.embedder_model_path),
            Path(settings.card_index_path),
        )
        print(f"[startup] local scanner ready: {len(self._scanner.index)} printings indexed", flush=True)

    def ready(self) -> str | None:
        if self._scanner is None:
            return "local scanner models or card index not loaded"
        return None

    async def detect(self, pil: Image.Image, jpeg: bytes) -> list[Detection]:
        assert self._scanner is not None, "ready() first"
        async with self._lock:
            t0 = time.perf_counter()
            found = await asyncio.to_thread(self._scanner.scan, pil)
        print(f"[scan] local: {len(found)} cards in {time.perf_counter() - t0:.1f}s", flush=True)
        return found
