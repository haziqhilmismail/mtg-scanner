"""
FastAPI app entry point.

Routes:
  GET  /                  -> static/index.html
  GET  /api/health        -> Gemini key + CK index status
  POST /api/scan          -> upload image, return detected cards
  POST /api/relookup      -> Scryfall fuzzy + search fallback, CK-enriched
  POST /api/printings     -> all printings of a name, CK-enriched
  POST /api/refresh-ck    -> force-refresh the CK pricelist
  POST /api/export        -> render the priced overlay PNG

DB tables (users, scans, listings, buyers, orders, order_items, payments)
are created on startup and a solo-mode user row is seeded if missing.
"""

import asyncio
import base64
import json
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path

import aiohttp
from alembic import command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import select

from .config import DATA_DIR, settings
from .db import async_session_factory
from .deps import CurrentUserId, DbSession
from .models import Scan, User
from .routers import auth as auth_router
from .routers import buyers as buyers_router
from .routers import listings as listings_router
from .routers import orders as orders_router
from .routers import posts as posts_router
from .services.cardkingdom_prices import get_index as get_ck_index
from .services.gemini_scanner import get_client, scan_image
from .services.price_overlay import render_overlay
from .services.scryfall_lookup import (
    HEADERS as SCRYFALL_HEADERS,
    lookup_all,
    to_card_summary,
)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
SCANS_DIR = DATA_DIR / "scans"
SCANS_DIR.mkdir(exist_ok=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 1) Run any pending migrations. Alembic is sync, so dispatch to a thread.
    alembic_cfg = AlembicConfig(str(BASE_DIR.parent / "alembic.ini"))
    await asyncio.to_thread(command.upgrade, alembic_cfg, "head")

    # 2) Seed solo-mode user if it doesn't exist
    async with async_session_factory() as s:
        existing = await s.scalar(select(User).where(User.id == settings.solo_user_id))
        if not existing:
            s.add(User(
                id=settings.solo_user_id,
                email=f"solo-{settings.solo_user_id}@local",
                fb_name="Me",
                default_currency="RM",
                default_mult_normal=2.8,
                default_mult_foil=3.0,
            ))
            await s.commit()
            print(f"[startup] Seeded solo user id={settings.solo_user_id}")

    # 3) Kick off CK pricelist load
    try:
        idx = await get_ck_index()
        print(f"[startup] CK index ready: {idx.matched_scryfall_count} cards")
    except Exception as e:
        print(f"[startup] WARNING — CK index failed to load: {e}")
        print("[startup] Server will start anyway; falling back to TCGplayer prices.")
    yield


app = FastAPI(title="MTG Pasar Malam Scanner", lifespan=lifespan)

# Rate limiter — in-memory, keyed by client IP. Each external-API or CPU-heavy
# endpoint is decorated with @limiter.limit("…") below. Internal CRUD routes
# (listings/buyers/orders) are unlimited since they don't call out and the app
# is single-user; if you ever expose this publicly, add decorators there too.
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
async def health():
    out: dict = {"ok": True, "model": settings.gemini_model}
    try:
        get_client()
    except Exception as e:
        out["ok"] = False
        out["gemini_error"] = str(e)
    try:
        idx = await get_ck_index()
        out["cardkingdom_cards"] = idx.matched_scryfall_count
    except Exception as e:
        out["cardkingdom_error"] = str(e)
    return out


@app.post("/api/refresh-ck")
@limiter.limit("3/hour")  # CK pricelist is ~50MB; don't hammer their CDN
async def refresh_ck(request: Request):
    idx = await get_ck_index()
    await idx.refresh(force=True)
    return {"ok": True, "indexed_cards": idx.matched_scryfall_count}


# ---------- Image cache for the export step ----------
# In-memory dict for now; survives within a single uvicorn process.
# Swap to disk-backed cache once we want exports to survive a restart.
_IMAGE_CACHE: dict[str, bytes] = {}
_CACHE_LIMIT = 30


