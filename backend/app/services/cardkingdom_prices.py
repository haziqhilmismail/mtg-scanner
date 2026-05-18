"""
cardkingdom_prices.py
---------------------
SQLite-backed index of CardKingdom retail prices keyed by Scryfall ID.

CardKingdom publishes their full singles pricelist as a public JSON endpoint:
  https://api.cardkingdom.com/api/v2/pricelist

It refreshes about once a day. Each product entry includes:
  - scryfall_id : matches Scryfall's card id exactly
  - price_retail : CK's retail (sell) price as a string
  - price_buy : CK's buylist (buy) price as a string
  - is_foil : "0" or "1" string
  - qty_retail : how many they have for sale
  - name, edition, url, etc

We download once at startup, cache the raw JSON to disk, then build a compact
SQLite cache (`data/ck_index.db`) which is the actual lookup target. The old
implementation held a ~95k-entry Python dict resident (~400 MB anon-rss thanks
to Python's per-string + per-dict overhead and allocator fragmentation), which
left no headroom on a 512 MB Fly VM — a single concurrent scan would OOM. The
SQLite cache keeps the working set on disk and the resident footprint to a few MB.

Refresh policy: the JSON cache TTL is 24h. On startup, if `ck_index.db` is at
least as new as the JSON, we just open it (milliseconds) — no re-parse. The
sqlite rebuild only runs when the JSON is fresher (i.e. we just downloaded a new
one, or someone hit /api/refresh-ck).
"""

import asyncio
import sqlite3
import time

import aiohttp
import ijson

from ..config import DATA_DIR

CK_PRICELIST_URL = "https://api.cardkingdom.com/api/v2/pricelist"
CACHE_DIR = DATA_DIR
CACHE_FILE = CACHE_DIR / "ck_pricelist.json"
DB_FILE = CACHE_DIR / "ck_index.db"
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


# `name_lower` + `edition_lower` exist purely for the fallback lookup path —
# Scryfall and CK occasionally disagree on the canonical scryfall_id for the
# same physical printing (most often with promo / reprint sets like Secrets of
# Strixhaven, Mystery Booster, Jumpstart). When the scryfall_id lookup misses,
# we re-query on (name, edition) so the card still gets priced.
_SCHEMA = """
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;
PRAGMA temp_store = MEMORY;
CREATE TABLE ck_prices (
    scryfall_id   TEXT    NOT NULL,
    is_foil       INTEGER NOT NULL,
    price_retail  REAL,
    price_buy     REAL,
    qty_retail    INTEGER NOT NULL DEFAULT 0,
    url           TEXT    NOT NULL DEFAULT '',
    name_lower    TEXT    NOT NULL DEFAULT '',
    edition_lower TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (scryfall_id, is_foil)
) WITHOUT ROWID;
CREATE INDEX idx_ck_name_edition ON ck_prices (name_lower, edition_lower, is_foil);
"""

# Mirrors the in-memory rule from the old dict implementation: within the same
# (scryfall_id, is_foil), the SKU with the highest qty_retail wins. The first
# non-empty URL observed wins (variants for the same is_foil share a product page).
# name_lower / edition_lower don't differ between SKUs of the same product, so
# they only need to be set on insert (or rescued from blank on update).
_UPSERT_SQL = """
INSERT INTO ck_prices (scryfall_id, is_foil, price_retail, price_buy, qty_retail, url, name_lower, edition_lower)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(scryfall_id, is_foil) DO UPDATE SET
  price_retail  = CASE WHEN excluded.qty_retail >= qty_retail AND excluded.price_retail > 0
                       THEN excluded.price_retail ELSE price_retail END,
  price_buy     = CASE WHEN excluded.qty_retail >= qty_retail AND excluded.price_retail > 0 AND excluded.price_buy > 0
                       THEN excluded.price_buy    ELSE price_buy    END,
  qty_retail    = CASE WHEN excluded.qty_retail >= qty_retail AND excluded.price_retail > 0
                       THEN excluded.qty_retail   ELSE qty_retail   END,
  url           = CASE WHEN url = '' THEN excluded.url ELSE url END,
  name_lower    = CASE WHEN name_lower = '' THEN excluded.name_lower ELSE name_lower END,
  edition_lower = CASE WHEN edition_lower = '' THEN excluded.edition_lower ELSE edition_lower END
"""


