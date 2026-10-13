"""
claims.py
---------
Turn a Facebook comment thread into draft claims.

Facebook offers no way to read a group's or profile's comments, so the seller
brings them in: screenshots of the thread (or pasted text). Two steps, kept
apart on purpose:

  1. read_screenshot() — finds which of the seller's photos the screenshot
     shows (image matching, no AI), then plain OCR (Tesseract) of the thread
     beside or below it. The seller can see and correct both before anything
     is inferred from them.
  2. parse_claims()    — Gemini, on the *text only*, matches each comment to
     the cards on sale and says what it could not work out.

Nothing here saves anything; the seller confirms the drafts first.
"""

import subprocess
import tempfile
from io import BytesIO

import numpy as np
from google.genai import types
from PIL import Image, ImageOps, ImageStat
from pydantic import BaseModel
from scipy.signal import fftconvolve

from ..config import settings
from .gemini_scanner import get_client

# English + Malay: threads mix both ("nak no 3", "mine", "kiri atas").
OCR_LANGS = "eng+msa"


# ---------- finding the seller's photo inside a screenshot ----------
# A screenshot of a Facebook photo usually shows the photo itself as well as
# the comments: on a phone the photo sits above them, on a PC to their left.
# Finding it does two jobs: it says *which* photo the comments are about, and
# it tells the OCR which part of the screenshot is the thread.

_COARSE_W, _FINE_W = 96, 240
_COARSE_SCALES = np.linspace(0.30, 1.0, 12)
_FINE_SCALES = np.linspace(0.30, 1.0, 24)
# Tested on phone- and PC-shaped screenshots: the right photo scores 0.9+,
# a mirrored or shifted copy of it about 0.7, an unrelated picture under 0.6.
MATCH_MIN_SCORE = 0.78
MATCH_MIN_LEAD = 0.08


def _gray(img: Image.Image, width: int) -> np.ndarray:
    height = max(8, round(img.height * width / img.width))
    return np.asarray(img.convert("L").resize((width, height), Image.BILINEAR), dtype=np.float32)


def _best_match(shot: np.ndarray, tmpl: np.ndarray) -> tuple[float, int, int]:
    """Best normalised cross-correlation of `tmpl` anywhere inside `shot`."""
    if tmpl.shape[0] > shot.shape[0] or tmpl.shape[1] > shot.shape[1]:
        return -1.0, 0, 0
    tz = tmpl - tmpl.mean()
    tnorm = float(np.sqrt((tz ** 2).sum()))
    if tnorm < 1e-3:
        return -1.0, 0, 0
    num = fftconvolve(shot, tz[::-1, ::-1], mode="valid")
    ones = np.ones_like(tmpl)
    s1 = fftconvolve(shot, ones, mode="valid")
    s2 = fftconvolve(shot ** 2, ones, mode="valid")
    var = s2 - s1 ** 2 / tmpl.size
    # A window far flatter than the photo (plain background, a dark bar) can't
    # be it; without this its tiny variance inflates the score.
    ok = var > 0.2 * tnorm ** 2
    ncc = np.where(ok, num / (tnorm * np.sqrt(np.maximum(var, 1e-6))), -1.0)
    y, x = divmod(int(np.argmax(ncc)), ncc.shape[1])
    return float(ncc[y, x]), y, x


def _search(shot_img: Image.Image, photo: Image.Image, width: int, scales) -> tuple[float, tuple[int, int, int, int] | None]:
    shot = _gray(shot_img, width)
    k = shot_img.width / width
    best: tuple[float, tuple[int, int, int, int] | None] = (-1.0, None)
    for s in scales:
        tw = int(round(width * s))
        tmpl = _gray(photo, tw)
        score, y, x = _best_match(shot, tmpl)
        if score > best[0]:
            best = (score, (round(x * k), round(y * k), round(tw * k), round(tmpl.shape[0] * k)))
    return best


def locate_photo(
    shot: Image.Image, photos: dict[int, Image.Image],
) -> tuple[int | None, tuple[int, int, int, int] | None]:
    """Which of `photos` (by scan id) is shown in the screenshot, and where
    (x, y, w, h). (None, None) when none is clearly there — comments only,
    a photo half hidden behind the comment sheet, or two look-alikes."""
    if not photos:
        return None, None
    # Rank every candidate cheaply, then look properly at the front-runners.
    coarse = sorted(((_search(shot, img, _COARSE_W, _COARSE_SCALES)[0], sid) for sid, img in photos.items()), reverse=True)
    fine = sorted(((*_search(shot, photos[sid], _FINE_W, _FINE_SCALES), sid) for _, sid in coarse[:3]), key=lambda r: -r[0])
    score, box, sid = fine[0]
    runner_up = fine[1][0] if len(fine) > 1 else -1.0
    if score >= MATCH_MIN_SCORE and score - runner_up >= MATCH_MIN_LEAD:
        return sid, box
    return None, None


