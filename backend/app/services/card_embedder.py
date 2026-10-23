"""
card_embedder.py
----------------
Offline card identification via image embeddings.

A perspective-warped card crop is embedded with a DINOv3 ViT-S/16 model
fine-tuned for card retrieval (ONNX, CPU) and matched by cosine similarity
against an index holding one embedding per Scryfall printing, built by
`scripts/build_embedding_index.py`.

The index covers EVERY paper printing, so the nearest neighbour already
carries a set + collector number. Reprints that share art are close together
in embedding space though, so `card_scanner.py` re-ranks the same-name
printings with the collector line OCR'd off the card (see collector_ocr.py).

Model: matteot11/collector-mtg-pkm-embedder-dinov3-small (DINOv3 License).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

# Scryfall `finishes` packed into a bitmask so the index stays plain numpy.
FINISH_BITS = {"nonfoil": 1, "foil": 2, "etched": 4}

# Printings a seller is unlikely to be holding unless the collector line says
# so: promos, The List / Mystery Booster reprints, Secret Lair drops, etc.
PROMO_SET_TYPES = {
    "promo", "memorabilia", "box", "masterpiece", "from_the_vault",
    "premium_deck", "spellbook", "arsenal", "treasure_chest",
}
PROMO_SETS = {"plst", "mb1", "mb2", "fmb1", "cmb1", "cmb2", "ulst"}


def is_promo(card: dict) -> bool:
    """`card` is a Scryfall card object."""
    return bool(
        card.get("promo")
        or card.get("set_type") in PROMO_SET_TYPES
        or card.get("set") in PROMO_SETS
    )


def normalize_name(text: str) -> str:
    """Lowercase letters + digits only, so OCR punctuation / spacing noise
    ("Jace,the Mind Sculptor") doesn't block a name match."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


class Embedder:
    """ONNX wrapper: PIL image(s) → L2-normalised 384-d vectors."""

    size = 224
    dim = 384

    def __init__(self, model_path: Path):
        self.session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name

    def preprocess(self, img: Image.Image) -> np.ndarray:
        # Matches the model's processor: squash to a 224 square (no aspect
        # preservation), bilinear, ImageNet normalisation.
        arr = np.asarray(
            img.convert("RGB").resize((self.size, self.size), Image.BILINEAR),
            dtype=np.float32,
        ) / 255.0
        return ((arr - _MEAN) / _STD).transpose(2, 0, 1)

    def embed_arrays(self, batch: np.ndarray) -> np.ndarray:
        return self.session.run(None, {self.input_name: batch})[0]

    def embed_images(self, imgs: list[Image.Image]) -> np.ndarray:
        if not imgs:
            return np.zeros((0, self.dim), dtype=np.float32)
        return self.embed_arrays(np.stack([self.preprocess(i) for i in imgs]))


@dataclass
class Printing:
    row: int  # row in the index
    scryfall_id: str
    name: str
    set: str
    collector_number: str
    finishes: int  # FINISH_BITS mask
    score: float  # cosine similarity to the query, -1..1

    @property
    def foil_only(self) -> bool:
        return self.finishes != 0 and not self.finishes & FINISH_BITS["nonfoil"]

    @property
    def nonfoil_only(self) -> bool:
        return self.finishes == FINISH_BITS["nonfoil"]


class CardIndex:
    """Loaded embedding index. Methods are thread-safe (read-only)."""

    def __init__(self, path: Path):
        with np.load(path, allow_pickle=False) as data:
            # float16 on disk (half the size), float32 in RAM for BLAS.
            self.embeddings = data["embeddings"].astype(np.float32)
            self.scryfall_id = data["scryfall_id"]
            self.oracle_id = data["oracle_id"]
            self.name = data["name"]
            self.set = data["set"]
            self.collector_number = data["collector_number"]
            self.finishes = data["finishes"]
            # 1 = promo-ish printing (see is_promo). Older indexes lack it.
            self.promo = (
                data["promo"] if "promo" in data.files
                else np.zeros(len(self.finishes), dtype=np.uint8)
            )
        # oracle_id → rows of every printing (and face) of that card.
        order = np.argsort(self.oracle_id, kind="stable")
        uniq, starts = np.unique(self.oracle_id[order], return_index=True)
        bounds = list(starts[1:]) + [len(order)]
        self._by_oracle = {
            bytes(o): order[s:e] for o, s, e in zip(uniq, starts, bounds)
        }
        # (set, collector number without leading zeros) → rows.
        self._by_set_number: dict[tuple[bytes, bytes], list[int]] = {}
        for row, (set_code, number) in enumerate(zip(self.set, self.collector_number)):
            key = (bytes(set_code), bytes(number).lstrip(b"0"))
            self._by_set_number.setdefault(key, []).append(row)
        # Normalised face name → rows. "Fire // Ice" is findable as either face.
        self._by_name: dict[str, list[int]] = {}
        for row, name in enumerate(self.name):
            for face in name.decode("utf-8").split("//"):
                self._by_name.setdefault(normalize_name(face), []).append(row)

    def __len__(self) -> int:
        return int(self.embeddings.shape[0])

    def printing(self, row: int, score: float) -> Printing:
        return Printing(
            row=int(row),
            scryfall_id=self.scryfall_id[row].decode(),
            name=self.name[row].decode("utf-8"),
            set=self.set[row].decode(),
            collector_number=self.collector_number[row].decode(),
            finishes=int(self.finishes[row]),
            score=float(score),
        )

    def scores(self, queries: np.ndarray) -> np.ndarray:
        """Cosine similarity of each query against the whole index: (Q, N)."""
        return queries.astype(np.float32, copy=False) @ self.embeddings.T

    def rows_for(self, set_code: str, collector_number: str) -> list[int]:
        """Index rows of the printing with this set code + collector number."""
        key = (set_code.lower().encode(), collector_number.lstrip("0").encode())
        return self._by_set_number.get(key, [])

    def rows_named(self, name: str) -> list[int]:
        """Index rows of every printing whose (face) name is exactly `name`,
        ignoring case, spacing and punctuation."""
        return self._by_name.get(normalize_name(name), [])

    def same_card_rows(self, row: int) -> np.ndarray:
        """Index rows of every printing of the card at `row` (same oracle id)."""
        return self._by_oracle.get(bytes(self.oracle_id[row]), np.array([row]))