_EMPTY_LOOKUP = {
    "retail_normal": None, "retail_foil": None,
    "buy_normal": None, "buy_foil": None,
    "in_stock_normal": False, "in_stock_foil": False,
    "url_normal": "", "url_foil": "",
}


class CKPriceIndex:
    def __init__(self):
        self._conn: sqlite3.Connection | None = None
        self.last_loaded: float = 0
        self.product_count: int = 0
        self.matched_scryfall_count: int = 0

    async def ensure_loaded(self, force: bool = False) -> None:
        if self._conn is not None and not force:
            return
        await self.refresh(force=force)

    async def refresh(self, force: bool = False) -> None:
        """Download (if needed) and (re)build the sqlite index."""
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

        # Skip-rebuild shortcut: if the sqlite is at least as new as the json
        # (and we're not forcing), just open the existing DB. This is the common
        # case on machine restart and turns a multi-second rebuild into a sub-ms
        # file open.
        if not force and DB_FILE.exists() and CACHE_FILE.exists() \
                and DB_FILE.stat().st_mtime >= CACHE_FILE.stat().st_mtime:
            await asyncio.to_thread(self._open_existing)
            return

        await asyncio.to_thread(self._build_sqlite)

    async def _download(self) -> None:
        print(f"[cardkingdom] downloading {CK_PRICELIST_URL} ...", flush=True)
        timeout = aiohttp.ClientTimeout(total=120)
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
            async with session.get(CK_PRICELIST_URL) as resp:
                resp.raise_for_status()
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
        # Peek the first non-whitespace byte. Binary-mode reads return bytes,
        # so compare against bytes.
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

    def _open_existing(self) -> None:
        """Open the existing on-disk sqlite cache and refresh stats. Used when
        the DB is already at least as new as the json — no rebuild needed."""
        conn = sqlite3.connect(DB_FILE, check_same_thread=False, isolation_level=None)
        try:
            cols = {row[1] for row in conn.execute("PRAGMA table_info(ck_prices)").fetchall()}
            # If the DB was built by an older revision missing the name/edition
            # columns, drop it and rebuild. Cheap (1-2s) and only happens once.
            if "name_lower" not in cols or "edition_lower" not in cols:
                conn.close()
                DB_FILE.unlink(missing_ok=True)
                print("[cardkingdom] schema migration: rebuilding sqlite cache", flush=True)
                self._build_sqlite()
                return
            (total,) = conn.execute("SELECT COUNT(*) FROM ck_prices").fetchone()
            (unique,) = conn.execute("SELECT COUNT(DISTINCT scryfall_id) FROM ck_prices").fetchone()
        except sqlite3.DatabaseError:
            conn.close()
            # Corrupt — fall back to a full rebuild.
            DB_FILE.unlink(missing_ok=True)
            self._build_sqlite()
            return
        old = self._conn
        self._conn = conn
        self.product_count = total
        self.matched_scryfall_count = unique
        self.last_loaded = time.time()
        # Old conn (if any) becomes garbage; refcount-close lets in-flight
        # lookups finish before the handle is released.
        del old
        print(f"[cardkingdom] opened sqlite cache: {unique} unique scryfall_ids "
              f"({total} rows)", flush=True)

    def _build_sqlite(self) -> None:
        """Stream-parse the JSON cache into a fresh sqlite file, atomically
        replace the live DB, then swap the read connection. Peak memory is
        bounded by the insert batch (~5k tuples) + SQLite's tiny page cache."""
        tmp_path = DB_FILE.with_suffix(".db.tmp")
        if tmp_path.exists():
            tmp_path.unlink()

        build_conn = sqlite3.connect(tmp_path, isolation_level=None)
        product_count = 0
        try:
            build_conn.executescript(_SCHEMA)
            build_conn.execute("BEGIN")

            batch: list[tuple] = []
            BATCH = 5000
            with open(CACHE_FILE, "rb") as f:
                for p in self._iter_products(f):
                    product_count += 1
                    sid = (p.get("scryfall_id") or "").strip()
                    if not sid:
                        continue
                    price = _to_float(p.get("price_retail"))
                    buy = _to_float(p.get("price_buy"))
                    qty = _to_int(p.get("qty_retail"))
                    is_foil = 1 if _is_truthy(p.get("is_foil")) else 0
                    url = (p.get("url") or "").strip()
                    name_lower = (p.get("name") or "").strip().lower()
                    edition_lower = (p.get("edition") or "").strip().lower()
                    batch.append((sid, is_foil, price, buy, qty, url, name_lower, edition_lower))
                    if len(batch) >= BATCH:
                        build_conn.executemany(_UPSERT_SQL, batch)
                        batch.clear()
            if batch:
                build_conn.executemany(_UPSERT_SQL, batch)
                batch.clear()
            build_conn.execute("COMMIT")

            (unique_count,) = build_conn.execute(
                "SELECT COUNT(DISTINCT scryfall_id) FROM ck_prices"
            ).fetchone()
            (row_count,) = build_conn.execute(
                "SELECT COUNT(*) FROM ck_prices"
            ).fetchone()
        except Exception:
            build_conn.close()
            tmp_path.unlink(missing_ok=True)
            raise
        build_conn.close()

        # Atomic swap on POSIX. Touch mtime so the freshness check vs the JSON
        # cache is monotonic even if the rename inherited an older mtime.
        tmp_path.replace(DB_FILE)
        DB_FILE.touch(exist_ok=True)

        read_conn = sqlite3.connect(DB_FILE, check_same_thread=False, isolation_level=None)
        old = self._conn
        self._conn = read_conn
        self.product_count = product_count
        self.matched_scryfall_count = unique_count
        self.last_loaded = time.time()
        del old  # refcount-close; safe vs in-flight lookups holding the prior ref
        print(f"[cardkingdom] indexed {unique_count} unique scryfall_ids "
              f"from {product_count} products ({row_count} rows, sqlite)", flush=True)

    def lookup_by_name_edition(self, name: str, edition: str) -> dict:
        """Fallback lookup when the scryfall_id query misses. Returns the same
        shape as `lookup()`. Used by /api/scan when CK and Scryfall disagree on
        the canonical scryfall_id for a printing — most often promos / reprint
        sets like Secrets of Strixhaven. We accept the risk that within-set
        variants (extended-art, borderless) may collapse to the standard SKU's
        price; trade-off is worth it vs leaving the card unpriced."""
        if not name or not edition or self._conn is None:
            return dict(_EMPTY_LOOKUP)
        name_n = name.strip().lower()
        edition_n = edition.strip().lower()
        rows = self._conn.execute(
            "SELECT is_foil, price_retail, price_buy, qty_retail, url "
            "FROM ck_prices WHERE name_lower = ? AND edition_lower = ?",
            (name_n, edition_n),
        ).fetchall()
        if not rows:
            return dict(_EMPTY_LOOKUP)
        # If the index returns multiple rows per is_foil (shouldn't happen since
        # the build UPSERT already dedups, but defensive), keep the highest-qty
        # price for each side.
        best: dict[int, tuple[float | None, float | None, int, str]] = {}
        for is_foil, price, buy, qty, url in rows:
            cur = best.get(is_foil)
            if cur is None or (qty or 0) > cur[2]:
                best[is_foil] = (price, buy, qty or 0, url or "")
        result = dict(_EMPTY_LOOKUP)
        for is_foil, (price, buy, qty, url) in best.items():
            side = "foil" if is_foil else "normal"
            result[f"retail_{side}"] = price if price and price > 0 else None
            result[f"buy_{side}"] = buy if buy and buy > 0 else None
            result[f"in_stock_{side}"] = qty > 0
            result[f"url_{side}"] = url
        return result

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
            "url_normal":   str,
            "url_foil":     str,
          }
        """
        if not scryfall_id or self._conn is None:
            return dict(_EMPTY_LOOKUP)
        rows = self._conn.execute(
            "SELECT is_foil, price_retail, price_buy, qty_retail, url "
            "FROM ck_prices WHERE scryfall_id = ?",
            (scryfall_id,),
        ).fetchall()
        if not rows:
            return dict(_EMPTY_LOOKUP)
        result = dict(_EMPTY_LOOKUP)
        for is_foil, price, buy, qty, url in rows:
            side = "foil" if is_foil else "normal"
            result[f"retail_{side}"] = price if price and price > 0 else None
            result[f"buy_{side}"] = buy if buy and buy > 0 else None
            result[f"in_stock_{side}"] = (qty or 0) > 0
            result[f"url_{side}"] = url or ""
        return result


# Module-level singleton
_index: CKPriceIndex | None = None


async def get_index() -> CKPriceIndex:
    global _index
    if _index is None:
        _index = CKPriceIndex()
        await _index.ensure_loaded()
    return _index
