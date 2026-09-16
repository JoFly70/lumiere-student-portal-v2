# Production authentication readiness

Phase 5E separates runtime readiness from provider-configuration verification so the production app does not need Supabase Management API privileges.

## Runtime readiness

The production deployment declares:

- `APP_URL=https://lumiere-student-portal-v-2.replit.app`
- `AUTH_EMAIL_MODE=custom_smtp`

`/ready` treats `AUTH_EMAIL_MODE` as a non-secret deployment signal only. It is not proof that Supabase SMTP is configured correctly and it is not proof that an inbox can receive mail.

The runtime readiness check continues to verify the observable application-side conditions it can legitimately inspect, including production HTTPS configuration, Supabase/Postgres project consistency, required tables, demo-mode disablement, session-secret quality, and email-auth availability.

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

It prints only safe status information and non-secret SMTP identity fields. It never prints the management token or SMTP password and does not PATCH provider configuration.

## Production email

Current production provider:

- SMTP provider: Resend
- sending domain: `auth.lumierepathways.com`
- sender: `Lumière <no-reply@auth.lumierepathways.com>`

Real inbox delivery is an end-to-end smoke requirement and cannot be inferred from `/ready` or the config verifier.

## Login/account model note

`public.profiles` exists and is part of the canonical account schema, but login authorization does not depend on a profile row. The application role authority remains `public.users`, matched to the Supabase Auth user ID.
