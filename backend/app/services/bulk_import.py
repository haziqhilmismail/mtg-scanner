"""Moxfield-style bulk import: parse a textarea, look each line up on Scryfall,
return a list of Listing-ready dicts for the router to persist.

Accepted line shapes (case-insensitive, whitespace-tolerant):
    1 Lightning Bolt
    4 Counterspell (TMP) 86
    2x Mox Sapphire *F*
    1 Black Lotus (LEA) 232 *F*
    # comments and blank lines are ignored

Foil marker: `*F*` anywhere after the name. The leading qty is required."""

import asyncio
import math
import re
from decimal import Decimal
from typing import Any

import aiohttp

from .scryfall_lookup import HEADERS, to_card_summary

FOIL_RE = re.compile(r"\*F\*", re.IGNORECASE)
# `(SET) cn` block at end. cn may include letters, numbers, dashes, ★, etc.
SET_CN_RE = re.compile(r"\s*\(([A-Za-z0-9]{2,8})\)\s*([\w★\-]+)?\s*$")
QTY_NAME_RE = re.compile(r"^\s*(\d+)x?\s+(.+?)\s*$")


def parse_line(raw: str) -> dict[str, Any] | None:
    """Parse one line into {qty, name, set_code, collector_number, is_foil}.
    Returns None for blanks/comments. Raises ValueError on malformed lines."""
    line = raw.strip()
    if not line or line.startswith("#") or line.startswith("//"):
        return None

    is_foil = False
    if FOIL_RE.search(line):
        line = FOIL_RE.sub("", line).strip()
        is_foil = True

    set_code = None
    cnum = None
    m = SET_CN_RE.search(line)
    if m:
        set_code = m.group(1).lower()
        cnum = m.group(2) or None
        line = SET_CN_RE.sub("", line).strip()

    qm = QTY_NAME_RE.match(line)
    if not qm:
        raise ValueError("Expected a leading quantity, e.g. '1 Lightning Bolt'")
    qty = int(qm.group(1))
    if qty < 1:
        raise ValueError("Quantity must be at least 1")
    name = qm.group(2).strip()
    if not name:
        raise ValueError("Card name is missing")

    return {
        "qty": qty,
        "name": name,
        "set_code": set_code,
        "collector_number": cnum,
        "is_foil": is_foil,
    }


def _ceiling_price(usd: float, mult: float) -> Decimal:
    """RM 1 floor, round UP to the next whole RM. Matches the default frontend
    rounding for new listings; users can edit afterwards if they want finer."""
    raw = max(1.0, (usd or 0.0) * mult)
    return Decimal(str(int(math.ceil(raw)))).quantize(Decimal("0.01"))


async def _lookup_one(session: aiohttp.ClientSession, parsed: dict[str, Any]) -> dict[str, Any] | None:
    """Try exact (set+cn) → fuzzy named (with set hint) → fuzzy named.
    Returns a to_card_summary dict, or None if Scryfall yields nothing."""
    name = parsed["name"]
    set_code = parsed["set_code"]
    cnum = parsed["collector_number"]

    if set_code and cnum:
        async with session.get(f"https://api.scryfall.com/cards/{set_code}/{cnum}") as resp:
            if resp.status == 200:
                sf = await resp.json()
                return to_card_summary(sf, fallback_name=name)

    params: dict[str, str] = {"fuzzy": name}
    if set_code:
        params["set"] = set_code
    async with session.get("https://api.scryfall.com/cards/named", params=params) as resp:
        if resp.status == 200:
            sf = await resp.json()
            return to_card_summary(sf, fallback_name=name)

    if set_code:
        async with session.get(
            "https://api.scryfall.com/cards/named", params={"fuzzy": name},
        ) as resp:
            if resp.status == 200:
                sf = await resp.json()
                return to_card_summary(sf, fallback_name=name)

    return None


async def lookup_lines(
    parsed_lines: list[tuple[int, dict[str, Any] | Exception | None]],
) -> dict[int, dict[str, Any] | None]:
    """Look up each parsed line on Scryfall in parallel, with light concurrency
    so we stay polite. Returns {line_index: summary_or_None}."""
    out: dict[int, dict[str, Any] | None] = {}
    sem = asyncio.Semaphore(5)
    timeout = aiohttp.ClientTimeout(total=20)

    async with aiohttp.ClientSession(headers=HEADERS, timeout=timeout) as session:
        async def worker(idx: int, parsed: dict[str, Any]):
            async with sem:
                await asyncio.sleep(0.1)  # 100ms between requests per worker
                try:
                    out[idx] = await _lookup_one(session, parsed)
                except Exception:
                    out[idx] = None

        tasks = [
            worker(idx, parsed)
            for idx, parsed in parsed_lines
            if isinstance(parsed, dict)
        ]
        await asyncio.gather(*tasks)
    return out


def price_for_card(summary: dict[str, Any], is_foil: bool, mult_normal: float, mult_foil: float) -> Decimal:
    """Pick USD column based on foil flag, apply user's default multiplier, then ceiling-round."""
    usd = float(summary.get("usd_foil") or 0.0) if is_foil else float(summary.get("usd") or 0.0)
    return _ceiling_price(usd, mult_foil if is_foil else mult_normal)
