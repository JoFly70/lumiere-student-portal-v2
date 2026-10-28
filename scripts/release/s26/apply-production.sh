#!/usr/bin/env bash
# S26 PRODUCTION schema release for Supabase project rheronevecsffaejteoj.
# Order and rationale: docs/recovery/s25-production-migration-plan.md. Owner-authorized (S26 order).
#
#   bash scripts/release/s26/apply-production.sh --check                                   # identity + pre-checks, read-only
#   bash scripts/release/s26/apply-production.sh --apply --i-understand-this-writes-to-production
#
# Uses DATABASE_URL (the production Repl's secret). It is never printed. Refuses to run unless the connection's
# user/host identify project rheronevecsffaejteoj and the database looks like production (66+ public tables).
# --apply first takes a pg_dump backup of the public schema (schema + data) into .s26-private-backup/ (git-ignored),
# records row counts, then applies each file with ON_ERROR_STOP and stops at the first error. Every file is
# additive and idempotent. Afterwards it checks that no existing table lost rows and runs the post-verify.
set -euo pipefail
cd "$(dirname "$0")/../../.."

REF=rheronevecsffaejteoj
MODE="${1:-}"
CONFIRM="${2:-}"
M=supabase/migrations
OUT=.s26-private-backup
mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG="$OUT/apply-$STAMP.log"

die() { echo "REFUSED: $*" | tee -a "$LOG" >&2; exit 2; }
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is not set"
case "$DATABASE_URL" in
  postgres://postgres.$REF:*@*.pooler.supabase.com:*|postgresql://postgres.$REF:*@*.pooler.supabase.com:*) ;;
  postgres://postgres:*@db.$REF.supabase.co:*|postgresql://postgres:*@db.$REF.supabase.co:*) ;;
  *) die "DATABASE_URL does not identify Supabase project $REF (user/host mismatch)";;
esac
PSQL=(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -P pager=off)
TABLES=$("${PSQL[@]}" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
echo "identity: project $REF; public base tables: $TABLES" | tee -a "$LOG"
[ "$TABLES" -ge 60 ] || die "only $TABLES public tables; this does not look like the production database"

counts() {
  "${PSQL[@]}" -At -c "SELECT c.relname || '=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
                         FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')" | LC_ALL=C sort
}

"${PSQL[@]}" -f scripts/release/s25/00-production-prechecks.sql > "$OUT/prechecks-$STAMP.txt"
if grep -q "MISSING - STOP" "$OUT/prechecks-$STAMP.txt"; then
  grep "MISSING - STOP" "$OUT/prechecks-$STAMP.txt" | tee -a "$LOG"; die "a prerequisite is missing (see prechecks)"
fi
echo "pre-checks: PASS (saved $OUT/prechecks-$STAMP.txt)" | tee -a "$LOG"
[ "$MODE" = "--check" ] && exit 0
[ "$MODE" = "--apply" ] && [ "$CONFIRM" = "--i-understand-this-writes-to-production" ] || die "usage: --check | --apply --i-understand-this-writes-to-production"

# 0. Backup and baseline.
pg_dump "$DATABASE_URL" --schema=public --no-owner --no-privileges -Fc -f "$OUT/public-$STAMP.dump"
pg_restore -l "$OUT/public-$STAMP.dump" > /dev/null || die "backup is unreadable"
counts > "$OUT/rowcounts-before-$STAMP.txt"
echo "backup: $OUT/public-$STAMP.dump ($(du -h "$OUT/public-$STAMP.dump" | cut -f1)), $(wc -l < "$OUT/rowcounts-before-$STAMP.txt") tables counted" | tee -a "$LOG"

apply() { echo "apply: $*" | tee -a "$LOG"; "${PSQL[@]}" "$@" >> "$LOG"; }

# 1. S18 billing + S22 account-gate restore in ONE transaction (S18 overwrites is_staff_or_admin() without the
#    active-account check; the S22 file restores it, so no session ever sees the unguarded helper).
COMBINED="$OUT/s18_with_account_gate-$STAMP.sql"
{ echo 'BEGIN;'
  cat "$M/20261030100000_s18_billing_ledger.sql"
  sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' "$M/20261103100000_s22_account_gate_restore.sql"
  echo 'COMMIT;'; } > "$COMBINED"
apply -f "$COMBINED"

# 2-13. One file at a time (enum ADD VALUE files cannot share a transaction with code using the new values).
for f in \
  20261030100100_s18_billing_audit_event_types.sql \
  20261030110000_s18_document_student_message.sql \
  20261031100000_s19_ticket_comment_idempotency.sql \
  20261031110000_s19_billing_corrections.sql \
  20261101100000_s20_billing_evidence_void.sql \
  20261101200000_s20_assistant_usage.sql \
  20261102100000_s21_assistant_conversations.sql \
  20261102110000_s21_document_attachments.sql \
  20261102120000_s21_student_memory.sql \
  20261102130000_s21_student_welcome.sql \
  20261104100000_s25_user_language_preference.sql \
  20261104110000_s25_client_write_lockdown.sql; do
  apply -f "$M/$f"
done

# Storage: student-documents to 20 MiB and the attachment MIME list (also done by the S21 file; idempotent).
apply -f scripts/release/s25/10-storage-bucket-student-documents.sql

# Preservation: no pre-existing table may have fewer rows than before.
counts > "$OUT/rowcounts-after-$STAMP.txt"
LOST=$(LC_ALL=C join -t= "$OUT/rowcounts-before-$STAMP.txt" "$OUT/rowcounts-after-$STAMP.txt" | awk -F= '$3 < $2 {print $1": "$2" -> "$3}')
[ -z "$LOST" ] || { echo "$LOST" | tee -a "$LOG"; die "rows decreased after migration; restore from $OUT/public-$STAMP.dump"; }
echo "row preservation: PASS" | tee -a "$LOG"

"${PSQL[@]}" -f scripts/release/s25/90-production-postverify.sql > "$OUT/postverify-$STAMP.txt"
if grep -Eq '\| f( |$)' "$OUT/postverify-$STAMP.txt"; then
  cat "$OUT/postverify-$STAMP.txt" | tee -a "$LOG"; die "post-verify has a failing row"
fi
echo "post-verify: PASS (saved $OUT/postverify-$STAMP.txt)" | tee -a "$LOG"
echo "S26 production schema release: DONE" | tee -a "$LOG"
