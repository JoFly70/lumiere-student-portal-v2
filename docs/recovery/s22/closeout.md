# S22 closeout: hosted Supabase, Replit integration, first-student production readiness

## 1. Overall result

**BLOCKED (hosted verification), with all preparatory work complete. In code terms this is PASS WITH GAPS.**

| Acceptance criterion (brief §12) | Status |
|---|---|
| 1. Isolated hosted Supabase staging instance | **BLOCKED.** No staging project exists. This container has no Supabase credentials, and the network policy refuses `api.supabase.com`, `*.supabase.co` and `supabase.com` (HTTP 403 at the egress proxy). |
| 2. Verified prerequisite schema and migrations | **LOCAL PASS** (throwaway PG16): 67 file applications, 189/189 checks + 1 informational. **HOSTED NOT RUN.** |
| 3. Deployed Replit staging application | **BLOCKED.** Needs an owner-created staging Repl plus a staging Supabase. Publishing over the only visible Repl would overwrite the live V2 deployment, which is prohibited. |
| 4. Real invitation / auth / email | **HOSTED NOT RUN.** Code defects fixed and locally tested; a hosted rehearsal script is ready. |
| 5. Real private Storage | **HOSTED NOT RUN.** Bucket policy verifier and J24–J27 are ready. |
| 6. Account-level isolation | **LOCAL PASS** (J11, J22, J27 local). One real RLS regression found and fixed (§9). |
| 7. Hosted student journey | **HOSTED NOT RUN.** 31/31 steps (P0, P1, J1–J29) pass locally, all labelled LOCAL/MOCKED, none REAL. |
| 8. Conversations and memory across sessions | **LOCAL PASS** (J19, J28, J29). |
| 9. Document attachments | **LOCAL PASS** (J24 eight formats byte-compared against a Storage double, J25 rejections). |
| 10. Logging and recoverability | Log and Sentry redaction fixed; backup and reset runbooks written. **Hosted NOT verified.** |
| 11. Validated domain cutover plan | **PREPARED, not executed.** The current owner of `lumiereportal.app` is unknown (§12). |
| 12. No unauthorized production changes | **MET** (§17). |

The brief says local tests alone do not verify staging. Nothing here claims hosted verification.

## 2. Branch and commits

Branch: `claude/s22-hosted-staging-replit-release`, base `3d82fbbbf5759f88ebe5b1a62a78fa2eafe00055` (S21). The final SHA is the commit that adds this file, reported in the session hand-off (`git log -1` on the branch).

| Commit | Content |
|---|---|
| `df94ff7` | Shared staging guard (`scripts/s22/lib/staging-guard.ts`) |
| `76b8dba` | Sonnet C: preflight, smoke, health timeouts, log/Sentry redaction, Replit and domain runbooks |
| `1994fd7` | Sonnet A + Opus: bootstrap manifest/runner, hosted verifier, forward migration `20261103100000_s22_account_gate_restore.sql` |
| `1109539` | Opus: stateless HMAC CSRF tokens |
| `c76cac0` | Sonnet B: auth link handling, first verification email, auth-settings verifier, hosted auth rehearsal |
| `ead0203` | Sonnet D: hosted journey J1–J29, harness, first-student setup guide |

## 3. Workstream results

| Stream | Result |
|---|---|
| **Opus** | Probed hosted reachability first (critical path: blocked within minutes, so every agent built owner-runnable tooling instead of waiting). Inspected Replit read-only through the Replit connector. Wrote the shared guard contract before launching agents. Turned two workaround scripts into a proper forward migration. Fixed the multi-instance CSRF defect. Integrated, ran the gates and wrote this closeout. |
| **Sonnet A: Supabase** | `bootstrap-manifest.ts` (11 steps plus 10b, every file explicit, coverage check over all 37 `supabase/migrations` files), `staging-bootstrap.ts` (local/staging/dry-run/twice, credentials only in the child environment), `hosted-verify.sql/.ts` (read-only, 130 checks plus the S14 probes). Found 4 defects (§9). 13 tests. |
| **Sonnet B: Auth and email** | No valid PKCE path exists. `?code=` links now get an actionable "unsupported" state. Fixed the first verification email that was never sent. Added `token_hash` recovery links. Removed the dead localhost fallback. Added a guarded settings verifier and a 21-step hosted auth rehearsal. 40 new tests. |
| **Sonnet C: Replit and domain** | `preflight-env.ts`, `smoke-staging.sh`, 3 s DB-probe timeouts on `/health` and `/ready`, token/JWT/signed-URL/conversation-content redaction in winston and Sentry. Wrote `replit-staging.md` and `domain-cutover.md`. 28 tests. |
| **Sonnet D: Hosted journey** | `hosted-journey.ts` and `journey/*`: an HTTP-only journey with service-role steps labelled, a REAL-label classifier that cannot return REAL locally, run-scoped cleanup and mutation tests. Wrote `first-student-setup.md`. 16 tests (31/31 steps locally). |

