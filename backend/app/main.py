"""
FastAPI app entry point.

Routes:
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
import time
import traceback
import zipfile
from contextlib import asynccontextmanager
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import aiohttp
from alembic import command
from alembic.config import Config as AlembicConfig
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener
from slowapi import _rate_limit_exceeded_handler

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
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from .config import DATA_DIR, settings
from .db import async_session_factory
from .deps import CurrentUserId, DbSession, ImageUserId, limiter
from pydantic import BaseModel
from sqlalchemy import update

from .models import Post, Scan, User
from .routers import auth as auth_router
from .routers import bugs as bugs_router
from .routers import buyers as buyers_router
from .routers import claims as claims_router
from .routers import credits as credits_router
from .routers import listings as listings_router
from .routers import orders as orders_router
from .routers import posts as posts_router
from .services import bug_reporter
from .services import credits
from .services import local_scan
from .services.cardkingdom_prices import DB_FILE as CK_DB_FILE
from .services.cardkingdom_prices import enrich as enrich_with_ck
from .services.cardkingdom_prices import get_index as get_ck_index
from .services.classical_detector import detect_card_quads, iou_xywh
from .services.gemini_scanner import CardDetection, get_client, scan_image
from .services.price_overlay import render_overlay
from .services.scryfall_lookup import (
    HEADERS as SCRYFALL_HEADERS,
    lookup_all,
    to_card_summary,
)

BASE_DIR = Path(__file__).resolve().parent
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

    # 4) Optional: the local scanner (SCANNER_BACKEND=local). Missing models
    # don't crash startup — /api/scan answers 503 until the files are in
    # place, everything else keeps working.
    if settings.use_local_scanner:
        try:
            n = await asyncio.to_thread(local_scan.load)
            print(f"[startup] local scanner ready: {n} printings indexed", flush=True)
        except Exception as e:
            print(f"[startup] WARNING — local scanner failed to load: {e}", flush=True)
    yield


app = FastAPI(title="MTG Pasar Malam Scanner", lifespan=lifespan)

# Rate limits (see deps.limiter) sit on the external-API and CPU-heavy routes.
# Internal CRUD routes (listings/buyers/orders) are unlimited: they don't call out.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(credits.OutOfCredits)
async def _out_of_credits(request: Request, exc: credits.OutOfCredits):
    return JSONResponse(status_code=402, content={"detail": {"code": "out_of_credits", "credits": exc.credits}})

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    out: dict = {"ok": True, "model": settings.gemini_model}
    if settings.use_local_scanner:
        out["model"] = local_scan.MODEL_NAME
        out["ok"] = local_scan.is_loaded()
        if not out["ok"]:
            out["scanner_error"] = "local scanner models or card index not loaded"
    else:
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
        if CK_DB_FILE.exists():
            out["cardkingdom_refreshed_at"] = CK_DB_FILE.stat().st_mtime
    except Exception as e:
        out["cardkingdom_error"] = str(e)
    return out


def _check_refresh_token(x_refresh_token: str | None = Header(default=None)):
    if settings.refresh_ck_token and x_refresh_token != settings.refresh_ck_token:
        raise HTTPException(403, "Invalid or missing refresh token")


# The token is a dependency so a wrong one is refused before the limiter
# counts it; otherwise 3 bad calls would 429 the nightly refresh.
@app.post("/api/refresh-ck", dependencies=[Depends(_check_refresh_token)])
@limiter.limit("3/hour")  # CK pricelist is ~50MB; don't hammer their CDN
async def refresh_ck(request: Request):
    """Force a refresh from CK. 200 only when the download actually ran end
    to end; 502 if CK couldn't be reached. The previous fire-and-forget
    behaviour returned 200 even when the underlying download silently
    failed and the rebuild ran from a week-old cache — see
    cardkingdom_prices.py for the new contract.

    Guarded by `refresh_ck_token` when configured: the public Funnel URL means
    anyone could otherwise trigger a 50 MB rebuild. The scheduled GitHub Action
    sends the matching X-Refresh-Token header."""
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


def _jpeg_data_url(pil: Image.Image) -> str:
    buf = BytesIO()
    pil.convert("RGB").save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _make_thumb_b64(pil: Image.Image, x: int, y: int, x2: int, y2: int) -> str:
    crop = pil.crop((max(0, x), max(0, y), min(pil.width, x2), min(pil.height, y2)))
    if crop.width == 0 or crop.height == 0:
        return ""
    # 700px wide gives plenty of detail when zoomed (the zoom modal caps at 900px).
    # The row thumbnail in the React UI renders this at ~78px wide, so we're paying
    # extra bytes once and reusing them for click-to-zoom — no extra round-trip needed.
    crop.thumbnail((700, 980))
    return _jpeg_data_url(crop)


def _preview_b64(pil: Image.Image) -> str:
    p = pil.copy()
    p.thumbnail((1400, 1400))  # no-op when already smaller
    return _jpeg_data_url(p)


def _scan_pictures(pil: Image.Image, bboxes: list[list[int]]) -> tuple[str, list[str]]:
    """A scan's preview and one thumbnail per [x, y, w, h] box, as data URLs."""
    return _preview_b64(pil), [_make_thumb_b64(pil, x, y, x + w, y + h) for x, y, w, h in bboxes]


