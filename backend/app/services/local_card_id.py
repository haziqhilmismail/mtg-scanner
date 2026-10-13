"""
local_card_id.py
----------------
Offline card identification via perceptual hashing.

Loads the index built by `scripts/build_phash_index.py` at lifespan startup
and names perspective-warped card crops without calling Gemini. Used by
/api/scan and /api/scans/{id}/frame-card when we get a confident pHash match.

Hash format: 8x8 phash → 64-bit packed into a single uint64 (MSB-first).
Hamming distance is computed against the full index with numpy's native
popcount. ~30k entries → sub-millisecond per query.

Distance thresholds (out of 64 bits):
  ≤ 8   strong match — trust the name without further checks
  ≤ 12  acceptable match — name is right, set might be one of several reprints
  > 12  fall back to Gemini

Foil vs non-foil is NOT distinguished — same art, same hash. The user
toggles foil per-card after scanning, as they always have.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import imagehash
import numpy as np
from PIL import Image


@dataclass
class Candidate:
    name: str
    set: str
    collector_number: str
    distance: int  # Hamming distance, 0..64


class PhashIndex:
    """Loaded pHash index. Methods are thread-safe (read-only)."""

    def __init__(self, path: Path):
        # allow_pickle=False — we only ship plain numpy arrays, no object refs.
        # Only the arrays the scan path reads are materialised; the .npz also
        # carries scryfall_id / released_at / image_url (~50 MB as U256) which
        # np.load leaves on disk unless asked for.
        with np.load(path, allow_pickle=False) as data:
            self.hashes = data["hashes"].astype(np.uint64, copy=False)  # shape (N,)
            self.name = data["name"]
            self.set = data["set"]
            self.collector_number = data["collector_number"]

    def __len__(self) -> int:
        return int(self.hashes.shape[0])

    def search(self, query_hash: np.uint64, top_k: int = 3) -> list[Candidate]:
        """Top-k closest hashes by Hamming distance."""
        if len(self) == 0:
            return []
        # XOR is the bit-difference; popcount of it is the Hamming distance.
        d = np.bitwise_count(self.hashes ^ np.uint64(query_hash))
        if top_k >= len(d):
            order = np.argsort(d, kind="stable")
        else:
            # argpartition is O(N); only sort the top-k slice.
            part = np.argpartition(d, top_k)[:top_k]
            order = part[np.argsort(d[part], kind="stable")]
        return [
            Candidate(
                name=str(self.name[idx]),
                set=self.set[idx].decode(),
                collector_number=str(self.collector_number[idx]),
                distance=int(d[idx]),
            )
            for idx in order[:top_k]
        ]


def hash_pil(img: Image.Image) -> np.uint64:
    """Hash a decoded PIL Image (normally a perspective-warped crop).

    Normalises to 488×680 (the Scryfall `normal` size used when building the
    index). pHash's internal 32×32 DCT-resize is uniform per input shape, so
    matching the index's aspect ratio is the single biggest accuracy lever —
    a square pre-resize squashes the card's 0.72 aspect into 1:1 and
    destroys the comparison.
    """
    img = img.convert("RGB")
    if (img.width, img.height) != (488, 680):
        img = img.resize((488, 680), Image.LANCZOS)
    bits = imagehash.phash(img, hash_size=8).hash
    return np.packbits(bits).view(">u8")[0]  # 64 bits, MSB-first


# --- module-level holder so main.py can keep one index for the process ---

_index: PhashIndex | None = None


def load_index(path: Path) -> PhashIndex:
    global _index
    _index = PhashIndex(path)
    return _index


def get_index() -> PhashIndex | None:
    return _index
