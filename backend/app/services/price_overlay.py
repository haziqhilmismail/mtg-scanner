"""
price_overlay.py
----------------
Draw clean price labels on top of the original photo.

Default: just price tags (rounded pill, drop shadow), positioned at the bottom
of each detected card. No outline rectangles - the photo stays clean.
Outlines are opt-in via show_outlines=True.
"""

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_PATH_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]


def _load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_PATH_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _polygon(c: dict) -> list[tuple[int, int]]:
    """A card's outline: its 4-point quad when known, else its bbox."""
    corners = c.get("corners")
    if corners and len(corners) == 4:
        return [(int(px), int(py)) for px, py in corners]
    x, y, w, h = c["bbox"]
    return [(int(x), int(y)), (int(x + w), int(y)), (int(x + w), int(y + h)), (int(x), int(y + h))]


class _Pill:
    """A pill's text measured once: its size, and where the text sits in it."""

    def __init__(self, draw, label: str, font, base_font_size: int):
        self.label, self.font, self.base = label, font, base_font_size
        self.text_box = draw.textbbox((0, 0), label, font=font)
        self.pad_x = max(12, base_font_size // 2)
        self.pad_y = max(8, base_font_size // 3)
        self.w = self.text_box[2] - self.text_box[0] + self.pad_x * 2
        self.h = self.text_box[3] - self.text_box[1] + self.pad_y * 2

    def clamp(self, x: int, y: int, W: int, H: int) -> tuple[int, int]:
        """(x, y) moved inside the photo, 4px from its edges."""
        return max(4, min(W - self.w - 4, x)), max(4, min(H - self.h - 4, y))

    def draw(self, fg_draw, sh_draw, x: int, y: int, is_foil: bool = False) -> None:
        """The pill at (x, y): its drop shadow, the fill and ring, the text."""
        radius = max(6, self.base // 3)

        # Drop shadow (slightly offset, drawn solid; blurred later)
        offset = max(2, self.base // 10)
        sh_draw.rounded_rectangle(
            [x + offset, y + offset, x + self.w + offset, y + self.h + offset],
            radius=radius, fill=(0, 0, 0, 130),
        )

        # Pill background
        if is_foil:
            bg_color = (240, 195, 50, 250)
            text_color = (25, 20, 10, 255)
        else:
            bg_color = (20, 20, 20, 245)
            text_color = (255, 255, 255, 255)

        # The ring: gold on a foil pill; on the dark pill, 18% white
        # pre-blended, since the layer stores the colour instead of blending it.
        ring = (255, 230, 130, 255) if is_foil else (62, 62, 62, 245)
        fg_draw.rounded_rectangle([x, y, x + self.w, y + self.h], radius=radius, fill=bg_color, outline=ring, width=2)
        fg_draw.text(
            (x + self.pad_x - self.text_box[0], y + self.pad_y - self.text_box[1]),
            self.label, font=self.font, fill=text_color,
        )


# A sold card's cover; BatchPreview.tsx draws the same in the preview.
COVER_SHADE = 120  # alpha of the black over it (0.47)


def _cover_blur(W: int, H: int) -> int:
    return max(10, min(W, H) // 50)


def _cover_sold(pil: Image.Image, covers: list[dict]) -> Image.Image:
    """Each sold card blurred past reading and darkened, so a repost of the
    photo shows what is left without hiding the photo itself."""
    W, H = pil.size
    blurred = pil.filter(ImageFilter.GaussianBlur(radius=_cover_blur(W, H)))
    mask = Image.new("L", pil.size, 0)
    shade = Image.new("RGBA", pil.size, (0, 0, 0, 0))
    mask_draw, shade_draw = ImageDraw.Draw(mask), ImageDraw.Draw(shade)
    for c in covers:
        mask_draw.polygon(_polygon(c), fill=255)
        shade_draw.polygon(_polygon(c), fill=(0, 0, 0, COVER_SHADE))
    return Image.alpha_composite(Image.composite(blurred, pil, mask), shade)


def render_overlay(
    image_bytes: bytes,
    cards: list[dict],
    show_outlines: bool = False,
    label_position: str = "bottom",
    font_scale: float = 1.0,
    covers: list[dict] | None = None,
) -> bytes:
    """
    image_bytes : original photo bytes
    cards : list of dicts with keys:
        - bbox : [x, y, w, h] in pixel coordinates
        - corners : optional [[x,y], [x,y], [x,y], [x,y]] 4-point polygon
                    (TL, TR, BR, BL). When present, the outline follows the
                    card's actual tilt instead of the axis-aligned rectangle.
        - label : string to render
        - is_foil : bool
        - pill_dx : optional int pixel offset added to the pill X (lets the
                    frontend drag the pill into the right spot per-card so
                    border-detection wonkiness doesn't ruin the export)
        - pill_dy : optional int pixel offset added to the pill Y
    show_outlines : if True, draws a thin outline around each card
    label_position : "bottom" | "top" | "center"
    font_scale : multiplier on the auto-scaled base font size (default 1.0).
                 Clamped to [0.5, 3.0] so a malformed payload can't blow up
                 the pill to fill the whole photo.
    covers : sold cards, each a dict with bbox and optional corners: blurred,
             darkened and marked SOLD (a repost of the photo).

    Returns JPEG-encoded bytes: a fifth of the PNG size for a photo, which
    matters when a phone shares a whole post.
    """
    pil = Image.open(BytesIO(image_bytes)).convert("RGBA")
    W, H = pil.size
    if covers:
        pil = _cover_sold(pil, covers)

    # Drop-shadow layer (drawn first, blurred, then composited)
    shadow_layer = Image.new("RGBA", pil.size, (0, 0, 0, 0))
    sh_draw = ImageDraw.Draw(shadow_layer)

    # Foreground layer (rectangles + label fills/text)
    fg_layer = Image.new("RGBA", pil.size, (0, 0, 0, 0))
    fg_draw = ImageDraw.Draw(fg_layer)

    scale = max(0.5, min(3.0, float(font_scale or 1.0)))
    base_font_size = max(22, int(min(H, W) * 0.030 * scale))
    font = _load_font(base_font_size)

    line_width = max(2, int(min(H, W) * 0.003))

    # Real MTG cards have a 488:680 aspect ratio. Gemini's bboxes sometimes overshoot
    # the card on one axis (extra table/background or a sliver of a neighbor). We derive
    # a "card-shaped" subbox centered on the bbox center for label placement, so the pill
    # sits at the actual card area instead of wherever the loose bbox happens to be.
    CARD_W_OVER_H = 488.0 / 680.0  # ≈ 0.7176

    for c in cards:
        raw_x, raw_y, raw_w, raw_h = c["bbox"]
        label = (c.get("label") or "").strip()
        is_foil = bool(c.get("is_foil", False))

        # Outline shows the *raw* detection so the user sees what Gemini actually found.
        # When a 4-point quad is available (classical-refined), draw a polygon so the
        # outline follows the card's tilt instead of an axis-aligned rectangle.
        if show_outlines:
            line_color = (220, 170, 30, 220) if is_foil else (50, 180, 100, 220)
            fg_draw.polygon(_polygon(c), outline=line_color, width=line_width)

        if not label:
            continue

        # Aspect-correct the bbox: take the smaller axis as truth, derive the other.
        # In nearly all cases the card is portrait (h > w), so width is more reliable.
        cx = raw_x + raw_w / 2
        cy = raw_y + raw_h / 2
        cur_aspect = (raw_w / raw_h) if raw_h > 0 else CARD_W_OVER_H
        if cur_aspect < CARD_W_OVER_H:
            # bbox is too tall — trust width
            card_w = float(raw_w)
            card_h = card_w / CARD_W_OVER_H
        else:
            # bbox is too wide — trust height
            card_h = float(raw_h)
            card_w = card_h * CARD_W_OVER_H
        x = int(cx - card_w / 2)
        y = int(cy - card_h / 2)
        w = int(card_w)
        h = int(card_h)
        x2, y2 = x + w, y + h

        pill = _Pill(fg_draw, label, font, base_font_size)
        rect_w, rect_h = pill.w, pill.h

        card_cx = x + w // 2
        if label_position == "top":
            rect_y = y - rect_h // 3
        elif label_position == "center":
            rect_y = y + h // 2 - rect_h // 2
        else:  # bottom (default)
            rect_y = y2 - rect_h * 2 // 3

        rect_x = card_cx - rect_w // 2

        # Per-card drag offset from the frontend preview. Lets the user pull
        # the pill onto the card when bbox detection drifted — applied before
        # clamping so a big drag can still pull the pill back into frame.
        pill_dx = int(c.get("pill_dx") or 0)
        pill_dy = int(c.get("pill_dy") or 0)
        rect_x += pill_dx
        rect_y += pill_dy

        pill.draw(fg_draw, sh_draw, *pill.clamp(rect_x, rect_y, W, H), is_foil)

    # SOLD across the middle of each sold card.
    sold = _Pill(fg_draw, "SOLD", font, base_font_size)
    for c in covers or []:
        x, y, w, h = c["bbox"]
        sold.draw(fg_draw, sh_draw, *sold.clamp(int(x + w / 2 - sold.w / 2), int(y + h / 2 - sold.h / 2), W, H))

    # Blur the shadow layer
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=base_font_size // 4))

    # Composite: photo -> shadow -> foreground
    composed = Image.alpha_composite(pil, shadow_layer)
    composed = Image.alpha_composite(composed, fg_layer).convert("RGB")

    buf = BytesIO()
    composed.save(buf, format="JPEG", quality=90)
    return buf.getvalue()
