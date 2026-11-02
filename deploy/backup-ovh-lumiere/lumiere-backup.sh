#!/usr/bin/env bash
# Lumière Student Portal: nightly database backup on the OVH VPS (S34, S33-09 follow-up).
#
# Runs as the `lpbackup` systemd service (see lumiere-backup.service). For one run it:
#   1. dumps the production Supabase database (schemas public, auth, storage metadata) with pg_dump, read-only;
#   2. checks that the dump is readable (pg_restore --list) and contains the core tables;
#   3. encrypts it with age to BOTH the owner's offline recovery key and the VPS operational key;
#   4. decrypts it again with the operational key and compares SHA-256 (verifies the encrypted copy);
#   5. stores the encrypted file plus a manifest, deletes the plaintext, and applies retention (KEEP_DAYS, always keeping
#      the newest 3 copies);
#   6. writes last-run.json (status, time, sizes, hashes; no secrets, no data).
#
# Secrets arrive only as systemd credentials in $CREDENTIALS_DIRECTORY: `dburl` (the database URL) and `agekey`
# (the operational age identity). The URL is never put on a command line: it is split into libpq environment variables
# and a private pgpass file in a per-run temporary directory.
set -euo pipefail
umask 077

DATA=${LUMIERE_BACKUP_DIR:-/var/backups/lumiere-portal}
RECIPIENTS=${LUMIERE_BACKUP_RECIPIENTS:-/etc/lumiere-backup/recipients.txt}
KEEP_DAYS=${LUMIERE_BACKUP_KEEP_DAYS:-14}
KEEP_MIN=${LUMIERE_BACKUP_KEEP_MIN:-3}
PG_BIN=${LUMIERE_PG_BIN:-/usr/lib/postgresql/18/bin}
EXPECT_REF=${LUMIERE_EXPECT_REF:-rheronevecsffaejteoj}
CRED=${CREDENTIALS_DIRECTORY:?CREDENTIALS_DIRECTORY not set (run through systemd)}
REQUIRED_TABLES=${LUMIERE_REQUIRED_TABLES:-"public students|public users|auth users"}

TS=$(date -u +%Y%m%dT%H%M%SZ)
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
NAME="lumiere-portal-$TS.dump.age"
mkdir -p "$DATA"
# Two runs in the same second (manual run during a timer run) must never overwrite each other.
[ -e "$DATA/$NAME" ] && NAME="lumiere-portal-$TS-$$.dump.age"
WORK=$(mktemp -d "$DATA/.work-XXXXXX")
trap 'rm -rf "$WORK"' EXIT

fail() {
  printf '{"status":"FAIL","startedAt":"%s","finishedAt":"%s","error":"%s"}\n' "$START" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" > "$DATA/last-run.json"
  echo "lumiere-backup FAILED: $1" >&2
  exit 1
}

# --- connection: URL -> libpq env + private pgpass (password never in argv or in the log) -------------------------
URL=$(cat "$CRED/dburl")
case "$URL" in *"$EXPECT_REF"*) ;; *) fail "database URL does not identify project $EXPECT_REF" ;; esac
ENVLINES=$(URL="$URL" WORK="$WORK" python3 - <<'PY'
import os, shlex, urllib.parse as u
p = u.urlsplit(os.environ["URL"])
if p.scheme not in ("postgres", "postgresql") or not p.hostname or not p.username:
    raise SystemExit(1)
q = dict(u.parse_qsl(p.query))
user, pw = u.unquote(p.username or ""), u.unquote(p.password or "")
host, port, db = p.hostname or "", str(p.port or 5432), (p.path.lstrip("/") or "postgres")
pgpass = os.path.join(os.environ["WORK"], "pgpass")
esc = lambda s: s.replace("\\", "\\\\").replace(":", "\\:")
with open(pgpass, "w") as f:
    f.write(f"{esc(host)}:{port}:{esc(db)}:{esc(user)}:{esc(pw)}\n")
os.chmod(pgpass, 0o600)
for k, v in (("PGHOST", host), ("PGPORT", port), ("PGDATABASE", db), ("PGUSER", user),
             ("PGSSLMODE", q.get("sslmode", "require")), ("PGPASSFILE", pgpass)):
    print(f"export {k}={shlex.quote(v)}")
PY
) || fail "database URL could not be parsed"
eval "$ENVLINES"
unset URL ENVLINES
export PGCONNECT_TIMEOUT=30 PGAPPNAME=lumiere-backup

