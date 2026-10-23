#!/usr/bin/env bash
#
# Auto-deploy hook for the homeserver. Polls origin/main; when it moves,
# fast-forwards, rebuilds the container (Docker layer cache keeps unchanged
# builds fast), and prunes the now-dangling old image so disk doesn't creep.
#
# Idempotent — a no-op when already up to date, so it's safe to run on a timer
# (see deploy/mtg-deploy.timer) or by hand. A failed build leaves the running
# container untouched: `docker compose up` only swaps it in after the build
# succeeds, so a bad push never takes the app down.
#
set -euo pipefail

# Resolve the repo root from the script's own location so the timer can invoke
# it by absolute path regardless of the working directory.
cd "$(dirname "$(readlink -f "$0")")"

BRANCH=main

git fetch --quiet origin "$BRANCH"
local_sha=$(git rev-parse HEAD)
remote_sha=$(git rev-parse "origin/$BRANCH")

if [ "$local_sha" = "$remote_sha" ]; then
  echo "$(date -Is) [deploy] up to date @ ${local_sha:0:8}"
  exit 0
fi

# A change to how the server runs the app (container setup, dependencies, this
# script, the timer) never goes live by itself: the timer stops here until
# someone has read it and runs `DEPLOY_INFRA=1 ./deploy.sh` by hand.
infra=$(git diff --name-only "$local_sha" "$remote_sha" -- docker-compose.yml Dockerfile .dockerignore deploy.sh deploy/ 'requirements*.txt' | tr '\n' ' ')
if [ -n "$infra" ] && [ "${DEPLOY_INFRA:-}" != 1 ]; then
  echo "$(date -Is) [deploy] held @ ${remote_sha:0:8}: server setup changed (${infra% }); review, then run DEPLOY_INFRA=1 $0"
  exit 0
fi

echo "$(date -Is) [deploy] ${local_sha:0:8} -> ${remote_sha:0:8}, deploying"
# --ff-only refuses to clobber local commits: if tower has diverged it fails
# loudly instead of silently merging. (.env and data/ are gitignored, so a
# clean tower tree fast-forwards fine.)
git merge --ff-only "origin/$BRANCH"

docker compose up -d --build
docker image prune -f >/dev/null   # drop the old, now-untagged image
echo "$(date -Is) [deploy] done @ ${remote_sha:0:8}"