def _thread_region(shot: Image.Image, box: tuple[int, int, int, int] | None) -> Image.Image:
    """The part of the screenshot that holds the comments."""
    if box is None:
        return shot
    x, y, w, h = box
    right, below = shot.width - (x + w), shot.height - (y + h)
    if right > 0.2 * shot.width:           # PC: thread in a column beside the photo
        return shot.crop((x + w, 0, shot.width, shot.height))
    if below > 0.15 * shot.height:         # phone: thread under the photo
        return shot.crop((0, y + h, shot.width, shot.height))
    return shot


def read_screenshot(
    image_bytes: bytes, photos: dict[int, Image.Image] | None = None,
) -> tuple[str, int | None]:
    """OCR one screenshot of a comment thread. Returns (text, scan id of the
    photo it shows or None). Raises ValueError if the bytes are not an image,
    RuntimeError if Tesseract is missing or fails."""
    try:
        shot = Image.open(BytesIO(image_bytes))
        shot.load()
    except Exception:
        raise ValueError("Could not read that image")
    shot = ImageOps.exif_transpose(shot).convert("RGB")
    scan_id, box = locate_photo(shot, photos or {})
    img = _thread_region(shot, box).convert("L")
    # Tesseract wants dark text on a light page: flip dark-mode screenshots.
    if ImageStat.Stat(img).mean[0] < 110:
        img = ImageOps.invert(img)
    # Screen text is sharp but small; a bigger page reads better. (A PC's
    # comment column is only a few hundred pixels wide.)
    if img.width < 1600:
        scale = 1600 / img.width
        img = img.resize((1600, round(img.height * scale)), Image.LANCZOS)
    img = ImageOps.autocontrast(img)
    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        img.save(f, format="PNG")
        f.flush()
        try:
            # --psm 4: one column of text in varying sizes, which is what a
            # comment thread is (names, bodies, the small "2h Like Reply" row).
            out = subprocess.run(
                ["tesseract", f.name, "stdout", "-l", OCR_LANGS, "--psm", "4"],
                capture_output=True, timeout=60,
            )
        except FileNotFoundError:
            raise RuntimeError("Text recognition is not installed on the server")
    if out.returncode != 0:
        raise RuntimeError(f"Text recognition failed: {out.stderr.decode(errors='replace')[:200]}")
    lines = [ln.rstrip() for ln in out.stdout.decode(errors="replace").splitlines()]
    return "\n".join(ln for ln in lines if ln.strip()), scan_id


# ---------- what the client tells us is on sale ----------

class CatalogueCard(BaseModel):
    card_id: int          # the card's id within its scan
    name: str
    set_code: str = ""
    price: str = ""       # as shown to buyers, e.g. "RM58"
    foil: bool = False
    position: str = ""    # where it sits in the photo, e.g. "row 1 of 2, 3rd of 4 from the left (top right)"


class CataloguePhoto(BaseModel):
    scan_id: int
    label: str            # how the seller refers to it, e.g. "Photo 2 (night-2.jpg)"
    cards: list[CatalogueCard]


# ---------- what Gemini gives back ----------
# Gemini structured output has no Optional: 0 / "" stand for "unknown".

class ClaimItemDraft(BaseModel):
    scan_id: int      # which photo; 0 if it could not tell
    card_id: int      # which card in that photo; -1 if it could not tell
    qty: int          # copies wanted, at least 1
    said: str         # the buyer's own words for this item
    unclear: str      # "" when sure; otherwise what the seller needs to settle


class ClaimDraft(BaseModel):
    buyer: str        # the commenter's name as written
    comment: str      # their comment, for the seller to check against
    items: list[ClaimItemDraft]
    unclear: str      # "" or a note about the whole comment (e.g. "cancels an earlier claim")


