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


def render_overlay(
    image_bytes: bytes,
    cards: list[dict],
    show_outlines: bool = False,
    label_position: str = "bottom",
    font_scale: float = 1.0,
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

    Returns JPEG-encoded bytes: a fifth of the PNG size for a photo, which
    matters when a phone shares a whole post.
    """
    pil = Image.open(BytesIO(image_bytes)).convert("RGBA")
    W, H = pil.size

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
        corners = c.get("corners")
        label = (c.get("label") or "").strip()
        is_foil = bool(c.get("is_foil", False))

        # Outline shows the *raw* detection so the user sees what Gemini actually found.
        # When a 4-point quad is available (classical-refined), draw a polygon so the
        # outline follows the card's tilt instead of an axis-aligned rectangle.
        if show_outlines:
            line_color = (220, 170, 30, 220) if is_foil else (50, 180, 100, 220)
            if corners and len(corners) == 4:
                pts = [(int(px), int(py)) for px, py in corners]
                fg_draw.polygon(pts, outline=line_color, width=line_width)
            else:
                fg_draw.rectangle(
                    [raw_x, raw_y, raw_x + raw_w, raw_y + raw_h],
                    outline=line_color, width=line_width,
                )

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

        # Measure label
        bbox = fg_draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        pad_x = max(12, base_font_size // 2)
        pad_y = max(8, base_font_size // 3)
        rect_w = tw + pad_x * 2
        rect_h = th + pad_y * 2

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

        # Clamp inside image
        rect_x = max(4, min(W - rect_w - 4, rect_x))
        rect_y = max(4, min(H - rect_h - 4, rect_y))

        radius = max(6, base_font_size // 3)

        # Drop shadow (slightly offset, drawn solid; blurred later)
        shadow_offset = max(2, base_font_size // 10)
        sh_draw.rounded_rectangle(
            [rect_x + shadow_offset, rect_y + shadow_offset,
             rect_x + rect_w + shadow_offset, rect_y + rect_h + shadow_offset],
            radius=radius,
            fill=(0, 0, 0, 130),
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
        fg_draw.rounded_rectangle(
            [rect_x, rect_y, rect_x + rect_w, rect_y + rect_h],
            radius=radius, fill=bg_color, outline=ring, width=2,
        )

        fg_draw.text(
            (rect_x + pad_x - bbox[0], rect_y + pad_y - bbox[1]),
            label, font=font, fill=text_color,
        )

    # Blur the shadow layer
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=base_font_size // 4))

    # Composite: photo -> shadow -> foreground
    composed = Image.alpha_composite(pil, shadow_layer)
    composed = Image.alpha_composite(composed, fg_layer).convert("RGB")

    buf = BytesIO()
    composed.save(buf, format="JPEG", quality=90)
    return buf.getvalue()
