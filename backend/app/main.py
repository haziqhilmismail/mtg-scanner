"""
FastAPI app entry point.

Routes:
  GET  /api/health        -> scanner + CK index status
  POST /api/export        -> render the priced overlay JPEG
  POST /api/export-all    -> render every batch's overlay, stream as one zip

DB tables (users, scans, listings, buyers, orders, order_items, payments)
are created on startup and a solo-mode user row is seeded if missing.
"""

import asyncio
import re
import traceback
import zipfile
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path

from alembic import command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image
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

from .config import settings
from .db import async_session_factory
from .deps import CurrentUserId, DbSession, json_payload, limiter

from .models import Scan, User
from .routers import auth as auth_router
from .routers import bugs as bugs_router
from .routers import catalogue as catalogue_router
from .routers import buyers as buyers_router
from .routers import claims as claims_router
from .routers import credits as credits_router
from .routers import listings as listings_router
from .routers import orders as orders_router
from .routers import payment as payment_router
from .routers import posts as posts_router
from .routers import sales as sales_router
from .routers import scans as scans_router
from .routers import slips as slips_router
from .services import bug_reporter
from .services import catalogue
from .services import credits
from .services import scans
from .services.price_overlay import render_overlay

BASE_DIR = Path(__file__).resolve().parent


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.make_data_dirs()
    # 1) Run any pending migrations. Alembic is sync, so dispatch to a thread.
    alembic_cfg = AlembicConfig(str(BASE_DIR.parent / "alembic.ini"))
    await asyncio.to_thread(command.upgrade, alembic_cfg, "head")

    # 2) Seed solo-mode user if it doesn't exist. Only in solo mode: with
    #    sign-in on, a re-created id 1 would be claimed by the next new account.
    async with async_session_factory() as s:
        existing = await s.scalar(select(User).where(User.id == settings.solo_user_id))
        if not existing and not settings.auth_enabled:
            s.add(User(
                id=settings.solo_user_id,
                email=f"solo-{settings.solo_user_id}@local",
            ))
            await s.commit()
            print(f"[startup] Seeded solo user id={settings.solo_user_id}", flush=True)

    # 3) Kick off CK pricelist load
    try:
        idx = await catalogue.ck_index()
        print(f"[startup] CK index ready: {idx.matched_scryfall_count} cards", flush=True)
    except Exception as e:
        print(f"[startup] WARNING — CK index failed to load: {e}", flush=True)
        print("[startup] Server will start anyway; cards will be unpriced until CK comes back.", flush=True)

    # 4) The scanner. Missing local models don't crash startup: /api/scan
    # answers 503 until the files are in place, everything else keeps working.
    try:
        await asyncio.to_thread(scans.scanner.load)
    except Exception as e:
        print(f"[startup] WARNING — scanner failed to load: {e}", flush=True)
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




@app.get("/api/support-qr")
async def support_qr():
    if not settings.support_qr.exists():
        raise HTTPException(404, "No support QR on this server")
    return FileResponse(settings.support_qr, media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/api/health")
async def health():
    out: dict = {"ok": True, "model": scans.scanner.model}
    if problem := scans.scanner.ready():
        out["ok"] = False
        out["scanner_error"] = problem
    try:
        idx = await catalogue.ck_index()
        out["cardkingdom_cards"] = idx.matched_scryfall_count
        # Unix epoch seconds; the frontend formats relative time.
        if idx.fetched_at:
            out["cardkingdom_refreshed_at"] = idx.fetched_at.timestamp()
    except Exception as e:
        out["cardkingdom_error"] = str(e)
    return out


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


def _card_shape(c: dict) -> dict | None:
    """A payload card's bbox and corners, checked; None when it has no bbox."""
    bbox = c.get("bbox")
    if not isinstance(bbox, list) or len(bbox) != 4:
        return None
    corners = c.get("corners")
    if not (isinstance(corners, list) and len(corners) == 4
            and all(isinstance(p, list) and len(p) == 2 for p in corners)):
        corners = None
    return {"bbox": bbox, "corners": corners}


def _render_export(data: dict, raw: bytes) -> bytes:
    """Render one priced-overlay JPEG from an export payload dict + source bytes."""
    cards = []
    for c in data.get("cards", []):
        shape = _card_shape(c)
        if not shape:
            continue
        try:
            pill_dx = int(c.get("pill_dx") or 0)
        except (TypeError, ValueError):
            pill_dx = 0
        try:
            pill_dy = int(c.get("pill_dy") or 0)
        except (TypeError, ValueError):
            pill_dy = 0
        cards.append({
            **shape,
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

    # Sold cards on a repost: covered on the photo.
    covers = [shape for c in data.get("covers") or [] if isinstance(c, dict) and (shape := _card_shape(c))]

    return render_overlay(
        raw, cards,
        show_outlines=show_outlines,
        label_position=label_position,
        font_scale=font_scale,
        covers=covers,
    )


def _zip_entry_name(filename: str | None, used: set[str]) -> str:
    """The client's name for a photo ("Friday Post - Photo 01.jpg") as a safe,
    unique `.jpg` zip entry: only the characters no file system takes go."""
    base = re.sub(r"\.[^.]+$", "", filename or "")
    base = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", base).strip(" .") or "photo"
    name = f"{base}.jpg"
    i = 2
    while name in used:
        name = f"{base} ({i}).jpg"
        i += 1
    used.add(name)
    return name


@app.post("/api/export")
@limiter.limit("60/minute")  # Pillow render is CPU-bound; cap to prevent runaway
async def export_overlay(request: Request, db: DbSession, user_id: CurrentUserId, payload: str = Form(...)):
    data = json_payload(payload)

    image_id = data.get("image_id")
    if not image_id:
        raise HTTPException(400, "Missing image_id")

    raw = await _resolve_export_image(db, user_id, image_id)
    jpeg = await asyncio.to_thread(_render_export, data, raw)
    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={"Content-Disposition": "attachment; filename=mtg_prices.jpg"},
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
    data = json_payload(payload)

    images = data.get("images")
    if not isinstance(images, list) or not images:
        raise HTTPException(400, "Missing 'images'")
    if len(images) > 100:
        raise HTTPException(400, "Too many images (max 100)")

    buf = BytesIO()
    used: set[str] = set()
    # ZIP_STORED: the entries are already-compressed JPEGs, so deflate would burn
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
            jpeg = await asyncio.to_thread(_render_export, item, raw)
            zf.writestr(_zip_entry_name(item.get("filename"), used), jpeg)

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
app.include_router(catalogue_router.router)
app.include_router(buyers_router.router)
app.include_router(claims_router.router)
app.include_router(credits_router.router)
app.include_router(listings_router.router)
app.include_router(orders_router.router)
app.include_router(payment_router.router)
app.include_router(posts_router.router)
app.include_router(sales_router.router)
app.include_router(scans_router.router)
app.include_router(slips_router.router)


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