def _cache_put(key: str, val: bytes):
    if len(_IMAGE_CACHE) >= _CACHE_LIMIT:
        oldest = next(iter(_IMAGE_CACHE))
        _IMAGE_CACHE.pop(oldest, None)
    _IMAGE_CACHE[key] = val


def _make_thumb_b64(pil: Image.Image, x: int, y: int, x2: int, y2: int) -> str:
    crop = pil.crop((max(0, x), max(0, y), min(pil.width, x2), min(pil.height, y2)))
    if crop.width == 0 or crop.height == 0:
        return ""
    # 700px wide gives plenty of detail when zoomed (the zoom modal caps at 900px).
    # The row thumbnail in the React UI renders this at ~78px wide, so we're paying
    # extra bytes once and reusing them for click-to-zoom — no extra round-trip needed.
    crop.thumbnail((700, 980))
    buf = BytesIO()
    crop.convert("RGB").save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _preview_b64(pil: Image.Image) -> str:
    p = pil.copy()
    if max(p.size) > 1400:
        p.thumbnail((1400, 1400))
    buf = BytesIO()
    p.convert("RGB").save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _enrich_with_ck(summary: dict | None, ck_index) -> dict | None:
    """Merge CK prices/URLs into a Scryfall summary. CK becomes primary, TCG falls back."""
    if not summary:
        return None
    sid = summary.get("scryfall_id", "")
    ck = ck_index.lookup(sid) if sid else {
        "retail_normal": None, "retail_foil": None,
        "buy_normal": None, "buy_foil": None,
        "in_stock_normal": False, "in_stock_foil": False,
        "url_normal": "", "url_foil": "",
    }
    tcg_normal = summary.get("usd", 0.0) or 0.0
    tcg_foil = summary.get("usd_foil", 0.0) or 0.0

    primary_normal = ck["retail_normal"] if ck["retail_normal"] else tcg_normal
    primary_foil = ck["retail_foil"] if ck["retail_foil"] else tcg_foil

    def _ck_full_url(path: str) -> str:
        if not path:
            return ""
        return "https://www.cardkingdom.com/" + path.lstrip("/")

    summary = {**summary}
    summary["usd"] = primary_normal or 0.0
    summary["usd_foil"] = primary_foil or 0.0
    summary["price_source_normal"] = "cardkingdom" if ck["retail_normal"] else ("tcgplayer" if tcg_normal else "none")
    summary["price_source_foil"] = "cardkingdom" if ck["retail_foil"] else ("tcgplayer" if tcg_foil else "none")
    summary["ck_retail_normal"] = ck["retail_normal"]
    summary["ck_retail_foil"] = ck["retail_foil"]
    summary["ck_buy_normal"] = ck["buy_normal"]
    summary["ck_buy_foil"] = ck["buy_foil"]
    summary["ck_in_stock_normal"] = ck["in_stock_normal"]
    summary["ck_in_stock_foil"] = ck["in_stock_foil"]
    summary["ck_url_normal"] = _ck_full_url(ck.get("url_normal", ""))
    summary["ck_url_foil"] = _ck_full_url(ck.get("url_foil", ""))
    summary["tcg_usd"] = tcg_normal
    summary["tcg_usd_foil"] = tcg_foil
    return summary


