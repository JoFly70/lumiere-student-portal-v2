#!/usr/bin/env bash
# Lumière Student Portal nightly backup on the OVH VPS (the same host as ClientDesk's backup). Idempotent.
# Run as root from the directory holding this file:   sudo bash install.sh
#   - service user `lpbackup` (no login, no sudo)
#   - operational age identity generated HERE, stored only as a host-encrypted systemd credential (never printed)
#   - every backup is encrypted to BOTH the owner's offline recovery key (the same one ClientDesk uses) and the
#     operational key
#   - the production database URL is typed in hidden (or piped on stdin) and stored only as an encrypted credential
#   - nightly timer at 03:40 UTC; the first backup runs at the end of the install
# Options:  --set-db-url   replace the stored database URL (e.g. after the database password changes)
set -euo pipefail
OFFLINE_RECIPIENT='age16m4afnwtt4wqh3npjk7fpl0u7845k2e0ttq2z4sfqj7wsp04rghq4fus6t'   # owner's offline recovery key (public half)
REF=rheronevecsffaejteoj
HERE=$(cd "$(dirname "$0")" && pwd)
APP=/opt/lumiere-backup; ETC=/etc/lumiere-backup; STORE=/etc/credstore.encrypted; DATA=/var/backups/lumiere-portal
[ "$(id -u)" = 0 ] || { echo "Please run with sudo:  sudo bash install.sh" >&2; exit 1; }

echo "1/6 packages (PostgreSQL 18 client tools, age, python3)"
DEBIAN_FRONTEND=noninteractive apt-get install -y -q postgresql-client-18 age python3 >/dev/null
[ -x /usr/lib/postgresql/18/bin/pg_dump ] || { echo "pg_dump 18 not found after install" >&2; exit 1; }

echo "2/6 service user and folders"
getent group lpbackup >/dev/null || groupadd --system --gid 61205 lpbackup
id lpbackup >/dev/null 2>&1 || useradd --system --uid 61205 --gid 61205 --home-dir "$DATA" --shell /usr/sbin/nologin lpbackup
[ "$(id -u lpbackup)" = 61205 ] || { echo "lpbackup must be uid 61205" >&2; exit 1; }
install -d -o root -g root -m 0755 "$APP"
install -d -o root -g lpbackup -m 0750 "$ETC"
install -d -o root -g root -m 0700 "$STORE"
install -d -o lpbackup -g lpbackup -m 0700 "$DATA"
install -o root -g root -m 0755 "$HERE/lumiere-backup.sh" "$APP/lumiere-backup.sh"
for u in lumiere-backup.service lumiere-backup.timer; do install -o root -g root -m 0644 "$HERE/$u" "/etc/systemd/system/$u"; done

echo "3/6 encryption keys"
if [ ! -s "$STORE/lumiere-backup.agekey" ]; then
  T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
  age-keygen 2>"$T/pub" | systemd-creds encrypt --with-key=host --name=agekey - "$STORE/lumiere-backup.agekey"
  sed -n 's/^Public key: //p' "$T/pub" > "$ETC/operational.recipient"
fi
OP=$(cat "$ETC/operational.recipient")
CHECK=$(systemd-creds decrypt --name=agekey "$STORE/lumiere-backup.agekey" - | age-keygen -y)
[ "$CHECK" = "$OP" ] || { echo "operational identity does not match its recipient" >&2; exit 1; }
printf '%s\n%s\n' "$OFFLINE_RECIPIENT" "$OP" > "$ETC/recipients.txt"
chown root:lpbackup "$ETC/recipients.txt" "$ETC/operational.recipient"; chmod 0640 "$ETC/recipients.txt" "$ETC/operational.recipient"

echo "4/6 database address"
if [ ! -s "$STORE/lumiere-backup.dburl" ] || [ "${1:-}" = "--set-db-url" ]; then
  if [ -t 0 ]; then
    echo "   Paste the Portal's DATABASE_URL (from Replit > Secrets), then press Enter."
    echo "   Nothing will appear on screen while you paste; that is normal."
    IFS= read -rs URL; echo
  else
    IFS= read -r URL
  fi
  URL=$(printf '%s' "$URL" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  case "$URL" in postgres://*|postgresql://*) ;; *) echo "   That does not look like a database address (it should start with postgresql://). Nothing was saved." >&2; exit 1;; esac
  case "$URL" in *"$REF"*) ;; *) echo "   That address is not for the Lumière production project ($REF). Nothing was saved." >&2; exit 1;; esac
  printf '%s' "$URL" | systemd-creds encrypt --with-key=host --name=dburl - "$STORE/lumiere-backup.dburl"
  unset URL
  echo "   saved (encrypted)"
else
  echo "   already stored (use --set-db-url to replace it)"
fi
chmod 0600 "$STORE"/lumiere-backup.*

echo "5/6 nightly schedule"
systemctl daemon-reload
systemctl enable --now lumiere-backup.timer >/dev/null

echo "6/6 first backup now (about a minute)"
if systemctl start lumiere-backup.service; then
  echo
  echo "SUCCESS:"; cat "$DATA/last-run.json"
else
  echo
  echo "The first backup FAILED. Details:"; cat "$DATA/last-run.json" 2>/dev/null || true
  journalctl -u lumiere-backup -n 20 --no-pager || true
  exit 1
fi
echo
systemctl list-timers lumiere-backup.timer --no-pager
echo "operational recipient: $OP"
