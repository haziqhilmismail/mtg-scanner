"""Drop-off slips: one per buyer, ten to an upright A4 page in a 2 x 5 grid,
for the seller to cut out and leave with each buyer's cards at the drop-off
point (frontend/DESIGN.md section 8 and its "Drop-off slips · A4 PDF" board).

A slip holds three rows and nothing else: the buyer's name, the buyer's
number, and the seller's name, which is always a line to write on. A missing
name or number is a line to write on too. Sizes are the board's CSS pixels
scaled to print. Drawn with Pillow at 300 dpi in black on white and saved as
a PDF, so it prints to size and reads in grayscale."""

from functools import cache
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont

DPI = 300
PX = DPI / 96                                     # one CSS pixel of the board, at print size
PAGE_W, PAGE_H = round(21.0 / 2.54 * DPI), round(29.7 / 2.54 * DPI)   # A4, upright
COLS, ROWS = 2, 5
PER_PAGE = COLS * ROWS
SLIP_W, SLIP_H = PAGE_W / COLS, PAGE_H / ROWS

PAD_X = 40 * PX
GAP = 6 * PX                                      # between a label and what follows it
LABEL_SIZE = 13 * PX
VALUE_SIZES = [size * PX for size in range(17, 11, -1)]   # 17px, shrinking to 12px: nothing prints smaller
LINE_HEIGHT = 1.3
BASELINES = (53 * PX, 87 * PX, SLIP_H - 36 * PX)  # the three rows; the seller's sits at the bottom
# A long name wraps down to where the number row still clears the seller's.
NAME_LINES = 1 + int((BASELINES[2] - 2 * (BASELINES[1] - BASELINES[0]) - BASELINES[0]) // (VALUE_SIZES[-1] * LINE_HEIGHT))
WRITE_IN = (200 * PX, 190 * PX, 200 * PX)
RULE = round(PX)                                  # 1px lines and cut lines
DASH, DASH_GAP = round(4 * PX), round(3 * PX)
INK, LABEL_INK, LINE_INK = 0, 0x33, 0x76          # black, #333, #767676

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
LABELS = ("Buyer's name:", "Buyer's number:", "Seller's name:")


def _font(size: float, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT, round(size))


@cache
def _drawable(ch: str) -> bool:
    """Whether DejaVu has a glyph for `ch`; a missing one prints as an empty box."""
    return ch.isspace() or _ink(ch) != _ink("\U0010FFFD")


@cache
def _ink(ch: str) -> bytes:
    font = _font(VALUE_SIZES[0], bold=True)
    img = Image.new("L", (font.size * 2, font.size * 2))
    ImageDraw.Draw(img).text((0, 0), ch, font=font, fill=255)
    return img.tobytes()


def printable(value: str) -> str:
    """`value` without the characters the slip can't print (emoji, scripts
    DejaVu lacks). Nothing left means the slip gets a write-in line."""
    return " ".join("".join(ch for ch in value if _drawable(ch)).split())


def _wrap(text: str, font: ImageFont.FreeTypeFont, width: float) -> list[str]:
    """Greedy word wrap; a word wider than the line (a long handle, a name
    in a script without spaces) breaks between letters."""
    lines: list[str] = []
    line = ""
    for word in text.split():
        candidate = f"{line} {word}" if line else word
        if font.getlength(candidate) <= width:
            line = candidate
            continue
        if line:
            lines.append(line)
        line = ""
        for ch in word:
            if line and font.getlength(line + ch) > width:
                lines.append(line)
                line = ""
            line += ch
    return [*lines, line] if line else lines


def fit_value(value: str, width: float, max_lines: int) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    """How `value` fits after its label: one line at 17px down to 14px, else
    two lines at 17px down to 12px, else 12px on up to `max_lines` lines with
    the last cut short by an ellipsis."""
    for lines_wanted, smallest in ((1, 14 * PX), (2, VALUE_SIZES[-1])):
        for size in (s for s in VALUE_SIZES if s >= smallest):
            font = _font(size, bold=True)
            lines = _wrap(value, font, width)
            if len(lines) <= lines_wanted:
                return font, lines
    if len(lines) > max_lines:
        last = lines[max_lines - 1]
        while last and font.getlength(last + "…") > width:
            last = last[:-1]
        lines = [*lines[:max_lines - 1], last.rstrip() + "…"]
    return font, lines


def _slip(draw: ImageDraw.ImageDraw, left: float, top: float, buyer: str, phone: str) -> None:
    label_font = _font(LABEL_SIZE)
    shift = 0.0                                   # how much a wrapped name pushes the number down
    for row, (label, value) in enumerate(zip(LABELS, (printable(buyer), printable(phone), ""))):
        baseline = top + BASELINES[row] + (shift if row == 1 else 0)
        draw.text((left + PAD_X, baseline), label, font=label_font, fill=LABEL_INK, anchor="ls")
        x = left + PAD_X + draw.textlength(label, font=label_font) + GAP
        if not value:
            draw.rectangle((x, baseline - RULE / 2, x + WRITE_IN[row], baseline + RULE / 2), fill=LINE_INK)
            continue
        width = left + SLIP_W - PAD_X - x
        font, lines = fit_value(value, width, NAME_LINES if row == 0 else 2)
        step = font.size * LINE_HEIGHT
        for i, text in enumerate(lines):
            draw.text((x, baseline + i * step), text, font=font, fill=INK, anchor="ls")
        if row == 0:
            shift = (len(lines) - 1) * step


def _dashed(draw: ImageDraw.ImageDraw, x0: float, y0: float, x1: float, y1: float) -> None:
    horizontal = y0 == y1
    length = (x1 - x0) if horizontal else (y1 - y0)
    for start in range(0, int(length), DASH + DASH_GAP):
        end = min(start + DASH, length)
        if horizontal:
            draw.rectangle((x0 + start, y0 - RULE / 2, x0 + end, y0 + RULE / 2), fill=LINE_INK)
        else:
            draw.rectangle((x0 - RULE / 2, y0 + start, x0 + RULE / 2, y0 + end), fill=LINE_INK)


def page(slips: list[tuple[str, str]]) -> Image.Image:
    """One A4 page of up to ten (buyer, phone) slips, with cut lines between
    the slips only: the page's own edges are the outer cuts."""
    img = Image.new("L", (PAGE_W, PAGE_H), 255)
    draw = ImageDraw.Draw(img)
    for n, (buyer, phone) in enumerate(slips):
        _slip(draw, (n % COLS) * SLIP_W, (n // COLS) * SLIP_H, buyer, phone)
    for r in range(1, ROWS):
        _dashed(draw, 0, r * SLIP_H, PAGE_W, r * SLIP_H)
    _dashed(draw, SLIP_W, 0, SLIP_W, PAGE_H)
    return img


def render(slips: list[tuple[str, str]]) -> bytes:
    """A PDF of the slips in the order given, ten to a page. The rest of the
    last page is blank slips."""
    slips = slips or [("", "")]
    slips = [*slips, *[("", "")] * (-len(slips) % PER_PAGE)]
    pages = [page(slips[i:i + PER_PAGE]) for i in range(0, len(slips), PER_PAGE)]
    out = BytesIO()
    pages[0].save(out, format="PDF", resolution=DPI, save_all=True, append_images=pages[1:])
    return out.getvalue()
