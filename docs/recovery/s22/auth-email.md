# S22 Authentication and email: flows, link formats, settings, rehearsal

Scope: what the app actually sends and accepts, the PKCE `?code=` finding (S20 item 7 / S21 section 25), the Supabase Auth settings staging and production need, and how the owner runs the hosted rehearsal.

Evidence labels used below:

- **LOCAL TEST** = proven by a test in this repo with no Supabase or network.
- **NOT RUN HOSTED** = needs the real staging Supabase project and a deployed app. This container cannot reach either (network policy, no credentials), so nothing hosted was run or simulated as real.

## 1. What the app sends, and in which link format

The app never calls `generateLink`, `inviteUserByEmail` or `signInWithOtp`. Every auth email is produced by Supabase itself (through the project's custom SMTP and email templates) as a side effect of exactly two server calls:

| Email | Trigger | Server call | Redirect passed | Link format Supabase produces |
|---|---|---|---|---|
| Verification (first) | `POST /api/auth/signup` when `ENABLE_EMAIL_VERIFICATION=true` | `auth.resend({type:"signup"})` via `sendInitialVerificationEmail` (`server/lib/email-verification.ts:62`, called at `server/routes.ts:265`) | `${APP_URL}/verify-email` | template-dependent, see below |
| Verification (again) | `POST /api/auth/resend-verification` (`server/routes.ts:470`, handler `server/lib/email-verification.ts:151`) | `auth.resend({type:"signup"})` on an isolated anon client (`server/routes.ts:465`) | `${APP_URL}/verify-email` | template-dependent |
| Password reset | `POST /api/auth/reset-password` (`server/routes.ts:312`, call at `:336`) | `supabaseAdmin.auth.resetPasswordForEmail` | `${APP_URL}/reset-password` | template-dependent |

Invitations are not emails: `POST /api/admin/invitations` (`server/routes/admin.ts:197`) returns a one-time token to the admin, who hands it to the student. `admin.createUser` (`server/routes.ts:187`) sends no email.

Link formats Supabase can emit, and what the client accepts:

| Format | Where it arrives | Accepted? | Code |
|---|---|---|---|
| Fragment `#access_token=...&type=signup` (implicit flow, `{{ .ConfirmationURL }}` template) | `/auth/verify`, `/verify-email` | yes; token introspected with `getUser`, success only if `email_confirmed_at` is set | `client/src/lib/verification-link.ts:37`, `server/lib/email-verification.ts:133` |
| `?token_hash=...&type=signup\|email` (custom template, recommended) | `/auth/verify`, `/verify-email` | yes; `verifyOtp` | `verification-link.ts:34`, `email-verification.ts:124` |
| Fragment `#access_token=...&type=recovery` | `/reset-password` | yes | `client/src/lib/recovery-token.ts` (`extractRecoveryToken`, `parseRecoveryLink`) |
| `?token_hash=...&type=recovery` (custom template, recommended) | `/reset-password` | yes (added in S22); exchanged on the server only when the new password is submitted | `recovery-token.ts` `parseRecoveryLink`, `server/lib/email-verification.ts` `exchangeRecoveryTokenHash`, `server/routes.ts:397` |
| `?code=...` or bare `?token=...` (PKCE) | any of the three pages | **no, by design**; the page now says so and offers a new link | below |
| Provider error `#error_code=otp_expired` | any | expired / invalid message; on `/reset-password` the request-a-new-link form is shown with the reason | `parseVerificationLink`, `parseRecoveryLink` |

## 2. PKCE `?code=` finding and decision

Facts (verified in code and `node_modules`):

1. `@supabase/auth-js` 2.80.0 defaults to `flowType: 'implicit'` (`GoTrueClient.js:24`). The three server clients (`supabaseAdmin`, `createUserAuthClient`, `getSupabaseClient` in `server/lib/supabase.ts`) never set `flowType: 'pkce'`. A PKCE email is only generated when the request that triggers it carries a `code_challenge`, which the client creates and pairs with a verifier it stores locally. `resend` does not send one, and `resetPasswordForEmail` on a non-PKCE client does not either.
2. The browser bundle has no Supabase client at all (no `@supabase/supabase-js` import under `client/src`), so no browser ever holds a verifier. Users are created by the server (`admin.createUser`).

Conclusion: no flow the app itself starts can produce a `?code=` link. A `?code=` link can only come from outside the app (for example a dashboard-initiated "send magic link"/recovery on a project with PKCE, a different client configured for PKCE, or a mis-edited template). Such a link can never be exchanged: there is no verifier, and `exchangeCodeForSession` would fail. There is therefore **no valid code-exchange path to implement**, and S22 does not add one (a LOCAL TEST asserts no `exchangeCodeForSession` and no `flowType: 'pkce'` anywhere in `server/` or `client/src`).

Decision (what changed):

- Guarantee by configuration: use `token_hash` templates (section 4). The verification and recovery pages and servers accept `token_hash`; the settings verifier warns when a template is not `token_hash`.
- Show an actionable message instead of a generic failure: `?code=` / `?token=` now yields reason `unsupported` ("This link format is not supported. Please request a new verification email and open the newest link.") with the existing resend link on `/verify-email` and `/auth/verify`, and the request-a-new-link form with the same explanation on `/reset-password`. English and French strings added (`client/src/i18n/modules/auth.ts`, keys `auth.verify.unsupportedBody`, `auth.reset.linkUnsupported`, `auth.reset.linkExpired`).
- Recovery with `token_hash` is new and additive: `/reset-password?token_hash=...&type=recovery` is stored only in page memory, scrubbed from the URL, and exchanged by `POST /api/auth/update-password` (`token_hash` + `recovery_type:"recovery"`) via `verifyOtp({type:"recovery"})` at submit time. The existing `access_token` path and every existing check (`hasRecoveryAuthenticationMethod`, `getUser`, `updateUserById`) are unchanged. Benefit: mail scanners that GET a link cannot burn a one-time recovery token, because nothing is consumed until the student submits a password.

## 3. Defects found and fixed in S22

| # | Defect | Fix | Proof |
|---|---|---|---|
| 1 | `?code=` links reported as generic "invalid" (verify) or silently ignored with the plain request form (reset). | Distinct `unsupported` state with message and resend path. | LOCAL TEST `tests/s22-auth-links.test.ts` |
| 2 | With `ENABLE_EMAIL_VERIFICATION=true` signup creates the account **unconfirmed through `admin.createUser`, which sends no email**. The student saw "check your email" but nothing was sent; only `/resend-verification` produced the first email. | Signup now sends the first verification email (best effort, never fails signup, address not logged). `server/routes.ts:265`, helper `server/lib/email-verification.ts:62`. | LOCAL TEST (helper + ordering check); the s20/s21 journey tests still pass. First real send: NOT RUN HOSTED |
| 3 | Reset-link redirect carried a dead `localhost:5000` fallback expression. | All three redirect sites use `authRedirectUrl(APP_URL, path)`; a test fails the build if any `redirectTo`/`emailRedirectTo` is assigned otherwise. | LOCAL TEST |
| 4 | Recovery links in `token_hash` form (the scanner-safe template) were unsupported. | Section 2. | LOCAL TEST |

Not defects: no code path builds a URL from `Host`, `Origin`, `Referer` or `X-Forwarded-*` (a LOCAL TEST scans all of `server/`). Note `server/lib/email.ts` and `server/lib/support-notifications.ts` build support-ticket links from `process.env.APP_URL || 'http://localhost:5000'`; they are not auth links and are out of scope, but production must have `APP_URL` set (`/ready` already enforces it).

## 4. Redirects: APP_URL only, staging and production by configuration

- Server: `resolvePasswordResetAppUrl(process.env.APP_URL, isProduction)` (`server/lib/auth-policy.ts:14`) returns the origin, or `null` in production when the value is not https or is localhost; reset then returns 503 rather than emitting a bad link. Verification emails then fall back to the Supabase Site URL, which must equal `APP_URL` (checked below).
- Changing from the staging origin to `https://lumiereportal.app` requires only: the `APP_URL` secret, the Supabase Site URL and redirect list, and the template (which uses `{{ .SiteURL }}`). No code change. LOCAL TEST covers the staging, Replit and `lumiereportal.app` origins, trailing slashes, http rejection, and a request carrying hostile `Host`/`X-Forwarded-Host`/`Origin` headers.
- Hosted proof that Supabase honours the redirect: the rehearsal compares the `redirect_to` host from `generateLink` with the `APP_URL` host (Supabase silently substitutes the Site URL when the redirect is not allow-listed, so a mismatch means a settings error).

## 5. Supabase Auth settings

Authentication > Providers > Email: enabled, **Confirm email ON**, **Allow new users to sign up OFF** (`disable_signup=true`; accounts are created only by the invitation flow).

Authentication > URL Configuration, staging (`<STAGING_APP_URL>` is the staging origin, no trailing slash):

- Site URL: `<STAGING_APP_URL>`
- Redirect URLs: `<STAGING_APP_URL>/auth/verify`, `<STAGING_APP_URL>/verify-email`, `<STAGING_APP_URL>/reset-password`

Production (project `rheronevecsffaejteoj`, published app today):

- Site URL: `https://lumiere-student-portal-v-2.replit.app` until cutover
- Redirect URLs: the same three paths on that origin

Production at cutover to the target domain:

- Site URL: `https://lumiereportal.app`
- Redirect URLs: `https://lumiereportal.app/auth/verify`, `https://lumiereportal.app/verify-email`, `https://lumiereportal.app/reset-password`; keep the Replit origin's three URLs while both are live, remove them after
- `APP_URL=https://lumiereportal.app`

Real paths used by the app: `client/src/App.tsx:76-79` (`/reset-password`, `/auth/verify`, `/verify-email`, `/resend-verification`). The server's own redirects use `/verify-email` and `/reset-password`; `/auth/verify` is the path the email templates below use. Wildcards (`<origin>/**`) are accepted by the verifier but exact entries are preferred.

Email templates (Authentication > Emails > Templates), recommended `token_hash` links so a mail scanner's GET cannot consume the token:

- Confirm signup: `{{ .SiteURL }}/auth/verify?token_hash={{ .TokenHash }}&type=signup`
- Reset password: `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`

The stock `{{ .ConfirmationURL }}` templates also work (fragment tokens) but are one-time GET links that scanners can consume; the verifier reports that as a warning.

## 6. SMTP requirements (custom_smtp)

Published app uses `AUTH_EMAIL_MODE=custom_smtp` (a non-secret signal read by `/ready`; it is not proof that SMTP works). Supabase Authentication > Emails > SMTP Settings needs: host, port, username, password, sender email and sender name (production: Resend, `no-reply@auth.lumierepathways.com`, per `docs/production-auth-readiness.md`). Staging should use its own sender or sandbox and never the production sender with real recipients. Env var names the app/ops side uses: `AUTH_EMAIL_MODE`, `APP_URL`, `ENABLE_EMAIL_VERIFICATION`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`; verifier only: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`. SMTP credentials live only in the Supabase dashboard, not in app env. Delivery and DNS (SPF/DKIM/DMARC) cannot be proven from code: NOT RUN HOSTED, owner confirms by inbox receipt.

## 7. Rate limits

App (per IP, Redis-backed in production):

| Endpoint | Limit | Source |
|---|---|---|
| `POST /api/auth/login` | 5 per 15 min | `server/middleware/rate-limit.ts:15` |
| `POST /api/auth/signup` | 3 per hour | `rate-limit.ts:141` |
| `POST /api/auth/reset-password` | 3 per hour | `rate-limit.ts:43` |
| `POST /api/auth/update-password` | 5 per 15 min | `rate-limit.ts:68` |
| `POST /api/auth/verify-email` | 20 per 15 min | `server/lib/email-verification.ts:173` |
| `POST /api/auth/resend-verification` | 3 per hour | `email-verification.ts:185` |
| all `/api` | 100 per 15 min | `rate-limit.ts:88` |

Supabase defaults (confirm in Authentication > Rate Limits; these are provider defaults, not read from this repo): built-in email sender is heavily limited (a few emails per hour, not for production) which is why custom SMTP is required; with custom SMTP the "emails sent" limit defaults to 30 per hour per project; a given user can be sent a confirmation/recovery email at most once per 60 seconds; OTP/token verifications 360 per hour per IP. The app's resend and signup both call the same provider path, so a student who signs up and immediately uses "resend" inside 60 seconds gets the provider's frequency refusal, which the generic response deliberately hides.

## 8. Session behaviour (how the app enforces it)

There is no app-side session store. Every authenticated request validates the bearer access token with `supabase.auth.getUser(token)` (`server/routes.ts` `getUserFromToken`, `/api/me` at `:651`), then requires `profiles.status = 'active'` (`server/lib/account-status.ts`). So expiry is the Supabase access-token lifetime (JWT expiry; default 3600 s, configurable under Authentication > Sessions) and the refresh-token policy; a forged or altered `exp` fails signature validation. Logout (`POST /api/auth/logout`) revokes the user's Supabase sessions, after which the same token is rejected. A successful password reset deletes every session for the user. Natural expiry waiting is not automated in the rehearsal (see below).

## 9. Hosted rehearsal (owner-run, staging only)

Script: `scripts/s22/hosted-auth-rehearsal.ts`. It refuses unless `assertStagingTarget({requireSupabaseUrl:true, requireAppUrl:true})` passes (named non-production project, `S22_STAGING_CONFIRM=staging:<ref>`, `SUPABASE_URL` equals `https://<ref>.supabase.co`, `APP_URL` not a production origin).

```bash
# preview, no network
npx tsx scripts/s22/hosted-auth-rehearsal.ts --dry-run

# real run
export S22_STAGING_PROJECT_REF=<20-letter staging ref>
export S22_STAGING_CONFIRM=staging:$S22_STAGING_PROJECT_REF
export SUPABASE_URL=https://$S22_STAGING_PROJECT_REF.supabase.co
export APP_URL=<staging app origin>
export SUPABASE_SERVICE_KEY=...        # staging service role
export S22_ADMIN_EMAIL=... S22_ADMIN_PASSWORD=...   # a staging admin
export S22_TEST_EMAIL_DOMAIN=<a domain you control>  # or S22_TEST_INBOX=you@gmail.com (becomes you+s22-<run>@gmail.com)
export S22_STUDENT_ID=<uuid of a synthetic staging student>   # optional, enables account linkage
npx tsx scripts/s22/hosted-auth-rehearsal.ts            # add --keep-user, --no-wait, --out=<file>
```

It creates one synthetic account (`s22-<run>@<domain>`), never a real student. Everything is driven through the app's own API except the three things that need the service role: `generateLink` (so the run does not depend on reading an inbox), the profile `inactive` toggle (restored in a `finally`), and cleanup. The app's limiters are real (login 5 per 15 min), so by default the script waits out HTTP 429 once per call; expect roughly 30 to 60 minutes unless `--no-wait`. Steps and what each proves:

`preflight`, `admin_login`, `uninvited_denied` (403 `INVITATION_REQUIRED`, no account created), `invitation_created` (via `/api/admin/invitations`), `wrong_email_denied`, `register` (no session issued), `unverified_login_denied`, `delivery_request` (real resend; **owner confirms inbox receipt, sender and link host**), `verification_link` (redirect host equals `APP_URL` host), `verify_via_app` (page route 200, verify, replay refused), `login`, `session_check` (`/api/me`), `session_invalid_denied` (forged, forged-expired, garbage, none all 401), `student_linkage`, `logout` (token rejected afterwards), `recovery_request` (identical response for known and unknown address), `recovery_link`, `password_reset` (wrong type refused, reset ok, replay refused, old password refused, new works), `inactive_denied` (existing token and login both 403, then restored), `natural_expiry` (NOT automated), `cleanup`.

Each step is `REAL_PASS`, `REAL_FAIL` or `NOT_RUN` with a reason; later steps are `NOT_RUN` if a prerequisite failed. Evidence is JSON passed through `redact()`, default `docs/recovery/s22/evidence/hosted-auth-rehearsal-<run>.json`; it contains statuses and short details only, never tokens, passwords or link hashes.

Settings check (read-only, needs a Supabase personal access token; without one it prints the checklist and exits 2 meaning NOT RUN):

```bash
APP_URL=<staging origin> S22_STAGING_PROJECT_REF=... S22_STAGING_CONFIRM=staging:... SUPABASE_ACCESS_TOKEN=... \
  npm run verify:supabase-auth-config -- --staging
# production, including the target domain's redirects:
APP_URL=https://lumiereportal.app EXTRA_APP_URLS=https://lumiere-student-portal-v-2.replit.app SUPABASE_ACCESS_TOKEN=... \
  npm run verify:supabase-auth-config
```

Checks: signups disabled, Confirm email on, Site URL equals `APP_URL`, the three redirect URLs present (for `APP_URL` and each `EXTRA_APP_URLS`), custom SMTP configured (existing check), and a warning when templates are not `token_hash`.

## 10. Results

| Item | Result | Label |
|---|---|---|
| `?code=` / `?token=` on `/auth/verify`, `/verify-email` shows unsupported + resend path | pass | LOCAL TEST (parser + page source + i18n EN/FR); rendered in a browser: NOT RUN |
| `?code=` on `/reset-password` shows message + request form | pass | LOCAL TEST (parser + source); rendered: NOT RUN |
| `token_hash` recovery accepted and exchanged at submit | helper and ordering pass | LOCAL TEST; real `verifyOtp` recovery: NOT RUN HOSTED |
| First verification email sent on signup | helper + ordering pass | LOCAL TEST; real delivery: NOT RUN HOSTED |
| All redirects derive from `APP_URL`, never Host headers | pass | LOCAL TEST |
| Staging origin and `https://lumiereportal.app` work by configuration | pass | LOCAL TEST (URL resolution); Supabase allow-list acceptance: NOT RUN HOSTED |
| Settings verifier (signups off, confirm on, Site URL, 3 redirects, EXTRA origins) | pass | LOCAL TEST (pure function); against real settings: NOT RUN HOSTED |
| Rehearsal orchestration | pass incl. negative cases, 429 wait | LOCAL TEST against a fake app (simulation, not hosted evidence) |
| Invitation, registration, verification, login, `/api/me`, logout, recovery, inactive denial, linkage on staging | not executed | NOT RUN HOSTED |
| Real email delivery, sender, DNS | not executed | NOT RUN HOSTED (owner confirms inbox) |
| Natural token expiry | not automated | NOT RUN HOSTED |

Remaining for the owner: apply the section 5 settings on staging and production, switch the two templates to `token_hash`, run the settings verifier and the rehearsal against staging, confirm the two real emails in the inbox, and keep the Replit origin in the allow-list until `lumiereportal.app` cutover completes.
