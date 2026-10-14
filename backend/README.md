# Backend

New consolidated backend for the scanner + order/checklist layer.

## Directory layout

```
backend/
├── requirements.txt
├── .env.example
├── data/                     # SQLite DB (app.db) + CK pricelist cache once moved over
└── app/
    ├── config.py             # env-based settings (pydantic-settings)
    ├── db.py                 # async engine + session factory
    ├── deps.py               # FastAPI deps: get_db, get_current_user_id
    ├── main.py               # (to be created — wires routers + lifespan)
    ├── models/               # SQLAlchemy 2.0 schema
    │   ├── base.py
    │   ├── user.py
    │   ├── scan.py
    │   ├── listing.py
    │   ├── buyer.py
    │   ├── order.py
    │   ├── order_item.py
    │   └── payment.py
    ├── schemas/              # Pydantic API contracts (request/response shapes)
    │   ├── user.py
    │   ├── scan.py
    │   ├── listing.py
    │   ├── buyer.py
    │   ├── order.py
    │   └── payment.py
    ├── services/             # (to be filled — gemini_scanner, scryfall_lookup, etc.)
    └── routers/              # (to be filled — listings, buyers, orders, etc.)
```

## Schema overview

| Table         | Purpose                                                                      |
|---------------|------------------------------------------------------------------------------|
| `users`       | Account + payment defaults (bank info, QR, default multipliers)              |
| `scans`       | Uploaded photo + raw Gemini response                                         |
| `listings`    | A card put up for sale. Card identity is denormalized at listing time        |
| `buyers`      | FB buyer profiles                                                            |
| `orders`      | Buyer's claim. `paid_at` and `delivered_at` are independent (credit drop-offs supported) |
| `order_items` | Line items with price + name snapshots                                       |
| `payments`    | Multiple payments per order allowed (partial payments)                       |

Status state machines:
- **Listing** → `active` ↔ `archived`. Quantity availability is computed from active order items.
- **Order** → `claimed` | `cancelled`. The paid/delivered axes are tracked via `paid_at` and `delivered_at` separately, so `delivered_at` set without `paid_at` represents "took on credit".

## Migration plan from existing `app/`

The old scanner-only backend at `mtg-scanner/app/` keeps running untouched while this
new structure is filled out. Steps:

1. **Schema + data model (done)** — this commit.
2. Add `db.init_db()` + Alembic baseline so the SQLite file is created on first run.
3. Move `app/gemini_scanner.py`, `app/scryfall_lookup.py`, `app/cardkingdom_prices.py`, `app/price_overlay.py` → `backend/app/services/`. Update imports.
4. Recreate `app/main.py` as `backend/app/main.py` with the existing scan/export routes pulled into `routers/scan.py`.
5. Build the new routers: `listings`, `buyers`, `orders`, `payments`.
6. Wire React frontend to the new endpoints.
7. Delete the old `app/` once the new backend has parity.

## Running (once main.py + routers exist)

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env  # then fill in GEMINI_API_KEY
uvicorn app.main:app --reload
```

## Local scanner (experimental)

`SCANNER_BACKEND=local` swaps Gemini out of `/api/scan` for a pipeline that
runs entirely on the server's CPU — no cloud model, no API key. The default
is still `gemini`; nothing changes unless the setting is flipped.

| Step     | Module              | What it does |
|----------|---------------------|--------------|
| Detect   | `card_detector.py`  | YOLO11n-OBB finds every card as a rotated quad |
| Name     | `card_embedder.py`  | Warps each quad flat, embeds it (DINOv3 ViT-S/16), nearest neighbour over one embedding per Scryfall printing |
| Name     | `collector_ocr.py`  | OCRs the title bar; a title that reads as a real card name overrules the embedding and settles which way up the card is |
| Version  | `collector_ocr.py`  | OCRs the collector line (`TLA ★ EN`, `R 0209`) and picks the exact printing among that card's reprints |
| Foil     | `card_scanner.py`   | `★` vs `•` on the collector line; or the printing's Scryfall `finishes` when it exists in only one finish |

Limits worth knowing: the collector line is ~1.4 mm tall, so version and foil
are only read when a card is roughly 250 px or wider in the photo (a 9-pocket
binder page at the 2000 px upload cap is borderline). Below that, the version
is the embedding's closest printing and foil defaults to off. Such cards come back with
`version_source: "embedding"` so the UI can ask the seller to confirm them.
Quantity is always 1; sellers set stacks themselves. Cards printed
before 2015 have no foil glyph at all.

### Setup

```bash
pip install -r requirements.txt -r requirements-local-scanner.txt
```

Three files must exist under `data/` (gitignored, not in the Docker image):

```
data/models/card_detector.onnx   ~10 MB
data/models/card_embedder.onnx   ~85 MB
data/card_index.npz              ~90 MB
```

Without them the app still starts; `/api/scan` returns 503 and `/api/health`
reports `ok: false`.

**Models** — exported once from the
[open-card-collector](https://github.com/matteot11/open-card-collector)
weights on Hugging Face (needs `torch`, `ultralytics`, `transformers`, `onnx`
— on a dev machine, not the server):

```python
from huggingface_hub import hf_hub_download, snapshot_download
from ultralytics import YOLO
import torch
from transformers import AutoModel

# Detector → data/models/card_detector.onnx
pt = hf_hub_download("matteot11/collector-mtg-pkm-detector-yolo11n-obb", "best.pt")
YOLO(pt).export(format="onnx", imgsz=640, opset=17)   # writes best.onnx next to best.pt

# Embedder → data/models/card_embedder.onnx
model = AutoModel.from_pretrained(
    snapshot_download("matteot11/collector-mtg-pkm-embedder-dinov3-small")).eval()

class Wrap(torch.nn.Module):
    def forward(self, x):
        return torch.nn.functional.normalize(model(pixel_values=x).last_hidden_state[:, 0], dim=1)

torch.onnx.export(Wrap(), (torch.randn(2, 3, 224, 224),), "data/models/card_embedder.onnx",
                  input_names=["pixel_values"], output_names=["embedding"],
                  dynamic_axes={"pixel_values": {0: "batch"}, "embedding": {0: "batch"}},
                  opset_version=17, dynamo=False)
```

**Index** — one embedding per paper printing on Scryfall (~112k card faces):

```bash
python scripts/build_embedding_index.py --cache-dir /somewhere/with/10GB
```

Downloads every card image (~8 GB cache, resumable) and embeds it; 1-2 hours
on a laptop. Re-run it when new sets release — cards missing from the index
get named as their closest look-alike.

**Licences** — the detector weights are AGPL-3.0 (Ultralytics), the embedder
is under the DINOv3 License, PP-OCR is Apache-2.0.
