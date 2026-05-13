"""
cardkingdom_prices.py
---------------------
Maintains an in-memory index of CardKingdom retail prices keyed by Scryfall ID.

CardKingdom publishes their full singles pricelist as a public JSON endpoint:
  https://api.cardkingdom.com/api/v2/pricelist

It refreshes about once a day. Each product entry includes:
  - scryfall_id : matches Scryfall's card id exactly
  - price_retail : CK's retail (sell) price as a string
  - price_buy : CK's buylist (buy) price as a string
  - is_foil : "0" or "1" string
  - qty_retail : how many they have for sale
  - name, edition, etc

We download once at startup, cache to disk, refresh every 24h.
"""

import asyncio
import time

import aiohttp
import ijson

from ..config import DATA_DIR

CK_PRICELIST_URL = "https://api.cardkingdom.com/api/v2/pricelist"
CACHE_DIR = DATA_DIR
CACHE_FILE = CACHE_DIR / "ck_pricelist.json"
CACHE_TTL_SECONDS = 24 * 3600  # refresh once per day

USER_AGENT = "MTGPasarMalamScanner/2.1"


def _to_float(v) -> float:
    try:
        if v is None or v == "":
            return 0.0
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _to_int(v) -> int:
    try:
        if v is None or v == "":
            return 0
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def _is_truthy(v) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, str):
        return v.strip() not in ("", "0", "false", "False")
    return False


class CKPriceIndex:
    def __init__(self):
        # scryfall_id -> {"normal": float|None, "foil": float|None,
        #                 "normal_buy": float|None, "foil_buy": float|None,
        #                 "normal_qty": int, "foil_qty": int}
        self.prices: dict[str, dict] = {}
        self.last_loaded: float = 0
        self.product_count: int = 0
        self.matched_scryfall_count: int = 0

    async def ensure_loaded(self, force: bool = False) -> None:
        if self.prices and not force:
            return
        await self.refresh(force=force)

    async def refresh(self, force: bool = False) -> None:
        """Download (if needed) and rebuild the index."""
        CACHE_DIR.mkdir(exist_ok=True)

        need_download = force or not CACHE_FILE.exists()
        if not need_download:
            age = time.time() - CACHE_FILE.stat().st_mtime
            if age > CACHE_TTL_SECONDS:
                need_download = True

        if need_download:
            try:
                await self._download()
            except Exception as e:
                if not CACHE_FILE.exists():
                    raise RuntimeError(f"Couldn't download CK pricelist and no cache exists: {e}")
                print(f"[cardkingdom] download failed ({e}); using existing cache", flush=True)

        # Heavy: the 65MB JSON balloons to ~250MB of transient Python objects
        # if parsed with json.load. ijson streams it product-by-product, keeping
        # peak memory roughly bounded by the final index size (~50MB).
        await asyncio.to_thread(self._build_from_cache)

    async def _download(self) -> None:
        print(f"[cardkingdom] downloading {CK_PRICELIST_URL} ...", flush=True)
        timeout = aiohttp.ClientTimeout(total=120)
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
            async with session.get(CK_PRICELIST_URL) as resp:
                resp.raise_for_status()
                # Stream to disk to avoid holding the whole thing in memory
                tmp = CACHE_FILE.with_suffix(".tmp")
                with open(tmp, "wb") as f:
                    async for chunk in resp.content.iter_chunked(1024 * 1024):
                        f.write(chunk)
                tmp.replace(CACHE_FILE)
        size_mb = CACHE_FILE.stat().st_size / 1e6
        print(f"[cardkingdom] downloaded {size_mb:.1f} MB to {CACHE_FILE}", flush=True)

    def _iter_products(self, f):
        """Yield products one at a time, handling both JSON shapes:
        either `{"data": [...]}` or a bare top-level array."""
        # Peek the first non-whitespace byte to choose the right ijson path.
        # Binary-mode reads return bytes, so compare against bytes.
        prefix = b""
        while True:
            ch = f.read(1)
            if not ch:
                return
            if ch.isspace():
                continue
            prefix = ch
            break
        f.seek(0)
        path = "data.item" if prefix == b"{" else "item"
        yield from ijson.items(f, path, use_float=True)

    def _build_from_cache(self) -> None:
        index: dict[str, dict] = {}
        product_count = 0
        # Open in binary mode — ijson prefers bytes and avoids the text-mode
        # decode buffer pulling the whole file into memory.
        with open(CACHE_FILE, "rb") as f:
            for p in self._iter_products(f):
                product_count += 1
                sid = (p.get("scryfall_id") or "").strip()
                if not sid:
                    continue
                price = _to_float(p.get("price_retail"))
                buy = _to_float(p.get("price_buy"))
                qty = _to_int(p.get("qty_retail"))
                is_foil = _is_truthy(p.get("is_foil"))

                entry = index.setdefault(sid, {
                    "normal": None, "foil": None,
                    "normal_buy": None, "foil_buy": None,
                    "normal_qty": 0, "foil_qty": 0,
                    "url_normal": "", "url_foil": "",
                })
                key = "foil" if is_foil else "normal"
                qty_key = key + "_qty"
                buy_key = key + "_buy"
                url_key = "url_" + key
                url = (p.get("url") or "").strip()
                # First-seen URL wins (variants for the same is_foil share product page)
                if url and not entry[url_key]:
                    entry[url_key] = url
                # If a card has multiple SKUs (different conditions), keep the entry
                # whose qty_retail is highest — that's the canonical NM listing.
                # (CK's pricelist usually has one row per is_foil per scryfall_id, but defensive.)
                if price > 0 and qty >= entry[qty_key]:
                    entry[key] = price
                    entry[qty_key] = qty
                    if buy > 0:
                        entry[buy_key] = buy

        self.prices = index
        self.product_count = product_count
        self.matched_scryfall_count = len(index)
        self.last_loaded = time.time()
        print(f"[cardkingdom] indexed {self.matched_scryfall_count} unique scryfall_ids "
              f"from {self.product_count} products", flush=True)

    def lookup(self, scryfall_id: str) -> dict:
        """
        Returns:
          {
            "retail_normal": float | None,
            "retail_foil": float | None,
            "buy_normal":   float | None,
            "buy_foil":     float | None,
            "in_stock_normal": bool,
            "in_stock_foil":   bool,
          }
        """
        entry = self.prices.get(scryfall_id)
        if not entry:
            return {
                "retail_normal": None, "retail_foil": None,
                "buy_normal": None, "buy_foil": None,
                "in_stock_normal": False, "in_stock_foil": False,
                "url_normal": "", "url_foil": "",
            }
        return {
            "retail_normal": entry["normal"],
            "retail_foil":   entry["foil"],
            "buy_normal":    entry["normal_buy"],
            "buy_foil":      entry["foil_buy"],
            "in_stock_normal": (entry["normal_qty"] or 0) > 0,
            "in_stock_foil":   (entry["foil_qty"] or 0) > 0,
            "url_normal":    entry.get("url_normal") or "",
            "url_foil":      entry.get("url_foil") or "",
        }


# Module-level singleton
_index: CKPriceIndex | None = None


async def get_index() -> CKPriceIndex:
    global _index
    if _index is None:
        _index = CKPriceIndex()
        await _index.ensure_loaded()
    return _index
