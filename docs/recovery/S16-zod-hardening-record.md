# S16 validation dependency hardening

## Scope and outcome

Patched upstream Zod 4.6.7 replaces Zod 3.25.76. The associated
CVE-2023-54404 / GHSA-mrhx-c7xc-m3w5 is no longer reported by npm audit.
No overrides, advisory suppression, or security-policy bypasses were used.
The existing S16 application and release branch are retained.

Compatible integrations are drizzle-zod 0.8.3 and @hookform/resolvers 5.9.2.
The unused production dependency zod-validation-error was removed.

## Compatibility and security boundaries

- API validation errors use Zod 4 `issues`, retaining existing response envelopes.
- Dictionary validation supplies an explicit string-key schema.
- Course forms distinguish raw input from parsed output. Numeric string credits
  still become numbers, credit bounds remain unchanged, and self-reporting cannot
  select the staff-controlled completed status.
- Partial student, contact, program, course and enrollment updates remove creation
  defaults before becoming optional. Omitted fields never reset stored credits,
  enrollment status, consent, contact scopes or identity preferences.
- Synthetic Knowledge test identifiers now conform to Zod 4's RFC UUID checks.
  No stored identifiers or data were changed.
- Ordinary JSON and form bodies remain bounded at 100 KiB; staff roadmap JSON
  imports retain their 2 MiB allowance. Exactly one JSON parser handles a request,
  preventing the ordinary limit from being reapplied to a parsed roadmap import.
  Raw JSON bytes remain available for signature verification.

## Verification

- Clean `npm ci`, TypeScript and fresh production build: passed.
- Focused suite: 746 tests passed across 28 files, including the existing S16
  curriculum/navigation tests, academic credit projections, authentication policy,
  real Knowledge router tests with mocked dependencies, and storage tests.
- Two new suites exercise request-size rejection before route validation,
  partial-update preservation, error serialization, real form resolver behavior,
  strict actor-spoof rejection and a first-student 21-credit draft.
- Tests ran in an isolated environment without inherited application credentials.
  The PostgreSQL-backed full first-student journey was deliberately not run:
  it creates a database and performs writes, prohibited for this hardening.
- Changed-file ESLint: zero errors; existing/style warnings remain.
- The rebuilt production-mode workspace serves the new client asset byte-for-byte.
  Root and liveness return 200; four protected API probes return 401 without
  authentication. Login renders. Client asset scanning found no service-role
  credentials; runtime browser configuration exposes a publishable key.

| Audit scope | Critical | High | Moderate | Default audit exit |
| --- | ---: | ---: | ---: | ---: |
| Full dependency tree, including build tooling | 0 | 0 | 8 | 1 |
| Production dependencies (`--omit=dev`) | 0 | 0 | 2 | 1 |

Both scopes pass `--audit-level=high`. This does **not** mean a clean audit:
the default audit commands still exit 1 for the disclosed moderate findings.
The production findings are ExcelJS and its UUID dependency, from
GHSA-w5hq-g745-h8pq. Remaining development chains involve esbuild under Drizzle
tooling and postcss-selector-parser under Tailwind typography.

No Supabase changes, migrations, invitations, student onboarding, payment
operations or deployment were performed. Secrets, domain and deployment settings
are preserved. Publishing remains a separate owner-reviewed action; these tests
do not verify signed-in production screens.

The existing no-Redis operating restriction is unchanged: publish with autoscale
max instances = 1, as required by the S16/S14 release records. Missing Stripe
configuration is unchanged; this work enables no payment processing.
