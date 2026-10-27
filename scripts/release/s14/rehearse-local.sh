#!/usr/bin/env bash
# S14 local release rehearsal. DISPOSABLE ONLY: builds a throwaway PostgreSQL 16
# cluster on 127.0.0.1:${PORT}, applies the production-lineage baseline and then the
# exact S14 release order, re-applies it (idempotency), runs the read-only probe,
# preflight and verify files, and three synthetic smoke inserts. Never point this
# at a hosted database: it only ever talks to the cluster it created.
#
# Usage: scripts/release/s14/rehearse-local.sh [workdir]
set -uo pipefail
# initdb refuses root: re-run as the postgres OS user (workdir must be writable by it)
if [ "$(id -u)" = 0 ]; then exec runuser -u postgres -- "$0" "$@"; fi
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
WORK=${1:-$(mktemp -d)}
PORT=${PORT:-55440}
BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres PGDATABASE=rehearsal

mkdir -p "$WORK"
"$BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null || exit 1
"$BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/pg.log" -w start >/dev/null || exit 1
trap '"$BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null' EXIT
createdb rehearsal

FAIL=0
run() { # file -> one line: rc, seconds, first error
  local t0 t1 out rc
  t0=$(date +%s.%N)
  out=$(psql -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$1" 2>&1 >/dev/null); rc=$?
  t1=$(date +%s.%N)
  printf "%-72s rc=%s %6.3fs %s\n" "${1#"$ROOT"/}" "$rc" "$(echo "$t1 - $t0" | bc)" "$(echo "$out" | grep -m1 ERROR | cut -c1-140)"
  [ "$rc" = 0 ] || FAIL=1
}

M=$ROOT/supabase/migrations
echo "== baseline (Supabase shim + production lineage, before S05)"
run "$ROOT/tests/helpers/s05-supabase-shim.sql"
# approximate Supabase default privileges (new public objects granted to API roles)
psql -X -q -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;" \
            -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;"
run "$M/20251217230356_011_degree_programs_courses.sql"
run "$ROOT/PRODUCTION_DATABASE_SETUP.sql"
for f in "$M"/2025121723515*.sql "$M"/202609*.sql; do run "$f"; done

RELEASE=(
  "$ROOT/scripts/release/s14/10-prereq-tables.sql"
  "$M/20261026100000_s05_student_roadmap.sql"
  "$M/20261026110000_s07_roadmap_audit_event_types.sql"
  "$M/20261026200000_s09_student_profile.sql"
  "$M/20261027100000_s08_support_audit_events.sql"
  "$M/20261028100000_s10_support_idempotency_index.sql"
  "$M/20261028200000_s10_support_schema_repair.sql"
  "$M/20261029100000_s11_high_school_pathway.sql"
  "$M/20261029110000_s11_high_school_audit_event_types.sql"
  "$ROOT/scripts/release/s14/30-account-gate.sql"
  "$ROOT/scripts/release/s14/35-client-privilege-hardening.sql"
  "$ROOT/scripts/disposable-env/90_storage_buckets.sql"
)
echo "== release pass 1"
for f in "${RELEASE[@]}"; do run "$f"; done
echo "== release pass 2 (idempotency)"
for f in "${RELEASE[@]}"; do run "$f"; done

echo "== probe / preflight / verify (rows with ok|pass = f are listed)"
psql -X -A -F'|' -t -f "$ROOT/scripts/release/s14/00-baseline-probe.sql" | awk -F'|' '($1=="A_migration" || $1=="B_s13_gap") && $3!="t"' | grep . || echo "probe: every migration APPLIED, every S13 gap object present"
psql -X -A -F'|' -t -f "$ROOT/scripts/release/s14/01-account-readiness.sql"
psql -X -A -F'|' -t -f "$ROOT/scripts/release/s14/90-verify.sql" | grep -E '\|f(\||$)' || echo "verify: every gate pass=t"

echo "== synthetic smoke (rolled back)"
psql -X -v ON_ERROR_STOP=1 -q <<'SQL' && echo "smoke: student_code generated, invitation row accepted, student_documents writable" || FAIL=1
BEGIN;
INSERT INTO users (id, email, role, name) VALUES ('00000000-0000-4000-8000-0000000000aa', 'synthetic.staff@example.invalid', 'admin', 'Synthetic Admin');
INSERT INTO students (id, email, first_name, last_name, dob, residency, phone_primary, address_country, address_line1)
  VALUES ('s14-synthetic', 'synthetic.student@example.invalid', 'Synthetic', 'Student', '2010-01-01',
          (SELECT enum_range(NULL::residency_enum))[1], '+10000000000', 'US', '1 Synthetic Way');
DO $$ BEGIN IF (SELECT student_code FROM students WHERE id='s14-synthetic') IS NULL THEN RAISE EXCEPTION 'no student_code'; END IF; END $$;
INSERT INTO account_invitations (email, token_hash, expires_at) VALUES ('synthetic.student@example.invalid', 'x', now() + interval '1 day');
INSERT INTO student_documents (student_id, doc_type, file_name, url, storage_path) VALUES ('s14-synthetic', 'hs_transcript', 't.pdf', 'u', 'p');
ROLLBACK;
SQL
echo "== result: $([ $FAIL = 0 ] && echo PASS || echo FAIL)"
exit $FAIL
