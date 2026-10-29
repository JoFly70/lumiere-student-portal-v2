#!/usr/bin/env bash
# S26 production release runner — run ONCE in the production Repl's Shell (not by any AI agent):
#
#   curl -fsSL https://raw.githubusercontent.com/JoFly70/lumiere-student-portal-v2/claude/s26-owner-and-first-student-finish/scripts/s26/release-loop.sh | bash
#
# What it does (owner-authorized: docs/recovery/S26-ADDENDUM-DIRECT-PRODUCTION-AUTHORIZATION.md):
#   1. Refuses unless the workspace's secrets identify production Supabase project rheronevecsffaejteoj.
#   2. Preserves the current workspace: tags HEAD (s26-pre-sync-backup-<sha>) and keeps its branch untouched.
#   3. Follows ONLY branch claude/s26-owner-and-first-student-finish of the public GitHub repo, for at most
#      S26_LOOP_HOURS (default 6) hours, fast-forward only. For each new commit:
#        a. checkout (branch s26-release), npm ci, typecheck-free production build;
#        b. first time only: guarded schema release (backup + additive idempotent migrations + row preservation);
#        c. provision/refresh the SYNTHETIC demo student (idempotent);
#        d. write release.json (SHA) and s26-evidence/status.json;
#        e. wait for the published site to serve that SHA (the deployment is published separately), then run
#           the hosted acceptance journey and write s26-evidence/acceptance.json (+ screenshots).
#   Secrets are never printed. Evidence files contain no credentials. Stop any time with Ctrl+C.
set -uo pipefail

REF=rheronevecsffaejteoj
BRANCH=claude/s26-owner-and-first-student-finish
REMOTE_URL=https://github.com/JoFly70/lumiere-student-portal-v2.git
LIVE=https://lumiere-student-portal-v-2.replit.app
HOURS="${S26_LOOP_HOURS:-6}"
EVID=s26-evidence
PRIV=.s26-private-backup

cd "${REPL_HOME:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" || exit 2
mkdir -p "$EVID" "$PRIV"
log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$EVID/loop.log"; }
status() { # status <step> <result> [detail]
  node -e 'const fs=require("fs");const f=process.argv[1];let s={};try{s=JSON.parse(fs.readFileSync(f,"utf8"))}catch{};s.updatedAt=new Date().toISOString();s.sha=process.argv[2];s.steps=s.steps||{};s.steps[process.argv[3]]={result:process.argv[4],detail:process.argv[5]||null,at:s.updatedAt};fs.writeFileSync(f,JSON.stringify(s,null,2))' \
    "$EVID/status.json" "${SHA:-unknown}" "$1" "$2" "${3:-}"
}

# 1. Identity guard (values never printed).
[ "${SUPABASE_URL:-}" = "https://$REF.supabase.co" ] || { echo "REFUSED: SUPABASE_URL is not production project $REF"; exit 2; }
case "${DATABASE_URL:-}" in *"$REF"*) ;; *) echo "REFUSED: DATABASE_URL does not identify $REF"; exit 2;; esac
log "identity: production project $REF confirmed (secret values not shown)"

# 2. Preserve current workspace state.
START_SHA=$(git rev-parse HEAD)
START_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git tag -f "s26-pre-sync-backup-${START_SHA:0:7}" "$START_SHA" >/dev/null
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git stash push -m "s26-pre-sync-backup $(date -u +%FT%TZ)" >/dev/null && log "uncommitted tracked changes stashed (git stash list)"
fi
log "preserved: branch $START_BRANCH at ${START_SHA:0:7}, tag s26-pre-sync-backup-${START_SHA:0:7}"
git remote get-url s26gh >/dev/null 2>&1 || git remote add s26gh "$REMOTE_URL"

need_pg() {
  if command -v psql >/dev/null && command -v pg_dump >/dev/null; then return 0; fi
  log "psql/pg_dump not on PATH; using nix-shell postgresql_16"
  return 1
}

