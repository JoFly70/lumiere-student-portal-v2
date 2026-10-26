#!/usr/bin/env bash
# Build the Student Portal schema from a clean, DISPOSABLE local database.
#
# Order (established empirically in S02; see README.md):
#   1. supabase/migrations/20251217230356_011_*   (legacy catalog; its CREATE POLICY
#                                                  statements are not idempotent, so
#                                                  it must run before step 2)
#   2. PRODUCTION_DATABASE_SETUP.sql              (the production lineage the modern
#                                                  chain was written against)
#   3. remaining supabase/migrations/*.sql        (filename order, unmodified)
#   4. scripts/disposable-env/50_runtime_supplement.sql
#   5. migrations/004_financial_timeline.sql, migrations/007_course_roadmap_tables.sql
#   6. per_credit_price column (shared/schema.ts:499; no SQL source)
#   7. scripts/disposable-env/60_s03_security_remediation.sql (S03; disposable only)
#   8. scripts/disposable-env/90_storage_buckets.sql
#
# Fails closed unless the target is a loopback Postgres. It must never be
# pointed at a hosted Supabase project: this is not a production migration path.
set -euo pipefail

DB_URL="${DISPOSABLE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/scripts/disposable-env"
FIRST="$ROOT/supabase/migrations/20251217230356_011_degree_programs_courses.sql"

case "$DB_URL" in
  postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;;
  *) echo "REFUSING: DISPOSABLE_DB_URL must target 127.0.0.1/localhost" >&2; exit 2 ;;
esac

run() {
  echo "-> ${1#"$ROOT"/}"
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$1" > /dev/null
}

if [ "$(psql "$DB_URL" -X -Atc "select count(*) from pg_tables where schemaname='public'")" != "0" ]; then
  echo "REFUSING: public schema is not empty; reset the disposable database first" >&2
  exit 3
fi

run "$FIRST"
run "$ROOT/PRODUCTION_DATABASE_SETUP.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  [ "$f" = "$FIRST" ] && continue
  run "$f"
done
run "$HERE/50_runtime_supplement.sql"
run "$ROOT/migrations/004_financial_timeline.sql"
run "$ROOT/migrations/007_course_roadmap_tables.sql"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 \
  -c "ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS per_credit_price INTEGER" > /dev/null
run "$HERE/60_s03_security_remediation.sql"
run "$HERE/90_storage_buckets.sql"
echo "schema applied: $(psql "$DB_URL" -X -Atc "select count(*) from pg_tables where schemaname='public'") public tables"
