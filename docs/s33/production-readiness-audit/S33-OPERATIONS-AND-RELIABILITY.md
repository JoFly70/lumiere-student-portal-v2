# S33: Operations and Reliability

Legend: **VERIFIED-CODE** means read in code (or covered by a test re-run in S33). **CONFIG-ASSUMPTION** means it depends on production settings this audit could not see. **UNVERIFIED** means it was not checked.

## Authentication

| Area | State | Basis |
|---|---|---|
| Invitation-only sign-up, 10-character password minimum, email must match the invitation | VERIFIED-CODE | `server/routes.ts:149-330`, `server/lib/invitations.ts` |
| Email verification required in production; the server refuses to start without it | VERIFIED-CODE | `server/lib/production-auth-guard.ts` (S25) |
| Auth provider outage (429/5xx) returns 503, not a sign-out | VERIFIED-CODE | `server/middleware/auth.ts:160-175` |
| Archived or inactive accounts get 403 on every path; Supabase ban revokes refresh tokens | VERIFIED-CODE | `server/middleware/auth.ts:143, 209`; `server/routes/admin.ts:196-283` |
| Session renewal before expiry; on 401, the user returns to the page they were on after signing in again | VERIFIED-CODE | `client/src/lib/auth.tsx:204-270` |
| Login and token refresh share one 5-per-15-minutes per-IP limit | **Risk (S33-02)** | `server/routes.ts:541, 568` |
| Supabase redirect URLs and email templates in French | CONFIG-ASSUMPTION / UNVERIFIED | `npm run verify:supabase-auth-config` exists but was not run against production |

## Email and notifications

| Area | State | Basis |
|---|---|---|
| `deliverEmail` has a 15-second timeout, returns a real result and never logs the body | VERIFIED-CODE | `server/lib/email.ts:53-78` |
| Invitation delivery result (`sent` / `failed` / `not_configured`) is shown to the administrator | VERIFIED-CODE | `client/src/components/admin/issued-invitation-notice.tsx` |
| Notification outbox uses `FOR UPDATE SKIP LOCKED` with a lease, retries with backoff, and is safe with two instances | VERIFIED-CODE | `server/services/s29/outbox.ts` |
| Failed deliveries appear in Needs Attention (`notification_failed`) and can be retried by an administrator | VERIFIED-CODE | `server/services/s29/rules.ts`; S32 SA-29 |
| Staff-only calendar events send no student reminder; turning the Concierge off stops reminders | VERIFIED-CODE | S32 SA-01 and SA-14 (tests in suite) |
| Concierge is currently off unless the owner switched it on | CONFIG-ASSUMPTION | S32 release readiness notes; this is an owner decision |
| Transcript request sends no staff notification | **Gap (S33-05)** | — |
| Real delivery through Resend, and the sender domain | UNVERIFIED (U2) | — |

## AI provider configuration

- **Live mode depends on configuration.** Live AI runs only when `SPARK_ASSISTANT_ENABLED=true` and `META_MODEL_API_KEY` is set. Students are live only when `SPARK_ASSISTANT_LIVE_ROLES` includes `student` and `SPARK_ASSISTANT_STUDENT_POLICY=minor_safe_v1` (`server/services/academic-assistant/config.ts:67-91`). The model and API base are fixed in code.
- **The budget limit is enforced.** The monthly budget is reserved atomically and fails closed (`server/services/academic-assistant/budget.ts`). When the provider fails, the assistant uses its built-in answers and shows a notice.
- **Production state: the provider is failing (S33-03).** Its last live answers succeeded at `31c3a1f`. The S32 log shows both Owner AI and the student assistant falling back, which indicates student live mode is configured.
- **Student live mode has a privacy defect (S33-01).** Keep it off until that is fixed.

## Rate limiting and Redis

**Limits per IP, per 15 minutes:**

| Bucket | Limit |
|---|---|
| `/api` | 100 (counted twice: `server/index.ts:242` and `server/routes.ts:146`) |
| `/api/admin` | 30 |
| Login + refresh | 5 |
| Sign-up | 3 per hour |
| Password reset | 3 per hour |

These limits are too low for a shared office (**S33-02**).

**Redis store.**
- It has a 2-second command timeout and fails closed (`server/lib/rate-limit-store.ts`).
- Without `REDIS_URL` in production, it falls back to in-memory counters and sends a Sentry warning (`server/index.ts:201-211`).
- In-memory counters reset on restart and are per instance.
- Whether `REDIS_URL` is set is UNVERIFIED (U3). The Diagnostics tile shows it.

**Trust proxy.** `trust proxy` is set to 1. If Replit's proxy hop differs, every user may share one IP, which makes S33-02 much worse. UNVERIFIED (U4).

## Database

| Area | State | Basis |
|---|---|---|
| Pool size is capped by `DB_POOL_MAX` | VERIFIED-CODE | `server/lib/db.ts:24` |
| Account link, unlink and email correction run in one transaction, with a row lock and a conditional update | VERIFIED-CODE | `server/routes/admin-student-account.ts` |
| Billing mutations are transactional and audited; paid installments are locked; a unique index prevents a double receipt | VERIFIED-CODE | `server/services/billing-service.ts`; migration `20261101100000_s20` |
| Audit-log foreign-key failures fixed (SA-05) | S32 claim | Confirm in production using the Diagnostics audit tile |
| Legacy tables (`enrollments`, `roadmap_plans`) can still be written through legacy routes but are not read by current views | **S33-06** | — |
| Migrations | Not run in S33 | Schema steps were skipped at release (already applied) |

## Diagnostics, logging and errors

- **Diagnostics.** The Diagnostics page (administrators) covers the scheduler, incidents and table checks.
- **Health endpoints.** `/health` returns 503 when degraded and uses a 3-second probe timeout. `/ready` validates the auth configuration.
- **Error handling.** The global error handler hides 5xx details in production and strips headers before sending to Sentry.
- **Gap (S33-07).** Errors caught inside route handlers are logged but not sent to Sentry, so Sentry under-reports production failures.

## Backups, restore and rollback

- **Rollback.** Moving `release/S26_RELEASE_SHA` back to a previous commit redeploys that commit through the runner. This is documented in `release/README.md`. Database changes are not rolled back by this mechanism.
- **Backups.** Supabase backups and point-in-time recovery are UNVERIFIED (U5). There is no standing restore runbook (**S33-09**).

## Deployment dependencies

- **Platform.** Replit deployment, with the S26 release runner run by the owner in the production Shell. Production secrets exist only there.
- **Release state.** Production is on `4ccd8ae`. 57 of 59 required acceptance checks pass; the 2 failures are the AI checks (S33-03).
- **Custom domain.** `lumiereportal.app` is being moved from MockPortalNode to this project by the owner with Replit Support. This is a known external dependency, not a code defect. S33 made no change to it.
- **Build dependency.** The lockfile resolves 165 packages through `package-firewall.replit.internal`. Outside Replit, `npm ci` fails until the lockfile URLs are rewritten (S33 rewrote them in a scratch copy only). This matters only for future work outside Replit; note it for maintainers.
