"""
gemini_scanner.py
-----------------
Send a card photo to Gemini, get back structured detections.

Gemini does both jobs in one call:
  - Locates each card (returns bounding box in normalized [0,1000] coords)
  - Identifies it (card name, set code, collector number)
  - Tells us if it looks foil

Output format follows Google's recommended bounding-box convention:
  box_2d = [ymin, xmin, ymax, xmax] in 0-1000 scale
"""

from pydantic import BaseModel
from google import genai
from google.genai import types

from ..config import settings


# Note: Gemini structured outputs don't support Optional/Union types.
# Use empty strings to mean "unknown" instead of null.
class CardDetection(BaseModel):
    name: str          # exact card name as printed (English)
    set_code: str      # 3-letter Scryfall set code, lowercase, or "" if unknown
    collector_number: str  # collector number from card bottom, or "" if unknown
    is_foil: bool      # true if rainbow shimmer / holographic treatment visible
    quantity: int      # 1 for a single card; N for N stacked-with-offset copies
    box_2d: list[int]  # [ymin, xmin, ymax, xmax] normalized 0-1000


PROMPT = """You are an expert at identifying Magic: The Gathering trading cards.

Look at this image carefully. It contains one or more MTG cards arranged in a grid (or scattered).

For EACH card visible in the image, return a JSON object with these exact fields:

- name: The exact English card name as printed on the card. Return the English name even if the card is in a non-English language. Be precise — "Lightning Bolt" not "lightning bolt".

  HOW TO READ THE NAME:
  * Look for short, prominent printed text. Card names are 1-5 words typically.
  * Capitalize in Title Case: "Sol Ring", not "sol ring" or "SOL RING".
  * It's printed in a distinct font that stands out from the rules text.
  * Read character-by-character — don't guess from context.

  COMMON MISTAKES TO AVOID:
  * Do NOT return the creature type or subtype as the name (e.g., NOT "Legendary Creature — Human Warrior")
  * Do NOT return flavor text (italic, in the rules-text box, often a quote)
  * Do NOT return rules text (game effects in the text box)
  * Do NOT return the artist credit (small print at the bottom)
  * If the name is in stylized typography or split across decorative elements (banners, ribbons, art-integrated), still read the actual letters.

  CRITICAL — name placement varies by frame:
    * Standard frame: name is at the TOP of the card in a title bar
    * Borderless, showcase, extended-art, and cinematic frames: name is often in the MIDDLE of the card, integrated into the art, printed on a banner, or styled in unusual typography. This is common in recent sets — Edge of Eternities (EOE), Final Fantasy (FIN), Tarkir: Dragonstorm (TDM), Modern Horizons 3 (MH3) showcases, Bloomburrow (BLB) full-art lands, and many Universes Beyond sets.
    * Full-art and stellar-sights basic lands: name may sit on a small horizontal banner near the middle or be otherwise stylized.
    * Token cards: name is usually at the top but in a different font.

  Search the WHOLE card for the printed name. Do NOT confuse it with:
    * Flavor text (italicized, in the lower text box)
    * Rules text (game-text in the lower text box)
    * Subtitle / type line (usually has creature type, e.g., "Legendary Creature — Human Warrior")
    * Mana cost icons in the top-right
    * Artist credit in the small footer
  If the printed text appears stylized, decorative, or in a unique typeface, that is still the card name — read it as-is.

- set_code: The 3-letter Scryfall set code (lowercase) if you can identify the set from the set symbol (usually mid-right of the card, between art and text box) or expansion name (often printed near the bottom).
  Recent sets to recognize: "eoe" (Edge of Eternities), "fin" (Final Fantasy), "tdm" (Tarkir: Dragonstorm), "dft" (Aetherdrift), "fdn" (Foundations), "dsk" (Duskmourn), "blb" (Bloomburrow), "mh3" (Modern Horizons 3), "otj" (Outlaws of Thunder Junction), "mkm" (Murders at Karlov Manor), "lci" (Lost Caverns of Ixalan), "woe" (Wilds of Eldraine), "mat" (March of the Machine: The Aftermath), "mom" (March of the Machine), "neo" (Kamigawa: Neon Dynasty), "mh2" (Modern Horizons 2).
  Return empty string "" if you cannot identify the set with confidence.

- collector_number: The collector number printed in the small footer at the bottom of the card (e.g., "161", "042", "T1"). It usually appears as "161/350" — return just the first part, "161". Return "" if not visible.
  This number is HIGH PRIORITY — set symbols can be worn, glared, or stylized in ways that mislead set identification, but the collector number is small printed text and is the most reliable cross-check for which set+printing a card actually is. Read it carefully even if the set symbol is obvious.

- is_foil: true if you observe rainbow shimmer, holographic effects, or characteristic foil-card light reflections. false otherwise. When uncertain, return false.

- quantity: How many physical copies of this specific card the seller has.
  * Cards laid out FLAT side-by-side, in a grid, or scattered → return ONE detection per card with quantity=1.
  * Cards STACKED with a small offset so multiple title bars or names of the same card peek out from under the top one → return ONE detection covering the stack with quantity equal to the number of visible copies (typically 2 or 3).
  Stacked-with-offset is the seller's shorthand for "I have multiple copies of this card." Do NOT return a separate detection per stacked card — collapse them into a single entry with the right quantity.
  If you cannot tell whether a card is alone or stacked, default to quantity=1.

- box_2d: The bounding box of this specific card as [ymin, xmin, ymax, xmax], with all four values as integers in normalized 0-1000 coordinates (0,0 is top-left, 1000,1000 is bottom-right of the image).
  CRITICAL — make the box TIGHT against the card's printed border:
  * The four edges of your box should align with the card's actual outer edge (the dark rounded rectangle that frames every MTG card).
  * Do NOT include empty table/background space, neighboring cards or partial cards, shadows, or glare.
  * Magic cards have roughly a 488:680 width-to-height ratio (~0.72). If your box's aspect ratio looks very different from this, you're including non-card area — tighten until proportions match a real card.
  * Loose boxes cause the price label to be placed off the card in downstream rendering. Tightness matters.
  For a single card: tight around just that card.
  For a stacked group (quantity > 1): cover the union of the whole visible stack.

Order the array in reading order: top-to-bottom, then left-to-right.

Return ONLY the JSON array. No markdown fences, no explanation, no preamble."""


