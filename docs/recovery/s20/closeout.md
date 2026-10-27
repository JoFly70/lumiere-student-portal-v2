# S20 closeout: first-student release candidate + Lumière Academic Assistant

Branch `claude/s20-first-student-launch-and-spark`, base `0fec690` (S19). Development only: nothing deployed, nothing
merged, no production database, credential or student record used. The only hosted DB credential in the session (Neon
project `clientdesk-production`, a different app's production) was identified and deliberately not touched.

Result: **PASS WITH GAPS**. Release track: CODE READY + LOCALLY VERIFIED, not HOSTED STAGING VERIFIED.
Assistant track: CODE READY + LOCALLY VERIFIED (mocked provider), live provider unverified.

## Delivered

| Stream | Result |
|---|---|
| A auth | `verify-email` no longer trusts a token in the URL: credential stripped from the URL at once, verified server-side (`POST /api/auth/verify-email`: `verifyOtp` for `token_hash`, `getUser` for access tokens), success only when the provider reports `email_confirmed_at`. Distinct expired/used, invalid, missing, unavailable states (EN/FR). `/resend-verification` page + `POST /api/auth/resend-verification` (generic 200, 3/h/IP, cannot create accounts: invite-only kept). 20 tests. |
| B billing | Voiding an evidence-backed receipt keeps the voided receipt and returns the evidence to `awaiting_review` (audited `billing.evidence_reviewed`), so staff can re-confirm or reject. Migration `20261101100000_s20_billing_evidence_void.sql`: evidence uniqueness only among non-voided receipts. Concurrency (one 200 / one 409), integer cents, student views unchanged. Staff: `/staff/billing` lookup + staff sidebar entry. |
| C release | `scripts/s20/verify-migrations.ts` 43/43 on throwaway PG16 (7 files, order/dependency, idempotency, new indexes/RLS). Synthetic first-student journey (15 steps, DB-backed vs mocked labelled). `release-rehearsal.md`, `migration-verification.md`. |
| D assistant API | `/api/assistant/status`, `/api/assistant/message`; adapter isolated in `meta-adapter.ts`, model `muse-spark-1.3-contributor`, `https://api.meta.ai/v1/chat/completions` (shape read from Meta docs). Local curated EN/FR knowledge (17 entries, source URL + date). Contract: `assistant-api-contract.md`. 37 tests. |
| E assistant UI + polish | Crest avatar + drawer, theme tokens only, EN/FR, sources, portal links, local vs AI labelling, 429/503/retry, focus trap, Esc, reduced motion, axe-clean. Profile French (`pt()` table, 330+ phrases), cockpit "credits not yet official", full-name titles on truncated labels. |
| Opus | Chatbase removed (script, config, iframe CSS); UMPI-specific meta description replaced; route wiring (`/verify-email`, `/resend-verification`, `/staff/billing`), assistant router mount + student-shell mount; i18n spread; mobile bottom padding; 44px login language targets; avatar-upload French; lint fix; stale S10 migration-chain harness assertions corrected (they failed on the S19 base too). |

## Spark controls (server-enforced)

- Live inference requires all of: `SPARK_ASSISTANT_ENABLED=true` (literal), `META_MODEL_API_KEY`, role in `SPARK_ASSISTANT_LIVE_ROLES` (default empty; only coach/staff/admin accepted; `student` always stripped: no adult attestation exists). The first (minor) student can never reach the provider.
- PII guard (emails, phones, IDs, addresses, DOB, self-identifying phrases, EN/FR; history included) -> no provider call, local answer + notice. Only the question, bounded history (6 turns x 400 chars) and curated public snippets are ever sent; no profile, grades, documents, finances or ids.
- Budget `SPARK_ASSISTANT_MONTHLY_BUDGET_USD` (default 2) in `assistant_usage_monthly` (aggregate only); worst-case cost reserved atomically before each call; store failure or exhaustion -> local mode. Token caps 2500 in / 700 out, 15 s timeout, 6 req/min/account. No fallback model, no grounding, no tools.
- Production client bundle contains no model id, API host, key name or Chatbase reference (checked in `dist/public`).

## Migrations: release order (apply all before deploying)

1. `20261030100000_s18_billing_ledger.sql`  2. `20261030100100_s18_billing_audit_event_types.sql`
3. `20261030110000_s18_document_student_message.sql`  4. `20261031100000_s19_ticket_comment_idempotency.sql`
5. `20261031110000_s19_billing_corrections.sql`  6. `20261101100000_s20_billing_evidence_void.sql`
7. `20261101200000_s20_assistant_usage.sql`

## Verification

- `tsc --noEmit`: 0 errors. ESLint on all S20-changed files: 0 errors (warnings are pre-existing `any`).
- `npm run build`: passes.
- Full `vitest run`: 148 files passed, 8 skipped, 0 failed (2926 tests).
- `npx tsx scripts/s20/verify-migrations.ts`: 43/43 pass.
- Screenshots: `docs/recovery/s20-evidence/screens/` (assistant desktop/mobile, light/dark/FR/reduced-motion, throttled,
  unavailable; profile FR). LOCAL UI SIMULATIONS: vite + Playwright, `/api` stubbed with synthetic data, replies are
  stubbed text. The "Prototypes" sidebar group visible there is dev-only and compiled out of production builds.

## Gaps / release blockers

1. **Hosted staging not available** (no non-production Supabase project/credentials). Not verified: real Supabase auth
   emails/redirects, refusal of unconfirmed sign-in, real session expiry, RLS via PostgREST, Storage uploads, email delivery.
2. Hosted Supabase settings (owner): "Confirm email" on, Site URL = `APP_URL`, redirect allow-list includes
   `${APP_URL}/auth/verify` and `${APP_URL}/verify-email`.
3. `account_invitations` and support tables are not in `supabase/migrations/`; the hosted target must already have them (S14 release scripts).
4. Live Meta call never executed (no key in this container). Reasoning-token pricing assumed included in `completion_tokens`.
5. Staff billing lookup needs a student id typed in (no staff student list; RBAC not broadened).
6. French: server-recorded readiness labels, staff desk and staff billing UI remain English; native-speaker review pending.
7. PKCE `?code=` verification links are not supported (current flow uses hash token / `token_hash`).
