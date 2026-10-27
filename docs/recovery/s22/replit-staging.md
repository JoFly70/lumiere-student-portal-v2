# S22 reproducible hosted staging on Replit

Goal: a second, isolated deployment (own `*.replit.app` URL, own Supabase project) that the S22 rehearsals can run against, **without touching the published production-like deployment** (`lumiere-student-portal-v-2.replit.app`, deploymentId `a24d52bb-...`, Repl `lumiere-student-portal-v2`). Nothing here is performed by Claude: every step is an owner action. Nothing was executed against Replit or Supabase from the build container (network policy blocks both), so no hosted result is claimed.

## 0. Facts this runbook relies on

| Fact | Source |
|---|---|
| Repo `.replit`: nodejs-20, port 5000 -> 80, Autoscale, build `npm ci && npm run build`, run `npm start`; `[userenv.production]` hardcodes `APP_URL` and `PUBLIC_APP_URL` to `https://lumiere-student-portal-v-2.replit.app` and sets `AUTH_EMAIL_MODE=custom_smtp` | `.replit`, identical on the live Repl |
| Live deployment secret NAMES: `DATABASE_URL`, `SESSION_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`. No `REDIS_URL`, no `ENABLE_EMAIL_VERIFICATION`, no SMTP, no Sentry | Replit connector (read-only) |
| Live `/health` = 200 (database ok); live `/ready` = 503 | public fetch |
| A remix gets a different `.replit.app` subdomain and deployment secrets must be re-added | Replit docs |
| Container cannot reach replit.app, lumiereportal.app, Supabase | policy |

## 1. Findings that change how staging must be configured

1. **`APP_URL` precedence is unverified.** `[userenv.production]` values come from the committed `.replit`; deployment secrets are the other source. Replit's documented precedence between the two was **not verified** (docs.replit.com was not readable from the build container). Do not rely on a secret overriding the file. **Safe approach:** in the staging Repl, edit `.replit` and delete the `APP_URL` and `PUBLIC_APP_URL` lines under `[userenv.production]` (keep `AUTH_EMAIL_MODE`), then set `APP_URL` as a deployment secret. After the first publish, prove it with the check in 4.3 (password-reset link / `scripts/s22/preflight-env.ts` run in the deployed Repl's shell cannot see deployment env, so use the reset-email link origin). If the owner would rather keep one `.replit`, ask Opus to make a staging-neutral variant; the repo file as committed is production-specific.
2. **`custom_smtp` is a declaration, not configuration.** In code, `AUTH_EMAIL_MODE` is only read by `server/lib/auth-readiness.ts` and `/ready` (value `custom_smtp` makes check `customSmtpDeclared` pass). The app has **no SMTP transport and no SMTP environment variables** (`server/lib/email.ts` is a log-only stub; `EMAIL_ENABLED` does not send mail). All verification, reset and invite mail is sent by **Supabase Auth**, so SMTP credentials live in Supabase Dashboard, Authentication, SMTP Settings, and are checked by `npm run verify:supabase-auth-config` plus a real inbox test. Consequence: the live deployment having no SMTP secrets is *not* by itself incomplete. Whether the Supabase project has custom SMTP set is unknowable from here; the owner must confirm.
3. **`ENABLE_EMAIL_VERIFICATION` is unset on the live deployment.** `server/routes.ts` signup does `email_confirm: !emailVerificationEnabled`, so unset means new users are **auto-confirmed and never verify their email**. The `/auth/verify` flow is then unused for signups. Staging must set it to `true` to exercise the verification journey; for production this is a product decision the owner must make explicitly (not silently inherited).
4. **`/ready` is 503 in production without `REDIS_URL`** (`distributedRateLimit` check, `server/lib/auth-readiness.ts`). Replit's Autoscale health check should target `/` or `/health`/`/live`, not `/ready`, otherwise a Redis-less deploy never becomes healthy; `/health` and `/live` do not depend on Redis.
5. **Runtime browser config comes from `SUPABASE_URL` + `SUPABASE_ANON_KEY`** via `/env.js` (`server/routes.ts`). `VITE_SUPABASE_*` are not read by the running app, only the first two matter; keep the `VITE_` pair equal anyway (preflight warns if they differ, fails if they target another ref).
6. **In-memory state breaks multi-instance Autoscale** (see 3).
7. **Lockfile portability:** `package-lock.json` has 165 `resolved` URLs on `http://package-firewall.replit.internal`. `npm ci` works inside Replit builds and fails elsewhere (CI, local, other hosts). Fine for Replit staging; do not reuse the lockfile for non-Replit builds without regenerating it (not changed in S22).

