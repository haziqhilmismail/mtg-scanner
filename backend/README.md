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
