# S23 staging Auth readiness remediation

Scope: isolated staging Repl and Supabase staging only. No production access,
dashboard writes, hosted account creation, email requests or migrations occurred.
The initial remediation did not push to GitHub; the subsequent reviewed
synchronization is recorded separately below.

## Implemented safeguards

- Development configuration requires email verification and disables demo mode.
  The guarded launcher validates these requirements and forces them in the app
  child environment, while retaining database identity/TLS isolation.
- Invitation signup creates an unconfirmed identity and returns the existing
  client verification-required response, never an automatic session. Unexpected
  provider auto-confirmation of a newly created identity fails closed.
- Login, `/api/me`, authenticated APIs and authenticated token helpers enforce
  the provider's email confirmation when verification is enabled. Phone
  confirmation and user metadata are not proof. Development local JWT/demo
  shortcuts cannot bypass this policy. Logout remains available.
- Redirects continue to use configured APP_URL, not request Host/Origin headers.

## Evidence

TypeScript PASS; production build PASS (non-failing bundle-size warning);
167 tests across 14 suites PASS, no skipped tests. New real-Express tests use
disposable local PostgreSQL and mocked Supabase/invitations/mail only.

After restart, the running server's staging target, verification policy, disabled
demo/app mail and absence of inherited PG defaults were verified. `/live` and
`/ready` returned 200; guest `/api/me` and academic API returned 401.

A read-only staging public Auth settings request confirmed:

- Email provider enabled.
- Provider auto-confirmation disabled.
- Public signup still enabled: invitation-only provider configuration is NOT
  ready, despite the app's own invitation enforcement.

There is no configured Supabase Management API access token. SMTP, dashboard
redirect allow-lists, templates and actual email delivery remain unverified.

## Minimal owner steps — staging project only

1. In Supabase Authentication settings for the staging project, turn OFF
   **Allow new users to sign up**. Keep Email enabled and Confirm email ON.
   The application creates invited identities through its server-side admin API.
2. Set Site URL to this staging Repl's current APP_URL origin. Add exact redirect
   URLs on that same origin for `/auth/verify`, `/verify-email`, `/reset-password`.
   Do not substitute a production domain.
3. Configure a staging/sandbox SMTP sender in Supabase Auth. Do not reuse
   production mail credentials or change the app declaration to custom_smtp
   before a working staging configuration is established.
4. Check confirmation and recovery email templates. Supported token-hash links:
   `{{ .SiteURL }}/auth/verify?token_hash={{ .TokenHash }}&type=signup`
   and `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`.
5. After the settings-only review, separately authorize a controlled delivery
   test to a designated owner-controlled test inbox. No such test ran here.

## Assurance boundary

A historical administrator-auto-confirmed identity has the same provider
confirmation timestamp as an email-confirmed identity. Existing timestamps alone
cannot prove inbox ownership or past delivery. Do not claim historical identities
were reverified or reset them automatically; review them separately before real
onboarding. Newly invited signup and unconfirmed-token denial are tested.

Application-side remediation PASS; end-to-end Auth release readiness remains
NO-GO until invitation-only provider settings and controlled delivery are proven.

## Public-signup-disabled compatibility review

The staging public health endpoint reported Supabase Auth `v2.197.0`; its public
settings still reported signup enabled, email auto-confirmation disabled, and
Email enabled. These were read-only requests. No provider settings were changed.

The matching upstream implementation separates public signup from the workflow
used here:

- [`signup.go`](https://github.com/supabase/auth/blob/v2.197.0/internal/api/signup.go)
  rejects public `Signup` when `DisableSignup` is true.
- [`api.go`](https://github.com/supabase/auth/blob/v2.197.0/internal/api/api.go)
  routes `/admin/users` through admin credential enforcement, separately from
  public `/signup`, `/resend` and `/verify`.
- [`admin.go`](https://github.com/supabase/auth/blob/v2.197.0/internal/api/admin.go)
  `adminUserCreate` does not gate on `DisableSignup`; `EmailConfirm` controls
  confirmation of the newly created identity.
- [`resend.go`](https://github.com/supabase/auth/blob/v2.197.0/internal/api/resend.go)
  resends confirmation for an existing unconfirmed identity without a
  `DisableSignup` gate.
- [`verify.go`](https://github.com/supabase/auth/blob/v2.197.0/internal/api/verify.go)
  validates existing confirmation tokens without a `DisableSignup` gate.

The app claims an invitation before server-admin `createUser(email_confirm:
false)`, then uses existing-user `resend(type: signup)`. It does not call public
`signUp` or signup-by-OTP. Two additional regression tests model disabled public
registration and a failed resend, asserting no public-signup fallback or automatic
login. This establishes source/mock compatibility, not a live disabled-signup
rehearsal or proof of delivery. Existing server-only staging service credentials
remain necessary; delivery still depends on Auth SMTP, applicable mail controls,
templates and redirects.

The reviewed synchronization excludes local `.replit` environment settings,
agent memory, unrelated historical evidence changes and generated screenshots.
An importing staging operator must set the non-secret launcher requirements
described in `scripts/staging/README.md`. No production configuration is replaced.

## Reviewed synchronization validation

Revalidated the selective source tree based on remote S22b commit
`86a002a5112a6c626f438ed46b71f28442ecbc98`, rather than pushing the independent
Replit checkpoint history:

- 169/169 tests across 14 suites PASS, including the two new compatibility tests.
- `npm run check` PASS.
- `npm run build` PASS; existing non-failing bundle-size warning.
- Exactly ten reviewed source/test/documentation files; credential-literal,
  binary/generated-artifact, unintended-path and whitespace checks PASS.
- `.replit`, environment files, memory and screenshots excluded; package scripts
  and package lock unchanged.

Test execution excluded managed/hosted database URLs, Supabase credentials,
session secrets and inherited PG defaults. The HTTP suite started its own
disposable local PostgreSQL; provider and mail operations were mocked.
