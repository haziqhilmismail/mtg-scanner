"""The FastAPI app: startup (migrations, the solo user, the CK price list, the
scanner), routers, rate limits, the error handler, and the health and support QR
routes.
"""

import asyncio
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image
from pillow_heif import register_heif_opener
from slowapi import _rate_limit_exceeded_handler

# iPhone uploads are HEIC by default; register once at import time so every
# Image.open() in the app (scan, overlay, …) can decode them transparently.
register_heif_opener()

# Decompression-bomb guard. A tiny malicious file can declare a huge canvas
# and balloon to gigabytes when PIL materialises it, OOM-killing the server.
# Every Image.open() in the app inherits this ceiling; PIL raises
# DecompressionBombError past 2× it. The scan path downscales to 2000 px
# anyway, so 50 MP (≈ 8660×5773) is far above any real phone photo.
Image.MAX_IMAGE_PIXELS = 50_000_000
from slowapi.errors import RateLimitExceeded
from sqlalchemy import select

from .config import settings
from .db import async_session_factory
from .deps import limiter

from .models import User
from .routers import auth as auth_router
from .routers import bugs as bugs_router
from .routers import catalogue as catalogue_router
from .routers import buyers as buyers_router
from .routers import claims as claims_router
from .routers import credits as credits_router
from .routers import export as export_router
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

BASE_DIR = Path(__file__).resolve().parent


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.make_data_dirs()
    alembic_cfg = AlembicConfig(str(BASE_DIR.parent / "alembic.ini"))
    await asyncio.to_thread(command.upgrade, alembic_cfg, "head")

    # Seed the solo-mode user if it doesn't exist. Only in solo mode: with
    # sign-in on, a re-created id 1 would be claimed by the next new account.
    async with async_session_factory() as s:
        existing = await s.scalar(select(User).where(User.id == settings.solo_user_id))
        if not existing and not settings.auth_enabled:
            s.add(User(
                id=settings.solo_user_id,
                email=f"solo-{settings.solo_user_id}@local",
            ))
            await s.commit()
            print(f"[startup] Seeded solo user id={settings.solo_user_id}", flush=True)

    try:
        idx = await catalogue.ck_index()
        print(f"[startup] CK index ready: {idx.matched_scryfall_count} cards", flush=True)
    except Exception as e:
        print(f"[startup] WARNING — CK index failed to load: {e}", flush=True)
        print("[startup] Server will start anyway; cards will be unpriced until CK comes back.", flush=True)

    # The scanner. Missing local models don't crash startup: /api/scan
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


app.include_router(auth_router.router)
app.include_router(bugs_router.router)
app.include_router(catalogue_router.router)
app.include_router(buyers_router.router)
app.include_router(claims_router.router)
app.include_router(credits_router.router)
app.include_router(export_router.router)
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
