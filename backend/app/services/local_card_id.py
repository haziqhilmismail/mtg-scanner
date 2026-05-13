"""
local_card_id.py
----------------
Offline card identification via perceptual hashing.

Loads the index built by `scripts/build_phash_index.py` at lifespan startup
and exposes `identify(crop_bytes)` to name a single cropped card image
without calling Gemini. Used by /api/scan to skip the Gemini naming pass
when we get a confident pHash match.

Hash format: 8x8 phash → 64-bit packed into a single uint64 (MSB-first).
Hamming distance is computed against the full index using vectorized
numpy bit-population-count. ~30k entries → sub-millisecond per query.

Distance thresholds (out of 64 bits):
  ≤ 8   strong match — trust the name without further checks
  ≤ 12  acceptable match — name is right, set might be one of several reprints
  > 12  fall back to Gemini

Foil vs non-foil is NOT distinguished — same art, same hash. The user
toggles foil per-card after scanning, as they always have.
"""

from __future__ import annotations

import io
import threading
from dataclasses import dataclass
from pathlib import Path

import imagehash
import numpy as np
from PIL import Image, ImageOps

# Precomputed popcount lookup table for 16-bit values. XORing the query hash
# against the index gives a uint64 array; we view it as uint16 chunks and sum
# popcounts. ~10x faster than bin(x).count("1") in a Python loop.
_POPCOUNT16 = np.array([bin(i).count("1") for i in range(1 << 16)], dtype=np.uint8)


@dataclass
class Candidate:
    scryfall_id: str
    name: str
    set: str
    collector_number: str
    released_at: str
    image_url: str
    distance: int  # Hamming distance, 0..64


class PhashIndex:
    """Loaded pHash index. Methods are thread-safe (read-only)."""

    def __init__(
        self,
        hashes: np.ndarray,
        scryfall_id: np.ndarray,
        name: np.ndarray,
        set_code: np.ndarray,
        collector_number: np.ndarray,
        released_at: np.ndarray,
        image_url: np.ndarray,
    ):
        self.hashes = hashes  # uint64, shape (N,)
        self.scryfall_id = scryfall_id
        self.name = name
        self.set = set_code
        self.collector_number = collector_number
        self.released_at = released_at
        self.image_url = image_url

    @classmethod
    def load(cls, path: Path) -> "PhashIndex":
        # allow_pickle=False — we only ship plain numpy arrays, no object refs.
        with np.load(path, allow_pickle=False) as data:
            return cls(
                hashes=data["hashes"].astype(np.uint64, copy=False),
                scryfall_id=data["scryfall_id"],
                name=data["name"],
                set_code=data["set"],
                collector_number=data["collector_number"],
                released_at=data["released_at"],
                image_url=data["image_url"],
            )

    def __len__(self) -> int:
        return int(self.hashes.shape[0])

    def hamming(self, query: np.uint64) -> np.ndarray:
        """Vectorized Hamming distance between `query` and every index hash.
        Returns uint8 array of distances 0..64."""
        # XOR is the bit-difference. View as uint16 chunks → look up popcount.
        xor = np.bitwise_xor(self.hashes, np.uint64(query))
        # Reinterpret uint64 as 4 uint16 → shape (N, 4)
        chunks = xor.view(np.uint16).reshape(-1, 4)
        return _POPCOUNT16[chunks].sum(axis=1).astype(np.uint8)

    def search(self, query_hash: np.uint64, top_k: int = 3) -> list[Candidate]:
        """Top-k closest hashes by Hamming distance."""
        if len(self) == 0:
            return []
        d = self.hamming(query_hash)
        if top_k >= len(d):
            order = np.argsort(d, kind="stable")
        else:
            # argpartition is O(N); only sort the top-k slice.
            part = np.argpartition(d, top_k)[:top_k]
            order = part[np.argsort(d[part], kind="stable")]
        out: list[Candidate] = []
        for idx in order[:top_k]:
            def _s(v):
                return v.decode() if isinstance(v, bytes) else str(v)
            out.append(Candidate(
                scryfall_id=_s(self.scryfall_id[idx]),
                name=str(self.name[idx]),
                set=_s(self.set[idx]),
                collector_number=str(self.collector_number[idx]),
                released_at=_s(self.released_at[idx]),
                image_url=str(self.image_url[idx]),
                distance=int(d[idx]),
            ))
        return out


def _phash_uint64(img: Image.Image) -> np.uint64:
    bits = imagehash.phash(img, hash_size=8).hash.flatten()
    packed = 0
    for b in bits:
        packed = (packed << 1) | int(b)
    return np.uint64(packed)


def hash_crop(crop_bytes: bytes) -> np.uint64 | None:
    """Hash a single crop. Returns None if the bytes can't be decoded.

    Normalises to 488×680 (the Scryfall `normal` size used when building the
    index). pHash's internal 32×32 DCT-resize is uniform per input shape, so
    matching the index's aspect ratio is the single biggest accuracy lever —
    a square pre-resize squashes the card's 0.72 aspect into 1:1 and
    destroys the comparison.
    """
    try:
        img = Image.open(io.BytesIO(crop_bytes))
        img.load()
    except Exception:
        return None
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    return hash_pil(img)


def hash_pil(img: Image.Image) -> np.uint64:
    """Hash an already-decoded PIL Image. The call-site path for perspective-
    warped crops — the warp produces a flat 488×680 PIL image directly, so we
    skip the encode/decode round-trip that `hash_crop` does.

    Resizes to 488×680 if the input isn't already that shape (paranoia — the
    perspective warp always outputs the target size).
    """
    img = img.convert("RGB")
    if (img.width, img.height) != (488, 680):
        img = img.resize((488, 680), Image.LANCZOS)
    return _phash_uint64(img)


# --- module-level loader/lookup so main.py can hold one index for the process ---

_index_lock = threading.Lock()
_index: PhashIndex | None = None
_index_path: Path | None = None


def load_index(path: Path) -> PhashIndex:
    """Load (or reuse) the index at `path`. Idempotent for the same path."""
    global _index, _index_path
    with _index_lock:
        if _index is not None and _index_path == path:
            return _index
        idx = PhashIndex.load(path)
        _index = idx
        _index_path = path
        return idx


def get_index() -> PhashIndex | None:
    return _index


def identify(crop_bytes: bytes, top_k: int = 3) -> list[Candidate]:
    """Top-k candidate cards for the given crop. Empty list if no index loaded
    or the crop can't be hashed."""
    idx = get_index()
    if idx is None:
        return []
    h = hash_crop(crop_bytes)
    if h is None:
        return []
    return idx.search(h, top_k=top_k)
