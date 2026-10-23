#!/usr/bin/env bash
#
# Nightly backup, run by deploy/mtg-backup.timer; install and restore steps are
# in DEPLOY_HOMESERVER.md. Every dated backup is deleted after $KEEP_DAYS days,
# as PRIVACY.md promises.
set -euo pipefail
umask 077   # the backups hold personal data: only this user may read them
cd "$(dirname "$(readlink -f "$0")")/.."   # backend/

env_value() { [ -f .env ] && sed -n "s/^$1=//p" .env | tr -d "\"'\r" || true; }
BACKUP_DIR=${BACKUP_DIR:-$HOME/backups/mtg-scanner}
NAS_DIR=$(env_value BACKUP_NAS_DIR)   # blank: the backups stay on this disk only
KEEP_DAYS=30   # the number in PRIVACY.md: change both together
export TZ=Asia/Kuala_Lumpur
day=$(date +%F)
oldest=$(date -d "-$((KEEP_DAYS - 1)) days" +%F)   # the oldest day kept
tmp=$BACKUP_DIR/.app.db.tmp   # one fixed name, so a crashed run's copy is removed by the next run

alert() {
  local token chat
  token=$(env_value TELEGRAM_BOT_TOKEN)
  chat=$(env_value TELEGRAM_CHAT_ID)
  if [ -z "$token" ] || [ -z "$chat" ]; then echo "[backup] no TELEGRAM_* in .env: the alert was not sent"; return 0; fi
  curl -fsS -m 20 "https://api.telegram.org/bot$token/sendMessage" -d chat_id="$chat" \
    --data-urlencode text="$1" >/dev/null || echo "[backup] the Telegram alert was not sent"
}
# EXIT, not ERR: it runs once per run, also for a failure inside a function or $(...).
trap 'rc=$?; rm -f "$tmp" "$tmp.gz"
  [ "$rc" = 0 ] || { echo "[backup] FAILED: $BASH_COMMAND"; alert "MTG scanner backup FAILED on $(hostname): $BASH_COMMAND"; }' EXIT

# Names carry the date, and ISO dates sort as text, so no file times are trusted.
prune() {  # prune DIR [PREFIX]
  local f
  for f in "$1/${2-}"20*; do
    if [[ -e $f && ${f##*/} < ${2-}$oldest ]]; then rm -rf -- "$f"; echo "[backup] pruned $f"; fi
  done
}

# Prune first: a failed night still deletes what is due, and a full disk gets
# its space back. A NAS that is down matches nothing, so this cannot fail on it.
prune "$BACKUP_DIR" app-
if [ -n "$NAS_DIR" ]; then
  prune "$NAS_DIR/db" app-
  prune "$NAS_DIR/files-changed"
fi

mkdir -p "$BACKUP_DIR"
rm -f "$tmp"
# -readonly: a missing app.db is an error, not a new empty database.
sqlite3 -readonly data/app.db ".timeout 10000" ".backup '$tmp'"
check=$(sqlite3 "$tmp" "PRAGMA integrity_check;")
[ "$check" = ok ] || { echo "[backup] integrity_check: $check"; false; }
# A 0-byte app.db copies as an empty database, and integrity_check passes that.
sqlite3 "$tmp" "SELECT 1 FROM alembic_version;" >/dev/null
gzip -c "$tmp" > "$tmp.gz"
mv "$tmp.gz" "$BACKUP_DIR/app-$day.db.gz"   # whole files only: never a half-written backup
echo "[backup] database: $BACKUP_DIR/app-$day.db.gz ($(du -h "$BACKUP_DIR/app-$day.db.gz" | cut -f1))"

if [ -z "$NAS_DIR" ]; then
  echo "[backup] no BACKUP_NAS_DIR in .env: the database backups stay on this disk only"
  exit 0
fi
mkdir -p "$NAS_DIR/db"
# rsync writes under a temp name and renames; sending every kept night also
# fills in the nights the NAS was down.
rsync -t "$BACKUP_DIR"/app-*.db.gz "$NAS_DIR/db/"
# -rt, not -a: an SMB share can't take Linux owners and modes. The folder takes
# the date of the last backup that still had the files, so they also go after 30 days.
# shortcut: the upload folders are listed by name; add a new one here too.
rsync -rt --modify-window=2 --delete --backup --backup-dir="$NAS_DIR/files-changed/$(date -d yesterday +%F)" \
  data/scans data/posts data/orders data/payment_qr "$NAS_DIR/files/"
echo "[backup] done for $day"