PROMPT = """You are helping a Malaysian Magic: The Gathering seller work out who claimed which cards from a Facebook comment thread.

The thread text below was read from screenshots by OCR, so expect small misreadings (l/1/I, O/0, missing diacritics, stray symbols), and Facebook chrome mixed in ("Like", "Reply", "2h", "Top fan", "Author", "View more replies", "Write a comment").

Comments are in Malay, English or a mix. Buyers claim with words like: "nak", "nak 1", "mine", "claim", "booking", "book", "ambil", "ambik", "amik", "lock", "sy nak", "saya nak", "+1", or by just naming a card. Cards carry no numbers; buyers describe them in their own words:
- the card's name, often shortened, nicknamed or misspelt ("sol ring", "rhystic", "bolt", "kitsune tu")
- its place in the photo ("top left", "kiri atas", "bawah kanan", "tengah", "second row first", "yang last", "yang ketiga", "the third one"). Counting goes left to right, then top to bottom, as the positions in the list below describe.
- its price ("yang RM58 tu", "the 58 one")
- what it is ("the foil one", "the dragon", "artifact tu") — match only if exactly one card fits
- "all" / "semua" / "borong"
A bare number such as "nak 2" usually means a quantity, not a card.

THE CARDS ON SALE
{catalogue}

{scope}

THE SELLER
The seller's own name is "{seller}". Never treat the seller's comments or replies as claims. A seller reply such as "ok", "noted", "sold", "pm" changes nothing.

WHAT TO RETURN
One entry per buyer comment that claims something, in the order the comments appear (earlier comments have first right to a card).
- buyer: the commenter's name as written.
- comment: their comment text, tidied of OCR junk but not reworded.
- items: one per card claimed, with scan_id and card_id taken from the list above, qty (default 1), and `said` = the buyer's words for that card.
- If you cannot tell which card or which photo is meant, still return the item with card_id -1 (and scan_id 0 if the photo is unknown) and put the reason in the item's `unclear`, phrased as a short question the seller can answer, e.g. "'Top left' fits a card in each photo — which photo?" or "No card called 'bolt' here — which card?". Never guess between two plausible cards.
- A position only identifies a card within one photo. If the thread covers several photos and a comment gives only a position, it is unclear unless something else (a card name, a price) settles it.
- Skip comments that are not claims: questions ("price?", "ada lagi?", "condition?"), "pm", "interested", tags of friends, emoji only.
- If a comment cancels or changes an earlier claim ("cancel", "tak jadi", "tukar"), return it with no certain items and explain in the comment-level `unclear`.
- If the same person claims in several comments, return each comment separately.

Return an empty list if nobody claimed anything.

THE THREAD
{thread}
"""


def _catalogue_text(photos: list[CataloguePhoto]) -> str:
    out = []
    for p in photos:
        out.append(f"{p.label} — scan_id {p.scan_id}")
        for c in p.cards:
            bits = [f"  card_id {c.card_id}", c.name + (" (foil)" if c.foil else "")]
            if c.set_code:
                bits.append(c.set_code.upper())
            if c.price:
                bits.append(c.price)
            if c.position:
                bits.append(c.position)
            out.append(" | ".join(bits))
    return "\n".join(out)


def parse_claims(thread: str, photos: list[CataloguePhoto], seller: str) -> list[ClaimDraft]:
    """Ask Gemini (text only) who claimed what. Synchronous — call it in a thread."""
    if len(photos) == 1:
        scope = f"All of these comments are about one photo: {photos[0].label}. Positions refer to it."
    else:
        scope = (f"The thread covers {len(photos)} photos. A position alone does not say which photo, "
                 "so treat it as unclear unless the comment also names the card or its price.")
    prompt = PROMPT.format(
        catalogue=_catalogue_text(photos), scope=scope,
        seller=seller or "(unknown)", thread=thread,
    )
    # Keep the client in a variable: a temporary is closed as soon as it is
    # garbage-collected, which can be mid-request.
    client = get_client()
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=[prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=list[ClaimDraft],
            temperature=0.0,
            thinking_config=types.ThinkingConfig(thinking_budget=settings.gemini_thinking_budget),
        ),
    )
    drafts = response.parsed or []
    # Never trust ids we did not offer: anything else becomes "unclear".
    valid = {(p.scan_id, c.card_id) for p in photos for c in p.cards}
    for d in drafts:
        for item in d.items:
            item.qty = max(1, item.qty)
            if (item.scan_id, item.card_id) not in valid:
                if len(photos) == 1 and item.scan_id == 0 and (photos[0].scan_id, item.card_id) in valid:
                    item.scan_id = photos[0].scan_id
                    continue
                item.card_id = -1
                item.unclear = item.unclear or "Which card is this?"
    return [d for d in drafts if d.items or d.unclear]
