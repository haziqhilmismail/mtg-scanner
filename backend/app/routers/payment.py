"""The seller's payment details: bank account, a note, and a DuitNow QR, added
to the order summaries copied for buyers."""

from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

from ..config import DATA_DIR
from ..deps import CurrentUserId, DbSession, ImageUserId
from ..models import User

router = APIRouter(prefix="/api/payment", tags=["payment"])

QR_DIR = DATA_DIR / "payment_qr"
QR_DIR.mkdir(exist_ok=True)
MAX_QR_BYTES = 8 * 1024 * 1024


class PaymentDetails(BaseModel):
    bank_name: str = Field("", max_length=64)
    bank_account_number: str = Field("", max_length=32)
    bank_account_holder: str = Field("", max_length=255)
    payment_note: str = Field("", max_length=500)


class PaymentRead(PaymentDetails):
    # Changes whenever the QR is replaced, so the client can reload it; null = no QR.
    qr_version: str | None = None


def _qr_file(user: User) -> Path | None:
    p = Path(user.qr_image_path) if user.qr_image_path else None
    return p if p and p.exists() else None


def _read(user: User) -> PaymentRead:
    qr = _qr_file(user)
    return PaymentRead(
        bank_name=user.bank_name or "",
        bank_account_number=user.bank_account_number or "",
        bank_account_holder=user.bank_account_holder or "",
        payment_note=user.payment_note or "",
        qr_version=str(qr.stat().st_mtime_ns) if qr else None,
    )


async def _user(db, user_id: int) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found")
    return user


@router.get("", response_model=PaymentRead)
async def get_payment(db: DbSession, user_id: CurrentUserId) -> PaymentRead:
    return _read(await _user(db, user_id))


@router.put("", response_model=PaymentRead)
async def save_payment(body: PaymentDetails, db: DbSession, user_id: CurrentUserId) -> PaymentRead:
    user = await _user(db, user_id)
    user.bank_name = body.bank_name.strip() or None
    user.bank_account_number = body.bank_account_number.strip() or None
    user.bank_account_holder = body.bank_account_holder.strip() or None
    user.payment_note = body.payment_note.strip() or None
    await db.flush()
    return _read(user)


@router.put("/qr", response_model=PaymentRead)
async def upload_qr(db: DbSession, user_id: CurrentUserId, image: UploadFile = File(...)) -> PaymentRead:
    """Save the QR as PNG: lossless keeps the code scannable, and decoding it
    here turns away anything that isn't an image."""
    raw = await image.read()
    if len(raw) > MAX_QR_BYTES:
        raise HTTPException(413, "Image too large (max 8 MB)")
    try:
        img = ImageOps.exif_transpose(Image.open(BytesIO(raw)))
        img.load()
    except Exception:
        raise HTTPException(400, "Could not read that image")
    if img.mode not in ("1", "L", "LA", "P", "RGB", "RGBA"):
        img = img.convert("RGB")  # e.g. a CMYK JPEG, which PNG can't hold
    # Square, cut from the top: a tall bank-app screenshot keeps its top
    # part (where the QR is); a wide image keeps its middle.
    side = min(img.size)
    left = (img.width - side) // 2
    img = img.crop((left, 0, left + side, side))
    user = await _user(db, user_id)
    path = QR_DIR / f"{user.id}.png"
    img.save(path, format="PNG")
    user.qr_image_path = str(path)
    await db.flush()
    return _read(user)


@router.delete("/qr", response_model=PaymentRead)
async def delete_qr(db: DbSession, user_id: CurrentUserId) -> PaymentRead:
    user = await _user(db, user_id)
    if qr := _qr_file(user):
        qr.unlink()
    user.qr_image_path = None
    await db.flush()
    return _read(user)


@router.get("/qr")
async def get_qr(db: DbSession, user_id: ImageUserId) -> Response:
    """The QR image (auth: ?token=<image token>, as <img> can't send headers)."""
    qr = _qr_file(await _user(db, user_id))
    if qr is None:
        raise HTTPException(404, "No QR uploaded")
    return Response(qr.read_bytes(), media_type="image/png", headers={"Cache-Control": "private, max-age=300"})
