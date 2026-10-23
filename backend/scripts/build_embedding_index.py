"""
build_embedding_index.py
------------------------
One-off (or occasional refresh) script that builds the card embedding index
used by the experimental local scanner (services/card_embedder.py).

Pipeline:
  1. Hit Scryfall's /bulk-data endpoint and download the latest
     `default_cards` JSONL (every paper printing, one object per line).
     Unlike the old pHash index we want EVERY printing, not unique artwork:
     the scan path picks the exact version from this index.
  2. For each printing (and each face of a double-faced card): GET
     `image_uris.normal` (488x680, ~60KB) from the Scryfall CDN into an
     on-disk cache.
  3. Embed every image with data/models/card_embedder.onnx (DINOv3 ViT-S/16,
     224x224, L2-normalised CLS token).
  4. Write data/card_index.npz with:
       embeddings        float16   (N, 384)
       scryfall_id       S36       (N,)
       oracle_id         S36       (N,)
       name              S192      (N,)   utf-8, the full card name
       set               S8        (N,)
       collector_number  S16       (N,)
       released_at       S10       (N,)
       finishes          uint8     (N,)   bitmask: 1 nonfoil, 2 foil, 4 etched
       promo             uint8     (N,)   1 = promo / The List / Secret Lair etc.
       face              uint8     (N,)   0 front, 1 back

Resumable: images are cached on disk, so re-running after a network drop only
fetches what is missing. The image cache is ~8 GB — point --cache-dir at a
disk with room and delete it afterwards.

Run this on a machine with AVX (a laptop is fine, ~1-2 h end to end), then
copy data/card_index.npz to the server's data/ directory.

Usage:
  python scripts/build_embedding_index.py [--limit N] [--out PATH] [--cache-dir DIR]
"""

from __future__ import annotations

import argparse
import asyncio
import gzip
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import aiohttp
import numpy as np
from PIL import Image

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.services.card_embedder import FINISH_BITS, Embedder, is_promo  # noqa: E402

DATA_DIR = BACKEND_ROOT / "data"
DEFAULT_OUT = DATA_DIR / "card_index.npz"
DEFAULT_MODEL = DATA_DIR / "models" / "card_embedder.onnx"
DEFAULT_CACHE = DATA_DIR / "index_build_cache"

SCRYFALL_BULK_URL = "https://api.scryfall.com/bulk-data"
USER_AGENT = "MTGPasarMalamScanner-IndexBuilder/2.0"
HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json"}

# cards.scryfall.io is a CDN with no rate limit, but stay modest anyway.
CONCURRENCY = 12
EMBED_BATCH = 32


def log(msg: str) -> None:
    print(f"[index] {msg}", flush=True)