def _json_payload(payload: str) -> dict:
    try:
        return json.loads(payload)
    except Exception:
        raise HTTPException(400, "Invalid JSON in 'payload'")


def _decode_upright(raw: bytes) -> Image.Image:
    """Decode a photo and turn it the right way up (EXIF); 400 if it can't be read."""
    try:
        pil = Image.open(BytesIO(raw))
        pil.load()
    except Exception:
        raise HTTPException(400, "Could not decode image")
    try:
        pil = ImageOps.exif_transpose(pil)
    except Exception:
        pass
    return pil


def _normalise_upload(raw: bytes) -> tuple[Image.Image, bytes]:
    """Decode an uploaded photo, upright it, cap its size; returns the RGB
    image and the JPEG bytes that get stored and sent to Gemini."""
    pil = _decode_upright(raw)

    # Cap working resolution. The client-side downscale (api.ts) handles JPEG /
    # PNG / WebP but silently falls through on HEIC because non-Safari browsers
    # can't decode it via createImageBitmap — Chrome uploads land here at the
    # full 12 MP. A 12 MP PIL RGB bitmap is ~36 MB, plus Sobel + base64-for-
    # Gemini + thumbnail buffers, and a couple of sequential scans on a small
    # box blow the memory budget. Thumbnailing here bounds peak memory regardless
    # of what the client sent.
    SCAN_MAX_EDGE = 2000
    if max(pil.size) > SCAN_MAX_EDGE:
        pil.thumbnail((SCAN_MAX_EDGE, SCAN_MAX_EDGE), Image.LANCZOS)

    pil = pil.convert("RGB")
    norm_buf = BytesIO()
    pil.save(norm_buf, format="JPEG", quality=92)
    norm_bytes = norm_buf.getvalue()
    return pil, norm_bytes


@app.post("/api/scan")
@limiter.limit("30/minute;200/hour")  # Gemini calls — quota- and cost-sensitive
async def scan(
    request: Request,
    db: DbSession,
    user_id: CurrentUserId,
    image: UploadFile = File(...),
    post_id: int | None = Form(default=None),
):
    # Which post to file the photo under. Checked before anything costly.
    if post_id is not None:
        post = await db.get(Post, post_id)
        if not post or post.user_id != user_id:
            raise HTTPException(404, "Post not found")
    raw = await image.read()
    # Reject oversized uploads before the expensive decode. 25 MB is generous
    # for a phone photo (even a 48 MP HEIC is a few MB); anything bigger is
    # either a mistake or an attempt to exhaust memory on the box.
    MAX_UPLOAD_BYTES = 25 * 1024 * 1024
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image too large (max 25 MB)")
    # Decoding (HEIC especially) and resizing are CPU-bound; keep the loop free.
    pil, norm_bytes = await asyncio.to_thread(_normalise_upload, raw)

    # One credit per photo, handed back if anything below fails.
    async with credits.spend(db, user_id):
        result = await _scan_pipeline(db, user_id, image.filename, pil, norm_bytes, post_id)
    result["credits"] = await credits.status(db, user_id)
    return result


