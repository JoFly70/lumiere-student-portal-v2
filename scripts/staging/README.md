# Staging-only startup safeguard

This launcher is exclusively for the disposable staging Repl. Package scripts,
lockfile and production configuration are preserved. Its development preview is
authorized to run through this guarded launcher; never publish from this guide.

## Enter credentials securely

In **this staging Repl's Secrets UI**, add:

- `STAGING_DATABASE_URL`: the session-pooler URL from Supabase project
  `tqgwoyzlnkqwkcjsiocd`, using user `postgres.tqgwoyzlnkqwkcjsiocd`,
  port `5432`, database `postgres`, and `sslmode=require` or stronger.
  URL-encode reserved characters in its database password. Other URL query
  options are deliberately rejected to prevent connection-target overrides.
- `SUPABASE_SERVICE_KEY`: this staging project's server-only service-role/secret
  key. Never put it in a `VITE_*`, `NEXT_PUBLIC_*`, or `PUBLIC_*` variable.
- `SUPABASE_ANON_KEY`: this staging project's public anon/publishable key.
- `VITE_SUPABASE_ANON_KEY`: the same public key, if supplied.
- `SESSION_SECRET`: at least 32 characters, exclusively for this staging app.

Do not edit, reveal, or use the managed `DATABASE_URL`.

The existing Replit environment must retain `S22_STAGING_PROJECT_REF` equal to
`tqgwoyzlnkqwkcjsiocd`, `S22_STAGING_CONFIRM` equal to
`staging:tqgwoyzlnkqwkcjsiocd`, and the exact staging `SUPABASE_URL` and
`VITE_SUPABASE_URL`. Any `NEXT_PUBLIC_SUPABASE_URL` must agree. `APP_URL` and
`PUBLIC_APP_URL` must equal `https://` plus this Repl's `REPLIT_DEV_DOMAIN`.

Set the non-secret staging development configuration
`ENABLE_EMAIL_VERIFICATION=true` and `ALLOW_DEMO_MODE=false`. The launcher refuses
missing/disabled verification or enabled demo mode, and forces verification on
and demo mode off in its application child. These settings are not credentials;
no workspace-specific `.replit` values need to be copied to another app.

## Activate only after owner authorization

1. Run `node scripts/staging/start.mjs --check` for offline configuration checks.
   This neither imports the application nor connects to a database.
2. Only when actual startup is authorized, use
   `node scripts/staging/start.mjs --start` as this Repl's Run command.
   Do not use the original `npm start` / `npm run dev` directly: those commands
   are intentionally preserved and do not apply this staging safeguard.

The launcher validates before spawning the existing application in development
mode. Its child environment receives the verified `STAGING_DATABASE_URL` as
`DATABASE_URL`; the managed value is never read or forwarded. Inherited `PG*`
variables and Node preload options are not forwarded. App-level email is disabled.
The service key is passed only to the server process, not to a frontend build.

Offline checks establish configured target identity, not DNS ownership,
credential authenticity, privileges, or database/schema readiness. Legacy JWT
keys are checked for role, project claim, and expiry, not cryptographic signature.
New-format opaque keys cannot prove project ownership offline; the owner must
source them exclusively from the staging project. Supabase Auth email settings
still require a separate staging-only review.

## Offline tests

`npm test -- tests/staging-startup-guard.test.ts`

Tests use password-free identity URLs, never generated credentials, and never
start an application server or a database.

App-level `EMAIL_ENABLED=false` does not disable Supabase Auth email. Do not run
hosted signup/resend/recovery tests without separate authorization for controlled
delivery. The S23 Auth tests mock provider/mail calls and use disposable local
PostgreSQL only; see `docs/recovery/s23-staging-auth-readiness.md`.

## Published staging deployment (S25)

The owner authorized a published, continuously reachable staging deployment of this same Repl
against the same staging project. It uses the same guard in a published mode:

- Deployment build: `npm ci && npm run build`
- Deployment run: `node scripts/staging/start.mjs --serve` (never `npm start`: that would read the
  managed `DATABASE_URL`)
- Deployment environment: the same staging identity/secrets as above, plus
  `STAGING_PUBLISHED_ORIGIN=https://<deployment>.replit.app` with `APP_URL` and `PUBLIC_APP_URL` equal
  to it. Only a `*.replit.app` origin is accepted, so the guard refuses the production custom domain.
- `node scripts/staging/start.mjs --check-published` runs the offline checks for that configuration.

The published child runs the production build (`dist/index.js`) with `NODE_ENV=production`, so the
production security headers and the S25 production auth guard apply; App-level email stays disabled.