def get_client():
    api_key = settings.gemini_api_key
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY not set. Get a free key at https://aistudio.google.com/apikey "
            "and put it in backend/.env or export it as an environment variable."
        )
    return genai.Client(api_key=api_key)


def scan_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> list[CardDetection]:
    """Send the image to Gemini and parse out card detections."""
    client = get_client()
    model = settings.gemini_model

    response = client.models.generate_content(
        model=model,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            PROMPT,
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=list[CardDetection],
            temperature=0.1,  # low temp for accuracy
            thinking_config=types.ThinkingConfig(
                thinking_budget=settings.gemini_thinking_budget,
            ),
        ),
    )

    # Log per-call token usage so we can see actual cost shape and prove the
    # thinking-budget cap is working. At $0.50/M input + $3.00/M output (and
    # thinking is billed at the output rate), the dominant lever is the
    # thinking token count.
    usage = getattr(response, "usage_metadata", None)
    if usage is not None:
        prompt_t = getattr(usage, "prompt_token_count", 0) or 0
        output_t = getattr(usage, "candidates_token_count", 0) or 0
        thinking_t = getattr(usage, "thoughts_token_count", 0) or 0
        total_t = getattr(usage, "total_token_count", 0) or 0
        # Rough USD cost estimate at advertised Gemini 3 Flash rates.
        cost_usd = (prompt_t * 0.5 + (output_t + thinking_t) * 3.0) / 1_000_000
        print(
            f"[gemini-usage] prompt={prompt_t} thinking={thinking_t} "
            f"output={output_t} total={total_t} cost=${cost_usd:.5f}",
            flush=True,
        )

    parsed = response.parsed
    if parsed is None:
        # Fall back to manual JSON parsing if structured output failed
        import json
        try:
            text = response.text or ""
            # Strip possible markdown fences
            text = text.strip()
            if text.startswith("```"):
                text = text.split("```", 2)[1]
                if text.startswith("json"):
                    text = text[4:]
            data = json.loads(text.strip())
            parsed = [CardDetection(**item) for item in data]
        except Exception as e:
            raise RuntimeError(f"Could not parse Gemini response: {e}\nRaw: {response.text[:500]}")

    # Post-process: Gemini sometimes ignores the "stacked = one detection with qty=N"
    # instruction and returns two separate detections for stacked-with-offset cards.
    # We catch this by looking for overlapping same-name bboxes and collapsing them.
    return _merge_stacked_detections(parsed)


def _bbox_overlap_ratio(a: list[int], b: list[int]) -> float:
    """Overlap as fraction of the smaller bbox's area.
    Stacked-with-offset pairs are nearly fully overlapping (the smaller is almost
    entirely contained in the larger), so this ratio approaches 1.0. Side-by-side
    cards have ratio ~= 0."""
    ay1, ax1, ay2, ax2 = a
    by1, bx1, by2, bx2 = b
    iy1, ix1 = max(ay1, by1), max(ax1, bx1)
    iy2, ix2 = min(ay2, by2), min(ax2, bx2)
    if iy2 <= iy1 or ix2 <= ix1:
        return 0.0
    inter = (iy2 - iy1) * (ix2 - ix1)
    a_area = (ay2 - ay1) * (ax2 - ax1)
    b_area = (by2 - by1) * (bx2 - bx1)
    smaller = min(a_area, b_area)
    return inter / smaller if smaller > 0 else 0.0


def _bbox_union(a: list[int], b: list[int]) -> list[int]:
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def _merge_stacked_detections(dets: list[CardDetection]) -> list[CardDetection]:
    """Merge same-name detections whose bboxes overlap by >50% of the smaller box.
    Result has summed quantities and the union bbox covering the stack."""
    if len(dets) < 2:
        return dets

    by_name: dict[str, list[int]] = {}
    for i, d in enumerate(dets):
        key = (d.name or "").strip().lower()
        if not key:
            continue
        by_name.setdefault(key, []).append(i)

    merged_into: dict[int, int] = {}  # j -> i; means j was merged into i
    for idxs in by_name.values():
        if len(idxs) < 2:
            continue
        for i in idxs:
            if i in merged_into:
                continue
            for j in idxs:
                if j <= i or j in merged_into:
                    continue
                ratio = _bbox_overlap_ratio(dets[i].box_2d, dets[j].box_2d)
                if ratio >= 0.5:  # threshold: overlapping at least half of the smaller box
                    add_qty = max(1, dets[j].quantity)
                    dets[i].quantity = max(1, dets[i].quantity) + add_qty
                    dets[i].box_2d = _bbox_union(dets[i].box_2d, dets[j].box_2d)
                    merged_into[j] = i

    return [d for i, d in enumerate(dets) if i not in merged_into]