## 2. Create the staging Repl (does not touch production)

Recommended: **Remix** the Repl `lumiere-student-portal-v2` to `lumiere-student-portal-staging` (Replit, Repl menu, Remix). Alternative: new Repl, Import from GitHub, branch `claude/s22-hosted-staging-replit-release`. Do *not* attach a custom domain to it and do *not* publish the original Repl.

1. In the new Repl, confirm the branch/commit under test (`git log -1` in the Shell).
2. Edit `.replit` as in finding 1 (remove the two hardcoded `APP_URL`/`PUBLIC_APP_URL` lines).
3. Create the isolated staging Supabase project and bootstrap it exactly per `docs/recovery/s21/staging-readiness.md` section 3. Never reuse `rheronevecsffaejteoj`, `ypbzdbfqoflyszdsbivn`, `brrktoofhtcylxrundvl`.
4. Publishing: Publish, **Autoscale** (see 3 for the machine limit), build/run commands from `.replit`. The first publish assigns the staging URL `https://<name>.replit.app`; note it.

## 3. Deployment secrets (names; values are the owner's, never pasted into chat or git)

| Secret | Value / rule |
|---|---|
| `SUPABASE_URL` | `https://<STAGING_REF>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | staging secret key (`sb_secret_...`) |
| `SUPABASE_ANON_KEY` | staging publishable key (`sb_publishable_...`); served to browsers at `/env.js` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | same two public values |
| `DATABASE_URL` | staging session-pooler URL (user `postgres.<STAGING_REF>`) |
| `SESSION_SECRET` | new random value, >= 32 chars (`openssl rand -hex 32`); not shared with production |
| `APP_URL`, `PUBLIC_APP_URL` | the staging `https://<name>.replit.app` (bare origin) |
| `ENABLE_EMAIL_VERIFICATION` | `true` |
| `AUTH_EMAIL_MODE` | `custom_smtp` (from `.replit`) only if the staging Supabase has custom SMTP; else `supabase_default` (shared mailer, tiny hourly cap, `/ready` fails) |
| `NODE_ENV` | set by `npm start`; do not add |
| `ALLOW_DEMO_MODE` | **not set** |
| `SPARK_ASSISTANT_ENABLED` | **not set** for the first run. For the live-assistant test only: `true`, plus `META_MODEL_API_KEY`, `SPARK_ASSISTANT_LIVE_ROLES=admin` |
| `REDIS_URL` | optional (see below) |
| `S22_STAGING_*` | local shell only (see 5), not deployment secrets |

Supabase dashboard: Site URL = staging `APP_URL`; Redirect URLs `${APP_URL}/auth/verify`, `${APP_URL}/verify-email`, `${APP_URL}/reset-password`; public signup off.

### Autoscale vs Reserved VM, REDIS_URL

State kept in each Node process: (a) `express-rate-limit` counters (memory store unless `REDIS_URL`); (b) **CSRF tokens** (`server/middleware/csrf.ts`, in-memory `Map`) required by the assistant, assistant-memory and student-attachment POST routes. Authentication itself is stateless (Supabase JWT in `Authorization`; `sessionConfig` in `server/config/production.ts` is not wired to any middleware, so no session store is needed).