@app.post("/api/scan")
@limiter.limit("30/minute;200/hour")  # Gemini calls — quota- and cost-sensitive
async def scan(
    request: Request,
    db: DbSession,
    user_id: CurrentUserId,
    image: UploadFile = File(...),
):
    raw = await image.read()
    try:
        pil = Image.open(BytesIO(raw))
        pil.load()
    except Exception:
        raise HTTPException(400, "Could not decode image")

    try:
        from PIL import ImageOps
        pil = ImageOps.exif_transpose(pil)
    except Exception:
        pass

    norm_buf = BytesIO()
    pil.convert("RGB").save(norm_buf, format="JPEG", quality=92)
    norm_bytes = norm_buf.getvalue()

    W, H = pil.size

    try:
        detections = scan_image(norm_bytes, mime_type="image/jpeg")
    except Exception as e:
        raise HTTPException(500, f"Gemini call failed: {e}")

    summaries = await lookup_all(detections)

    ck_index = await get_ck_index()
    summaries = [_enrich_with_ck(s, ck_index) for s in summaries]

    cards_out = []
    for i, (det, sf) in enumerate(zip(detections, summaries)):
        try:
            ymin, xmin, ymax, xmax = det.box_2d
        except (ValueError, TypeError):
            ymin, xmin, ymax, xmax = 0, 0, 1000, 1000

        x = int(xmin / 1000 * W)
        y = int(ymin / 1000 * H)
        x2 = int(xmax / 1000 * W)
        y2 = int(ymax / 1000 * H)
        x, y = max(0, x), max(0, y)
        x2, y2 = min(W, x2), min(H, y2)
        if x2 <= x or y2 <= y:
            x, y, x2, y2 = 0, 0, W, H

        crop_b64 = _make_thumb_b64(pil, x, y, x2, y2)

        if sf is None:
            sf = {
                "scryfall_id": "",
                "name": det.name or "(unknown)",
                "set": (det.set_code or "").upper(),
                "set_name": "",
                "collector_number": det.collector_number or "",
                "rarity": "",
                "usd": 0.0, "usd_foil": 0.0,
                "image_url": "",
                "scryfall_uri": "",
                "_lookup_failed": True,
                "price_source_normal": "none",
                "price_source_foil": "none",
            }

        cards_out.append({
            "id": i,
            "bbox": [x, y, x2 - x, y2 - y],
            "corners": [[x, y], [x2, y], [x2, y2], [x, y2]],
            "crop_b64": crop_b64,
            "gemini": {
                "name": det.name,
                "set_code": det.set_code,
                "collector_number": det.collector_number,
                "is_foil": det.is_foil,
                "quantity": det.quantity,
            },
            "candidates": [sf],
        })

    preview_b64 = _preview_b64(pil)

    # Persist: write the original image to disk and record a Scan row.
    # We stash the full response payload (cards + preview) inside gemini_raw so
    # GET /api/scans can rehydrate the frontend on refresh without re-running Gemini.
    response_payload = {
        "image_b64": preview_b64,
        "width": W,
        "height": H,
        "cards": cards_out,
    }
    scan_row = Scan(
        user_id=user_id,
        filename=image.filename or "upload.jpg",
        width=W,
        height=H,
        gemini_raw=response_payload,
    )
    db.add(scan_row)
    await db.flush()  # need id before writing file path
    image_path = SCANS_DIR / f"{scan_row.id}.bin"
    image_path.write_bytes(raw)
    scan_row.image_path = str(image_path)
    await db.flush()

    image_id = str(scan_row.id)
    _cache_put(image_id, raw)

    return {
        "image_id": image_id,
        "scan_id": scan_row.id,
        **response_payload,
    }


