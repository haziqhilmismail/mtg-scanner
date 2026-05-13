FROM python:3.12-slim

# Pillow wheels on python:3.12-slim already bundle libjpeg/zlib, so no apt step
# for image codecs. BUT we DO need a TrueType font for `price_overlay.py` —
# `python:3.12-slim` ships with zero fonts, so `ImageFont.truetype(...)` finds
# nothing and falls through to `ImageFont.load_default()`, which is an ~11px
# bitmap that silently ignores the requested size. Result: price pills render
# with tiny text in prod while the macOS dev box (which has Arial) looks fine.
# fonts-dejavu-core (~1.5 MB) installs DejaVuSans-Bold.ttf at the first path
# in price_overlay.FONT_PATH_CANDIDATES, so no Python change is needed.
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so layer caching kicks in on code-only changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend (alembic.ini, migrations/, app/).
COPY . .

# Make sure the data dir exists when no Fly volume is mounted (local docker run).
# When a volume IS mounted at /app/data, it just covers this directory.
RUN mkdir -p /app/data

EXPOSE 8000

# Migrations + user seed + CK pricelist hydrate all run inside FastAPI's
# lifespan, so a single uvicorn process is enough — no entrypoint script needed.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
