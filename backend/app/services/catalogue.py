"""The card catalogue: Scryfall says which card it is, Card Kingdom what it costs.

Every card summary that leaves this module is CK-priced, so no caller looks a
card up and then has to remember to price it. This is the only module that
talks to Scryfall (User-Agent, timeouts, rate limit, lookup chains), and
`ck_index()` is the only way to the CK price list (cardkingdom_prices.py).
Tests replace `scryfall_cards` and `ck_index`.

Errors, one policy for the whole module:
  - A non-200 answer from Scryfall is a miss (`_get_json` returns None).
  - A scan's lookups never fail the scan: any error on one request is a miss
    too, and the chain goes on to the next strategy (`_try_json`).
  - The seller's own searches (`find`, `printings`) let network errors raise,
    so the app's 500 handler reports them.
"""

import asyncio
import urllib.parse

import aiohttp

from ..schemas.scan import Guess
from .cardkingdom_prices import USER_AGENT, CKPriceIndex

HEADERS = {"User-Agent": USER_AGENT, "Accept": "application/json"}
SCRYFALL = "https://api.scryfall.com"
CONCURRENCY = 5
DELAY = 0.10  # 100ms between requests per worker: Scryfall asks for ~10 req/sec max


# ---------- Card Kingdom ----------

_index: CKPriceIndex | None = None


async def ck_index() -> CKPriceIndex:
    """The open CK price list, loaded (or downloaded) on first use."""
    global _index
    if _index is None:
        _index = CKPriceIndex()
        await _index.refresh()
    return _index


def priced(summary: dict | None, ck: CKPriceIndex) -> dict | None:
    """A card summary with today's CK prices and URLs. CK is the *only* price
    source, no Scryfall/TCG fallback: a card CK does not list is priced at 0
    with `price_source_*` = "none" so the UI can flag it for a manual price."""
    if not summary:
        return None
    sid = summary.get("scryfall_id", "")
    normal, foil = ck.price(sid, False), ck.price(sid, True)

    def _ck_full_url(path: str) -> str:
        return "https://www.cardkingdom.com/" + path.lstrip("/") if path else ""

    return {
        **summary,
        "usd": normal.retail or 0.0,
        "usd_foil": foil.retail or 0.0,
        "price_source_normal": "cardkingdom" if normal.retail else "none",
        "price_source_foil": "cardkingdom" if foil.retail else "none",
        "ck_retail_normal": normal.retail,
        "ck_retail_foil": foil.retail,
        "ck_url_normal": _ck_full_url(normal.url),
        "ck_url_foil": _ck_full_url(foil.url),
    }


# ---------- Scryfall ----------

def _summary(scryfall: dict | None, fallback_name: str = "") -> dict | None:
    """Slim Scryfall response into the fields the frontend needs."""
    if not scryfall:
        return None
    image_uris = scryfall.get("image_uris") or {}
    if not image_uris and scryfall.get("card_faces"):
        # Double-faced cards: use first face's image
        image_uris = scryfall["card_faces"][0].get("image_uris", {})
    prices = scryfall.get("prices", {}) or {}

    def f(v):
        try:
            return float(v) if v else 0.0
        except (TypeError, ValueError):
            return 0.0

    return {
        "scryfall_id": scryfall.get("id", ""),
        "name": scryfall.get("name", fallback_name),
        "set": (scryfall.get("set") or "").upper(),
        "set_name": scryfall.get("set_name", ""),
        "collector_number": scryfall.get("collector_number", ""),
        "rarity": scryfall.get("rarity", ""),
        "usd": f(prices.get("usd")),
        "usd_foil": f(prices.get("usd_foil")),
        "image_url": image_uris.get("normal") or image_uris.get("small", ""),
        "scryfall_uri": scryfall.get("scryfall_uri", ""),
    }


def _session(timeout_s: float = 15) -> aiohttp.ClientSession:
    return aiohttp.ClientSession(headers=HEADERS, timeout=aiohttp.ClientTimeout(total=timeout_s))


async def _get_json(session: aiohttp.ClientSession, url: str, params: dict | None = None) -> dict | None:
    async with session.get(url, params=params) as resp:
        return await resp.json() if resp.status == 200 else None


async def _try_json(session: aiohttp.ClientSession, url: str, params: dict | None = None) -> dict | None:
    try:
        return await _get_json(session, url, params)
    except Exception:
        return None


