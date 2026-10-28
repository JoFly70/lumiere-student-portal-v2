# S24 isolated database gate and preview restoration

2026-10-28. Only the isolated staging Repl and approved Supabase staging project
`tqgwoyzlnkqwkcjsiocd` were used for hosted verification. No production, email,
payments, credentials, real students or public deployment were changed.

## Corrected skip diagnosis

The historical 110 skipped database cases were gated by local PostgreSQL binary
discovery, not by missing Supabase or TEST_DATABASE_URL credentials. The harness
assumed `/usr/lib/postgresql/16/bin`; PostgreSQL 16 was actually present through
Nix/PATH. It now discovers a complete executable installation through PATH,
resolves Nix symlinks, preserves a valid legacy installation and fails closed on
an invalid explicit S05_PG_BIN_DIR override.

The first execution also exposed stale provider mocks: application authentication
had correctly stopped accepting the old local-token bypass. The fixtures now
simulate external provider verification of their existing signed test tokens,
checking signature, issuer, identity and expiry and supplying confirmed synthetic
provider identities. Real application requireAuth, local account lookup and RBAC
remain unchanged. Tampered fixture tokens are explicitly rejected.

## Final verification

- Relevant database, academic, auth, security and staging-guard suites:
  **500 passed, zero skipped, zero failed**, across 28 files.
- Original UI regression file: **2 distinct checks passed**.
- Total unique passing checks: **502**, including the previously skipped 110
  database-backed cases and seven new discovery/provider regression checks.
- TypeScript: PASS.
- Lint: PASS, zero errors; 1,767 warnings under the existing baseline policy.
  No rules were relaxed and no automatic fixes were applied.
- Explicit production-mode frontend/server build: PASS. Existing PostCSS,
  annotation and bundle-size warnings remain nonblocking.

Tests were invoked in a child process with inherited managed DATABASE_URL,
STAGING_DATABASE_URL, PG-prefixed variables and Supabase/mail/payment credentials
excluded before value lookup. EMAIL_ENABLED=false and NODE_ENV=test were used.
Each database suite created its own temporary loopback-only PostgreSQL cluster,
applied fixture schema there and stopped/deleted its own cluster afterward.
No fixture migration, table rename or reset ran against retained Supabase data.
Billing cases exercised only local arithmetic/records, not a payment provider.

The main test selection:

    npx vitest run --maxWorkers=1 s11 s12 s13 s18-flight s19-staff s20-auth s22-auth s23-auth s24 staging-startup-guard s22-staging-guard s17-security-documents s18-document-review-privacy

Separate UI checks (exclude ignored review worktrees to avoid duplicate discovery):

    npx vitest run --config /dev/null --exclude 'generated-artifacts/**' client/src/components/staging-portal-corrections.test.ts

Do not use inherited database credentials to reproduce these commands. The
disposable fixtures must never be redirected to an existing shared database.

## Restored development preview and hosted smoke

Normal guarded workflow start restored service; no application redesign,
dependency installation or production configuration change was needed.
The launcher now emits sanitized child-start, child-exit and received-signal
events, with timestamps and exit codes but no URLs, credentials or environment
values. This is diagnostic instrumentation, not an automatic restart loop.

The existing confirmed owner-authorized synthetic student was rechecked with
an isolated no-email QA session. Its password and other owner sessions were not
retrieved/reset; records and published QA plan were retained.

Hosted APIs returned 200 for identity/profile, high-school programs/state,
academic projection, own documents and tickets. Guest profile access returned
401; student access to administration and another student's documents returned
403. Browser checks passed for real high-school dashboard, reload persistence,
High School/My Subjects with all five TEST ONLY electives, Documents/upload
control, Support/Create Ticket dialog, absent prototype navigation and the
university-only route denial/return link. No upload or ticket was submitted.
The direct developer prototype rendered; its earlier reported error was not
reproduced. No actual password login or email delivery was repeated.

## Availability limitation and release boundary

Available prior logs do not establish why earlier workflows stopped. Replit's
development-environment documentation allows inactivity-related suspension,
which is a possibility, not a proven explanation of these incidents:

https://docs.replit.com/core-concepts/project-editor/app-setup/development-urls

An active development preview is not a promise of unattended continuous hosting.
No paid service, external keep-alive, public deployment or production domain was
introduced. Future launcher lifecycle evidence can distinguish an observed child
exit or signal from an unexplained missing workflow, but an uncatchable compute
termination may not produce an application event.

The retained 16-core + 5-elective QA plan is TEST ONLY / NOT SCHOOL-APPROVED and
awards no official credits. Approved real elective/course selection and separate
production configuration/migration/storage/backup checks and owner sign-off
remain outside this isolated staging test gate.
