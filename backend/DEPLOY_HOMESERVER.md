# Self-hosting the backend on the homeserver

Run `mtg-scanner-backend` as a Docker container on the Ubuntu (Proxmox) box and
expose it publicly with **Tailscale Funnel**, so the Vercel-hosted frontend can
keep reaching it at a stable HTTPS URL.

```
Browser ──HTTPS──> Vercel (React app, /api/* rewrite)
                      │
                      ▼  https://<host>.<tailnet>.ts.net
              Tailscale Funnel  ──>  localhost:8000  ──>  Docker container
                                                              └─ ./data (SQLite, images, ck_index.db)
```

Why this works: the browser only ever talks to the Vercel domain. Vercel rewrites
`/api/*` to the Funnel URL server-side, so it's same-origin to the browser — no
CORS, and no Google-OAuth changes (ID tokens are verified server-side regardless
of the backend's address).

---

## 1. One-time prerequisites (on the Ubuntu VM)

```bash
# Docker engine + compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # log out/in so docker works without sudo

# Tailscale is already installed. Enable Funnel for this node in the admin
# console: https://login.tailscale.com/admin/dns  -> enable HTTPS certificates,
# and https://login.tailscale.com/admin/acls -> ensure the node has the
# "funnel" attribute (nodeAttrs). Then confirm:
tailscale status
```

## 2. Get the code + config

```bash
git clone git@github.com:haziqhilmismail/mtg-scanner-backend.git
cd mtg-scanner-backend

# Create .env from your existing production secrets (NOT committed to git).
# At minimum: GEMINI_API_KEY, GOOGLE_CLIENT_ID, ALLOWED_EMAILS (optional),
# JWT_SECRET (see step 3 about reusing the existing one).
cp .env.example .env
nano .env
```

## 3. Data

Everything the app keeps lives in `./data`: `app.db` (all orders/listings),
`scans/`, `posts/`, `orders/`, `ck_index.db` (CardKingdom prices), and
`jwt_secret.txt`. Moving to a new box means copying that directory (stop the
container first for a consistent SQLite copy). Keeping `jwt_secret.txt` keeps
existing logins valid; drop it and everyone just signs in again.

## 4. Run it

```bash
docker compose up -d --build
docker compose logs -f          # watch startup: migrations, CK index hydrate
curl localhost:8000/api/health  # -> {"ok":true,...}
```

The container restarts automatically on reboot (`restart: unless-stopped`).

## 5. Expose publicly with Tailscale Funnel

```bash
sudo tailscale funnel --bg 8000     # serve localhost:8000 to the public internet
tailscale funnel status             # prints the public https://<host>.<tailnet>.ts.net URL
```

Copy that `https://<host>.<tailnet>.ts.net` URL — the frontend's `vercel.json`
rewrite gets pointed at it (one-line change, then redeploy the frontend).

## 6. Point the frontend at it

In `frontend/vercel.json`, the rewrite destination is:

```json
{ "source": "/api/:path*", "destination": "https://<host>.<tailnet>.ts.net/api/:path*" }
```

Commit + push `mtg-scanner-frontend` → Vercel redeploys → traffic now flows to
the homeserver.

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
the VM (after the units exist in your checkout):

```bash
cd ~/mtg-scanner-backend
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
a clean build). A push now lands on the homeserver within ~5 min, no manual
step. For deeper disk cleanup occasionally: `docker system prune -af` (removes
*all* unused images + build cache; the next build re-pulls the base image).

## Notes / caveats

- **CardKingdom refresh** runs in-app: `POST /api/refresh-ck`, triggered nightly
  by `.github/workflows/ck-refresh.yml`.
- **Rate limiting** (slowapi) is per signed-in user. Every request arrives from
  the same proxy address, so anonymous calls share one bucket.
- **Uptime** is now on you — if the VM/Proxmox host is down, the app is down.
- **Backups**: `./data/app.db` is your whole business state. Snapshot it
  (Proxmox snapshot or a nightly `cp`/`litestream`) so a disk loss isn't fatal.