## 4. Supabase staging status

**No hosted staging project exists, and none was reachable or creatable from this session.** Hosted project reference: **none**.
* Checked by variable names only: no `SUPABASE_*`, `DATABASE_URL`, `PG*` or `SUPABASE_ACCESS_TOKEN` is set. The ChatGPT Supabase connection does not reach Claude Code, and no Supabase MCP connector is attached here.
* The published V2 app's `replit.md` names the canonical Supabase `rheronevecsffaejteoj`. It is treated as production and is on the guard's forbidden list together with the historical refs `ypbzdbfqoflyszdsbivn` and `brrktoofhtcylxrundvl`. Nothing connected to any of them.
* No project was created and nothing was purchased.

## 5. Schema bootstrap verification (LOCAL PG16, NOT HOSTED)

`npx tsx scripts/s22/staging-bootstrap.ts --target=local --twice --verify`: pass 1 applied 43 files, the idempotency pass applied 24 (steps 04–10b), **67 applications, 0 failures**.

Verification: **190 checks: 189 pass, 0 fail, 1 informational** (`C_admin_count`=0 until the first admin exists). The checks cover connectivity, 35 tables, 24 constraints, RLS plus the policy list, the account-gate helpers, three private buckets (`student-documents` 20 MB with pdf/png/jpeg/webp/docx/xlsx/csv/txt), append-only triggers, anon privileges and `profiles.status` write protection.

A negative control proves the verifier turns red on five deliberate breakages, and a catalog snapshot proves the verifier is read-only. Staging mode refuses to run unless `S22_STAGING_PROJECT_REF`, `S22_STAGING_CONFIRM=staging:<ref>` and a matching `DATABASE_URL` are set, plus `--i-understand-this-writes-to-staging`. Runbook: `supabase-staging.md`.

## 6. Authentication and email

Details are in `auth-email.md`. The app sends auth mail only through Supabase (`resetPasswordForEmail`, `auth.resend`). `AUTH_EMAIL_MODE=custom_smtp` is a declaration only: there is no SMTP transport in the app, so SMTP lives in the Supabase dashboard.

Fixed:
1. **The first verification email was never sent.** With verification on, signup used `admin.createUser`, which sends nothing.
2. `?code=` and bare `?token=` links now show "unsupported" with a resend path on `/verify-email` and `/auth/verify`. They were previously a generic "invalid", and `/reset-password` silently ignored them.
3. `token_hash` recovery links are supported. The hash is exchanged at password submit, so mail scanners cannot consume it.
4. Redirects derive only from `APP_URL`. A test scans `server/` for Host/Origin/X-Forwarded-* use.

Live finding: the published deployment has **no `ENABLE_EMAIL_VERIFICATION`**, so new signups there are auto-confirmed.

Hosted status: invitation, delivery, verification, login, expiry, logout, recovery, denial, inactive accounts and linkage are all **NOT RUN hosted**. The script is `scripts/s22/hosted-auth-rehearsal.ts --dry-run` first. Supabase rate-limit defaults quoted in the doc are unverified.

## 7. Hosted storage results

**NOT RUN.** Ready to run: the bucket MIME/size/privacy checks (`hosted-verify`), plus J24 (8 formats, signed-URL SHA-256 byte compare), J25 (rejections, rejected object must be absent), J26 (photo) and J27 (cross-account, including direct Storage probes).

## 8. Replit deployment

Replit facts from the Replit connector (read-only) and a public GET:
* The only Lumière Repl the owner can edit is `lumiere-student-portal-v2`. Its Autoscale deployment `a24d52bb-…` is live at `https://lumiere-student-portal-v-2.replit.app`.
* `GET /health` returns 200 with `environment: production`, database ok.
* `GET /ready` returns 503, because there is no `REDIS_URL`.
* Deployment secret names: DATABASE_URL, SESSION_SECRET, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_URL.
* **Staging deployment URL: none.** None was created, and nothing was published or republished.