# --- 1. dump (read-only) ---------------------------------------------------------------------------------------------
"$PG_BIN/pg_dump" -Fc --no-owner --no-privileges -n public -n auth -n storage -f "$WORK/db.dump" 2> "$WORK/pg_dump.err" \
  || fail "pg_dump failed: $(head -c 300 "$WORK/pg_dump.err" | tr '\n"' '  ')"

# --- 2. readability + core tables --------------------------------------------------------------------------------------
"$PG_BIN/pg_restore" --list "$WORK/db.dump" > "$WORK/toc.txt" || fail "pg_restore --list could not read the dump"
TABLES=$(grep -c ' TABLE DATA ' "$WORK/toc.txt" || true)
IFS='|' read -r -a REQ <<< "$REQUIRED_TABLES"
for t in "${REQ[@]}"; do
  grep -q " TABLE DATA $t " "$WORK/toc.txt" || fail "dump is missing table data for: $t"
done
PLAIN_SHA=$(sha256sum "$WORK/db.dump" | cut -d' ' -f1)
PLAIN_BYTES=$(stat -c %s "$WORK/db.dump")

# --- 3. encrypt to every recipient (offline recovery key + operational key) -------------------------------------------
NREC=$(grep -c '^age1' "$RECIPIENTS" || true)
[ "$NREC" -ge 2 ] || fail "recipients file must list the offline and the operational key"
age -R "$RECIPIENTS" -o "$WORK/$NAME" "$WORK/db.dump" || fail "age encryption failed"
STANZAS=$(head -c 4096 "$WORK/$NAME" | grep -ac '^-> X25519' || true)
[ "$STANZAS" -eq "$NREC" ] || fail "encrypted file has $STANZAS key stanzas, expected $NREC"

# --- 4. verify: decrypt with the operational key and compare -----------------------------------------------------------
CHECK_SHA=$(age -d -i "$CRED/agekey" "$WORK/$NAME" | sha256sum | cut -d' ' -f1)
[ "$CHECK_SHA" = "$PLAIN_SHA" ] || fail "decrypt-verify mismatch"
CIPHER_SHA=$(sha256sum "$WORK/$NAME" | cut -d' ' -f1)
CIPHER_BYTES=$(stat -c %s "$WORK/$NAME")
rm -f "$WORK/db.dump"

# --- 5. store + manifest + retention ------------------------------------------------------------------------------------
SERVER_VERSION=$("$PG_BIN/psql" -XAtc 'show server_version' 2>/dev/null || echo unknown)
mv "$WORK/$NAME" "$DATA/$NAME"
cat > "$DATA/$NAME.json" <<EOF
{"file":"$NAME","createdAt":"$START","schemas":["public","auth","storage"],"tablesWithData":$TABLES,
 "plainSha256":"$PLAIN_SHA","plainBytes":$PLAIN_BYTES,"cipherSha256":"$CIPHER_SHA","cipherBytes":$CIPHER_BYTES,
 "recipients":$NREC,"verified":"decrypted with the operational key, SHA-256 matches","serverVersion":"$SERVER_VERSION",
 "pgDump":"$("$PG_BIN/pg_dump" --version)"}
EOF
mapfile -t ALL < <(ls -1t "$DATA"/lumiere-portal-*.dump.age 2>/dev/null)
DELETED=0
for ((i = KEEP_MIN; i < ${#ALL[@]}; i++)); do
  f=${ALL[$i]}
  if [ -n "$(find "$f" -maxdepth 0 -mtime +"$KEEP_DAYS")" ]; then rm -f "$f" "$f.json"; DELETED=$((DELETED + 1)); fi
done

# --- 6. last-run.json ---------------------------------------------------------------------------------------------------
KEPT=$(ls -1 "$DATA"/lumiere-portal-*.dump.age 2>/dev/null | wc -l)
printf '{"status":"PASS","startedAt":"%s","finishedAt":"%s","file":"%s","tablesWithData":%s,"cipherBytes":%s,"kept":%s,"deleted":%s}\n' \
  "$START" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$NAME" "$TABLES" "$CIPHER_BYTES" "$KEPT" "$DELETED" > "$DATA/last-run.json"
echo "lumiere-backup OK: $NAME ($CIPHER_BYTES bytes, $TABLES tables with data, kept $KEPT, deleted $DELETED)"
