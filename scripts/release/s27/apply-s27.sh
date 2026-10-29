#!/usr/bin/env bash
# S27 PRODUCTION schema release for Supabase project rheronevecsffaejteoj (program journey tables).
# Mirrors scripts/release/s26/apply-production.sh safety:
#
#   bash scripts/release/s27/apply-s27.sh --check                                   # identity + state, read-only
#   bash scripts/release/s27/apply-s27.sh --apply --i-understand-this-writes-to-production
#
# Uses DATABASE_URL (never printed). Refuses unless the connection identifies project rheronevecsffaejteoj and the
# database looks like production (60+ public tables). --apply takes a pg_dump backup first, records row counts,
# applies ONLY supabase/migrations/20261105100000_s27_program_journey.sql (additive, idempotent), checks that no
# existing table lost rows, then post-verifies the 4 new tables (present, RLS on, no client privileges).
set -euo pipefail
cd "$(dirname "$0")/../../.."

REF=rheronevecsffaejteoj
MODE="${1:-}"
CONFIRM="${2:-}"
FILE=supabase/migrations/20261105100000_s27_program_journey.sql
OUT=.s26-private-backup
mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG="$OUT/apply-s27-$STAMP.log"

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
"${PSQL[@]}" -At -c "SELECT to_regclass('public.hs_enrollments') IS NOT NULL AND to_regclass('public.students') IS NOT NULL" | grep -q t || die "prerequisite tables (students, hs_enrollments) are missing; apply the S26 release first"

ENUMS="SELECT 'audit_event_types (6) and notes order column | ' || ((SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'audit_event_type' AND e.enumlabel IN ('program.agreement_updated','program.checkpoint_updated','program.session_requested','program.session_updated','program.note_added','program.access_denied')) = 6
  AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'student_staff_notes' AND column_name = 'seq'))::text"
POSTVERIFY="SELECT t.name || ' | ' || (c.oid IS NOT NULL AND c.relrowsecurity AND NOT has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))::text
  FROM (VALUES ('student_agreements'),('student_checkpoints'),('orientation_sessions'),('student_staff_notes')) AS t(name)
  LEFT JOIN pg_class c ON c.relname = t.name AND c.relnamespace = 'public'::regnamespace"

if [ "$MODE" = "--check" ]; then
  CHECK=$( { "${PSQL[@]}" -At -c "$POSTVERIFY"; "${PSQL[@]}" -At -c "$ENUMS"; } | tee -a "$LOG")
  # Exit 0 only when everything is applied: 4 tables (RLS on, no client privileges) and all 6 enum values.
  [ "$(echo "$CHECK" | grep -c '| true$')" = "5" ] && { echo "S27 check: APPLIED"; exit 0; }
  echo "S27 check: NOT FULLY APPLIED"; exit 1
fi
[ "$MODE" = "--apply" ] && [ "$CONFIRM" = "--i-understand-this-writes-to-production" ] || die "usage: --check | --apply --i-understand-this-writes-to-production"

counts() {
  "${PSQL[@]}" -At -c "SELECT c.relname || '=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
                         FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')" | LC_ALL=C sort
}

pg_dump "$DATABASE_URL" --schema=public --no-owner --no-privileges -Fc -f "$OUT/public-s27-$STAMP.dump"
pg_restore -l "$OUT/public-s27-$STAMP.dump" > /dev/null || die "backup is unreadable"
counts > "$OUT/rowcounts-s27-before-$STAMP.txt"
echo "backup: $OUT/public-s27-$STAMP.dump ($(du -h "$OUT/public-s27-$STAMP.dump" | cut -f1))" | tee -a "$LOG"

echo "apply: $FILE" | tee -a "$LOG"
"${PSQL[@]}" -f "$FILE" >> "$LOG"

counts > "$OUT/rowcounts-s27-after-$STAMP.txt"
LOST=$(LC_ALL=C join -t= "$OUT/rowcounts-s27-before-$STAMP.txt" "$OUT/rowcounts-s27-after-$STAMP.txt" | awk -F= '$3 < $2 {print $1": "$2" -> "$3}')
[ -z "$LOST" ] || { echo "$LOST" | tee -a "$LOG"; die "rows decreased after migration; restore from $OUT/public-s27-$STAMP.dump"; }
echo "row preservation: PASS" | tee -a "$LOG"

{ "${PSQL[@]}" -At -c "$POSTVERIFY"; "${PSQL[@]}" -At -c "$ENUMS"; } > "$OUT/postverify-s27-$STAMP.txt"
cat "$OUT/postverify-s27-$STAMP.txt" | tee -a "$LOG"
[ "$(grep -c '| true$' "$OUT/postverify-s27-$STAMP.txt")" = "5" ] || die "post-verify: the 4 S27 tables are not all present with RLS on and no client privileges, or the 6 audit event types are missing"
echo "post-verify: PASS (4 tables present, RLS on, no client privileges, 6 audit event types)" | tee -a "$LOG"
echo "S27 production schema release: DONE" | tee -a "$LOG"