The reproducible procedure is in `replit-staging.md`: remix the Repl into a staging Repl, set deployment secrets, remove the hardcoded production `APP_URL` from `[userenv.production]`, publish Autoscale (max 1 instance, or set Redis), then run `preflight-env.ts`, `smoke-staging.sh` and the rehearsals.

Findings:
* `package-lock.json` has 165 `resolved` URLs on `package-firewall.replit.internal`, so `npm ci` works only on Replit. This is a portability issue; the lockfile was not edited.
* Autoscale health checks must target `/health` or `/live`, not `/ready`.

## 9. RLS and security findings

1. **Fixed (needs production too): `is_staff_or_admin()` lost its active-account check.** `20261030100000_s18_billing_ledger.sql` re-creates it without the check after the S14 account gate, so a **deactivated staff/admin account keeps staff-level RLS access through PostgREST**. The forward migration `20261103100000_s22_account_gate_restore.sql` restores all four helpers. To check the canonical DB read-only: `select pg_get_functiondef('public.is_staff_or_admin()'::regprocedure);` should mention `current_user_is_active`.
2. **Fixed:** `assistant_purge_active()` was executable by anon (low impact: it reads a session GUC). Revoked in the same migration.
3. **Fixed:** CSRF tokens lived in process memory, which caused intermittent 403s on assistant and attachment writes once Autoscale runs more than one instance. Tokens are now stateless HMAC tokens keyed by `SESSION_SECRET`, compared in constant time and expiring after 1 h, with a random per-process key if the secret is missing. 4 tests.
4. **Fixed:** the error handler sent `Authorization`, cookies and `?token_hash` URLs to Sentry. Winston now redacts bearer tokens, JWTs, signed URLs and conversation and file content. `assistant_integrity_checkpoint` lines still log (tested).
5. **Fixed:** health DB probes had no timeout.
6. Documentation errors: `staging-readiness.md` said 11 `202609*` files (there are 15–16) and called every file idempotent. Steps 01–03 are in fact one-shot; the manifest encodes this.
7. Open (low): attachment order within a message is by uuid, not selection order (`store.ts:117`). User emails appear in signup/reset warning logs (PII, not secrets). There is a stale comment at `assistant-memory.ts:5`.

## 10. Regression results (this container, final tree)

* `npx vitest run`: **180 files passed, 8 skipped; 3,377 tests passed, 192 skipped, 0 failed.** S21 had 3,261, so 116 tests are new.
* `npx tsc --noEmit`: 0 errors. `npm run build`: passes. `dist/public` scan for model id, `api.meta.ai`, service-key and Meta key names: none.
* `scripts/s21/verify-migrations.ts`: **79/79** with the new S22 migration present.
* `staging-bootstrap --target=local --twice --verify`: PASS (§5).
* S07 evidence JSON that the suite rewrites was restored to its committed state.

## 11. Domain cutover plan

See `domain-cutover.md`: determine the owner, decide the old site's fate, link via Replit Publishing → Domains (move, or A + permanent `replit-verify` TXT, DNS-only, no AAAA, `www` separately), list the values that change, a 9-item preflight, ordered steps, read-only post-checks, a rollback within 15 minutes, and a signed approval gate. Code audit:
* CORS already allows `lumiereportal.app` and `www`.
* There is no cookie session (Supabase JWT).
* `APP_URL`/`PUBLIC_APP_URL` and Supabase Site/Redirect URLs must change.
* HSTS `includeSubDomains; preload` affects all subdomains for a year, and needs owner acceptance.

**Unknown: who serves `lumiereportal.app` today.** It shows an older marketing page with a public "Create account" form, the "© Lumiere College Accelerator" footer, and a possibly cached copy. It is not linked to the visible V2 deployment, and the connector cannot see where it is linked.

## 12. Production prerequisites

