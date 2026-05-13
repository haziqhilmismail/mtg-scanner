"""
verify_phash_index.py
---------------------
Sanity-check the pHash index by:
  1. Picking a random card from the index and looking up its OWN hash (must be 0).
  2. Cropping each known card from the demo image and looking them up,
     printing top-3 candidates with Hamming distance.

Run after `build_phash_index.py` completes.

Usage:
  cd backend
  python scripts/verify_phash_index.py [--index path] [--demo path]
"""

from __future__ import annotations

import argparse
import random
import sys
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services import local_card_id  # noqa: E402

BACKEND_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INDEX = BACKEND_ROOT / "data" / "phash_index.npz"
DEFAULT_DEMO = BACKEND_ROOT.parent / "frontend" / "public" / "demo" / "sample-scan.jpg"

# Known cards in the demo image. Bboxes copied from frontend/src/data/demoScan.ts.
# (set, collector_number, expected name, [x, y, w, h] in pixels at 1729x1729)
DEMO_CARDS = [
    # Frantic Search, Pick Your Poison, Etali, Malakir Rebirth — read from demoScan.ts
    # at run time so this stays in sync.
]


def parse_demo_scan(demo_ts: Path) -> list[dict]:
    """Pull DEMO_CARDS from frontend/src/data/demoScan.ts via crude regex (no JS engine)."""
    import re
    txt = demo_ts.read_text()
    cards = []
    pat = re.compile(
        r"name:\s*'([^']+)'.*?collectorNumber:\s*'([^']+)'.*?"
        r"bbox:\s*\{\s*x:\s*(\d+)\s*,\s*y:\s*(\d+)\s*,\s*w:\s*(\d+)\s*,\s*h:\s*(\d+)\s*\}",
        re.DOTALL,
    )
    for m in pat.finditer(txt):
        cards.append({
            "name": m.group(1),
            "collector_number": m.group(2),
            "bbox": (int(m.group(3)), int(m.group(4)), int(m.group(5)), int(m.group(6))),
        })
    return cards


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--index", default=str(DEFAULT_INDEX))
    parser.add_argument("--demo", default=str(DEFAULT_DEMO))
    args = parser.parse_args()

    idx_path = Path(args.index)
    if not idx_path.exists():
        print(f"index not found at {idx_path}", file=sys.stderr)
        return 1

    idx = local_card_id.load_index(idx_path)
    print(f"loaded {len(idx)} entries from {idx_path}")

    # 1. Self-lookup: pick a random entry, hash should round-trip distance=0
    sample = random.randint(0, len(idx) - 1)
    cands = idx.search(idx.hashes[sample], top_k=2)
    top = cands[0]
    status = "ok" if top.distance == 0 else "FAIL"
    print(f"[self-lookup] index[{sample}]={idx.name[sample]!r} → top={top.name!r} d={top.distance} ({status})")

    # 2. Demo image
    demo_path = Path(args.demo)
    demo_ts = BACKEND_ROOT.parent / "frontend" / "src" / "data" / "demoScan.ts"
    if not demo_path.exists() or not demo_ts.exists():
        print(f"\nskipping demo image check (demo file or ts not found)")
        return 0

    pil = Image.open(demo_path)
    pil.load()
    W, H = pil.size
    print(f"\ndemo image: {demo_path.name} ({W}x{H})")

    cards = parse_demo_scan(demo_ts)
    if not cards:
        print("could not parse cards from demoScan.ts")
        return 0

    hit = 0
    for c in cards:
        x, y, w, h = c["bbox"]
        crop = pil.crop((x, y, x + w, y + h))
        buf = BytesIO()
        crop.convert("RGB").save(buf, format="JPEG", quality=90)
        h_u64 = local_card_id.hash_crop(buf.getvalue())
        if h_u64 is None:
            print(f"  {c['name']!r}: HASH FAILED")
            continue
        results = idx.search(h_u64, top_k=3)
        names = [(r.name, r.set, r.collector_number, r.distance) for r in results]
        matched = any(r.name.lower().startswith(c["name"].lower().split(" //")[0]) for r in results)
        if matched:
            hit += 1
        marker = "✓" if matched else "✗"
        print(f"  {marker} {c['name']!r} (cn={c['collector_number']}): top3 = {names}")

    print(f"\nresult: {hit}/{len(cards)} demo cards identified")
    return 0 if hit == len(cards) else 1


if __name__ == "__main__":
    sys.exit(main())
