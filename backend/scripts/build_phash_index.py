"""
build_phash_index.py
--------------------
One-off (or occasional refresh) script that builds the local pHash index used
by services/local_card_id.py.

Pipeline:
  1. Hit Scryfall's /bulk-data endpoint and grab the latest `unique_artwork`
     bulk-data download URL. unique_artwork is the right cut: same art across
     reprints hashes identically, so deduping by art saves ~50% of the index
     vs default_cards.
  2. Stream-parse the JSON (~100MB) with ijson so peak RAM stays modest.
  3. For each entry: GET `image_uris.normal` (488x680, ~60KB) from the
     Scryfall CDN, compute imagehash.phash (64-bit), keep the metadata we
     care about.
  4. Write data/phash_index.npz with:
       hashes        uint64    (N,)
       scryfall_id   S36       (N,)
       name          U128      (N,)
       set           S10       (N,)
       collector_number S16    (N,)
       released_at   S10       (N,)

Resumable: progress is saved to data/phash_build_progress.json after every
batch, so re-running the script picks up where it left off if Scryfall
times out or the network drops.

Usage:
  cd backend
  python scripts/build_phash_index.py [--limit N] [--out PATH] [--force]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
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
DEFAULT_OUT = DATA_DIR / "phash_index.npz"
PROGRESS_PATH = DATA_DIR / "phash_build_progress.json"
BULK_CACHE = DATA_DIR / "scryfall_unique_artwork.json"

SCRYFALL_BULK_URL = "https://api.scryfall.com/bulk-data"
USER_AGENT = "MTGPasarMalamScanner-IndexBuilder/1.0"

CONCURRENCY = 5
REQUEST_DELAY = 0.08          # 80ms between requests per worker — polite to Scryfall CDN
BATCH_FLUSH_EVERY = 200       # checkpoint progress every N hashes


def log(msg: str) -> None:
    print(f"[phash] {msg}", flush=True)


async def fetch_bulk_meta(session: aiohttp.ClientSession) -> dict:
    async with session.get(SCRYFALL_BULK_URL) as resp:
        resp.raise_for_status()
        data = await resp.json()
    for entry in data.get("data") or []:
        if entry.get("type") == "unique_artwork":
            return entry
    raise RuntimeError("unique_artwork bulk-data entry not found in Scryfall response")


async def download_bulk(session: aiohttp.ClientSession, url: str, dest: Path) -> None:
    """Stream the bulk JSON to disk (~100MB, don't load into RAM)."""
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
    """Stream-parse Scryfall bulk dump. Each entry is one card-print."""
    with open(path, "rb") as fh:
        for item in ijson.items(fh, "item"):
            yield item


def pick_image_url(card: dict) -> str | None:
    """Choose the best Scryfall image URL for pHash. Falls back to face[0] for DFCs."""
    image_uris = card.get("image_uris") or {}
    if not image_uris:
        faces = card.get("card_faces") or []
        if faces:
            image_uris = faces[0].get("image_uris") or {}
    # `normal` is 488x680, which matches MTG card aspect natively. `small`
    # (146x204) loses too much DCT signal — empirically increases collisions.
    return image_uris.get("normal") or image_uris.get("large") or image_uris.get("small")


async def fetch_phash(session: aiohttp.ClientSession, sem: asyncio.Semaphore, url: str) -> np.uint64 | None:
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
    # imagehash.phash returns ImageHash; .hash is an 8x8 bool ndarray.
    # Pack the 64 bits MSB-first into a single uint64 so we can store as
    # a flat numpy array and do vectorized Hamming distance at runtime.
    h = imagehash.phash(img, hash_size=8)
    bits = h.hash.flatten()
    if bits.size != 64:
        return None
    packed = 0
    for bit in bits:
        packed = (packed << 1) | int(bit)
    return np.uint64(packed)


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
    """Pack rows into an .npz with parallel arrays."""
    if not rows:
        raise RuntimeError("no rows to write — nothing was successfully hashed")
    hashes = np.array([r["hash"] for r in rows], dtype=np.uint64)
    scryfall_id = np.array([r["scryfall_id"] for r in rows], dtype="S36")
    name = np.array([r["name"] for r in rows], dtype="U128")
    set_code = np.array([r["set"] for r in rows], dtype="S10")
    # Collector numbers can include non-ASCII glyphs like ★ on special-frame
    # printings — Unicode dtype, not bytes.
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
    )
    log(f"wrote {out} ({out.stat().st_size/1e6:.1f} MB, {len(rows)} entries)")


