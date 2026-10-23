# Self-hosting the backend on the homeserver

Run the backend as a Docker container on the Ubuntu (Proxmox) box and expose
it publicly with a **Cloudflare Tunnel** at `https://api.haziqhilmi.com`, so the
Vercel-hosted frontend can reach it at a stable HTTPS URL with no port open on
the home network.

```
Browser on mtg.haziqhilmi.com      Browser on a Vercel preview
            │                                  │
            │                                  ▼
            │                       Vercel (/api/* rewrite)
            ▼                                  │
     https://api.haziqhilmi.com  ◄─────────────┘
            │  Cloudflare Tunnel
            ▼
     cloudflared container  ──>  localhost:8000  ──>  backend container
                                                        └─ ./data (SQLite, images, ck_index.db)
```

The real site calls `api.haziqhilmi.com` directly (`frontend/src/api/http.ts`),
so the backend's `CORS_ORIGINS` must list `https://mtg.haziqhilmi.com`. Vercel
previews use the same-site `/api` route instead, which Vercel rewrites to the
same URL server-side (`frontend/vercel.json`), so they need no CORS. Google
sign-in needs no change: ID tokens are verified server-side whatever the
backend's address.

---

## 1. One-time prerequisites (on the Ubuntu VM)

```bash
# Docker engine + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # log out/in so docker works without sudo
```

The domain's DNS must be on Cloudflare (the free plan is enough).

## 2. Get the code + config

```bash
git clone https://github.com/haziqhilmismail/mtg-scanner.git
cd mtg-scanner/backend

# Create .env from your existing production secrets (NOT committed to git).
# At minimum: GEMINI_API_KEY, GOOGLE_CLIENT_ID, CORS_ORIGINS, REFRESH_CK_TOKEN,
# ALLOWED_EMAILS (optional), JWT_SECRET (see step 3 about reusing the existing
# one), and SCANNER_BACKEND=local with the local scanner's files in data/
# (README "Local scanner").
cp .env.example .env
nano .env
```

## 3. Data

Everything the app keeps lives in `./data`: `app.db` (all orders/listings),
the uploaded files (`scans/`, `posts/`, `orders/`, `payment_qr/`),
`ck_index.db` (CardKingdom prices), the local scanner's `models/` and
`card_index.npz`, and `jwt_secret.txt`. Moving to a new box means copying that
directory (stop the container first for a consistent SQLite copy). Keeping
`jwt_secret.txt` keeps existing logins valid; drop it and everyone just signs
in again.

## 4. Run it

```bash
docker compose up -d --build
docker compose logs -f          # watch startup: migrations, CK index hydrate
curl localhost:8000/api/health  # -> {"ok":true,...}
```

The container restarts automatically on reboot (`restart: unless-stopped`).

## 5. Expose publicly with a Cloudflare Tunnel

cloudflared runs in Docker as your user and keeps its files in `~/.cloudflared`:
the login certificate, the tunnel's credentials and `config.yml`.

```bash
mkdir -p ~/.cloudflared && chmod 700 ~/.cloudflared
CF="docker run --rm -it --user $(id -u):$(id -g) -e HOME=/cfhome -v $HOME/.cloudflared:/cfhome/.cloudflared cloudflare/cloudflared:latest"
$CF tunnel login                                  # open the URL it prints; saves cert.pem
$CF tunnel create mtg-api                         # prints the tunnel ID; saves <TUNNEL-ID>.json
$CF tunnel route dns mtg-api api.haziqhilmi.com   # adds the DNS record for the tunnel
```

Write `~/.cloudflared/config.yml` with that tunnel ID:

```yaml
tunnel: <TUNNEL-ID>
credentials-file: /cfhome/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: api.haziqhilmi.com
    service: http://127.0.0.1:8000
  - service: http_status:404
```

Then start it. `--network host` lets it reach the container's port on the
host's loopback; `--restart unless-stopped` brings it back after a reboot.

```bash
docker run -d --name mtg-api-tunnel --restart unless-stopped --network host \
  --user "$(id -u):$(id -g)" -e HOME=/cfhome -v ~/.cloudflared:/cfhome/.cloudflared:ro \
  cloudflare/cloudflared:latest tunnel --no-autoupdate --config /cfhome/.cloudflared/config.yml run
curl https://api.haziqhilmi.com/api/health   # -> {"ok":true,...}
```

## 6. Point the frontend at it

`frontend/vercel.json` rewrites `/api/*` to the tunnel:

```json
{ "source": "/api/:path*", "destination": "https://api.haziqhilmi.com/api/:path*" }
```

and `frontend/src/api/http.ts` sends the real site's calls straight to
`https://api.haziqhilmi.com`. Vercel builds the frontend from this repo (Root
Directory `frontend`) on every push to `main`.

---

## Updating later

By hand:

```bash
git pull
docker compose up -d --build
```

### Auto-deploy (pull + rebuild on a timer)

`deploy.sh` + the units in `deploy/` poll `origin/main` and, when it moves,
fast-forward, rebuild the container, and prune the old image. One-time setup on
the VM (after the units exist in your checkout; first fix the paths in
`deploy/mtg-deploy.service` if yours differ):

```bash
cd ~/mtg-scanner/backend
git pull --ff-only                 # fetch deploy.sh + deploy/*.{service,timer}
chmod +x deploy.sh
sudo cp deploy/mtg-deploy.service deploy/mtg-deploy.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mtg-deploy.timer
```

Check it / trigger a deploy immediately:

```bash
systemctl list-timers mtg-deploy.timer        # next scheduled run
sudo systemctl start mtg-deploy.service       # run once now
journalctl -u mtg-deploy.service -n 30 --no-pager
```

A failed build leaves the running container in place (compose only swaps after
a clean build). A push lands on the homeserver within ~5 min, no manual step,
except a change to how the server runs the app (`docker-compose.yml`,
`Dockerfile`, `.dockerignore`, `deploy.sh`, `deploy/`, `requirements*.txt`): the
timer holds it, and logs "held", until someone reviews it and runs
`DEPLOY_INFRA=1 ./deploy.sh`. For deeper disk cleanup occasionally: `docker system prune -af` (removes
*all* unused images + build cache; the next build re-pulls the base image).

## Notes / caveats

- **CardKingdom refresh** runs in-app: `POST /api/refresh-ck`, triggered nightly
  by `.github/workflows/ck-refresh.yml`, which sends the `REFRESH_CK_TOKEN` repo
  secret; set the same value in `.env`.
- **Rate limiting** (slowapi) is per signed-in user. Every request arrives from
  the same proxy address, so anonymous calls share one bucket.
- **Uptime** is now on you — if the VM/Proxmox host is down, the app is down.
- **Backups**: `./data/app.db` is your whole business state. Snapshot it
  (Proxmox snapshot or a nightly `cp`/`litestream`) so a disk loss isn't fatal.
