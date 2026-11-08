"""Card catalogue routes: the seller's own card searches, and the CK price
list refresh. The lookups themselves live in services/catalogue.py."""

from fastapi import APIRouter, Depends, Form, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from ..config import settings
from ..deps import CurrentUserId, json_payload, limiter
from ..services import catalogue

router = APIRouter(tags=["catalogue"])


def _check_refresh_token(x_refresh_token: str | None = Header(default=None)):
    if settings.refresh_ck_token and x_refresh_token != settings.refresh_ck_token:
        raise HTTPException(403, "Invalid or missing refresh token")


# The token is a dependency so a wrong one is refused before the limiter
# counts it; otherwise 3 bad calls would 429 the nightly refresh.
@router.post("/api/refresh-ck", dependencies=[Depends(_check_refresh_token)])
@limiter.limit("3/hour")  # CK pricelist is ~50MB; don't hammer their CDN
async def refresh_ck(request: Request):
    """Force a refresh from CK. 200 only when the download actually ran end
    to end; 502 if CK couldn't be reached.

    Guarded by `refresh_ck_token` when configured: the API's URL is public, so
    anyone could otherwise trigger a 50 MB rebuild. The scheduled GitHub Action
    sends the matching X-Refresh-Token header."""
    idx = await catalogue.ck_index()
    try:
        await idx.refresh(force=True)
    except Exception as e:
        return JSONResponse(
            status_code=502,
            content={
                "ok": False,
                "download_succeeded": False,
                "error": str(e),
                "indexed_cards": idx.matched_scryfall_count,
            },
        )
    return {
        "ok": True,
        "download_succeeded": True,
        "indexed_cards": idx.matched_scryfall_count,
    }


def _name(data: dict) -> str:
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Missing 'name'")
    return name


@router.post("/api/relookup")
@limiter.limit("60/minute")  # Scryfall asks ~10 req/sec max — keep well below
async def relookup(request: Request, _: CurrentUserId, payload: str = Form(...)):
    """Fuzzy lookup → search fallback → 404. Result is CK-priced."""
    data = json_payload(payload)
    name = _name(data)
    card = await catalogue.find(name, (data.get("set") or "").strip().lower())
    if card is None:
        raise HTTPException(404, "Card not found on Scryfall")
    return card


@router.post("/api/printings")
@limiter.limit("20/minute")  # Each call paginates Scryfall up to 4 pages
async def printings(request: Request, _: CurrentUserId, payload: str = Form(...)):
    """Every printing of a card name, paginated and CK-priced."""
    name = _name(json_payload(payload))
    found = await catalogue.printings(name)
    if not found:
        raise HTTPException(404, "No printings found for that name")
    return {"name": name, "printings": found}