* With **more than one Autoscale instance**: rate limits multiply by instance count, and a CSRF token minted on instance A is rejected (403 `CSRF_TOKEN_INVALID`) when the next request lands on instance B, giving **intermittent 403s on assistant/attachment writes**. Redis fixes only the first; **`REDIS_URL` does not fix CSRF** (open defect, `csrf.ts` is outside S22 health/log scope; recommend a stateless HMAC token keyed by `SESSION_SECRET`).
* **Staging recommendation:** Autoscale with **max machines = 1** (Publishing settings), or a Reserved VM. One instance makes in-memory limits and CSRF consistent and keeps cost lowest. Redis is then optional; without it `/ready` is 503 by design, so run the smoke with `--allow-not-ready` and preflight without `--require-redis`. If the owner wants staging to prove the production topology, add a Redis (Upstash/Redis Cloud free tier) and set `REDIS_URL`, then `/ready` must be 200.
* **Production recommendation:** same single-instance cap until CSRF is stateless; Redis required for `/ready`.
* Autoscale scales to zero when idle: the first request after idle is a cold start (tens of seconds); the smoke retries are not built in, so re-run once if the first probe times out.

## 4. Verify (owner machine, then Replit Shell)

1. **Preflight (offline, values stay local):** export the staging values in a shell *on a trusted machine* (or the Replit Shell of the staging Repl), then
   `S22_STAGING_PROJECT_REF=<ref> S22_STAGING_CONFIRM=staging:<ref> NODE_ENV=production npx tsx scripts/s22/preflight-env.ts`
   (add `--require-redis` if Redis is used). Must print `result: PASS`. It prints names and verdicts only.
2. **Smoke (read-only GETs):** `scripts/s22/smoke-staging.sh https://<staging>.replit.app` (add `--allow-not-ready` when `REDIS_URL` is unset), then `scripts/release/s14/smoke-hosted.sh https://<staging>.replit.app` for the anon PostgREST probes. The script refuses the three production origins.
3. **APP_URL really overridden:** request a password reset for a staging user; the email link must start with the staging origin, never `lumiere-student-portal-v-2.replit.app`. If it does, the `.replit` edit in finding 1 was not applied.
4. Run `npm run verify:supabase-auth-config` against staging.
5. Run the hosted rehearsals (S20 journeys J1-J15 plus S21 conversation, attachment, memory, welcome flows; `docs/recovery/s20/release-rehearsal.md`). Only then may "HOSTED STAGING VERIFIED" be claimed, with the outputs attached.

## 5. Safety rails

* `scripts/s22/lib/staging-guard.ts` refuses the canonical, historical and Neon refs and the three production origins; preflight, smoke and the rehearsal scripts all use it.
* Logs: request logs record `path` without the query string; `lib/log-redaction.ts` (S22) scrubs tokens, signed URLs, cookies and assistant/file content from logs and Sentry. Staging log lines `assistant_integrity_checkpoint` remain visible by design.

## 6. Cost and approval

Replit Deployments are paid compute (Autoscale: base fee plus usage; Reserved VM: fixed monthly; credits/plan limits apply) and a second Supabase project may be free-tier or paid; Redis optional. **The owner must confirm cost before publishing; Claude does not purchase, publish or upgrade anything.** To stop spend: Publishing, Shut down the staging deployment (this also removes any custom-domain links attached to it), or delete the Repl.

## 7. Open owner questions

1. Deployment-secret vs `[userenv.production]` precedence (finding 1): confirm in Replit docs/support or use the safe approach.
2. Does the canonical Supabase project have custom SMTP configured (so `AUTH_EMAIL_MODE=custom_smtp` is truthful)?
3. Is skipping email verification on live signups (`ENABLE_EMAIL_VERIFICATION` unset) intended?
4. Staging Supabase project name/ref and the Redis decision (single instance vs Redis).