async def _scan_pipeline(
    db: DbSession, user_id: int, filename: str | None, pil: Image.Image, norm_bytes: bytes,
    post_id: int | None = None,
) -> dict:
    """Everything /api/scan does once it has a decoded photo and a credit."""
    W, H = pil.size

    if settings.use_local_scanner:
        # Offline pipeline — replaces steps 1-5 below wholesale.
        cards_out = await local_scan.scan_cards(pil)
        return await _store_scan(db, user_id, filename, pil, norm_bytes, cards_out, post_id)

    # ---------- Step 1: classical bbox + quad detection (cheap, no API call) ----------
    # The classical detector finds tight, card-shaped blobs in the photo and
    # returns both the axis-aligned bbox (for IoU matching against Gemini)
    # and a 4-corner quad following the card edges (for the polygon outline).
    classical_boxes: list[tuple[int, int, int, int]] = []
    classical_quads: list[list[list[int]]] = []
    if settings.use_classical_bbox:
        try:
            for bbox, quad in await asyncio.to_thread(detect_card_quads, norm_bytes):
                classical_boxes.append(bbox)
                classical_quads.append(quad)
        except Exception as e:
            print(f"[scan] classical detector failed: {e}", flush=True)

    # ---------- Step 2: Gemini locates + names the cards ----------
    try:
        # The Gemini SDK call is synchronous and takes several seconds; run it
        # in a worker thread so the event loop keeps serving other requests
        # (and other scans) while this one waits.
        gemini_detections: list[CardDetection] = await asyncio.to_thread(scan_image, norm_bytes)
    except Exception as e:
        raise HTTPException(500, f"Gemini call failed: {e}")

    # ---------- Step 3: tighten each Gemini box with a classical one ----------
    @dataclass
    class _Resolved:
        det: CardDetection
        bbox_px: tuple[int, int, int, int]  # (x, y, w, h)
        corners: list[list[int]] | None  # 4-point quad (TL,TR,BR,BL), None for Gemini-only
        bbox_source: str

    resolved: list[_Resolved] = []
    classical_consumed = [False] * len(classical_boxes)
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
            # Match against ALL classical boxes. If the best one was already
            # taken by an earlier Gemini detection, this one is a duplicate of
            # the same card; otherwise refine to it and mark it taken.
            best_iou, best_idx = 0.0, -1
            for ci, cb in enumerate(classical_boxes):
                cur = iou_xywh(gemini_xywh, cb)
                if cur > best_iou:
                    best_iou, best_idx = cur, ci
            if best_idx >= 0 and best_iou >= 0.4:
                if classical_consumed[best_idx]:
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
        ))

    # ---------- Step 4: Scryfall lookup + CK enrichment ----------
    summaries = await lookup_all([r.det for r in resolved])
    ck_index = await get_ck_index()
    summaries = [enrich_with_ck(s, ck_index) for s in summaries]

    # ---------- Step 5: pack output ----------
    cards_out = []
    for i, (r, sf) in enumerate(zip(resolved, summaries)):
        x, y, w, h = r.bbox_px
        x2, y2 = x + w, y + h

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
            "crop_b64": "",  # filled in by _store_scan
            "bbox_source": r.bbox_source,
            "name_source": "gemini",
            "name_confidence": None,
            "gemini": {
                "name": r.det.name,
                "set_code": r.det.set_code,
                "collector_number": r.det.collector_number,
                "is_foil": r.det.is_foil,
                "quantity": r.det.quantity,
            },
            "candidates": [sf],
        })

    return await _store_scan(db, user_id, filename, pil, norm_bytes, cards_out, post_id)


