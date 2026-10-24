#!/usr/bin/env bash
# Tests backup.sh on a fake backend folder, with `date` fixed to chosen days:
# the 30-day rule that PRIVACY.md promises, the NAS mirror, and the failure
# alert. Needs sqlite3, rsync and gzip. Run: backend/deploy/test_backup.sh
set -euo pipefail
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/backend/deploy" "$T/backend/data/"{scans,posts,orders,payment_qr,corrections}
cp "$(dirname "$(readlink -f "$0")")/backup.sh" "$T/backend/deploy/"
sqlite3 "$T/backend/data/app.db" "CREATE TABLE alembic_version(v); CREATE TABLE users(email);"
echo photo > "$T/backend/data/scans/1.bin"
echo crop > "$T/backend/data/corrections/a1.jpg"
printf 'BACKUP_NAS_DIR=%s\nTELEGRAM_BOT_TOKEN=t\nTELEGRAM_CHAT_ID=1\n' "$T/nas" > "$T/backend/.env"

cat > "$T/bin/date" <<EOF
#!/usr/bin/env bash
args=(); have_d=0
while [ \$# -gt 0 ]; do
  if [ "\$1" = -d ]; then args+=(-d "\$FAKE_DAY \$2"); have_d=1; shift 2; else args+=("\$1"); shift; fi
done
[ \$have_d = 1 ] || args=(-d "\$FAKE_DAY" "\${args[@]}")
exec $(command -v date) "\${args[@]}"
EOF
cat > "$T/bin/sqlite3" <<EOF
#!/usr/bin/env bash
[ "\${FAIL_CHECK:-}" = 1 ] && [[ "\$*" == *integrity_check* ]] && { echo malformed; exit 11; }
exec $(command -v sqlite3) "\$@"
EOF
printf '#!/usr/bin/env bash\necho "$*" >> %s/curl.log\n' "$T" > "$T/bin/curl"
chmod +x "$T/bin/"* "$T/backend/deploy/backup.sh"

run() { PATH="$T/bin:$PATH" FAKE_DAY=$1 BACKUP_DIR="$T/local" "$T/backend/deploy/backup.sh" >/dev/null; }
ok() { "$@" || { echo "FAIL (line ${BASH_LINENO[0]}): $*"; exit 1; }; }

run 2026-01-01
ok test -f "$T/local/app-2026-01-01.db.gz"
ok test -f "$T/nas/db/app-2026-01-01.db.gz"
ok test -f "$T/nas/files/scans/1.bin"
ok test -f "$T/nas/files/corrections/a1.jpg"

# A deleted photo is kept under the date of the last backup that had it.
rm "$T/backend/data/scans/1.bin"
run 2026-01-02
ok test -f "$T/nas/files-changed/2026-01-01/scans/1.bin"

# Day 30 still holds the first night; day 31 deletes it everywhere.
run 2026-01-30
ok test -f "$T/local/app-2026-01-01.db.gz"
run 2026-01-31
ok test ! -e "$T/local/app-2026-01-01.db.gz"
ok test ! -e "$T/nas/db/app-2026-01-01.db.gz"
ok test ! -e "$T/nas/files-changed/2026-01-01"

# A failed night sends one alert, leaves no temp copy, and still deletes what is due.
if FAIL_CHECK=1 run 2026-03-15; then echo "FAIL: a bad copy passed"; exit 1; fi
ok test "$(wc -l < "$T/curl.log")" = 1
ok test -z "$(ls -A "$T/local")"

# No BACKUP_NAS_DIR: the copy stays on this disk only.
sed -i '/^BACKUP_NAS_DIR=/d' "$T/backend/.env"
run 2026-03-16
ok test -f "$T/local/app-2026-03-16.db.gz"
ok test ! -e "$T/nas/db/app-2026-03-16.db.gz"
echo "backup.sh: all checks passed"
