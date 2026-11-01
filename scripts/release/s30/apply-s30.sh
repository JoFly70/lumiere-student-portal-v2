#!/usr/bin/env bash
# S30 PRODUCTION schema release for Supabase project rheronevecsffaejteoj (operations, imports, calendar tables).
# Mirrors scripts/release/s26/apply-production.sh safety:
#
#   bash scripts/release/s30/apply-s30.sh --check                                   # identity + state, read-only
#   bash scripts/release/s30/apply-s30.sh --apply --i-understand-this-writes-to-production
#
# Uses DATABASE_URL (never printed). Refuses unless the connection identifies project rheronevecsffaejteoj and the
# database looks like production (60+ public tables). --apply takes a pg_dump backup first, records row counts,
# applies ONLY supabase/migrations/20261106100000_s30_operations_academic.sql (additive, idempotent), checks that no
# existing table lost rows, then post-verifies the 10 new tables (present, RLS on, no client privileges) and the 11 audit event types.
set -euo pipefail
cd "$(dirname "$0")/../../.."

REF=rheronevecsffaejteoj
MODE="${1:-}"
CONFIRM="${2:-}"
FILE=supabase/migrations/20261106100000_s30_operations_academic.sql
OUT=.s26-private-backup
mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG="$OUT/apply-s30-$STAMP.log"

die() { echo "REFUSED: $*" | tee -a "$LOG" >&2; exit 2; }
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is not set"
case "$DATABASE_URL" in
  postgres://postgres.$REF:*@*.pooler.supabase.com:*|postgresql://postgres.$REF:*@*.pooler.supabase.com:*) ;;
  postgres://postgres:*@db.$REF.supabase.co:*|postgresql://postgres:*@db.$REF.supabase.co:*) ;;
  *) die "DATABASE_URL does not identify Supabase project $REF (user/host mismatch)";;
esac
[ -f "$FILE" ] || die "$FILE is missing"
PSQL=(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -P pager=off)
TABLES=$("${PSQL[@]}" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
echo "identity: project $REF; public base tables: $TABLES" | tee -a "$LOG"
[ "$TABLES" -ge 60 ] || die "only $TABLES public tables; this does not look like the production database"
"${PSQL[@]}" -At -c "SELECT to_regclass('public.student_agreements') IS NOT NULL AND to_regclass('public.students') IS NOT NULL" | grep -q t || die "prerequisite tables (students, student_agreements) are missing; apply the S27 release first"

ENUMS="SELECT 'audit_event_types (11) | ' || ((SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'audit_event_type' AND e.enumlabel IN ('ops.exception_updated','ops.access_denied','ops.fleet_ai_queried','import.batch_uploaded','import.batch_approved','import.batch_committed','import.batch_rolled_back','import.batch_discarded','import.mapping_saved','calendar.event_changed','calendar.subscription_changed')) = 11)::text"
POSTVERIFY="SELECT t.name || ' | ' || (c.oid IS NOT NULL AND c.relrowsecurity AND NOT has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))::text
  FROM (VALUES ('ops_events'),('ops_exception_states'),('ops_notifications'),('ops_runs'),('academic_import_mappings'),('academic_import_batches'),('academic_import_rows'),('academic_reported_records'),('calendar_events'),('calendar_subscriptions')) AS t(name)
  LEFT JOIN pg_class c ON c.relname = t.name AND c.relnamespace = 'public'::regnamespace"

if [ "$MODE" = "--check" ]; then
  CHECK=$( { "${PSQL[@]}" -At -c "$POSTVERIFY"; "${PSQL[@]}" -At -c "$ENUMS"; } | tee -a "$LOG")
  # Exit 0 only when everything is applied: 10 tables (RLS on, no client privileges) and all 11 enum values.
  [ "$(echo "$CHECK" | grep -c '| true$')" = "11" ] && { echo "S30 check: APPLIED"; exit 0; }
  echo "S30 check: NOT FULLY APPLIED"; exit 1
fi
[ "$MODE" = "--apply" ] && [ "$CONFIRM" = "--i-understand-this-writes-to-production" ] || die "usage: --check | --apply --i-understand-this-writes-to-production"

counts() {
  "${PSQL[@]}" -At -c "SELECT c.relname || '=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
                         FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')" | LC_ALL=C sort
}

# The backup tools must be at least the server's major version (pg_dump refuses an older client). When the
# workspace's pg_dump is older, run the matching postgresql_<major> from nix; the URL stays in the environment.
SERVER_MAJOR=$("${PSQL[@]}" -At -c "SELECT current_setting('server_version_num')::int / 10000")
DUMP_MAJOR=$(pg_dump --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)
export S30_DUMP_FILE="$OUT/public-s30-$STAMP.dump"
BACKUP='pg_dump "$DATABASE_URL" --schema=public --no-owner --no-privileges -Fc -f "$S30_DUMP_FILE" && pg_restore -l "$S30_DUMP_FILE" > /dev/null'
if [ -n "$DUMP_MAJOR" ] && [ "$DUMP_MAJOR" -ge "$SERVER_MAJOR" ]; then
  echo "backup tools: pg_dump $DUMP_MAJOR for server $SERVER_MAJOR" | tee -a "$LOG"
  bash -c "$BACKUP" || die "backup failed or is unreadable"
else
  command -v nix-shell >/dev/null || die "pg_dump ${DUMP_MAJOR:-missing} is older than server $SERVER_MAJOR and nix-shell is unavailable"
  echo "backup tools: nix postgresql_$SERVER_MAJOR (workspace pg_dump ${DUMP_MAJOR:-missing} is older than server $SERVER_MAJOR)" | tee -a "$LOG"
  nix-shell -p "postgresql_$SERVER_MAJOR" --run "$BACKUP" || die "backup with nix postgresql_$SERVER_MAJOR failed or is unreadable"
fi
[ -s "$S30_DUMP_FILE" ] || die "backup file is missing or empty"
counts > "$OUT/rowcounts-s30-before-$STAMP.txt"
echo "backup: $OUT/public-s30-$STAMP.dump ($(du -h "$OUT/public-s30-$STAMP.dump" | cut -f1))" | tee -a "$LOG"

echo "apply: $FILE" | tee -a "$LOG"
"${PSQL[@]}" -f "$FILE" >> "$LOG"

counts > "$OUT/rowcounts-s30-after-$STAMP.txt"
LOST=$(LC_ALL=C join -t= "$OUT/rowcounts-s30-before-$STAMP.txt" "$OUT/rowcounts-s30-after-$STAMP.txt" | awk -F= '$3 < $2 {print $1": "$2" -> "$3}')
[ -z "$LOST" ] || { echo "$LOST" | tee -a "$LOG"; die "rows decreased after migration; restore from $OUT/public-s30-$STAMP.dump"; }
echo "row preservation: PASS" | tee -a "$LOG"

{ "${PSQL[@]}" -At -c "$POSTVERIFY"; "${PSQL[@]}" -At -c "$ENUMS"; } > "$OUT/postverify-s30-$STAMP.txt"
cat "$OUT/postverify-s30-$STAMP.txt" | tee -a "$LOG"
[ "$(grep -c '| true$' "$OUT/postverify-s30-$STAMP.txt")" = "11" ] || die "post-verify: the 10 S30 tables are not all present with RLS on and no client privileges, or the 11 audit event types are missing"
echo "post-verify: PASS (10 tables present, RLS on, no client privileges, 11 audit event types)" | tee -a "$LOG"
echo "S30 production schema release: DONE" | tee -a "$LOG"
