# S25 git reconciliation and hosting plan

Recorded 2026-10-28 by read-only inspection (Replit file reads plus read-only Replit Agent questions; nothing was modified, published or restarted). No secret values were requested or recorded; environment variable NAMES only.

Baseline: remote `claude/s25-production-release-and-student-visibility` at `0b72bfb` (S24 HEAD).

## 1. Divergence audit: staging Repl "AllGullibleBase" (12005f5d-d31a-42c8-803c-2d0433c373f5)

Workspace HEAD `8a493ddd` on branch `claude/s22b-real-hosted-staging`; working tree clean; remotes are Replit-internal (`origin` github.replit.internal, `gitsafe-backup`). Merge base is older than 0b72bfb: 10 local-only commits and 8 remote-only commits (63eeed7, 86a002a, 86f1d32, 76251b9, 60a6376, 24a8eaa, a5b940f, 0b72bfb).

`git diff --stat 0b72bfb HEAD` touches 18 paths. `git diff 0b72bfb HEAD -- server shared client src tests package.json package-lock.json` is **0 lines**, so app, server, shared and test source plus dependencies are identical to remote 0b72bfb.

Local-only commits (oldest last):

| Commit | Subject | Files | Class | Action |
|---|---|---|---|---|
| 949bd2b | Configure Replit environment, init memory docs | `.replit`, `.agents/memory/*` | (b)/(c) | not copied; see below |
| 96626bd | Staging environment isolation scripts and testing | scripts/staging/* (guard, start, README, qa) | already on remote (identical; diff shows no change) | none |
| 3848832 | Update replit configuration file | `.replit` | (b) | not copied |
| 5006f25 | First student smoke test evidence and automation script | `scripts/staging/first-student-smoke.mjs`, `docs/recovery/s22-evidence/first-student-smoke-*.json/png` | (a) script; (c) evidence | script COPIED verbatim; evidence not copied (see below) |
| 8f6e0cc | Student document review workflow and results | no net diff vs remote | none | none |
| a228b13, 9b30e2e | Staging auth enforcement/readiness docs | no net diff vs remote (remote S23 is the superset) | none | none |
| 4df0408, 8a493dd | S24 commits | same subjects as remote 24a8eaa / 0b72bfb; tree-identical | none | none |
| f3222ec | Memory documentation and staging QA file | `.agents/memory/*` | (c) | not copied |

Net tree differences (the 18 paths):

| Path | Class | Finding | Action |
|---|---|---|---|
| `scripts/staging/first-student-smoke.mjs` | (a) | Opt-in, staging-only synthetic smoke (350 lines). Hardcodes staging ref `tqgwoyzlnkqwkcjsiocd`, refuses inherited `DATABASE_URL`/`PG*`, requires `--execute`, uses `.invalid` synthetic emails, cleans up, no secrets. Imports `./guard.mjs`, `../s22/hosted-journey.ts`, `../s22/journey/{types,hosted-ops,http,ctx,fixtures}.ts`; all exports verified to exist in the clone; `ws`, `@supabase/supabase-js`, `tsx` are in package.json. `node --check` passes. | COPIED verbatim |
| `.replit` | (b) | Staging config: no `[deployment]`, `NODE_ENV=development`, staging Supabase URLs, `S22_STAGING_PROJECT_REF`, `S22_STAGING_CONFIRM`, `EMAIL_ENABLED=false`, `AUTH_EMAIL_MODE=supabase_default`, `CUSTOM_DOMAIN`/`APP_URL`/`PUBLIC_APP_URL` set to the dev-preview hostname, workflow `node scripts/staging/start.mjs --start`, modules adds `python-base-3.13`. No secrets (values are public config), but it is a workspace file. Remote `.replit` is the S16 production config. | Not copied; recorded in section 3 |
| `.agents/memory/{MEMORY.md,auth-assurance.md,diploma-curriculum.md,staging-isolation.md}` | (c) | Replit Agent memory notes. Rules: do not treat inherited managed `DATABASE_URL` as staging; do not invent elective courses / publish a real roadmap without school-approved offerings; confirmation timestamps are not inbox-delivery proof; staging never touches live Repl, prod secrets or lumiereportal.app. Clone already has `.agents/memory/MEMORY.md` and `staging-hosted-qa.md`; the staging MEMORY.md index adds three more entries (the three notes above). | Not copied (agent-local); summarized here |
| `docs/recovery/s22-evidence/first-student-smoke-*.json` (4) and `*.png` (5) | (c) | Synthetic smoke run evidence (runs 20261028033128, 033503, 040440, 041101). Latest (041101-a3d5): verdict `PASS_PERMITTED_SAFE_JOURNEY`, cleanup PASS, 4 synthetic users removed, plan publication deliberately NOT attempted, no email sent, production untouched. Screenshots of synthetic UI only. | Not copied (binary and redundant); result summarized here. Rerun the script on the S25 SHA for fresh evidence |
| `docs/recovery/s22-evidence/three-operational-fixes.md` | remote-only (absent locally) | Remote has it; staging deleted it. | none (keep remote) |
| `docs/recovery/s22b/chatgpt-hosted-staging-evidence.md` | remote-only superset | Staging has an older, shorter version (missing the 130/130 rerun, domain-owner and offline-verification sections). | none (keep remote) |

Conclusion: "substantially equivalent" is confirmed. The only unique useful content is the smoke script. Nothing under `server/`, `shared/`, `client/src/` or `tests/` differs, so no diffs need to be applied there.

Staging workspace note: the local-only commits are not on any GitHub branch; the staging Repl branch `claude/s22b-real-hosted-staging` must NOT be used as the deployment source. After S25 is committed, re-sync the staging Repl from GitHub (see section 4) rather than pushing from it.

## 2. Files added to the clone

- `scripts/staging/first-student-smoke.mjs` (new, verbatim from the staging Repl)
- `docs/recovery/s25-git-reconciliation-and-hosting.md` (this file)

Run (staging only, from the staging Repl, with `STAGING_DATABASE_URL` and the staging secrets present, and the app running on port 5000): `node --import tsx scripts/staging/first-student-smoke.mjs --execute` (needs `chromium` on PATH). It writes `docs/recovery/s22-evidence/first-student-smoke-<runId>.json/png`.

## 3. Hosting facts found

| Item | Staging "AllGullibleBase" | Production "lumiere-student-portal-v2" |
|---|---|---|
| replId | 12005f5d-... | 33a30f4f-... |
| Git state | HEAD 8a493dd, branch `claude/s22b-real-hosted-staging`, clean | HEAD cd21764 "Published your App", branch `claude/s16-first-student-cutover` (origin tip 94f91ac), clean; this is the S16 generation |
| `.replit` deployment | **none** (no `[deployment]`; active deployment none; never published) | `deploymentTarget = "autoscale"`, build `sh -c "npm ci && npm run build"`, run `npm start` |
| Run command | workflow: `node scripts/staging/start.mjs --start` (guarded launcher) | workflow `npm start` |
| Port mapping | localPort 5000 -> externalPort 80 | localPort 5000 -> externalPort 80 |
| package.json | `build` = `vite build && esbuild server/index.ts ... --outdir=dist`; `start` = `NODE_ENV=production node dist/index.js`; `dev` = tsx server/index.ts | same scripts |
| Deployment machine | n/a | Autoscale, 2 vCPU / 4 GiB (cr-2-4); max machines not exposed |
| Published URL | none (dev preview stopped, HTTP 502) | https://lumiere-student-portal-v-2.replit.app (deployment a24d52bb-45d8-4fb8-89b8-4f688ba12b81, status success) |
| Custom domains | none | none (lumiereportal.app not attached here) |
| Supabase project | `tqgwoyzlnkqwkcjsiocd` (from `.replit` env, public config) | host `rheronevecsffaejteoj.supabase.co` (reported by Agent, host only) |
| Secret NAMES | `SESSION_SECRET`, `STAGING_DATABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `VITE_SUPABASE_ANON_KEY`; Replit-managed `DATABASE_URL` also exists and must NOT be used | workspace and deployment: `DATABASE_URL`, `SESSION_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL` |
| Env var NAMES | `.replit`: `APP_URL, AUTH_EMAIL_MODE, CUSTOM_DOMAIN, EMAIL_ENABLED, NEXT_PUBLIC_SUPABASE_URL, NODE_ENV, PUBLIC_APP_URL, S22_STAGING_CONFIRM, S22_STAGING_PROJECT_REF, SUPABASE_URL, VITE_SUPABASE_URL`; dev only `ALLOW_DEMO_MODE, ENABLE_EMAIL_VERIFICATION` | deployment env: `APP_URL, AUTH_EMAIL_MODE (custom_smtp), PUBLIC_APP_URL` |

Domain: `lumiereportal.app` is attached to Repl MockPortalNode (a51b4fb3-73af-47af-840b-7f8e17d7c553; also mock-portal-node-jsebbag.replit.app), an Autoscale deployment serving the older marketing page. DNS is at Name.com; apex A `34.111.179.208`, TXT `replit-verify=a51b4fb3-...` (matches the MockPortalNode replId), `www` has no record. Not touched.

Critical staging/production difference: staging's start path goes through `scripts/staging/start.mjs`/`guard.mjs`, which require `STAGING_DATABASE_URL`, refuse the managed `DATABASE_URL`, and are pinned to ref `tqgwoyzlnkqwkcjsiocd`. A published deployment runs `npm start` (plain `node dist/index.js`), which reads `DATABASE_URL`, not `STAGING_DATABASE_URL`. So a staging deployment cannot be made by just adding a `[deployment]` block: `DATABASE_URL` for the deployment must be explicitly set to the staging pooler URL by the owner in the deployment's Secrets (the managed one is unverified; the Agent says it cannot overwrite it), or the deployment run command must be `node scripts/staging/start.mjs --start`. Decide this before publishing (open question 1).

## 4. Minimal procedures

Preconditions: lead has committed S25 and pushed; note the S25 SHA. Publishing a Replit deployment may incur charges (see cost).

### 4.1 Publish staging as a stable deployment from the S25 SHA

1. In the staging Repl, bring the workspace to the S25 SHA without relying on its diverged history. Preferred: create a fresh Repl via Replit "Import from GitHub" of the S25 branch/SHA (avoids the 10 local-only commits). Alternative (owner-run in the Shell, not by the Agent): `git fetch origin`, `git checkout -B s25-staging <S25 SHA>` (the local-only commits remain in reflog/`gitsafe-backup`; they contain nothing needed beyond the smoke script now in S25).
2. Config: use the staging `.replit` plus a deployment block: `[deployment] deploymentTarget = "autoscale"` (or `"gce"` for Reserved VM), `build = ["sh","-c","npm ci && npm run build"]`, `run = ["node","scripts/staging/start.mjs","--start"]` (keeps the guard) , `[[ports]] localPort=5000 externalPort=80`. Set deployment env `NODE_ENV=production`, `APP_URL`/`PUBLIC_APP_URL` to the staging `.replit.app` URL (not the dev hostname), keep `EMAIL_ENABLED=false`, `S22_STAGING_*`, `AUTH_EMAIL_MODE=supabase_default`.
3. Deployment Secrets (names): `SESSION_SECRET`, `STAGING_DATABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_URL`/`VITE_SUPABASE_URL` (public). The owner enters them in the Repl Secrets UI, never in chat.
4. Publish (owner or lead via the Publish tool). Poll status until `success`; then run `curl` health check and the first-student smoke script against the staging deployment/preview, set Supabase Auth Site URL/redirects to the staging URL.
5. Record the deployment URL and SHA in the S25 release record.

### 4.2 Redeploy production from the S25 SHA

1. Confirm the S25 release gates passed on staging (4.1 step 4). Take rollback notes first: current deployment `a24d52bb-45d8-4fb8-89b8-4f688ba12b81` at workspace HEAD `cd21764` (S16); the pre-S25 production schema state on `rheronevecsffaejteoj`.
2. Apply any new S25 DB migrations to `rheronevecsffaejteoj` BEFORE the code (owner/lead decision; migrations are not run by the deploy). Back up first (Supabase PITR/backups).
3. Move the production Repl workspace to the S25 SHA: workspace is on `claude/s16-first-student-cutover` (cd21764, clean). Owner Shell: `git fetch origin && git checkout -B s25-release <S25 SHA>` (or Replit Git pane pull of the S25 branch). The `.replit` on S25 must retain the production `[deployment]` and `[userenv.production]` blocks (it is the remote `.replit`, which they match). Keep `.s16-private-backup/` untracked and out of git (it is a private backup folder in the workspace; verify it is not committed).
4. Verify deployment Secrets still present (7 names above) and env `APP_URL`/`PUBLIC_APP_URL`/`AUTH_EMAIL_MODE=custom_smtp`.
5. Publish (redeploy). Poll `get_publish_status` until `success`; smoke `https://lumiere-student-portal-v-2.replit.app` (health, login, `/api/me`).
6. Rollback: Replit deployments keep prior builds; use the Publishing tab "rollback"/redeploy the previous version (S16, cd21764), or `git checkout cd21764` and republish. DB changes must be backward compatible or reverted separately.

### 4.3 Domain cutover and rollback for lumiereportal.app

Cutover (only after 4.2 passes on the `.replit.app` URL and the owner signs off):
1. In MockPortalNode, leave its deployment running. In the production Repl's Publishing > Domains, add `lumiereportal.app`; Replit will show a conflict/move flow because the domain is attached elsewhere. Alternatively first remove the domain from MockPortalNode.
2. Replit shows the required records (A and a `replit-verify` TXT bound to the production Repl's id, `33a30f4f-...`). At Name.com: replace the existing TXT `replit-verify=a51b4fb3-...` with the new value (or keep both if Replit permits) and update the apex A if Replit specifies a different IP (current `34.111.179.208`, TTL 300 s, so propagation is fast).
3. Wait for Replit to report the domain verified and TLS issued. Update Supabase Auth Site URL / Redirect URLs for production to `https://lumiereportal.app`, and set `APP_URL`/`PUBLIC_APP_URL` deployment env to match, then redeploy.
4. `www` currently has no record; add a CNAME only if wanted.

Rollback: keep MockPortalNode's deployment untouched (old marketing page stays published at mock-portal-node-jsebbag.replit.app). To revert: re-attach `lumiereportal.app` to MockPortalNode in Replit, restore TXT `replit-verify=a51b4fb3-73af-47af-840b-7f8e17d7c553` and the original A record `34.111.179.208` at Name.com (these values are recorded above; screenshot the Name.com zone before editing), restore the previous Supabase Auth URLs. TTL 300 s limits downtime.

### Cost

Publishing a new Replit deployment may incur charges, borne by the owner's plan: Autoscale bills a base fee plus usage (compute units and requests; scales to zero when idle; production is currently 2 vCPU / 4 GiB); Reserved VM bills a fixed hourly/monthly rate for an always-on machine of the chosen size, and suits steady traffic or stateful processes. A second always-on deployment (staging) doubles the baseline. Prefer Autoscale for staging, and unpublish or suspend staging when idle. Exact pricing changes; check the Replit pricing page / Publishing tab quote before publishing. Supabase staging project is quoted $0/month; production Supabase plan not inspected.

## 5. Open questions

1. How will the staging deployment obtain its DB connection: owner sets deployment `DATABASE_URL` to the staging pooler URL, or deployment `run` uses the guarded launcher? (Run command and secret must agree; the managed `DATABASE_URL` must not be used.)
2. Should staging be republished from a fresh GitHub import of S25 (recommended) or by resetting the diverged workspace?
3. Does S25 add DB migrations for production project `rheronevecsffaejteoj`, and who applies them and when (before code)?
4. Max machines / scaling settings of the production Autoscale deployment are not exposed; check in the Publishing UI.
5. Is `.s16-private-backup/` in the production workspace tracked by git? (It is not in the clone; ensure it stays out of the public repo.)
6. Production Supabase project ref was reported by the Agent as host only; the owner should confirm it equals `rheronevecsffaejteoj` in the Supabase dashboard, and that staging deployment Secrets do not contain production keys.
7. Supabase Auth settings (Site URL, redirects, SMTP for `custom_smtp` in production) remain "not yet verified" in the S22b record.
8. Domain: confirm the exact Replit move flow (remove from MockPortalNode first vs. move at attach) and whether `www` is required.
9. The production Repl's `AUTH_EMAIL_MODE=custom_smtp` requires SMTP secrets; no SMTP secret names appear in the production secret list (only the 7 above). Confirm how mail is sent in production.