1. Apply `20261103100000_s22_account_gate_restore.sql` to production after the staging run (owner approval; additive, idempotent).
2. Set `ENABLE_EMAIL_VERIFICATION=true`, set `APP_URL`/`PUBLIC_APP_URL` to the final origin, and set `REDIS_URL` or cap at 1 instance. `preflight-env.ts --production --ref <ref>` must PASS (the live secrets currently fail it).
3. Supabase Auth: Site URL, the three redirect URLs (`/auth/verify`, `/verify-email`, `/reset-password`), Confirm email on, signups off, `token_hash` email templates, custom SMTP inbox test.
4. Route logs (at least `assistant_integrity_checkpoint`) to a separately retained store.

## 13. Backup and rollback

* **Database:** take a Supabase backup before any production migration. Free tier has daily backups and no PITR, so also run `pg_dump` through the guarded URL (procedure in `supabase-staging.md` §8). Storage buckets get a listing or export.
* **Migrations:** every S22 change is additive. To roll back the function migration, re-run the prior definitions, though that is not advisable because it re-opens the gap.
* **Application:** use Replit deployment history to redeploy the previous build.
* **Domain:** re-link to the old deployment or restore the saved DNS records. The old deployment stays running and untouched until sign-off.
* **Staging reset:** delete and recreate the project (recommended).

## 14. Remaining launch blockers

1. No staging Supabase project, and no network or credential path from this environment.
2. No staging Replit deployment.
3. Hosted auth, email, Storage, RLS-through-PostgREST and the J1–J29 journey have never run.
4. The current owner and DNS control of `lumiereportal.app` are unknown.
5. Production config gaps on the live deployment: `ENABLE_EMAIL_VERIFICATION`, `REDIS_URL`, `APP_URL`, the S22 migration.
6. Admin workflow gaps for the first student (from `first-student-setup.md`):
   * Students created through the UI stay "Lead".
   * Staff cannot upload documents on a student's behalf in the UI.
   * The server does not block a plan with fewer than 5 elective credits.
   * Template v2 core titles are "pending the school's written confirmation".
   * The real tuition, dates and elective names are owner inputs.
7. Still deferred: OCR, virus scanning and native French review.

## 15. Minimum owner actions (in order)

1. **Create the staging Supabase project** (free tier, name `lumiere-staging-s22`) and apply the Auth settings in `supabase-staging.md` §2.
2. **Pick one of these two:**
   * **(a)** In this Claude Code environment's settings, add `*.supabase.co`, `api.supabase.com` and `*.replit.app` to Allowed domains. Then add `S22_STAGING_PROJECT_REF`, `S22_STAGING_CONFIRM`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY` (staging values only) as environment secrets. A later session can then run steps 3–6 itself.
   * **(b)** Run them yourself from the Replit Shell.
3. `npx tsx scripts/s22/staging-bootstrap.ts --target=staging --i-understand-this-writes-to-staging --twice --verify --evidence=…`, then create the first admin.
4. Remix the Repl into a staging Repl and set its secrets (`replit-staging.md` §2–3). Publish only after approving the cost.
5. Run `preflight-env.ts`, `smoke-staging.sh <staging url>`, `hosted-auth-rehearsal.ts` and `hosted-journey.ts`, and send back the evidence JSON.
6. Run `dig`/`whois` for `lumiereportal.app` and say which account hosts it.

## 16. Explicit statement: production untouched

No production database was connected to or migrated. No deployment was published, republished or stopped. No domain or DNS was changed, no real student data was used, no infrastructure was purchased, no AI inference was called, and nothing was merged to `main`.

External contact was limited to:
* Read-only Replit connector calls: list apps, publish status, reading `.replit` and `replit.md`, and two read-only questions to the Replit agent, which are visible in that Repl's agent history.
* One public unauthenticated GET each of `/health`, `/ready` and the `lumiereportal.app` home page, through a web-fetch service.
* Replit documentation searches.

## 17. Next milestone

**S22b: hosted staging execution.** Once owner actions 1–2 are done, a session with staging access runs the bootstrap, verifier, preflight, smoke, auth rehearsal and J1–J29 against real services and records REAL labels. On a full hosted PASS, the owner reviews `domain-cutover.md` §9 and authorizes the production migration and cutover.

## Execution efficiency

* The hosted-reachability probe ran first, so no agent waited on infrastructure. All four built owner-runnable, guarded tooling in parallel against one shared guard contract written before launch.
* Each agent owned its files exclusively, and Opus made all commits, so there were no conflicts.
* The work reused S14 probes, the S21 journey ids, test doubles and the PG16 harness.
* There was one full-suite run at integration, plus targeted runs per agent.
