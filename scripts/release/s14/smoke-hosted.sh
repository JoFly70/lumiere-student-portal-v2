#!/usr/bin/env bash
# S14 hosted smoke (READ-ONLY, unauthenticated). Run from the owner's machine after
# the deploy (and once BEFORE it, to record the old build's answers).
# Sends only GET requests; never sends credentials; writes nothing anywhere.
#
# Usage: scripts/release/s14/smoke-hosted.sh https://lumiere-student-portal-v-2.replit.app
#
# It also reads the PUBLIC Supabase URL + anon key the app serves at /env.js (the
# browser receives these anyway) and asks PostgREST, as anon, for a few sensitive
# tables: every one must be refused or return zero rows.
set -uo pipefail
BASE=${1:?usage: smoke-hosted.sh <app base url>}
BASE=${BASE%/}
Z=00000000-0000-4000-8000-000000000000
FAIL=0
check() { # label expected_codes(regex) url
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$3")
  if [[ $code =~ ^($2)$ ]]; then echo "PASS $1 -> $code"; else echo "FAIL $1 -> $code (expected $2)"; FAIL=1; fi
}

echo "== app at $BASE"
check "liveness /health"                         "200"     "$BASE/health"
check "SPA root /"                               "200"     "$BASE/"
check "/api/me without token"                    "401"     "$BASE/api/me"
check "/api/tickets without token"               "401"     "$BASE/api/tickets"
check "attachment download-url without token"    "401"     "$BASE/api/tickets/$Z/attachments/$Z/download-url"
check "/api/student/high-school without token"   "401"     "$BASE/api/student/high-school"
check "/api/admin/students without token"        "401"     "$BASE/api/admin/students"
# /ready reports configuration readiness; 503 is expected while REDIS_URL is unset
# (see runbook). Printed, not gated.
echo "INFO /ready -> $(curl -s --max-time 15 "$BASE/ready" | head -c 600)"

echo "== /env.js must expose only the URL and a publishable/anon key"
ENVJS=$(curl -s --max-time 15 "$BASE/env.js")
SB_URL=$(sed -n "s/.*SUPABASE_URL: '\([^']*\)'.*/\1/p" <<<"$ENVJS")
ANON=$(sed -n "s/.*SUPABASE_ANON: '\([^']*\)'.*/\1/p" <<<"$ENVJS")
[ -n "$SB_URL" ] && [ -n "$ANON" ] || { echo "FAIL /env.js did not contain SUPABASE_URL and SUPABASE_ANON"; FAIL=1; }
echo "INFO Supabase project served to browsers: ${SB_URL:-?}  (must equal the project you backed up and migrated)"
if [[ $ANON == sb_secret_* ]]; then echo "FAIL /env.js serves a SECRET key"; FAIL=1
elif [[ $ANON == eyJ* ]]; then
  P=$(cut -d. -f2 <<<"$ANON" | tr '_-' '/+'); while (( ${#P} % 4 )); do P+='='; done
  ROLE=$(base64 -d <<<"$P" 2>/dev/null | tr -d ' ' | sed -n 's/.*"role":"\([^"]*\)".*/\1/p')
  if [ "$ROLE" = "anon" ]; then echo "PASS /env.js key role=anon"; else echo "FAIL /env.js key role=${ROLE:-unknown}"; FAIL=1; fi
else echo "PASS /env.js key is a publishable key"; fi

if [ -n "$SB_URL" ] && [ -n "$ANON" ]; then
  echo "== PostgREST as anon (each must be 401/403/404 or an empty array)"
  for t in students users profiles student_documents account_invitations ticket_attachments support_tickets \
           hs_enrollments hs_credit_awards hs_official_results student_contacts audit_logs; do
    body=$(curl -s --max-time 15 -w '\n%{http_code}' -H "apikey: $ANON" -H "Authorization: Bearer $ANON" "$SB_URL/rest/v1/$t?select=*&limit=1")
    code=${body##*$'\n'}; data=${body%$'\n'*}
    if [[ $code =~ ^(401|403|404)$ ]] || [ "$data" = "[]" ]; then echo "PASS anon $t -> $code"; else echo "FAIL anon $t -> $code (rows visible to anon)"; FAIL=1; fi
  done
  echo "== Storage (informational; bucket privacy is gated by 01-account-readiness.sql E_buckets)"
  for b in documents student-documents knowledge-evidence; do
    echo "INFO public URL of bucket $b -> $(curl -s --max-time 15 "$SB_URL/storage/v1/object/public/$b/s14-probe-does-not-exist" | head -c 200)"
  done
fi
echo "== result: $([ $FAIL = 0 ] && echo PASS || echo FAIL)"
exit $FAIL
