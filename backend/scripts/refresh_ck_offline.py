#!/usr/bin/env python3
"""
Offline CardKingdom index build, for when CK blocks the Fly VM's IP.

What this does:
  1. Downloads CK's pricelist using your laptop's IP (where CK still serves us).
  2. Builds data/ck_index.db using the exact same _build_db_from_file path that
     the server would have used.
  3. Tells you the two commands to SFTP it onto the Fly volume + restart.

Usage:
    cd backend
    .venv/bin/python scripts/refresh_ck_offline.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Make `app.*` importable without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import aiohttp

from app.services.cardkingdom_prices import (
    CK_PRICELIST_URL,
    CACHE_DIR,
    DB_FILE,
    USER_AGENT,
    CKPriceIndex,
)

APP_NAME = "mtg-scanner-backend"


async def download_pricelist(dest: Path) -> None:
    print(f"[offline] downloading {CK_PRICELIST_URL} ...", flush=True)
    timeout = aiohttp.ClientTimeout(total=180)
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as s:
        async with s.get(CK_PRICELIST_URL) as resp:
            resp.raise_for_status()
            with open(dest, "wb") as f:
                async for chunk in resp.content.iter_chunked(1024 * 1024):
                    f.write(chunk)
    size_mb = dest.stat().st_size / 1e6
    print(f"[offline] downloaded {size_mb:.1f} MB → {dest}", flush=True)


async def main() -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    tmp_json = CACHE_DIR / ".ck_pricelist.download"
    tmp_db = DB_FILE.with_suffix(".db.tmp")

    await download_pricelist(tmp_json)

    print("[offline] building sqlite index ...", flush=True)
    idx = CKPriceIndex()
    unique, total = idx._build_db_from_file(tmp_json, tmp_db)
    tmp_json.unlink(missing_ok=True)
    db_mb = DB_FILE.stat().st_size / 1e6
    print(f"[offline] indexed {unique} unique scryfall_ids from {total} products",
          flush=True)
    print(f"[offline] wrote {DB_FILE} ({db_mb:.1f} MB)", flush=True)

    print()
    print("Next steps — push the index to Fly and restart:")
    print()
    print(f"  echo 'put {DB_FILE} /app/data/ck_index.db' | \\")
    print(f"      fly ssh sftp shell -a {APP_NAME}")
    print(f"  fly machine restart -a {APP_NAME}")
    print()
    print("Then verify:")
    print(f"  curl -s https://{APP_NAME}.fly.dev/api/health | jq .cardkingdom_cards")


if __name__ == "__main__":
    asyncio.run(main())