async def download_bulk(session: aiohttp.ClientSession, dest: Path) -> None:
    """Stream the default_cards JSONL (gzipped, ~100MB) to disk."""
    async with session.get(SCRYFALL_BULK_URL) as resp:
        resp.raise_for_status()
        entries = (await resp.json()).get("data") or []
    entry = next((e for e in entries if e.get("type") == "default_cards"), None)
    if entry is None:
        raise RuntimeError("default_cards bulk-data entry not found in Scryfall response")
    url = entry["jsonl_download_uri"]
    log(f"downloading {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    async with session.get(url) as resp:
        resp.raise_for_status()
        with tmp.open("wb") as f:
            async for chunk in resp.content.iter_chunked(1 << 20):
                f.write(chunk)
    tmp.rename(dest)


def iter_entries(bulk_path: Path):
    """Yield one dict per indexable card face."""
    with gzip.open(bulk_path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            card = json.loads(line)
            if card.get("digital") or card.get("image_status") in ("missing", "placeholder"):
                continue
            if "paper" not in (card.get("games") or ["paper"]):
                continue
            faces = [card] if card.get("image_uris") else (card.get("card_faces") or [])
            finishes = sum(FINISH_BITS.get(f, 0) for f in card.get("finishes") or [])
            for face_no, face in enumerate(faces[:2]):
                url = (face.get("image_uris") or {}).get("normal")
                if not url:
                    continue
                yield {
                    "scryfall_id": card["id"],
                    "oracle_id": card.get("oracle_id") or face.get("oracle_id") or "",
                    "name": card.get("name", ""),
                    "set": card.get("set", ""),
                    "collector_number": card.get("collector_number", ""),
                    "released_at": card.get("released_at", ""),
                    "finishes": finishes,
                    "promo": int(is_promo(card)),
                    "face": face_no,
                    "url": url,
                }


def image_path(cache_dir: Path, entry: dict) -> Path:
    sid = entry["scryfall_id"]
    return cache_dir / "img" / sid[:2] / f"{sid}_{entry['face']}.jpg"


async def download_images(session: aiohttp.ClientSession, cache_dir: Path, entries: list[dict]) -> None:
    todo = [e for e in entries if not image_path(cache_dir, e).exists()]
    log(f"images: {len(entries) - len(todo)} cached, {len(todo)} to fetch")
    sem = asyncio.Semaphore(CONCURRENCY)
    done = 0
    failed = 0
    t0 = time.time()

    async def one(entry: dict) -> None:
        nonlocal done, failed
        path = image_path(cache_dir, entry)
        path.parent.mkdir(parents=True, exist_ok=True)
        async with sem:
            for attempt in range(4):
                try:
                    async with session.get(entry["url"], timeout=aiohttp.ClientTimeout(total=60)) as resp:
                        if resp.status == 200:
                            body = await resp.read()
                            tmp = path.with_suffix(".part")
                            tmp.write_bytes(body)
                            tmp.rename(path)
                            break
                        if resp.status == 404:
                            failed += 1
                            break
                except Exception:
                    pass
                await asyncio.sleep(1.5 * (attempt + 1))
            else:
                failed += 1
        done += 1
        if done % 2000 == 0:
            rate = done / max(time.time() - t0, 1e-6)
            log(f"  fetched {done}/{len(todo)} ({rate:.0f}/s, {failed} failed)")

    await asyncio.gather(*[one(e) for e in todo])
    if failed:
        log(f"  {failed} images could not be fetched — those printings are left out")


def embed_all(cache_dir: Path, entries: list[dict], model_path: Path) -> tuple[np.ndarray, list[dict]]:
    embedder = Embedder(model_path)
    kept = [e for e in entries if image_path(cache_dir, e).exists()]
    out = np.zeros((len(kept), embedder.dim), dtype=np.float16)
    ok = np.ones(len(kept), dtype=bool)

    def load(i: int):
        try:
            with Image.open(image_path(cache_dir, kept[i])) as im:
                return embedder.preprocess(im)
        except Exception:
            ok[i] = False
            return np.zeros((3, embedder.size, embedder.size), dtype=np.float32)

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=4) as pool:
        for start in range(0, len(kept), EMBED_BATCH):
            idxs = range(start, min(start + EMBED_BATCH, len(kept)))
            batch = np.stack(list(pool.map(load, idxs)))
            out[start:start + len(batch)] = embedder.embed_arrays(batch)
            if (start // EMBED_BATCH) % 100 == 0:
                rate = (start + len(batch)) / max(time.time() - t0, 1e-6)
                log(f"  embedded {start + len(batch)}/{len(kept)} ({rate:.0f}/s)")
    kept = [e for e, good in zip(kept, ok) if good]
    return out[ok], kept


def write_index(out_path: Path, embeddings: np.ndarray, entries: list[dict]) -> None:
    def col(key: str, dtype: str) -> np.ndarray:
        return np.array([str(e[key]).encode("utf-8") for e in entries], dtype=dtype)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".tmp.npz")
    np.savez(
        tmp,
        embeddings=embeddings,
        scryfall_id=col("scryfall_id", "S36"),
        oracle_id=col("oracle_id", "S36"),
        name=col("name", "S192"),
        set=col("set", "S8"),
        collector_number=col("collector_number", "S16"),
        released_at=col("released_at", "S10"),
        finishes=np.array([e["finishes"] for e in entries], dtype=np.uint8),
        promo=np.array([e["promo"] for e in entries], dtype=np.uint8),
        face=np.array([e["face"] for e in entries], dtype=np.uint8),
    )
    tmp.rename(out_path)
    log(f"wrote {out_path} ({len(entries)} entries, {out_path.stat().st_size / 1e6:.0f} MB)")


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="only index the first N faces (smoke test)")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    ap.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    ap.add_argument("--force-bulk", action="store_true", help="re-download the bulk JSONL even if cached")
    args = ap.parse_args()

    args.cache_dir.mkdir(parents=True, exist_ok=True)
    bulk_path = args.cache_dir / "default_cards.jsonl.gz"
    async with aiohttp.ClientSession(headers=HEADERS) as session:
        if args.force_bulk or not bulk_path.exists():
            await download_bulk(session, bulk_path)
        entries = list(iter_entries(bulk_path))
        if args.limit:
            entries = entries[:args.limit]
        log(f"{len(entries)} card faces to index")
        await download_images(session, args.cache_dir, entries)

    embeddings, kept = embed_all(args.cache_dir, entries, args.model)
    write_index(args.out, embeddings, kept)


if __name__ == "__main__":
    asyncio.run(main())
