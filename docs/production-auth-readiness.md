# Production authentication readiness

Phase 5E separates runtime readiness from provider-configuration verification so the production app does not need Supabase Management API privileges.

## Runtime readiness

The production deployment declares:

- `APP_URL=https://lumiere-student-portal-v-2.replit.app`
- `AUTH_EMAIL_MODE=custom_smtp`

`/ready` treats `AUTH_EMAIL_MODE` as a non-secret deployment signal only. It is not proof that Supabase SMTP is configured correctly and it is not proof that an inbox can receive mail.

The runtime readiness check continues to verify the observable application-side conditions it can legitimately inspect, including production HTTPS configuration, Supabase/Postgres project consistency, required tables, demo-mode disablement, session-secret quality, and email-auth availability.

Since S03 it also requires:

- Supabase public signup to be **disabled** (`disable_signup: true` in the public Auth settings). Accounts are created only through the server's invitation flow, so the email provider must be enabled for login and recovery while Supabase's own signup endpoint stays closed (`authEmail` check).
- Every rate limiter, including the login, signup, password-reset and password-update limiters, to be on the shared Redis backend (`distributedRateLimit` check). Set `REDIS_URL`; if Redis is absent or fails to connect at startup the server falls back to per-instance memory limits and `/ready` reports not ready.

## Provider configuration check

Use the standalone read-only verifier before a production deploy or as a CI gate:

```bash
APP_URL=https://lumiere-student-portal-v-2.replit.app \
SUPABASE_PROJECT_REF=rheronevecsffaejteoj \
SUPABASE_ACCESS_TOKEN=<scoped-management-token> \
npm run verify:supabase-auth-config
```

The token is for CI/manual deployment verification only. It must not be added to the running Replit app. Use a fine-grained Supabase token with only the permission needed to read Auth configuration (`auth_config_read`).

The verifier refuses non-canonical project refs and performs only a GET against Supabase Auth configuration. It checks:

- Supabase Auth Site URL matches `APP_URL`
- redirect allowlist contains `${APP_URL}/reset-password`
- custom SMTP is configured
- Supabase public signup is disabled

It prints only safe status information and non-secret SMTP identity fields. It never prints the management token or SMTP password and does not PATCH provider configuration.

## Production email

Current production provider:

- SMTP provider: Resend
- sending domain: `auth.lumierepathways.com`
- sender: `Lumière <no-reply@auth.lumierepathways.com>`

Real inbox delivery is an end-to-end smoke requirement and cannot be inferred from `/ready` or the config verifier.

## Login/account model note

The application role authority remains `public.users`, matched to the Supabase Auth user ID. Since S03, authentication also requires an `active` row in `public.profiles`; a missing profile or a failed status lookup fails closed. The production `profiles` table has not been verified (see `docs/recovery/S03-remediation-record.md`).