DEADLINE=$(( $(date +%s) + HOURS * 3600 ))
DONE_SHA=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  git fetch -q s26gh "$BRANCH" 2>>"$EVID/loop.log" || { sleep 60; continue; }
  SHA=$(git rev-parse FETCH_HEAD)
  # Pinned release: with S26_PIN_SHA set, only that exact commit is ever synced.
  if [ -n "${S26_PIN_SHA:-}" ]; then SHA=$(git rev-parse --verify "${S26_PIN_SHA}^{commit}" 2>/dev/null || echo "$DONE_SHA"); fi
  if [ "$SHA" != "$DONE_SHA" ]; then
    log "new commit ${SHA:0:7}: syncing"
    rm -f "$EVID/status.json" "$EVID/acceptance.json"
    git checkout -q -B s26-release "$SHA" && status sync PASS "${SHA:0:7}" || { status sync FAIL; sleep 60; continue; }
    if npm ci --no-audit --no-fund > "$EVID/npm-ci.log" 2>&1 && npm run build > "$EVID/build.log" 2>&1; then
      status build PASS
    else
      status build FAIL "$(tail -5 "$EVID/build.log" "$EVID/npm-ci.log" 2>/dev/null | tr '\n' ' ' | cut -c1-400)"; DONE_SHA=$SHA; continue
    fi
    PV=$(ls -t "$PRIV"/postverify-*.txt 2>/dev/null | head -1)
    if { ls "$PRIV"/apply-*.log >/dev/null 2>&1 && grep -q "S26 production schema release: DONE" "$PRIV"/apply-*.log; } \
       || { [ -n "$PV" ] && grep -q "all 17 tables present *| t" "$PV" && ! grep -Eq '\| f( |$)' "$PV"; }; then
      status schema SKIPPED "already applied and post-verified (${PV:-apply log})"
    else
      if need_pg; then RUN=(bash); else RUN=(nix-shell -p postgresql_16 --run); fi
      if [ "${RUN[0]}" = bash ]; then
        bash scripts/release/s26/apply-production.sh --apply --i-understand-this-writes-to-production > "$EVID/schema.log" 2>&1
      else
        nix-shell -p postgresql_16 --run "bash scripts/release/s26/apply-production.sh --apply --i-understand-this-writes-to-production" > "$EVID/schema.log" 2>&1
      fi
      if grep -q "S26 production schema release: DONE" "$EVID/schema.log"; then status schema PASS "backup + additive migrations + row preservation + post-verify"
      else status schema FAIL "$(grep -E 'REFUSED|ERROR|FAIL' "$EVID/schema.log" | head -5 | tr '\n' ' ' | cut -c1-400)"; DONE_SHA=$SHA; continue; fi
    fi
    if npx tsx scripts/s26/provision-demo-student.ts --ref "$REF" --real-code LCA-2026-0001 > "$EVID/provision.json" 2> "$EVID/provision.err" \
       && grep -q '"verdict": "PASS"' "$EVID/provision.json"; then
      status provision PASS
    else
      # Gate: a release whose student/academic provisioning failed is NOT ready to publish.
      status provision FAIL "see $EVID/provision.json"
      status ready_to_publish FAIL "provisioning failed; not publishable"
      log "provisioning FAILED for ${SHA:0:7}; release blocked (fix and push a new commit)"
      DONE_SHA=$SHA; ACCEPTED=1; continue
    fi
    printf '{"sha":"%s"}\n' "$SHA" > release.json
    for k in META_MODEL_API_KEY SPARK_ASSISTANT_ENABLED SPARK_ASSISTANT_LIVE_ROLES SPARK_ASSISTANT_STUDENT_POLICY REDIS_URL SESSION_SECRET SUPABASE_SERVICE_KEY; do
      [ -n "${!k:-}" ] && echo "$k=set" || echo "$k=unset"
    done > "$EVID/env-names.txt"
    status ready_to_publish PASS "release.json=${SHA:0:7}; publish the deployment now"
    log "ready to publish ${SHA:0:7}; waiting for $LIVE to serve it"
    DONE_SHA=$SHA
    ACCEPTED=""
  fi
  if [ -z "${ACCEPTED:-}" ] && [ -n "$DONE_SHA" ] && grep -q '"ready_to_publish"' "$EVID/status.json" 2>/dev/null; then
    LIVE_SHA=$(curl -fsS -m 20 "$LIVE/health" 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).release||"")}catch{}})')
    if [ "$LIVE_SHA" = "$DONE_SHA" ]; then
      log "live site serves ${DONE_SHA:0:7}"
      if [ -d s26-private-intake ]; then
        log "running confidential first-student intake (private folder; evidence holds no personal data)"
        if npx tsx scripts/s26/private-intake.ts --base "$LIVE" --ref "$REF" > "$EVID/intake.out" 2>&1; then status intake PASS "see $EVID/intake.json"
        else status intake FAIL "see $EVID/intake.json"; fi
      else
        status intake SKIPPED "no s26-private-intake/ folder in the workspace"
      fi
      log "running hosted acceptance"
      if npx tsx scripts/s26/production-acceptance.ts --base "$LIVE" --ref "$REF" > "$EVID/acceptance.out" 2>&1; then status acceptance PASS
      else status acceptance FAIL "see $EVID/acceptance.json"; fi
      ACCEPTED=1
    fi
  fi
  sleep 60
done
log "loop finished after $HOURS h; workspace stays on branch s26-release. Previous state: tag s26-pre-sync-backup-${START_SHA:0:7}"
