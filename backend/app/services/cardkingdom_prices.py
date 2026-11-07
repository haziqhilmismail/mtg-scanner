"""
cardkingdom_prices.py
---------------------
SQLite-backed index of CardKingdom retail prices keyed by Scryfall ID.

Reads:  GET https://api.cardkingdom.com/api/v2/pricelist  (streamed)
Writes: data/ck_index.db                                  (one persistent file)

That's the whole contract. We do NOT keep a persistent JSON copy of CK's
response any more — during a refresh we stream the HTTP body into a transient
tmp file in the data dir, ijson-parse it into a tmp sqlite, atomic-rename the
sqlite onto ck_index.db, and delete the tmp file. The previous two-cache
design (json + sqlite, with mtime comparisons) was an over-fit to CK's flaky
CDN and silently fell back to weeks-old data when a download failed; this
design either succeeds outright or raises so the caller can see what went wrong.

Refresh policy: on startup we open ck_index.db if it's < 24h old; otherwise
we refresh. /api/refresh-ck forces a refresh regardless of age. There is no
background timer; if the server stays up for a week and nobody hits the
refresh endpoint, the cache stays at the boot-time snapshot.

Price field: we always store the NM-condition price (taken from
`condition_values.nm_price`, falling back to the top-level `price_retail`
when condition_values is missing). The seller stocks NM cards themselves
and uses CK's NM list price as their pricing anchor, so EX/VG fallbacks
would undercharge them. Worked example: Clout of the Dominus (eve/99) —
CK is out at NM ($0.99 list) and only stocks EX at $0.79; we still store
$0.99 because that's what the seller wants to multiply against.
"""

import asyncio
import sqlite3
import time
from datetime import datetime, timezone
from typing import NamedTuple

import aiohttp
import ijson

from ..config import settings

CK_PRICELIST_URL = "https://api.cardkingdom.com/api/v2/pricelist"

# Refresh once per day. Only consulted at startup; once the connection is
# open this TTL is invisible until the next process restart.
CACHE_TTL_SECONDS = 24 * 3600

# Bumped on schema change so old on-disk DBs trigger a full rebuild instead
# of returning rows that are missing the new columns.
SCHEMA_VERSION = 2

# The one User-Agent for Card Kingdom and Scryfall (catalogue.py).
USER_AGENT = "MTGPasarMalamScanner/2.2"

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


def _pick_nm_price(p: dict) -> tuple[float, int]:
    """Always return CK's NM-condition price + qty.

    We deliberately ignore EX/VG/G fallbacks — the seller stocks NM cards
    and uses CK's NM list as their pricing anchor, so charging based on
    CK's currently-stocked-but-lower-grade price would undercut them.
    qty is `nm_qty` so the in-stock flag downstream reflects "can a buyer
    actually get this from CK at NM" rather than "any condition is stocked."

    Falls back to the top-level `price_retail` / `qty_retail` only when
    `condition_values` is missing entirely (a few edge SKUs); the top-level
    `price_retail` IS the NM list price, so the fallback preserves intent.
    """
    cv = p.get("condition_values") or {}
    nm_price = _to_float(cv.get("nm_price"))
    if nm_price > 0:
        return nm_price, _to_int(cv.get("nm_qty"))
    return _to_float(p.get("price_retail")), _to_int(p.get("qty_retail"))


_SCHEMA = """
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;
PRAGMA temp_store = MEMORY;
CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE ck_prices (
    scryfall_id  TEXT    NOT NULL,
    is_foil      INTEGER NOT NULL,
    name         TEXT    NOT NULL DEFAULT '',
    edition      TEXT    NOT NULL DEFAULT '',
    price_retail REAL,
    price_buy    REAL,
    qty_retail   INTEGER NOT NULL DEFAULT 0,
    url          TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (scryfall_id, is_foil)
) WITHOUT ROWID;
"""

