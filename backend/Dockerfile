FROM python:3.12-slim

# Pillow wheels on python:3.12-slim already bundle libjpeg/zlib, so no apt step.
# If you ever swap to a non-slim base, also remove this comment.

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
