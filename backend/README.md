# MTG scanner backend

FastAPI + SQLAlchemy 2 (async) + SQLite, behind the React frontend
(`mtg-scanner-frontend`, on Vercel). It prices Magic cards from photos
(Gemini, or the local scanner below; prices from CardKingdom, card data from
Scryfall) and keeps the seller's stock, posts, buyers and orders.

## Layout

```
app/
├── main.py       # app, lifespan (migrations, CK index), scan / export / Scryfall routes
├── config.py     # settings from env / .env (see .env.example)
├── db.py         # async engine + session (commits on success)
├── deps.py       # DbSession, CurrentUserId (bearer), ImageUserId (?token=), the rate limiter
├── models/       # SQLAlchemy tables
├── schemas/      # Pydantic request/response shapes
├── routers/      # auth, bugs, buyers, claims, credits, listings, orders, posts
└── services/     # Gemini, Scryfall, CardKingdom, overlay render, credits, local scanner...
migrations/       # Alembic; `alembic upgrade head` runs on every start
scripts/          # make_voucher.py, build_embedding_index.py
tests/
```

## Auth

With `GOOGLE_CLIENT_ID` set, `POST /api/auth/google` swaps a Google ID token
for a 7-day session JWT (sent as `Authorization: Bearer`) plus a 30-day
image-only token for `<img src="...?token=">` URLs. `GET /api/auth/me` returns
both again. Without `GOOGLE_CLIENT_ID` the app runs in solo mode: no login,
everything belongs to user `SOLO_USER_ID`.

## Tables

| Table | Purpose |
|---|---|
| `users` | Account + pricing defaults, scan-credit state |
| `scans` | Uploaded photo (file in `data/scans/`), detected cards, the seller's per-card edits (`ui_state`) |
| `posts`, `listing_post_links` | Facebook posts and the listings under each |
| `listings` | A card put up for sale; card identity is copied in at listing time |
| `buyers`, `orders`, `order_items` | Claims; `paid_at` and `delivered_at` are independent (credit drop-offs) |
| `payments` | Reserved for partial payments (no routes yet) |
| `scan_credit_events`, `vouchers`, `voucher_redemptions` | Scan credits, see `services/credits.py` |
| `bug_events` | Backend 500s and frontend crash reports (also pushed to Telegram) |

## Running

```bash
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env          # then fill in GEMINI_API_KEY
uvicorn app.main:app --reload
python -m pytest tests
```

Production runs in Docker on the home server; see `DEPLOY_HOMESERVER.md`.

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