# Dedup rule (CK sometimes lists multiple SKUs against the same scryfall_id +
# is_foil — language variants, condition pools, etc): the SKU with the most
# stock wins. URL / name / edition take the first non-empty value observed.
_UPSERT_SQL = """
INSERT INTO ck_prices (scryfall_id, is_foil, name, edition, price_retail, price_buy, qty_retail, url)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(scryfall_id, is_foil) DO UPDATE SET
  name         = CASE WHEN name = ''         THEN excluded.name    ELSE name         END,
  edition      = CASE WHEN edition = ''      THEN excluded.edition ELSE edition      END,
  price_retail = CASE WHEN excluded.qty_retail >= qty_retail AND excluded.price_retail > 0
                      THEN excluded.price_retail ELSE price_retail END,
  price_buy    = CASE WHEN excluded.qty_retail >= qty_retail AND excluded.price_retail > 0 AND excluded.price_buy > 0
                      THEN excluded.price_buy    ELSE price_buy    END,
  qty_retail   = CASE WHEN excluded.qty_retail >= qty_retail AND excluded.price_retail > 0
                      THEN excluded.qty_retail   ELSE qty_retail   END,
  url          = CASE WHEN url = '' THEN excluded.url ELSE url END
"""


class CKPrice(NamedTuple):
    """CK's NM price for one finish of one printing. Prices are None when CK
    does not list it (or lists it at 0); url is CK's path, "" when unlisted."""
    retail: float | None = None
    buy: float | None = None
    url: str = ""


