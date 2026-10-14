"""
scryfall_lookup.py
------------------
Take the scanner's card detections and look each up on Scryfall to get the
real price data, image URL, and confirmed metadata.

Lookup strategy per card (best -> last resort):
  0. By id: GET /cards/{scryfall_id}                (the scanner's index match)
  1. Name + collector number search, preferring the detected set
  2. Exact: GET /cards/{set}/{collector_number}     (if both present)
  3. Named with set hint: GET /cards/named?fuzzy=<name>&set=<set>
  4. Named only: GET /cards/named?fuzzy=<name>

In parallel with a semaphore + small delay to respect Scryfall's rate limit.
"""

import asyncio
import urllib.parse

import aiohttp

USER_AGENT = "MTGPasarMalamScanner/2.0"
HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json",
}

CONCURRENCY = 5
DELAY = 0.10  # 100ms between requests per worker


def to_card_summary(scryfall: dict | None, fallback_name: str = "") -> dict | None:
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


async def _fetch_json(session, url, params=None):
    try:
        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status == 200:
                return await resp.json()
    except Exception:
        pass
    return None


async def _lookup_one(session, sem, detection):
    async with sem:
        await asyncio.sleep(DELAY)
        name = (detection.name or "").strip()
        set_code = (detection.set_code or "").strip().lower()
        cnum = (detection.collector_number or "").strip()

        # Strategy 0: the scanner matched a specific printing in its index, so
        # fetch exactly that card. The strategies below only run if the id is
        # missing or Scryfall no longer knows it (stale index).
        scryfall_id = (getattr(detection, "scryfall_id", "") or "").strip()
        if scryfall_id:
            url = f"https://api.scryfall.com/cards/{urllib.parse.quote(scryfall_id)}"
            data = await _fetch_json(session, url)
            if data and "name" in data:
                return data

        # Strategy 1: name + collector_number via Scryfall search. We search
        # ALL printings of this name, filter to the matching cn, and prefer the
        # printing in the detected set only if it's actually one of the matches.
        if name and cnum:
            q = f'!"{name}" cn:{cnum}'
            data = await _fetch_json(
                session,
                "https://api.scryfall.com/cards/search",
                params={"q": q, "unique": "prints"},
            )
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
            url = f"https://api.scryfall.com/cards/{urllib.parse.quote(set_code)}/{urllib.parse.quote(cnum)}"
            data = await _fetch_json(session, url)
            if data and "name" in data:
                return data

        # Strategy 3: fuzzy named with set hint
        if name and set_code:
            data = await _fetch_json(session, "https://api.scryfall.com/cards/named",
                                     params={"fuzzy": name, "set": set_code})
            if data and "name" in data:
                return data

        # Strategy 4: fuzzy named alone
        if name:
            data = await _fetch_json(session, "https://api.scryfall.com/cards/named",
                                     params={"fuzzy": name})
            if data and "name" in data:
                return data

        return None


async def lookup_all(detections) -> list[dict | None]:
    """Look up every detection. Returns a list of summaries (or None) aligned with input."""
    if not detections:
        return []
    sem = asyncio.Semaphore(CONCURRENCY)
    async with aiohttp.ClientSession(headers=HEADERS) as session:
        results = await asyncio.gather(*[_lookup_one(session, sem, d) for d in detections])
    return [to_card_summary(r, fallback_name=d.name) for r, d in zip(results, detections)]
