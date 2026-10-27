#!/usr/bin/env bash
# S22 hosted smoke (READ-ONLY, unauthenticated, GET only). Refuses production origins unless
# --allow-production-readonly is given (pre-cutover baseline / post-cutover verification).
#
# Usage: scripts/s22/smoke-staging.sh <base url> [--allow-production-readonly] [--expect-ready|--allow-not-ready]
#   /ready must be 200 by default (--expect-ready). Use --allow-not-ready to print it as INFO
#   (e.g. REDIS_URL intentionally unset on staging, where production /ready returns 503).
# Then run scripts/release/s14/smoke-hosted.sh <base url> for the PostgREST-as-anon probes.
set -uo pipefail
BASE=""; ALLOW_PROD=0; READY_MODE=expect
for a in "$@"; do
  case "$a" in
    --allow-production-readonly) ALLOW_PROD=1 ;;
    --expect-ready) READY_MODE=expect ;;
    --allow-not-ready) READY_MODE=info ;;
    -*) echo "unknown flag $a" >&2; exit 2 ;;
    *) BASE=$a ;;
  esac
done
[ -n "$BASE" ] || { echo "usage: smoke-staging.sh <base url> [--allow-production-readonly] [--allow-not-ready]" >&2; exit 2; }
BASE=${BASE%/}
ORIGIN=$(printf '%s' "$BASE" | sed -E 's#^(https?://[^/]+).*#\1#' | tr 'A-Z' 'a-z')
case "$ORIGIN" in
  https://*) ;;
  http://localhost*|http://127.0.0.1*) ;;
  *) echo "REFUSED: base URL must be https (or localhost): $ORIGIN" >&2; exit 2 ;;
esac
case "$ORIGIN" in
  https://lumiereportal.app|https://www.lumiereportal.app|https://lumiere-student-portal-v-2.replit.app)
    if [ $ALLOW_PROD = 0 ]; then
      echo "REFUSED: $ORIGIN is a production origin. Pass --allow-production-readonly for a read-only baseline." >&2; exit 2
    fi
    echo "NOTE: production origin, read-only GETs only" ;;
esac

FAIL=0
code_of() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1"; }
check() { # label expected_regex path
  local code; code=$(code_of "$BASE$3")
  if [[ $code =~ ^($2)$ ]]; then echo "PASS $1 -> $code"; else echo "FAIL $1 -> $code (expected $2)"; FAIL=1; fi
}

echo "== $BASE"
check "liveness /live"            "200" "/live"
check "health /health"            "200" "/health"
if [ $READY_MODE = expect ]; then check "readiness /ready" "200" "/ready"
else echo "INFO /ready -> $(code_of "$BASE/ready") (not gated; 503 expected while REDIS_URL is unset)"; fi
check "SPA root /"                "200" "/"

echo "== security headers (on /)"
HDRS=$(curl -s -D - -o /dev/null --max-time 15 "$BASE/")
hdr() { grep -i "^$1:" <<<"$HDRS" | head -1 | tr -d '\r'; }
if [[ $BASE == https://* ]]; then
  H=$(hdr strict-transport-security); [[ $H =~ max-age=[0-9]{7,} ]] && echo "PASS HSTS present" || { echo "FAIL HSTS missing/short"; FAIL=1; }
else echo "INFO HSTS skipped (non-https)"; fi
[ -n "$(hdr content-security-policy)" ] && echo "PASS CSP present" || { echo "FAIL CSP missing"; FAIL=1; }
[[ $(hdr x-content-type-options) =~ nosniff ]] && echo "PASS X-Content-Type-Options nosniff" || { echo "FAIL X-Content-Type-Options"; FAIL=1; }
[ -n "$(hdr x-frame-options)" ] && echo "PASS X-Frame-Options present" || { echo "FAIL X-Frame-Options missing"; FAIL=1; }

echo "== unauthenticated API must be 401"
Z=00000000-0000-4000-8000-000000000000
for p in /api/me /api/tickets /api/student/high-school /api/admin/students "/api/tickets/$Z/attachments/$Z/download-url"; do
  check "GET $p" "401" "$p"
done

echo "== /env.js exposes only public keys"
ENVJS=$(curl -s --max-time 15 "$BASE/env.js")
if grep -Eq "SUPABASE_URL|SUPABASE_ANON" <<<"$ENVJS"; then echo "PASS /env.js has SUPABASE_URL + SUPABASE_ANON"; else echo "FAIL /env.js missing public keys"; FAIL=1; fi
echo "INFO /env.js keys: $(grep -oE '^\s*[A-Z_]+:' <<<"$ENVJS" | tr -d ' :' | tr '\n' ' ')"
if grep -Eq "sb_secret_|service_role|SERVICE_KEY|DATABASE_URL|SESSION_SECRET|postgres(ql)?://" <<<"$ENVJS"; then echo "FAIL /env.js contains a secret-looking value"; FAIL=1; else echo "PASS /env.js has no secret patterns"; fi
ANON=$(sed -n "s/.*SUPABASE_ANON: '\([^']*\)'.*/\1/p" <<<"$ENVJS")
if [[ $ANON == eyJ* ]]; then
  P=$(cut -d. -f2 <<<"$ANON" | tr '_-' '/+'); while (( ${#P} % 4 )); do P+='='; done
  ROLE=$(base64 -d <<<"$P" 2>/dev/null | tr -d ' ' | sed -n 's/.*"role":"\([^"]*\)".*/\1/p')
  [ "$ROLE" = "anon" ] && echo "PASS /env.js key role=anon" || { echo "FAIL /env.js key role=${ROLE:-unknown}"; FAIL=1; }
fi

echo "== SPA auth routes serve the app shell"
for p in /auth/verify /verify-email /reset-password; do check "GET $p" "200" "$p"; done

echo "== result: $([ $FAIL = 0 ] && echo PASS || echo FAIL)"
exit $FAIL