async def main_async(args) -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = Path(args.out).resolve()

    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    timeout = aiohttp.ClientTimeout(total=60)
    async with aiohttp.ClientSession(headers=headers, timeout=timeout) as session:
        # Step 1: bulk-data metadata
        meta = await fetch_bulk_meta(session)
        download_uri = meta["download_uri"]
        updated_at = meta.get("updated_at", "")
        log(f"unique_artwork updated_at={updated_at}")

        # Step 2: download bulk if missing or --force
        if args.force or not BULK_CACHE.exists():
            await download_bulk(session, download_uri, BULK_CACHE)
        else:
            log(f"using cached bulk JSON at {BULK_CACHE} (use --force to refresh)")

        # Step 3: load progress
        progress = load_progress() if not args.force else {"done_ids": [], "rows": []}
        done_set = set(progress["done_ids"])
        rows: list[dict] = list(progress["rows"])
        log(f"resuming with {len(rows)} rows already hashed; {len(done_set)} ids skipped")

        # Step 4: build a list of (card_meta, url) for entries we still need
        todo: list[tuple[dict, str]] = []
        skipped_no_image = 0
        seen = 0
        for card in iter_bulk_entries(BULK_CACHE):
            seen += 1
            cid = card.get("id") or ""
            if not cid or cid in done_set:
                continue
            # Skip art_series, tokens, and emblems — they hash but pollute matches.
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

        # Step 5: hash in batches of CONCURRENCY*4 — flush progress every BATCH_FLUSH_EVERY
        sem = asyncio.Semaphore(CONCURRENCY)
        start = time.time()
        last_flush_at = 0
        ok = 0
        fail = 0
        for batch_start in range(0, len(todo), 64):
            batch = todo[batch_start: batch_start + 64]
            results = await asyncio.gather(
                *(fetch_phash(session, sem, url) for _, url in batch),
                return_exceptions=True,
            )
            for (card, url), packed in zip(batch, results):
                cid = card.get("id") or ""
                if isinstance(packed, BaseException) or packed is None:
                    fail += 1
                    continue
                rows.append({
                    "hash": int(packed),
                    "scryfall_id": cid,
                    "name": card.get("name", "")[:128],
                    "set": (card.get("set") or "").lower()[:10],
                    "collector_number": (card.get("collector_number") or "")[:16],
                    "released_at": card.get("released_at", "")[:10],
                    "image_url": url[:256],
                })
                done_set.add(cid)
                ok += 1

            # Checkpoint every BATCH_FLUSH_EVERY successful hashes
            if len(rows) - last_flush_at >= BATCH_FLUSH_EVERY:
                progress["rows"] = rows
                progress["done_ids"] = list(done_set)
                save_progress(progress)
                last_flush_at = len(rows)
                elapsed = time.time() - start
                rate = ok / elapsed if elapsed > 0 else 0
                eta_s = (len(todo) - (ok + fail)) / rate if rate > 0 else 0
                log(f"  progress: {ok} ok, {fail} fail, {rate:.1f}/s, ETA {eta_s/60:.1f} min")

        # Final flush
        progress["rows"] = rows
        progress["done_ids"] = list(done_set)
        save_progress(progress)
        log(f"done hashing: {ok} ok, {fail} fail in {(time.time()-start)/60:.1f} min")

        # Step 6: dedupe by hash, keep most recently released printing.
        # Two prints with the same art produce the same pHash; we'd rather show
        # the recent one because users are most likely to be holding it.
        rows.sort(key=lambda r: r["released_at"], reverse=True)
        seen_hash: set[int] = set()
        deduped: list[dict] = []
        for r in rows:
            if r["hash"] in seen_hash:
                continue
            seen_hash.add(r["hash"])
            deduped.append(r)
        log(f"deduped: {len(rows)} → {len(deduped)} unique hashes")

        # Step 7: write index
        write_index(deduped, out)

        # Step 8: cleanup progress so the next run starts fresh (cache stays)
        PROGRESS_PATH.unlink(missing_ok=True)

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Build local pHash index for MTG card identification.")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help=f"output .npz path (default: {DEFAULT_OUT})")
    parser.add_argument("--limit", type=int, default=0, help="cap entries (debug); 0 = no cap")
    parser.add_argument("--force", action="store_true", help="ignore cached bulk JSON + progress, start over")
    args = parser.parse_args()

    try:
        return asyncio.run(main_async(args))
    except KeyboardInterrupt:
        log("interrupted — progress saved; re-run to resume")
        return 130


if __name__ == "__main__":
    sys.exit(main())
