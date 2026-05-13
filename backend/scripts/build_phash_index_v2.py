"""
build_phash_index_v2.py
-----------------------
v2 index builder: 144-bit pHash (hash_size=12) instead of v1's 64-bit.

Same pipeline as build_phash_index.py — reuses the already-downloaded
Scryfall bulk JSON cache (data/scryfall_unique_artwork.json) and re-fetches
each card's `normal` image to hash it at the bigger size.

Storage format change:
  v1: hashes shape (N,) uint64               (64 bits packed into one uint64)
  v2: hashes shape (N, 9) uint16             (144 bits packed into 9 uint16)

The (N, 9) uint16 layout fits the same popcount-via-uint16-chunks trick
the v1 runtime uses. 144 / 16 = 9 exact.

Output: data/phash_index_v2_144.npz (~10 MB expected).
Resumable: data/phash_build_v2_progress.json.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from io import BytesIO
from pathlib import Path

import aiohttp
import ijson
import imagehash
import numpy as np
from PIL import Image

BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_ROOT / "data"
DEFAULT_OUT = DATA_DIR / "phash_index_v2_144.npz"
PROGRESS_PATH = DATA_DIR / "phash_build_v2_progress.json"
BULK_CACHE = DATA_DIR / "scryfall_unique_artwork.json"

SCRYFALL_BULK_URL = "https://api.scryfall.com/bulk-data"
USER_AGENT = "MTGPasarMalamScanner-IndexBuilderV2/1.0"

HASH_SIZE = 12        # 12x12 = 144 bits
BITS = HASH_SIZE * HASH_SIZE   # 144
CHUNKS = (BITS + 15) // 16     # 9 uint16 chunks
CONCURRENCY = 5
REQUEST_DELAY = 0.08
BATCH_FLUSH_EVERY = 200


def log(msg: str) -> None:
    print(f"[phash-v2] {msg}", flush=True)


def pack_bits_to_uint16(bits: np.ndarray) -> np.ndarray:
    """Pack a 1-D bool array of length BITS into (CHUNKS,) uint16, MSB-first."""
    out = np.zeros(CHUNKS, dtype=np.uint16)
    for i, b in enumerate(bits):
        if b:
            chunk = i // 16
            bit_in_chunk = 15 - (i % 16)
            out[chunk] |= np.uint16(1 << bit_in_chunk)
    return out


async def fetch_bulk_meta(session: aiohttp.ClientSession) -> dict:
    async with session.get(SCRYFALL_BULK_URL) as resp:
        resp.raise_for_status()
        data = await resp.json()
    for entry in data.get("data") or []:
        if entry.get("type") == "unique_artwork":
            return entry
    raise RuntimeError("unique_artwork bulk-data entry not found in Scryfall response")


async def download_bulk(session: aiohttp.ClientSession, url: str, dest: Path) -> None:
    tmp = dest.with_suffix(dest.suffix + ".part")
    log(f"downloading bulk JSON → {tmp.name}")
    async with session.get(url) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("Content-Length") or 0)
        got = 0
        last_log = 0.0
        with open(tmp, "wb") as fh:
            async for chunk in resp.content.iter_chunked(1 << 16):
                fh.write(chunk)
                got += len(chunk)
                now = time.time()
                if now - last_log > 1.5:
                    pct = (got / total * 100) if total else 0.0
                    log(f"  bulk: {got/1e6:.1f} MB / {total/1e6:.1f} MB ({pct:.0f}%)")
                    last_log = now
    tmp.replace(dest)
    log(f"bulk JSON saved ({dest.stat().st_size/1e6:.1f} MB)")


def iter_bulk_entries(path: Path):
    with open(path, "rb") as fh:
        for item in ijson.items(fh, "item"):
            yield item


def pick_image_url(card: dict) -> str | None:
    image_uris = card.get("image_uris") or {}
    if not image_uris:
        faces = card.get("card_faces") or []
        if faces:
            image_uris = faces[0].get("image_uris") or {}
    return image_uris.get("normal") or image_uris.get("large") or image_uris.get("small")


async def fetch_phash_v2(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str) -> np.ndarray | None:
    """Returns (CHUNKS,) uint16 array, or None on any failure."""
    async with sem:
        await asyncio.sleep(REQUEST_DELAY)
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200:
                    return None
                raw = await resp.read()
        except Exception:
            return None
    try:
        img = Image.open(BytesIO(raw))
        img.load()
    except Exception:
        return None
    h = imagehash.phash(img, hash_size=HASH_SIZE)
    bits = h.hash.flatten()
    if bits.size != BITS:
        return None
    return pack_bits_to_uint16(bits)


def load_progress() -> dict:
    if PROGRESS_PATH.exists():
        try:
            return json.loads(PROGRESS_PATH.read_text())
        except Exception:
            pass
    return {"done_ids": [], "rows": []}


def save_progress(progress: dict) -> None:
    tmp = PROGRESS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(progress))
    tmp.replace(PROGRESS_PATH)


def write_index(rows: list[dict], out: Path) -> None:
    if not rows:
        raise RuntimeError("no rows to write — nothing was successfully hashed")
    hashes = np.stack([np.array(r["hash"], dtype=np.uint16) for r in rows], axis=0)
    scryfall_id = np.array([r["scryfall_id"] for r in rows], dtype="S36")
    name = np.array([r["name"] for r in rows], dtype="U128")
    set_code = np.array([r["set"] for r in rows], dtype="S10")
    collector_number = np.array([r["collector_number"] for r in rows], dtype="U16")
    released_at = np.array([r["released_at"] for r in rows], dtype="S10")
    image_url = np.array([r["image_url"] for r in rows], dtype="U256")

    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        out,
        hashes=hashes,
        scryfall_id=scryfall_id,
        name=name,
        set=set_code,
        collector_number=collector_number,
        released_at=released_at,
        image_url=image_url,
        hash_bits=np.array([BITS]),
    )
    log(f"wrote {out} ({out.stat().st_size/1e6:.1f} MB, {len(rows)} entries, {BITS}-bit hashes)")


async def main_async(args) -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = Path(args.out).resolve()

    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(headers=headers, timeout=timeout) as session:
        meta = await fetch_bulk_meta(session)
        download_uri = meta["download_uri"]
        updated_at = meta.get("updated_at", "")
        log(f"unique_artwork updated_at={updated_at}")

        if args.force or not BULK_CACHE.exists():
            await download_bulk(session, download_uri, BULK_CACHE)
        else:
            log(f"using cached bulk JSON at {BULK_CACHE} (use --force to refresh)")

        progress = load_progress() if not args.force else {"done_ids": [], "rows": []}
        done_set = set(progress["done_ids"])
        rows: list[dict] = list(progress["rows"])
        log(f"resuming with {len(rows)} rows already hashed; {len(done_set)} ids skipped")

        todo: list[tuple[dict, str]] = []
        skipped_no_image = 0
        seen = 0
        for card in iter_bulk_entries(BULK_CACHE):
            seen += 1
            cid = card.get("id") or ""
            if not cid or cid in done_set:
                continue
            if card.get("layout") in {"art_series", "emblem", "token"}:
                continue
            url = pick_image_url(card)
            if not url:
                skipped_no_image += 1
                continue
            todo.append((card, url))
            if args.limit and len(todo) >= args.limit:
                break
        log(f"bulk has {seen} entries; {len(todo)} to hash, {skipped_no_image} skipped (no image)")

        sem = asyncio.Semaphore(CONCURRENCY)
        start = time.time()
        last_flush_at = 0
        ok = 0
        fail = 0
        for batch_start in range(0, len(todo), 64):
            batch = todo[batch_start: batch_start + 64]
            results = await asyncio.gather(
                *(fetch_phash_v2(session, sem, url) for _, url in batch),
                return_exceptions=True,
            )
            for (card, url), packed in zip(batch, results):
                cid = card.get("id") or ""
                if isinstance(packed, BaseException) or packed is None:
                    fail += 1
                    continue
                rows.append({
                    "hash": packed.tolist(),   # JSON-friendly for progress file
                    "scryfall_id": cid,
                    "name": card.get("name", "")[:128],
                    "set": (card.get("set") or "").lower()[:10],
                    "collector_number": (card.get("collector_number") or "")[:16],
                    "released_at": card.get("released_at", "")[:10],
                    "image_url": url[:256],
                })
                done_set.add(cid)
                ok += 1

            if len(rows) - last_flush_at >= BATCH_FLUSH_EVERY:
                progress["rows"] = rows
                progress["done_ids"] = list(done_set)
                save_progress(progress)
                last_flush_at = len(rows)
                elapsed = time.time() - start
                rate = ok / elapsed if elapsed > 0 else 0
                eta_s = (len(todo) - (ok + fail)) / rate if rate > 0 else 0
                log(f"  progress: {ok} ok, {fail} fail, {rate:.1f}/s, ETA {eta_s/60:.1f} min")

        progress["rows"] = rows
        progress["done_ids"] = list(done_set)
        save_progress(progress)
        log(f"done hashing: {ok} ok, {fail} fail in {(time.time()-start)/60:.1f} min")

        # Dedupe by hash tuple, keeping most recently released printing.
        # 144 bits → use tuple-of-uint16 as hash key.
        rows.sort(key=lambda r: r["released_at"], reverse=True)
        seen_hash: set[tuple] = set()
        deduped: list[dict] = []
        for r in rows:
            key = tuple(r["hash"])
            if key in seen_hash:
                continue
            seen_hash.add(key)
            deduped.append(r)
        log(f"deduped: {len(rows)} → {len(deduped)} unique hashes")

        write_index(deduped, out)
        PROGRESS_PATH.unlink(missing_ok=True)

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Build 144-bit pHash index (v2).")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    try:
        return asyncio.run(main_async(args))
    except KeyboardInterrupt:
        log("interrupted — progress saved; re-run to resume")
        return 130


if __name__ == "__main__":
    sys.exit(main())