@app.get("/api/scans")
async def list_scans(db: DbSession, user_id: CurrentUserId, limit: int = 30):
    """Most-recent-first list of saved scans, with the full response baked in.
    Frontend uses this to rehydrate batches after a page refresh."""
    from sqlalchemy import select
    q = (
        select(Scan)
        .where(Scan.user_id == user_id)
        .order_by(Scan.created_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(q)).scalars().all()
    out = []
    for s in rows:
        payload = s.gemini_raw or {}
        out.append({
            "image_id": str(s.id),
            "scan_id": s.id,
            "filename": s.filename,
            "image_b64": payload.get("image_b64", ""),
            "width": s.width,
            "height": s.height,
            "cards": payload.get("cards", []),
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })
    return out


@app.delete("/api/scans/{scan_id}", status_code=204)
async def delete_scan(scan_id: int, db: DbSession, user_id: CurrentUserId):
    """Drop a scan from the dashboard. Removes the DB row + the cached image bytes on disk."""
    scan_row = await db.get(Scan, scan_id)
    if not scan_row or scan_row.user_id != user_id:
        raise HTTPException(404, "Scan not found")
    if scan_row.image_path:
        try:
            Path(scan_row.image_path).unlink(missing_ok=True)
        except Exception:
            pass
    _IMAGE_CACHE.pop(str(scan_id), None)
    await db.delete(scan_row)


@app.post("/api/relookup")
@limiter.limit("60/minute")  # Scryfall asks ~10 req/sec max — keep well below
async def relookup(request: Request, payload: str = Form(...)):
    """Fuzzy lookup → search fallback → 404. Result is CK-enriched."""
    try:
        data = json.loads(payload)
    except Exception:
        raise HTTPException(400, "Invalid JSON in 'payload'")

    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Missing 'name'")
    set_code = (data.get("set") or "").strip().lower()

    params = {"fuzzy": name}
    if set_code:
        params["set"] = set_code

    timeout = aiohttp.ClientTimeout(total=15)
    sf = None
    async with aiohttp.ClientSession(headers=SCRYFALL_HEADERS, timeout=timeout) as session:
        async with session.get("https://api.scryfall.com/cards/named", params=params) as resp:
            if resp.status == 200:
                sf = await resp.json()
        if sf is None:
            search_q = name
            if set_code:
                search_q = f'{name} set:{set_code}'
            async with session.get(
                "https://api.scryfall.com/cards/search",
                params={"q": search_q, "order": "released", "unique": "cards"},
            ) as resp:
                if resp.status == 200:
                    body = await resp.json()
                    cards = body.get("data") or []
                    if cards:
                        sf = cards[0]

    if sf is None:
        raise HTTPException(404, "Card not found on Scryfall")

    summary = to_card_summary(sf, fallback_name=name)
    ck_index = await get_ck_index()
    return _enrich_with_ck(summary, ck_index)


# In-process cache for Scryfall's /sets endpoint. The list is ~800 entries
# and changes only when new sets release, so a long-lived TTL is fine.
_SETS_CACHE: dict[str, object] = {"data": None, "fetched_at": 0.0}
_SETS_TTL = 6 * 60 * 60  # 6 hours

# Same idea for /catalog/card-names — ~30k strings, changes only when new
# cards are spoiled. Used by the new-stock autocomplete.
_CARD_NAMES_CACHE: dict[str, object] = {"data": None, "fetched_at": 0.0}
_CARD_NAMES_TTL = 24 * 60 * 60  # 24 hours


@app.get("/api/sets")
@limiter.limit("30/minute")
async def list_scryfall_sets(request: Request):
    """Return a slim {code, name, released_at, set_type} list for the set picker.
    Cached aggressively — Scryfall doesn't want this called per keystroke."""
    import time as _time
    now = _time.time()
    cached = _SETS_CACHE.get("data")
    if cached and (now - float(_SETS_CACHE.get("fetched_at") or 0)) < _SETS_TTL:
        return cached
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(headers=SCRYFALL_HEADERS, timeout=timeout) as session:
        async with session.get("https://api.scryfall.com/sets") as resp:
            if resp.status != 200:
                raise HTTPException(502, "Scryfall /sets failed")
            body = await resp.json()
    sets = []
    for s in body.get("data") or []:
        sets.append({
            "code": (s.get("code") or "").lower(),
            "name": s.get("name") or "",
            "released_at": s.get("released_at"),
            "set_type": s.get("set_type"),
            "icon_svg_uri": s.get("icon_svg_uri"),
        })
    _SETS_CACHE["data"] = sets
    _SETS_CACHE["fetched_at"] = now
    return sets


@app.get("/api/card-names")
@limiter.limit("30/minute")
async def list_card_names(request: Request):
    """Scryfall's full English card-name catalog. Cached for 24h since this is
    used by the new-stock form's name autocomplete on every keystroke."""
    import time as _time
    now = _time.time()
    cached = _CARD_NAMES_CACHE.get("data")
    if cached and (now - float(_CARD_NAMES_CACHE.get("fetched_at") or 0)) < _CARD_NAMES_TTL:
        return cached
    timeout = aiohttp.ClientTimeout(total=20)
    async with aiohttp.ClientSession(headers=SCRYFALL_HEADERS, timeout=timeout) as session:
        async with session.get("https://api.scryfall.com/catalog/card-names") as resp:
            if resp.status != 200:
                raise HTTPException(502, "Scryfall /catalog/card-names failed")
            body = await resp.json()
    names = body.get("data") or []
    _CARD_NAMES_CACHE["data"] = names
    _CARD_NAMES_CACHE["fetched_at"] = now
    return names


@app.post("/api/printings")
@limiter.limit("20/minute")  # Each call paginates Scryfall up to 4 pages
async def printings(request: Request, payload: str = Form(...)):
    """Every printing of a card name, paginated and CK-enriched."""
    try:
        data = json.loads(payload)
    except Exception:
        raise HTTPException(400, "Invalid JSON in 'payload'")

    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Missing 'name'")

    timeout = aiohttp.ClientTimeout(total=20)
    cards: list[dict] = []
    async with aiohttp.ClientSession(headers=SCRYFALL_HEADERS, timeout=timeout) as session:
        url = "https://api.scryfall.com/cards/search"
        params = {
            "q": f'!"{name}"',
            "unique": "prints",
            "order": "released",
            "dir": "desc",
        }
        for _ in range(4):
            async with session.get(url, params=params) as resp:
                if resp.status != 200:
                    break
                body = await resp.json()
                page = body.get("data") or []
                cards.extend(page)
                if not body.get("has_more"):
                    break
                next_url = body.get("next_page")
                if not next_url:
                    break
                url = next_url
                params = None

    if not cards:
        raise HTTPException(404, "No printings found for that name")

    ck_index = await get_ck_index()
    out: list[dict] = []
    for card in cards:
        s = to_card_summary(card)
        if s:
            out.append(_enrich_with_ck(s, ck_index))
    return {"name": name, "printings": out}


@app.post("/api/export")
@limiter.limit("60/minute")  # Pillow render is CPU-bound; cap to prevent runaway
async def export_overlay(request: Request, db: DbSession, user_id: CurrentUserId, payload: str = Form(...)):
    try:
        data = json.loads(payload)
    except Exception:
        raise HTTPException(400, "Invalid JSON in 'payload'")

    image_id = data.get("image_id")
    if not image_id:
        raise HTTPException(400, "Missing image_id")

    raw: bytes | None = _IMAGE_CACHE.get(image_id)
    # Cache miss (e.g. after a server restart) — fall through to disk
    if raw is None:
        try:
            scan_pk = int(image_id)
        except ValueError:
            scan_pk = None
        if scan_pk is not None:
            scan_row = await db.get(Scan, scan_pk)
            if scan_row and scan_row.user_id == user_id and scan_row.image_path:
                p = Path(scan_row.image_path)
                if p.exists():
                    raw = p.read_bytes()
                    _cache_put(image_id, raw)
    if raw is None:
        raise HTTPException(404, "image_id not found (re-upload the image)")
    cards = []
    for c in data.get("cards", []):
        bbox = c.get("bbox")
        if not bbox or len(bbox) != 4:
            continue
        cards.append({
            "bbox": bbox,
            "label": c.get("label_override") or c.get("label") or "",
            "is_foil": bool(c.get("is_foil", False)),
        })

    show_outlines = bool(data.get("show_outlines", False))
    label_position = data.get("label_position", "bottom")

    png = render_overlay(raw, cards, show_outlines=show_outlines, label_position=label_position)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Content-Disposition": "attachment; filename=mtg_prices.png"},
    )


# Auth + checklist routers
app.include_router(auth_router.router)
app.include_router(buyers_router.router)
app.include_router(listings_router.router)
app.include_router(orders_router.router)
app.include_router(posts_router.router)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