async def _lookup_one(session, sem, detection: Guess):
    """Best -> last resort:
      0. By id: GET /cards/{scryfall_id}              (the scanner's index match)
      1. Name + collector number search, preferring the detected set
      2. Exact: GET /cards/{set}/{collector_number}   (if both present)
      3. Named with set hint: GET /cards/named?fuzzy=<name>&set=<set>
      4. Named only: GET /cards/named?fuzzy=<name>"""
    async with sem:
        await asyncio.sleep(DELAY)
        name = (detection.name or "").strip()
        set_code = (detection.set_code or "").strip().lower()
        cnum = (detection.collector_number or "").strip()

        # Strategy 0: the scanner matched a specific printing in its index, so
        # fetch exactly that card. The strategies below only run if the id is
        # missing or Scryfall no longer knows it (stale index).
        scryfall_id = detection.scryfall_id.strip()
        if scryfall_id:
            data = await _try_json(session, f"{SCRYFALL}/cards/{urllib.parse.quote(scryfall_id)}")
            if data and "name" in data:
                return data

        # Strategy 1: name + collector_number via Scryfall search. We search
        # ALL printings of this name, filter to the matching cn, and prefer the
        # printing in the detected set only if it's actually one of the matches.
        if name and cnum:
            data = await _try_json(session, f"{SCRYFALL}/cards/search",
                                   params={"q": f'!"{name}" cn:{cnum}', "unique": "prints"})
            if data and data.get("data"):
                cards = data["data"]
                if set_code:
                    for c in cards:
                        if (c.get("set") or "").lower() == set_code:
                            return c
                # No matching set hint — return the first (Scryfall orders by release)
                return cards[0]

        # Strategy 2: exact set + collector_number
        if set_code and cnum:
            url = f"{SCRYFALL}/cards/{urllib.parse.quote(set_code)}/{urllib.parse.quote(cnum)}"
            data = await _try_json(session, url)
            if data and "name" in data:
                return data

        # Strategy 3: fuzzy named with set hint
        if name and set_code:
            data = await _try_json(session, f"{SCRYFALL}/cards/named", params={"fuzzy": name, "set": set_code})
            if data and "name" in data:
                return data

        # Strategy 4: fuzzy named alone
        if name:
            data = await _try_json(session, f"{SCRYFALL}/cards/named", params={"fuzzy": name})
            if data and "name" in data:
                return data

        return None


async def scryfall_cards(guesses: list[Guess]) -> list[dict | None]:
    """Each scanner guess on Scryfall, unpriced: a summary, or None when
    nothing matched. Aligned with the input."""
    if not guesses:
        return []
    sem = asyncio.Semaphore(CONCURRENCY)
    async with _session() as session:
        results = await asyncio.gather(*[_lookup_one(session, sem, g) for g in guesses])
    return [_summary(r, fallback_name=g.name) for r, g in zip(results, guesses)]


# ---------- what callers use ----------

async def look_up(guesses: list[Guess]) -> list[dict | None]:
    """Each scanner guess as a priced card, or None when Scryfall has no match."""
    summaries = await scryfall_cards(guesses)
    ck = await ck_index()
    return [priced(s, ck) for s in summaries]


async def find(name: str, set_code: str = "") -> dict | None:
    """The seller's search for one card: fuzzy name (in `set_code` when
    given), then a full-text search; None when neither finds it."""
    params = {"fuzzy": name, **({"set": set_code} if set_code else {})}
    async with _session() as session:
        card = await _get_json(session, f"{SCRYFALL}/cards/named", params)
        if card is None:
            q = f"{name} set:{set_code}" if set_code else name
            body = await _get_json(session, f"{SCRYFALL}/cards/search",
                                   {"q": q, "order": "released", "unique": "cards"})
            card = ((body or {}).get("data") or [None])[0]
    return priced(_summary(card, fallback_name=name), await ck_index()) if card else None


async def printings(name: str) -> list[dict]:
    """Every printing of an exact card name, newest first (at most 4 pages)."""
    cards: list[dict] = []
    url = f"{SCRYFALL}/cards/search"
    params = {"q": f'!"{name}"', "unique": "prints", "order": "released", "dir": "desc"}
    async with _session(20) as session:
        for _ in range(4):
            body = await _get_json(session, url, params)
            if body is None:
                break
            cards.extend(body.get("data") or [])
            if not body.get("has_more") or not body.get("next_page"):
                break
            url, params = body["next_page"], None
    ck = await ck_index()
    return [priced(s, ck) for card in cards if (s := _summary(card))]
