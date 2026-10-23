"""Drop-off slips for Cards & Hobbies (C&H): 6 x 10.5 cm. One end (3 cm)
stays empty for the shop's stamp; the rest holds the buyer's name and number,
a gap, and the seller's name last.
Ten to an upright A4 page, the text straight: five strips cut across the
page, each cut in half. Five 6 cm strips need 30 cm and A4 is 29.7, so each
is 5.94 cm: 0.6 mm short, well inside the shop's "differ significantly".

Drawn with Pillow at 300 dpi and saved as a PDF, so printed at 100% each slip
is exactly to size."""

from io import BytesIO

from PIL import Image, ImageDraw, ImageFont

DPI = 300
CM = DPI / 2.54
PAGE_W, PAGE_H = round(21.0 * CM), round(29.7 * CM)          # A4, upright
COLS, ROWS = 2, 5
SLIP_LONG, SLIP_SHORT = 10.5 * CM, PAGE_H / ROWS               # laid sideways on the page: 10.5 x 5.94 cm
PER_PAGE = COLS * ROWS
STAMP = 3.0 * CM                                              # left empty at the right end for C&H's stamp
PAD = 0.5 * CM                                                # off the edges a printer can't reach

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
LABELS = ("Buyer's name", "Buyer's number", "Seller's name")


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT, size)


def _fields(values: tuple[str, str, str], length: float) -> Image.Image:
    """The slip's fields:

        Buyer's name: Jane Doe
        Buyer's number: 012-345 6789

        Seller's name: Muhammad Haziq

    An empty value is a line to write on with a pen."""
    w, h = round(length), round(SLIP_SHORT - 2 * PAD)
    img = Image.new("L", (w, h), 255)
    draw = ImageDraw.Draw(img)
    # Text baselines: the buyer's two rows as high as they go, the seller's
    # row as low as it goes, the space between left empty.
    row = 60
    baselines = (row - 10, 2 * row, h - 14)
    label_font = _font(34)
    for label, value, y in zip(LABELS, values, baselines):
        text = f"{label}: "
        draw.text((0, y), text, font=label_font, fill=60, anchor="ls")
        x = draw.textlength(text, font=label_font)
        if value:
            # As large as fits after the label: a long name shrinks, never overflows.
            size = 42
            while size > 20 and draw.textlength(value, font=_font(size, True)) > w - x:
                size -= 2
            draw.text((x, y), value, font=_font(size, True), fill=0, anchor="ls")
        else:
            draw.line((x, y + 4, w, y + 4), fill=150, width=2)
    return img


def _dashed(draw: ImageDraw.ImageDraw, x0: float, y0: float, x1: float, y1: float) -> None:
    length = max(abs(x1 - x0), abs(y1 - y0))
    for start in range(0, int(length), 36):
        end = min(start + 20, length)
        f0, f1 = start / length, end / length
        draw.line((x0 + (x1 - x0) * f0, y0 + (y1 - y0) * f0, x0 + (x1 - x0) * f1, y0 + (y1 - y0) * f1), fill=140, width=3)


def _page(slips: list[tuple[str, str, str]]) -> Image.Image:
    page = Image.new("L", (PAGE_W, PAGE_H), 255)
    draw = ImageDraw.Draw(page)
    for n, (buyer, phone, seller) in enumerate(slips):
        x, y = (n % COLS) * SLIP_LONG, (n // COLS) * SLIP_SHORT
        page.paste(_fields((buyer, phone, seller), SLIP_LONG - STAMP - PAD), (round(x + PAD), round(y + PAD)))
    # Cut lines: between the strips, and down the middle. The page's own
    # edges are the outer cuts.
    for r in range(1, ROWS):
        _dashed(draw, 0, r * SLIP_SHORT, PAGE_W, r * SLIP_SHORT)
    _dashed(draw, SLIP_LONG, 0, SLIP_LONG, PAGE_H)
    return page


def render(slips: list[tuple[str, str, str]], seller: str = "") -> bytes:
    """A PDF of the slips in order (buyer's name, number, seller's name; an
    empty one is a line to write on), ten to a page. The last page's spare
    places become blank slips, with the seller's name when given."""
    slips = slips or [("", "", seller)]
    while len(slips) % PER_PAGE:
        slips = [*slips, ("", "", seller)]
    pages = [_page(slips[i:i + PER_PAGE]) for i in range(0, len(slips), PER_PAGE)]
    out = BytesIO()
    pages[0].save(out, format="PDF", resolution=DPI, save_all=True, append_images=pages[1:])
    return out.getvalue()