class CKPriceIndex:
    def __init__(self):
        self._conn: sqlite3.Connection | None = None
        self.matched_scryfall_count: int = 0
        # When the open price list was downloaded (the file's time), UTC.
        self.fetched_at: datetime | None = None

    async def refresh(self, force: bool = False) -> None:
        """
        Reads:  GET CK_PRICELIST_URL (streamed; transient file under data/)
        Writes: settings.ck_db_file (atomic via .tmp + rename)

        force=False + recent DB exists → just open it (sub-ms).
        force=True OR no/stale DB     → download + rebuild.

        On download failure: raises. The previous self._conn (if any) is
        left in place, so the running app keeps serving whatever it was
        serving before — but the caller (e.g. /api/refresh-ck) sees the
        exception and can surface it to the user, rather than silently
        rebuilding from a stale cache.
        """
        settings.data_dir.mkdir(parents=True, exist_ok=True)

        if not force and settings.ck_db_file.exists():
            age = time.time() - settings.ck_db_file.stat().st_mtime
            if age < CACHE_TTL_SECONDS:
                opened = await asyncio.to_thread(self._try_open_existing)
                if opened:
                    return
                # Schema drift / corruption → fall through to full rebuild.

        await self._download_and_build()

    def _try_open_existing(self) -> bool:
        """Open settings.ck_db_file and confirm it's the current schema version.
        Returns True on success; False if the caller should rebuild."""
        try:
            conn = sqlite3.connect(settings.ck_db_file, check_same_thread=False, isolation_level=None)
            row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
            if not row or int(row[0]) != SCHEMA_VERSION:
                conn.close()
                return False
            (total,) = conn.execute("SELECT COUNT(*) FROM ck_prices").fetchone()
            (unique,) = conn.execute("SELECT COUNT(DISTINCT scryfall_id) FROM ck_prices").fetchone()
        except sqlite3.DatabaseError:
            return False

        old = self._conn
        self._conn = conn
        self.matched_scryfall_count = unique
        self.fetched_at = datetime.fromtimestamp(settings.ck_db_file.stat().st_mtime, timezone.utc)
        del old  # refcount-close lets in-flight lookups release the old handle
        print(f"[cardkingdom] opened existing cache: {unique} unique scryfall_ids "
              f"({total} rows)", flush=True)
        return True

    async def _download_and_build(self) -> None:
        """The only path that actually talks to CK.

        1. Stream HTTP body to data/.ck_pricelist.download (transient).
        2. ijson-parse the file → batched INSERTs into data/ck_index.db.tmp.
        3. Atomic-rename tmp → ck_index.db; swap the read connection.
        4. Delete the transient download file.

        Raises on HTTP error or parse failure. Does NOT clobber self._conn
        unless the build all the way succeeds.
        """
        download_path = settings.data_dir / ".ck_pricelist.download"
        tmp_db = settings.ck_db_file.with_suffix(".db.tmp")

        # Step 1 — stream download.
        print(f"[cardkingdom] downloading {CK_PRICELIST_URL} ...", flush=True)
        timeout = aiohttp.ClientTimeout(total=180)
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
            async with session.get(CK_PRICELIST_URL) as resp:
                resp.raise_for_status()
                with open(download_path, "wb") as f:
                    async for chunk in resp.content.iter_chunked(1024 * 1024):
                        f.write(chunk)
        size_mb = download_path.stat().st_size / 1e6
        print(f"[cardkingdom] downloaded {size_mb:.1f} MB", flush=True)

        # Step 2-3 — parse + build sqlite (CPU-bound; off-loop to a thread).
        try:
            unique_count, product_count = await asyncio.to_thread(
                self._build_db_from_file, download_path, tmp_db
            )
        finally:
            # Step 4 — always drop the transient download, success or fail.
            download_path.unlink(missing_ok=True)

        self.matched_scryfall_count = unique_count
        print(f"[cardkingdom] indexed {unique_count} unique scryfall_ids "
              f"from {product_count} products", flush=True)

    def _build_db_from_file(self, src_json, dest_db_tmp) -> tuple[int, int]:
        """Read src_json (a downloaded JSON file), build a fresh sqlite at
        dest_db_tmp, atomic-rename onto settings.ck_db_file, swap self._conn. Returns
        (unique_scryfall_ids, total_products_seen)."""
        if dest_db_tmp.exists():
            dest_db_tmp.unlink()

        build_conn = sqlite3.connect(dest_db_tmp, isolation_level=None)
        product_count = 0
        try:
            build_conn.executescript(_SCHEMA)
            build_conn.execute(
                "INSERT INTO meta (key, value) VALUES ('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )
            build_conn.execute("BEGIN")

            batch: list[tuple] = []
            BATCH = 5000
            with open(src_json, "rb") as f:
                for p in _iter_ck_products(f):
                    product_count += 1
                    sid = (p.get("scryfall_id") or "").strip()
                    if not sid:
                        continue
                    price, qty = _pick_nm_price(p)
                    buy = _to_float(p.get("price_buy"))
                    is_foil = 1 if _is_truthy(p.get("is_foil")) else 0
                    name = (p.get("name") or "").strip()
                    edition = (p.get("edition") or "").strip()
                    url = (p.get("url") or "").strip()
                    batch.append((sid, is_foil, name, edition, price, buy, qty, url))
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
        except Exception:
            build_conn.close()
            dest_db_tmp.unlink(missing_ok=True)
            raise
        build_conn.close()

        # POSIX-atomic swap onto the live DB. Touch mtime so the freshness
        # check vs CACHE_TTL_SECONDS is monotonic next boot.
        dest_db_tmp.replace(settings.ck_db_file)
        settings.ck_db_file.touch(exist_ok=True)

        read_conn = sqlite3.connect(settings.ck_db_file, check_same_thread=False, isolation_level=None)
        old = self._conn
        self._conn = read_conn
        self.fetched_at = datetime.fromtimestamp(settings.ck_db_file.stat().st_mtime, timezone.utc)
        del old  # refcount-close; safe vs. in-flight lookups holding the prior ref
        return unique_count, product_count

    def price(self, scryfall_id: str | None, foil: bool) -> CKPrice:
        if not scryfall_id or self._conn is None:
            return CKPrice()
        row = self._conn.execute(
            "SELECT price_retail, price_buy, url FROM ck_prices WHERE scryfall_id = ? AND is_foil = ?",
            (scryfall_id, int(foil)),
        ).fetchone()
        if not row:
            return CKPrice()
        retail, buy, url = row
        return CKPrice(retail if retail and retail > 0 else None, buy if buy and buy > 0 else None, url or "")


def _iter_ck_products(f):
    """Yield products one at a time from CK's JSON file. Handles both shapes
    CK has shipped over the years: `{"data": [...]}` and a bare top-level
    array. The peek must compare to BYTES (b"{"); a str comparison silently
    picks the wrong ijson path and yields zero products."""
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
