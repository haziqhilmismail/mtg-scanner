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
  POST /api/export-all    -> render every batch's overlay, stream as one zip

DB tables (users, scans, listings, buyers, orders, order_items, payments)
are created on startup and a solo-mode user row is seeded if missing.
"""

import asyncio
import base64
import json
import re
import zipfile
from contextlib import asynccontextmanager
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import aiohttp
from alembic import command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pillow_heif import register_heif_opener
from slowapi import Limiter, _rate_limit_exceeded_handler

# iPhone uploads are HEIC by default; register once at import time so every
# Image.open() in the app (scan, overlay, …) can decode them transparently.
register_heif_opener()

# Decompression-bomb guard. A tiny malicious file can declare a huge canvas
# and balloon to gigabytes when PIL materialises it, OOM-killing the 1 GB VM.
# Every Image.open() in the app inherits this ceiling; PIL raises
# DecompressionBombError past 2× it. The scan path downscales to 2000 px
# anyway, so 50 MP (≈ 8660×5773) is far above any real phone photo.
Image.MAX_IMAGE_PIXELS = 50_000_000
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import select

from .config import DATA_DIR, settings
from .db import async_session_factory
from .deps import CurrentUserId, DbSession
from .models import Scan, User
from .routers import auth as auth_router
from .routers import bugs as bugs_router
from .routers import buyers as buyers_router
from .routers import listings as listings_router
from .routers import orders as orders_router
from .routers import posts as posts_router
from .services import bug_reporter
from .services import local_card_id
from .services.cardkingdom_prices import get_index as get_ck_index
from .services.classical_detector import detect_card_quads, iou_xywh, perspective_warp
from .services.gemini_scanner import CardDetection, get_client, scan_image
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
            print(f"[startup] Seeded solo user id={settings.solo_user_id}", flush=True)

    # 3) Kick off CK pricelist load
    try:
        idx = await get_ck_index()
        print(f"[startup] CK index ready: {idx.matched_scryfall_count} cards", flush=True)
    except Exception as e:
        print(f"[startup] WARNING — CK index failed to load: {e}", flush=True)
        print("[startup] Server will start anyway; cards will be unpriced until CK comes back.", flush=True)

    # 4) Optional: load the local pHash card-ID index.
    # Build it once with scripts/build_phash_index.py — the .npz lives on the
    # Fly volume so it survives restarts. We don't crash on missing index;
    # the scan path falls back to Gemini-only naming when get_index() is None.
    if settings.use_local_card_id:
        phash_path = Path(settings.phash_index_path)
        if phash_path.exists():
            try:
                pidx = await asyncio.to_thread(local_card_id.load_index, phash_path)
                print(f"[startup] pHash index ready: {len(pidx)} entries", flush=True)
            except Exception as e:
                print(f"[startup] WARNING — pHash index failed to load: {e}", flush=True)
        else:
            print(f"[startup] pHash enabled but {phash_path} missing — run scripts/build_phash_index.py", flush=True)
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
        # File mtime is the authoritative "when did this index actually get
        # written" timestamp — the refresh job atomic-renames a fresh build
        # onto DB_FILE, so its mtime advances with each successful refresh.
        # Returned as Unix epoch seconds; the frontend formats relative time.
        try:
            from .services.cardkingdom_prices import DB_FILE as _ck_db
            if _ck_db.exists():
                out["cardkingdom_refreshed_at"] = _ck_db.stat().st_mtime
        except Exception:
            pass
    except Exception as e:
        out["cardkingdom_error"] = str(e)
    pidx = local_card_id.get_index()
    out["phash_enabled"] = bool(settings.use_local_card_id)
    out["phash_loaded"] = pidx is not None
    if pidx is not None:
        out["phash_entries"] = len(pidx)
    return out


@app.post("/api/refresh-ck")
@limiter.limit("3/hour")  # CK pricelist is ~50MB; don't hammer their CDN
async def refresh_ck(
    request: Request,
    x_refresh_token: str | None = Header(default=None),
):
    """Force a refresh from CK. 200 only when the download actually ran end
    to end; 502 if CK couldn't be reached. The previous fire-and-forget
    behaviour returned 200 even when the underlying download silently
    failed and the rebuild ran from a week-old cache — see
    cardkingdom_prices.py for the new contract.

    Guarded by `refresh_ck_token` when configured: the public Funnel URL means
    anyone could otherwise trigger a 50 MB rebuild. The scheduled GitHub Action
    sends the matching X-Refresh-Token header."""
    if settings.refresh_ck_token and x_refresh_token != settings.refresh_ck_token:
        raise HTTPException(403, "Invalid or missing refresh token")
    from fastapi.responses import JSONResponse  # local import: cold-path
    idx = await get_ck_index()
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
    """Merge CK prices/URLs into a Scryfall summary. CK is the *only* price
    source — no Scryfall/TCG fallback. If CK has no entry, the card is priced
    at 0 with `price_source_*` = "none" so the UI can flag it for a manual
    override."""
    if not summary:
        return None
    sid = summary.get("scryfall_id", "")
    ck = ck_index.lookup(sid) if sid else {
        "retail_normal": None, "retail_foil": None,
        "buy_normal": None, "buy_foil": None,
        "in_stock_normal": False, "in_stock_foil": False,
        "url_normal": "", "url_foil": "",
    }

    def _ck_full_url(path: str) -> str:
        if not path:
            return ""
        return "https://www.cardkingdom.com/" + path.lstrip("/")

    summary = {**summary}
    summary["usd"] = ck["retail_normal"] or 0.0
    summary["usd_foil"] = ck["retail_foil"] or 0.0
    summary["price_source_normal"] = "cardkingdom" if ck["retail_normal"] else "none"
    summary["price_source_foil"] = "cardkingdom" if ck["retail_foil"] else "none"
    summary["ck_retail_normal"] = ck["retail_normal"]
    summary["ck_retail_foil"] = ck["retail_foil"]
    summary["ck_buy_normal"] = ck["buy_normal"]
    summary["ck_buy_foil"] = ck["buy_foil"]
    summary["ck_in_stock_normal"] = ck["in_stock_normal"]
    summary["ck_in_stock_foil"] = ck["in_stock_foil"]
    summary["ck_url_normal"] = _ck_full_url(ck.get("url_normal", ""))
    summary["ck_url_foil"] = _ck_full_url(ck.get("url_foil", ""))
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
    # Reject oversized uploads before the expensive decode. 25 MB is generous
    # for a phone photo (even a 48 MP HEIC is a few MB); anything bigger is
    # either a mistake or an attempt to exhaust memory on the box.
    MAX_UPLOAD_BYTES = 25 * 1024 * 1024
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image too large (max 25 MB)")
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

    # Cap working resolution. The client-side downscale (api.ts) handles JPEG /
    # PNG / WebP but silently falls through on HEIC because non-Safari browsers
    # can't decode it via createImageBitmap — Chrome uploads land here at the
    # full 12 MP. A 12 MP PIL RGB bitmap is ~36 MB, plus Sobel + base64-for-
    # Gemini + thumbnail buffers, and a couple of sequential scans on a 512 MB
    # Fly VM blow the budget. Thumbnailing here bounds peak memory regardless
    # of what the client sent.
    SCAN_MAX_EDGE = 2000
    if max(pil.size) > SCAN_MAX_EDGE:
        pil.thumbnail((SCAN_MAX_EDGE, SCAN_MAX_EDGE), Image.LANCZOS)

    norm_buf = BytesIO()
    pil.convert("RGB").save(norm_buf, format="JPEG", quality=92)
    norm_bytes = norm_buf.getvalue()

    W, H = pil.size

    # ---------- Step 1: classical bbox + quad detection (cheap, no API call) ----------
    # The classical detector finds tight, card-shaped blobs in the photo and
    # returns both the axis-aligned bbox (for IoU matching against Gemini)
    # and a 4-corner quad following the card edges (for the polygon outline).
    # It runs first so we can hash each crop locally before deciding whether
    # we need Gemini.
    classical_boxes: list[tuple[int, int, int, int]] = []
    classical_quads: list[list[list[int]]] = []
    if settings.use_classical_bbox:
        try:
            for bbox, quad in detect_card_quads(norm_bytes):
                classical_boxes.append(bbox)
                classical_quads.append(quad)
        except Exception as e:
            print(f"[scan] classical detector failed: {e}", flush=True)

    # ---------- Step 2: local pHash identification per classical box ----------
    # If the index is loaded, hash each classical crop and look it up. A
    # confident match (Hamming ≤ threshold) names the card without Gemini.
    #
    # The crop is *perspective-warped* via the quad (see notebook §27/§28):
    # the index was built from upright Scryfall images, and even a small tilt
    # in the photo shifts the hash by 6–10 bits — enough to flip top-1 to a
    # neighbour. Warping the quad flat puts the card in the same orientation
    # as the index. Empirically this took clean-photo top-1 from 1/4 to 4/4
    # with zero false positives.
    phash_results: list[local_card_id.Candidate | None] = [None] * len(classical_boxes)
    if settings.use_local_card_id and local_card_id.get_index() is not None and classical_boxes:
        idx = local_card_id.get_index()
        thresh = settings.phash_distance_threshold
        margin = settings.phash_distance_margin
        pil_rgb = pil.convert("RGB")
        for ci, (cx, cy, cw, ch) in enumerate(classical_boxes):
            try:
                warped = perspective_warp(pil_rgb, classical_quads[ci])
            except Exception as e:
                # Numerical edge cases in the 8-coeff solve fall back to the
                # axis-aligned crop so pHash still has a chance.
                print(f"[scan] perspective warp failed (card {ci}): {e}", flush=True)
                warped = pil_rgb.crop((cx, cy, cx + cw, cy + ch))
            h = local_card_id.hash_pil(warped)
            # top_k=2 so we can require a margin between #1 and #2. At ~48k
            # entries the bottom of the distance distribution is noisy —
            # a tied or near-tied top-1 means we don't actually know which
            # card it is, even if the absolute distance is small.
            cands = idx.search(h, top_k=2)
            if not cands or cands[0].distance > thresh:
                continue
            if len(cands) >= 2 and (cands[1].distance - cands[0].distance) < margin:
                continue
            phash_results[ci] = cands[0]

    # ---------- Step 3: Gemini for detection + naming-fallback ----------
    # Always call Gemini. The classical detector can under-detect (finds 1 of 4
    # cards when 3 share a busy background), and we can't tell from this side
    # whether it caught everything. The reconciliation step below de-dupes any
    # Gemini detections that overlap a pHash-named classical box.
    # If pHash already named every classical box confidently we still call —
    # the only "wasted" work is one extra Gemini round-trip on photos where
    # classical happened to find every card. That's worth it to never silently
    # drop cards classical missed.
    gemini_detections: list[CardDetection] = []
    try:
        gemini_detections = scan_image(norm_bytes, mime_type="image/jpeg")
    except Exception as e:
        # If pHash got SOME of the cards we can still ship a partial result
        # rather than 500; otherwise bail.
        if not any(r is not None for r in phash_results):
            raise HTTPException(500, f"Gemini call failed: {e}")
        print(f"[scan] Gemini call failed, continuing with pHash only: {e}", flush=True)
        gemini_detections = []

    # ---------- Step 4: assemble unified detection list ----------
    # Per detection we track: a CardDetection (drives Scryfall lookup),
    # the pixel bbox, where the bbox came from, where the name came from,
    # and the pHash distance if applicable.
    def _classical_box_to_norm(box: tuple[int, int, int, int]) -> list[int]:
        cx, cy, cw, ch = box
        return [
            max(0, min(1000, int(cy / H * 1000))),
            max(0, min(1000, int(cx / W * 1000))),
            max(0, min(1000, int((cy + ch) / H * 1000))),
            max(0, min(1000, int((cx + cw) / W * 1000))),
        ]

    @dataclass
    class _Resolved:
        det: CardDetection
        bbox_px: tuple[int, int, int, int]  # (x, y, w, h)
        corners: list[list[int]] | None  # 4-point quad (TL,TR,BR,BL), None for Gemini-only
        bbox_source: str
        name_source: str
        name_confidence: int | None  # Hamming distance for phash; None for gemini

    resolved: list[_Resolved] = []
    classical_consumed: list[bool] = [False] * len(classical_boxes)

    # 4a) pHash-named entries — bbox comes from classical (tight by construction)
    for ci, cand in enumerate(phash_results):
        if cand is None:
            continue
        cx, cy, cw, ch = classical_boxes[ci]
        det = CardDetection(
            name=cand.name,
            set_code=cand.set,
            collector_number=cand.collector_number,
            is_foil=False,  # pHash can't tell — user toggles
            quantity=1,
            box_2d=_classical_box_to_norm(classical_boxes[ci]),
        )
        resolved.append(_Resolved(
            det=det,
            bbox_px=(cx, cy, cw, ch),
            corners=classical_quads[ci],
            bbox_source="classical",
            name_source="phash",
            name_confidence=cand.distance,
        ))
        classical_consumed[ci] = True

    # 4b) Gemini-named entries — for each Gemini detection, refine bbox by
    # matching to any *remaining* classical box (same logic as before).
    for det in gemini_detections:
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

        bbox_source = "gemini"
        matched_quad: list[list[int]] | None = None
        if classical_boxes:
            gemini_xywh = (x, y, x2 - x, y2 - y)
            # Match against ALL classical boxes — including ones pHash already
            # named. If we matched a pHash-named box, drop this Gemini
            # detection as a duplicate; otherwise refine using the unconsumed
            # classical bbox + mark it consumed. Skipping pHash-consumed boxes
            # here would let Gemini's near-duplicate detection slip through as
            # a second entry for the same card.
            best_iou, best_idx = 0.0, -1
            for ci, cb in enumerate(classical_boxes):
                cur = iou_xywh(gemini_xywh, cb)
                if cur > best_iou:
                    best_iou, best_idx = cur, ci
            if best_idx >= 0 and best_iou >= 0.4:
                if phash_results[best_idx] is not None:
                    # pHash already named this classical box → its entry wins,
                    # this Gemini one is a duplicate.
                    continue
                if classical_consumed[best_idx]:
                    # Already consumed by an earlier Gemini detection in this
                    # loop — also a duplicate. Drop it.
                    continue
                cx, cy, cw, ch = classical_boxes[best_idx]
                x, y = cx, cy
                x2, y2 = cx + cw, cy + ch
                classical_consumed[best_idx] = True
                bbox_source = "classical"
                matched_quad = classical_quads[best_idx]

        resolved.append(_Resolved(
            det=det,
            bbox_px=(x, y, x2 - x, y2 - y),
            corners=matched_quad,
            bbox_source=bbox_source,
            name_source="gemini",
            name_confidence=None,
        ))

    # ---------- Step 5: Scryfall lookup + CK enrichment ----------
    summaries = await lookup_all([r.det for r in resolved])
    ck_index = await get_ck_index()
    summaries = [_enrich_with_ck(s, ck_index) for s in summaries]

    # ---------- Step 6: pack output ----------
    cards_out = []
    for i, (r, sf) in enumerate(zip(resolved, summaries)):
        x, y, w, h = r.bbox_px
        x2, y2 = x + w, y + h
        crop_b64 = _make_thumb_b64(pil, x, y, x2, y2)

        if sf is None:
            sf = {
                "scryfall_id": "",
                "name": r.det.name or "(unknown)",
                "set": (r.det.set_code or "").upper(),
                "set_name": "",
                "collector_number": r.det.collector_number or "",
                "rarity": "",
                "usd": 0.0, "usd_foil": 0.0,
                "image_url": "",
                "scryfall_uri": "",
                "_lookup_failed": True,
                "price_source_normal": "none",
                "price_source_foil": "none",
            }

        # Real min-area-quad when the classical detector matched this card;
        # otherwise an axis-aligned rectangle as a graceful fallback so the
        # frontend can always treat `corners` as a 4-point polygon.
        corners = r.corners or [[x, y], [x2, y], [x2, y2], [x, y2]]

        cards_out.append({
            "id": i,
            "bbox": [x, y, w, h],
            "corners": corners,
            "crop_b64": crop_b64,
            "bbox_source": r.bbox_source,
            "name_source": r.name_source,
            "name_confidence": r.name_confidence,
            "gemini": {
                "name": r.det.name,
                "set_code": r.det.set_code,
                "collector_number": r.det.collector_number,
                "is_foil": r.det.is_foil,
                "quantity": r.det.quantity,
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
    # Save the normalized JPEG (downscaled + EXIF-corrected) rather than the
    # raw upload. Three reasons: (1) saved bytes now match the W/H + polygon
    # coords returned by /api/scan, so frontend rendering and /api/export stay
    # consistent; (2) _IMAGE_CACHE doesn't hold multi-MB HEIC blobs; (3) export
    # decodes a small JPEG instead of re-decoding HEIC every time.
    image_path = SCANS_DIR / f"{scan_row.id}.bin"
    image_path.write_bytes(norm_bytes)
    scan_row.image_path = str(image_path)
    await db.flush()

    image_id = str(scan_row.id)
    _cache_put(image_id, norm_bytes)

    return {
        "image_id": image_id,
        "scan_id": scan_row.id,
        **response_payload,
    }


@app.post("/api/scans/{scan_id}/frame-card")
@limiter.limit("30/minute")
async def frame_card(
    request: Request,
    scan_id: int,
    db: DbSession,
    user_id: CurrentUserId,
    payload: str = Form(...),
):
    """User-drawn frame around a card the detector missed (typically two
    cards merged into one bbox). Body: {corners: [[x,y]*4]} in source-image
    pixels, TL/TR/BR/BL order. Perspective-warps the region flat, pHashes it
    against the local index. Confident match → fully-named card with CK
    pricing. No match → "manual" stub the user renames via the existing
    relookup flow. Appended to the scan's stored cards JSON so it survives
    refresh."""
    scan_row = await db.get(Scan, scan_id)
    if not scan_row or scan_row.user_id != user_id:
        raise HTTPException(404, "Scan not found")

    try:
        data = json.loads(payload)
    except Exception:
        raise HTTPException(400, "Invalid JSON in 'payload'")

    corners = data.get("corners")
    if not (isinstance(corners, list) and len(corners) == 4
            and all(isinstance(p, list) and len(p) == 2 for p in corners)):
        raise HTTPException(400, "Missing/invalid 'corners' — need 4 [x,y] points")
    try:
        corners_int = [[int(round(p[0])), int(round(p[1]))] for p in corners]
    except (TypeError, ValueError):
        raise HTTPException(400, "Corners must be numeric")

    # Load image from cache → disk fallback.
    raw: bytes | None = _IMAGE_CACHE.get(str(scan_id))
    if raw is None and scan_row.image_path:
        p = Path(scan_row.image_path)
        if p.exists():
            raw = p.read_bytes()
            _cache_put(str(scan_id), raw)
    if raw is None:
        raise HTTPException(404, "Original image bytes missing — re-upload")

    try:
        pil = Image.open(BytesIO(raw))
        pil.load()
        from PIL import ImageOps
        try:
            pil = ImageOps.exif_transpose(pil)
        except Exception:
            pass
    except Exception:
        raise HTTPException(400, "Could not decode original image")

    W, H = pil.size
    # Clamp corners inside the image and compute an axis-aligned bbox for
    # thumbnail + storage. The pHash warp uses the raw quad regardless.
    clamped = [
        [max(0, min(W, x)), max(0, min(H, y))]
        for x, y in corners_int
    ]
    xs = [p[0] for p in clamped]
    ys = [p[1] for p in clamped]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    if x1 - x0 < 16 or y1 - y0 < 16:
        raise HTTPException(400, "Frame is too small")

    skip_identify = bool(data.get("skip_identify", False))

    pil_rgb = pil.convert("RGB")

    # pHash via the perspective-warped crop. Same gate as /api/scan — absolute
    # threshold AND top-2 margin — so a low-confidence local match falls
    # through to "manual" rather than naming the wrong card.
    # `skip_identify` bypasses the lookup entirely — the user has signalled
    # they'll fill the card in by hand via the row's edit controls.
    matched: local_card_id.Candidate | None = None
    if not skip_identify and settings.use_local_card_id and local_card_id.get_index() is not None:
        idx = local_card_id.get_index()
        thresh = settings.phash_distance_threshold
        margin = settings.phash_distance_margin
        try:
            warped = perspective_warp(pil_rgb, clamped)
        except Exception as e:
            print(f"[frame-card] warp failed: {e}", flush=True)
            warped = pil_rgb.crop((x0, y0, x1, y1))
        try:
            h = local_card_id.hash_pil(warped)
            cands = idx.search(h, top_k=2)
            if cands and cands[0].distance <= thresh:
                if len(cands) < 2 or (cands[1].distance - cands[0].distance) >= margin:
                    matched = cands[0]
        except Exception as e:
            print(f"[frame-card] phash search failed: {e}", flush=True)

    crop_b64 = _make_thumb_b64(pil, x0, y0, x1, y1)

    # Build the card record. Two flavours: pHash-named (full Scryfall + CK)
    # or manual stub (user types the name via existing relookup).
    if matched is not None:
        det = CardDetection(
            name=matched.name,
            set_code=matched.set,
            collector_number=matched.collector_number,
            is_foil=False,
            quantity=1,
            box_2d=[
                max(0, min(1000, int(y0 / H * 1000))),
                max(0, min(1000, int(x0 / W * 1000))),
                max(0, min(1000, int(y1 / H * 1000))),
                max(0, min(1000, int(x1 / W * 1000))),
            ],
        )
        summaries = await lookup_all([det])
        ck_index = await get_ck_index()
        sf = _enrich_with_ck(summaries[0] if summaries else None, ck_index)
        gemini_hint = {
            "name": det.name, "set_code": det.set_code,
            "collector_number": det.collector_number,
            "is_foil": False, "quantity": 1,
        }
        name_source = "phash"
        name_confidence = matched.distance
    else:
        sf = {
            "scryfall_id": "",
            "name": "",
            "set": "", "set_name": "", "collector_number": "", "rarity": "",
            "usd": 0.0, "usd_foil": 0.0,
            "image_url": "", "scryfall_uri": "",
            "_lookup_failed": True,
            "_manual": True,
            "price_source_normal": "manual",
            "price_source_foil": "manual",
        }
        gemini_hint = {
            "name": "", "set_code": "", "collector_number": "",
            "is_foil": False, "quantity": 1,
        }
        name_source = "gemini"  # nothing named it; UI shows the manual banner
        name_confidence = None

    existing_payload = dict(scan_row.gemini_raw or {})
    existing_cards = list(existing_payload.get("cards") or [])
    new_id = (max((c.get("id", -1) for c in existing_cards), default=-1) + 1)

    new_card = {
        "id": new_id,
        "bbox": [x0, y0, x1 - x0, y1 - y0],
        "corners": clamped,
        "crop_b64": crop_b64,
        "bbox_source": "user",
        "name_source": name_source,
        "name_confidence": name_confidence,
        "gemini": gemini_hint,
        "candidates": [sf],
    }
    existing_cards.append(new_card)
    existing_payload["cards"] = existing_cards
    # JSON column — reassign to mark the field dirty (SQLAlchemy doesn't
    # detect in-place dict mutations).
    scan_row.gemini_raw = existing_payload
    await db.flush()

    return new_card


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


@app.post("/api/scans/{scan_id}/relookup-prices")
@limiter.limit("30/minute")
async def relookup_scan_prices(
    request: Request, scan_id: int, db: DbSession, user_id: CurrentUserId,
):
    """Re-run CK price enrichment for every candidate in a saved scan. Cards
    themselves (names, sets, scryfall_ids, bboxes) are unchanged — only the
    pricing fields (usd/usd_foil/price_source_*/ck_*) are refreshed from
    the current ck_index.db. Cheap (local SQLite lookups, no network).
    Returns the same shape as GET /api/scans for in-place rehydration."""
    scan_row = await db.get(Scan, scan_id)
    if not scan_row or scan_row.user_id != user_id:
        raise HTTPException(404, "Scan not found")

    payload = scan_row.gemini_raw or {}
    cards = payload.get("cards", [])
    ck_index = await get_ck_index()

    updated = 0
    for card in cards:
        cands = card.get("candidates", []) or []
        for i, cand in enumerate(cands):
            if not cand:
                continue
            new_cand = _enrich_with_ck(cand, ck_index)
            if new_cand:
                cands[i] = new_cand
                updated += 1
        card["candidates"] = cands

    payload["cards"] = cards
    scan_row.gemini_raw = payload
    # JSON column needs an explicit mark — SQLAlchemy doesn't detect
    # in-place dict mutation.
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(scan_row, "gemini_raw")
    await db.commit()

    return {
        "image_id": str(scan_row.id),
        "scan_id": scan_row.id,
        "filename": scan_row.filename,
        "image_b64": payload.get("image_b64", ""),
        "width": scan_row.width,
        "height": scan_row.height,
        "cards": cards,
        "updated": updated,
    }


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


async def _resolve_export_image(db: DbSession, user_id: int, image_id: str) -> bytes:
    """Return the source photo bytes for an export `image_id`.

    Checks the in-memory cache first, then falls back to disk (e.g. after a
    server restart) when the id is a numeric scan PK owned by the user.
    Raises 404 when nothing is found.
    """
    raw: bytes | None = _IMAGE_CACHE.get(image_id)
    if raw is None:
        try:
            scan_pk = int(image_id)
        except (ValueError, TypeError):
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
    return raw


def _render_export(data: dict, raw: bytes) -> bytes:
    """Render one priced-overlay PNG from an export payload dict + source bytes."""
    cards = []
    for c in data.get("cards", []):
        bbox = c.get("bbox")
        if not bbox or len(bbox) != 4:
            continue
        corners = c.get("corners")
        if not (isinstance(corners, list) and len(corners) == 4
                and all(isinstance(p, list) and len(p) == 2 for p in corners)):
            corners = None
        try:
            pill_dx = int(c.get("pill_dx") or 0)
        except (TypeError, ValueError):
            pill_dx = 0
        try:
            pill_dy = int(c.get("pill_dy") or 0)
        except (TypeError, ValueError):
            pill_dy = 0
        cards.append({
            "bbox": bbox,
            "corners": corners,
            "label": c.get("label_override") or c.get("label") or "",
            "is_foil": bool(c.get("is_foil", False)),
            "pill_dx": pill_dx,
            "pill_dy": pill_dy,
        })

    show_outlines = bool(data.get("show_outlines", False))
    label_position = data.get("label_position", "bottom")
    try:
        font_scale = float(data.get("font_scale", 1.0) or 1.0)
    except (TypeError, ValueError):
        font_scale = 1.0

    return render_overlay(
        raw, cards,
        show_outlines=show_outlines,
        label_position=label_position,
        font_scale=font_scale,
    )


def _zip_entry_name(filename: str | None, used: set[str]) -> str:
    """Turn a client filename into a safe, unique `<base>_priced.png` zip entry."""
    base = re.sub(r"\.[^.]+$", "", filename or "card")
    base = re.sub(r"[^\w.\- ]", "_", base).strip() or "card"
    name = f"{base}_priced.png"
    i = 2
    while name in used:
        name = f"{base}_priced_{i}.png"
        i += 1
    used.add(name)
    return name


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

    raw = await _resolve_export_image(db, user_id, image_id)
    png = _render_export(data, raw)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Content-Disposition": "attachment; filename=mtg_prices.png"},
    )


@app.post("/api/export-all")
@limiter.limit("12/minute")  # heavier than single export — renders N images per call
async def export_all_overlays(request: Request, db: DbSession, user_id: CurrentUserId, payload: str = Form(...)):
    """Render every supplied image's priced overlay and stream them as one zip.

    Payload: {"images": [{"filename": ..., "image_id": ..., "cards": [...],
    "show_outlines": ..., "label_position": ..., "font_scale": ...}, ...]}.
    Images whose source bytes can't be found are skipped rather than failing
    the whole archive; a 404 is only returned when nothing renders at all.
    """
    try:
        data = json.loads(payload)
    except Exception:
        raise HTTPException(400, "Invalid JSON in 'payload'")

    images = data.get("images")
    if not isinstance(images, list) or not images:
        raise HTTPException(400, "Missing 'images'")
    if len(images) > 100:
        raise HTTPException(400, "Too many images (max 100)")

    buf = BytesIO()
    used: set[str] = set()
    # ZIP_STORED: the entries are already-compressed PNGs, so deflate would burn
    # CPU on the 512 MB VM for no size win.
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        for item in images:
            if not isinstance(item, dict):
                continue
            image_id = item.get("image_id")
            if not image_id:
                continue
            try:
                raw = await _resolve_export_image(db, user_id, image_id)
            except HTTPException:
                continue  # one stale id shouldn't sink the whole export
            png = _render_export(item, raw)
            zf.writestr(_zip_entry_name(item.get("filename"), used), png)

    if not used:
        raise HTTPException(404, "No exportable images (re-upload and try again)")

    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=mtg_prices.zip"},
    )


# Auth + checklist routers
app.include_router(auth_router.router)
app.include_router(bugs_router.router)
app.include_router(buyers_router.router)
app.include_router(listings_router.router)
app.include_router(orders_router.router)
app.include_router(posts_router.router)


# Global handler for *unexpected* exceptions only. FastAPI's built-in
# HTTPException handler runs before this, so explicit 4xx / 429s / 401s
# bypass bug reporting (they're expected error responses). Anything that
# reaches here is something a route handler didn't anticipate.
@app.exception_handler(Exception)
async def _capture_unexpected(request: Request, exc: Exception):
    import traceback
    from fastapi.responses import JSONResponse  # local import: cold-path

    # Still surface the traceback in logs (`fly logs`) — installing this
    # handler suppresses Starlette's default stderr print, so we restore it.
    traceback.print_exception(type(exc), exc, exc.__traceback__)
    try:
        await bug_reporter.report_exception(request, exc)
    except Exception as report_err:  # never let the reporter mask the real bug
        print(f"[bug-reporter] capture failed: {report_err}", flush=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