async def _store_scan(
    db: DbSession, user_id: int, filename: str | None,
    pil: Image.Image, norm_bytes: bytes, cards_out: list[dict],
    post_id: int | None = None,
) -> dict:
    """Persist a finished scan (photo + cards) and build the /api/scan response."""
    W, H = pil.size
    preview_b64, thumbs = await asyncio.to_thread(_scan_pictures, pil, [c["bbox"] for c in cards_out])
    for card, thumb in zip(cards_out, thumbs):
        card["crop_b64"] = thumb

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
        post_id=post_id,
        filename=filename or "upload.jpg",
        width=W,
        height=H,
        gemini_raw=response_payload,
    )
    db.add(scan_row)
    await db.flush()  # need id before writing file path
    # Save the normalized JPEG (downscaled + EXIF-corrected) rather than the
    # raw upload. Three reasons: (1) saved bytes now match the W/H + polygon
    # coords returned by /api/scan, so frontend rendering and /api/export stay
    # consistent; (2) export decodes a small JPEG instead of re-decoding HEIC
    # every time.
    image_path = SCANS_DIR / f"{scan_row.id}.bin"
    image_path.write_bytes(norm_bytes)
    scan_row.image_path = str(image_path)
    await db.flush()

    return {
        "image_id": str(scan_row.id),
        "scan_id": scan_row.id,
        "post_id": post_id,
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
    pixels, TL/TR/BR/BL order. With the local scanner on, it tries to name
    the card → fully-named card with CK pricing. Otherwise (or no match) →
    "manual" stub the user renames via the existing relookup flow. Appended
    to the scan's stored cards JSON so it survives refresh."""
    scan_row = await db.get(Scan, scan_id)
    if not scan_row or scan_row.user_id != user_id:
        raise HTTPException(404, "Scan not found")

    data = _json_payload(payload)

    corners = data.get("corners")
    if not (isinstance(corners, list) and len(corners) == 4
            and all(isinstance(p, list) and len(p) == 2 for p in corners)):
        raise HTTPException(400, "Missing/invalid 'corners' — need 4 [x,y] points")
    try:
        corners_int = [[int(round(p[0])), int(round(p[1]))] for p in corners]
    except (TypeError, ValueError):
        raise HTTPException(400, "Corners must be numeric")

    raw = await _resolve_export_image(db, user_id, str(scan_id))

    pil = await asyncio.to_thread(_decode_upright, raw)

    W, H = pil.size
    # Clamp corners inside the image and compute an axis-aligned bbox for
    # thumbnail + storage.
    clamped = [
        [max(0, min(W, x)), max(0, min(H, y))]
        for x, y in corners_int
    ]
    xs = [p[0] for p in clamped]
    ys = [p[1] for p in clamped]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    if x1 - x0 < 16 or y1 - y0 < 16:
        raise HTTPException(400, "Frame is too small")

    # `skip_identify`: the user will fill the card in by hand via the row's
    # edit controls.
    local_det = None
    if settings.use_local_scanner and not data.get("skip_identify"):
        try:
            local_det = await local_scan.identify_quad(pil.convert("RGB"), clamped)
        except Exception as e:
            print(f"[frame-card] identification failed: {e}", flush=True)

    crop_b64 = await asyncio.to_thread(_make_thumb_b64, pil, x0, y0, x1, y1)

    # Build the card record. Two flavours: locally named (full Scryfall + CK)
    # or manual stub (user types the name via existing relookup).
    if local_det is not None:
        det = local_det.det
        summaries = await lookup_all([det])
        ck_index = await get_ck_index()
        sf = enrich_with_ck(summaries[0] if summaries else None, ck_index)
        gemini_hint = {
            "name": det.name, "set_code": det.set_code,
            "collector_number": det.collector_number,
            "is_foil": det.is_foil, "quantity": 1,
        }
        name_source = local_det.name_source
        name_confidence = round(local_det.score, 3)
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
async def list_scans(
    db: DbSession, user_id: CurrentUserId,
    limit: int = Query(default=30, ge=1, le=500), lite: bool = False,
    before: int | None = None,
):
    """Most-recent-first list of saved scans, with the full response baked in.
    Frontend uses this to rehydrate batches after a page refresh.

    `lite=1` leaves out the embedded images (the photo preview and every
    card's thumbnail, as base64). With them, 30 scans is ~22 MB in a single
    response that has to finish before anything shows; without, ~0.3 MB. The
    client then loads each picture from /preview and /crops/{id} below, only
    when it is on screen, and the browser caches them.

    `before=<scan id>` pages back: the scans with a smaller id than that one."""
    q = (
        select(Scan)
        .where(Scan.user_id == user_id)
        .order_by(Scan.id.desc())
        .limit(limit)
    )
    if before is not None:
        q = q.where(Scan.id < before)
    rows = (await db.execute(q)).scalars().all()
    out = []
    for s in rows:
        payload = s.gemini_raw or {}
        cards = payload.get("cards", [])
        if lite:
            cards = [{**c, "crop_b64": ""} for c in cards]
        out.append({
            "image_id": str(s.id),
            "scan_id": s.id,
            "post_id": s.post_id,
            "filename": s.filename,
            "image_b64": "" if lite else payload.get("image_b64", ""),
            "width": s.width,
            "height": s.height,
            "cards": cards,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "ui_state": s.ui_state,
        })
    return out


class ScanState(BaseModel):
    state: dict


@app.patch("/api/scans/{scan_id}/state", status_code=204)
async def save_scan_state(scan_id: int, body: ScanState, db: DbSession, user_id: CurrentUserId):
    """Store the seller's per-card edits for this scan. Last write wins."""
    scan_row = await db.get(Scan, scan_id)
    if not scan_row or scan_row.user_id != user_id:
        raise HTTPException(404, "Scan not found")
    if len(json.dumps(body.state)) > 64 * 1024:
        raise HTTPException(413, "State too large (max 64 KB)")
    scan_row.ui_state = body.state


class MoveScans(BaseModel):
    scan_ids: list[int]
    post_id: int | None = None  # None = unfile


@app.post("/api/scans/move", status_code=204)
async def move_scans(body: MoveScans, db: DbSession, user_id: CurrentUserId):
    """File photos under a post (or unfile them). Other people's scans in
    `scan_ids` are silently left alone."""
    if body.post_id is not None:
        post = await db.get(Post, body.post_id)
        if not post or post.user_id != user_id:
            raise HTTPException(404, "Post not found")
    await db.execute(
        update(Scan)
        .where(Scan.id.in_(body.scan_ids), Scan.user_id == user_id)
        .values(post_id=body.post_id)
    )


async def _scan_for_image(db: DbSession, scan_id: int, user_id: int) -> Scan:
    """The scan behind an <img src>, 404 unless it is `user_id`'s."""
    scan_row = await db.get(Scan, scan_id)
    if not scan_row or scan_row.user_id != user_id:
        raise HTTPException(404, "Scan not found")
    return scan_row


def _data_url_jpeg(data_url: str, max_edge: int | None = None) -> Response:
    """A stored `data:image/jpeg;base64,...` string as an image response,
    optionally shrunk. A scan's pictures never change once saved, so the
    browser may keep them for good."""
    if not data_url:
        raise HTTPException(404, "No image")
    raw = base64.b64decode(data_url.split(",", 1)[-1])
    if max_edge:
        img = Image.open(BytesIO(raw))
        img.thumbnail((max_edge, max_edge))
        buf = BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=80)
        raw = buf.getvalue()
    return Response(
        content=raw,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@app.get("/api/scans/{scan_id}/preview")
async def scan_preview(
    scan_id: int,
    db: DbSession,
    user_id: ImageUserId,
    w: int | None = Query(default=None, ge=32, le=1400),
):
    """The scan's photo preview. `w` caps the longest edge, for the small
    thumbnails in the scan strip."""
    scan_row = await _scan_for_image(db, scan_id, user_id)
    # Resizing for ?w= is a decode + re-encode; a strip of thumbnails is many at once.
    return await asyncio.to_thread(_data_url_jpeg, (scan_row.gemini_raw or {}).get("image_b64", ""), w)


@app.get("/api/scans/{scan_id}/crops/{card_id}")
async def scan_card_crop(
    scan_id: int, card_id: int, db: DbSession, user_id: ImageUserId,
):
    """One detected card's thumbnail, cut from the photo at scan time."""
    scan_row = await _scan_for_image(db, scan_id, user_id)
    for card in (scan_row.gemini_raw or {}).get("cards", []):
        if card.get("id") == card_id:
            return _data_url_jpeg(card.get("crop_b64", ""))
    raise HTTPException(404, "Card not found")


@app.delete("/api/scans/{scan_id}", status_code=204)
async def delete_scan(scan_id: int, db: DbSession, user_id: CurrentUserId):
    """Drop a scan from the dashboard. Removes the DB row + the image bytes on disk."""
    scan_row = await db.get(Scan, scan_id)
    if not scan_row or scan_row.user_id != user_id:
        raise HTTPException(404, "Scan not found")
    if scan_row.image_path:
        try:
            Path(scan_row.image_path).unlink(missing_ok=True)
        except Exception:
            pass
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
            new_cand = enrich_with_ck(cand, ck_index)
            if new_cand:
                cands[i] = new_cand
                updated += 1
        card["candidates"] = cands

    payload["cards"] = cards
    scan_row.gemini_raw = payload
    # JSON column needs an explicit mark — SQLAlchemy doesn't detect
    # in-place dict mutation.
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
async def relookup(request: Request, _: CurrentUserId, payload: str = Form(...)):
    """Fuzzy lookup → search fallback → 404. Result is CK-enriched."""
    data = _json_payload(payload)

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
    return enrich_with_ck(summary, ck_index)


# In-process cache for Scryfall's slow-moving catalogs, keyed by API path.
# /sets (~800 entries) changes only when new sets release; /catalog/card-names
# (~30k strings) only when new cards are spoiled — long TTLs are fine.
_SCRYFALL_CACHE: dict[str, tuple[float, list]] = {}


async def _scryfall_data(path: str, ttl: float) -> list:
    fetched_at, cached = _SCRYFALL_CACHE.get(path, (0.0, []))
    if cached and time.time() - fetched_at < ttl:
        return cached
    timeout = aiohttp.ClientTimeout(total=20)
    async with aiohttp.ClientSession(headers=SCRYFALL_HEADERS, timeout=timeout) as session:
        async with session.get("https://api.scryfall.com" + path) as resp:
            if resp.status != 200:
                raise HTTPException(502, f"Scryfall {path} failed")
            data = (await resp.json()).get("data") or []
    _SCRYFALL_CACHE[path] = (time.time(), data)
    return data


@app.get("/api/sets")
@limiter.limit("30/minute")
async def list_scryfall_sets(request: Request):
    """Return a slim {code, name, released_at, set_type} list for the set picker.
    Cached aggressively — Scryfall doesn't want this called per keystroke."""
    return [
        {
            "code": (s.get("code") or "").lower(),
            "name": s.get("name") or "",
            "released_at": s.get("released_at"),
            "set_type": s.get("set_type"),
            "icon_svg_uri": s.get("icon_svg_uri"),
        }
        for s in await _scryfall_data("/sets", ttl=6 * 60 * 60)
    ]


@app.get("/api/card-names")
@limiter.limit("30/minute")
async def list_card_names(request: Request):
    """Scryfall's full English card-name catalog. Cached for 24h since this is
    used by the new-stock form's name autocomplete on every keystroke."""
    return await _scryfall_data("/catalog/card-names", ttl=24 * 60 * 60)


@app.post("/api/printings")
@limiter.limit("20/minute")  # Each call paginates Scryfall up to 4 pages
async def printings(request: Request, _: CurrentUserId, payload: str = Form(...)):
    """Every printing of a card name, paginated and CK-enriched."""
    data = _json_payload(payload)

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
            out.append(enrich_with_ck(s, ck_index))
    return {"name": name, "printings": out}


async def _resolve_export_image(db: DbSession, user_id: int, image_id: str) -> bytes:
    """Return the source photo bytes for an export `image_id` (a scan id),
    from disk and only for the scan's owner. Raises 404 otherwise."""
    try:
        scan_row = await db.get(Scan, int(image_id))
    except (ValueError, TypeError, OverflowError):
        scan_row = None
    if scan_row and scan_row.user_id == user_id and scan_row.image_path:
        p = Path(scan_row.image_path)
        if p.exists():
            return p.read_bytes()
    raise HTTPException(404, "image_id not found (re-upload the image)")


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
    data = _json_payload(payload)

    image_id = data.get("image_id")
    if not image_id:
        raise HTTPException(400, "Missing image_id")

    raw = await _resolve_export_image(db, user_id, image_id)
    png = await asyncio.to_thread(_render_export, data, raw)
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
    data = _json_payload(payload)

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
            png = await asyncio.to_thread(_render_export, item, raw)
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
app.include_router(claims_router.router)
app.include_router(credits_router.router)
app.include_router(listings_router.router)
app.include_router(orders_router.router)
app.include_router(posts_router.router)


# Global handler for *unexpected* exceptions only. FastAPI's built-in
# HTTPException handler runs before this, so explicit 4xx / 429s / 401s
# bypass bug reporting (they're expected error responses). Anything that
# reaches here is something a route handler didn't anticipate.
@app.exception_handler(Exception)
async def _capture_unexpected(request: Request, exc: Exception):
    # Still surface the traceback in logs (`docker compose logs`) — installing this
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
