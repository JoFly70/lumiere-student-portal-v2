# S06 — Security and infrastructure hardening record

**Branch:** `claude/s06-security-infra-hardening`, based on S04 `13deeca`. Not merged into S05 or `main`. Nothing was deployed. No hosted database or production credentials were used.

> This is not a production security acceptance. Every check below ran either with mocked dependencies or against a disposable local stack.

## 1. Redis rate-limit readiness (fixes S04 pre-production note 2)

**Readiness follows live Redis health.**
- `server/lib/rate-limit-store.ts` keeps a health flag.
- `trackRedisHealth(client)` updates the flag from client events:
  - `ready` sets it to true;
  - `end` and `reconnecting` set it to false;
  - `error` sets it to false only while `!client.isReady`.
- `checkRedisHealth` runs a bounded ping every 15 s as a backstop. It replaces the old 60 s ping, which only logged.
- While Redis is configured but unhealthy, `getRateLimitBackend()` reports `'memory'`. This makes `/ready` report `distributedRateLimit: false` and return not ready. It recovers automatically once the client is ready again.

**No stalls.**
- `disableOfflineQueue: true` makes commands reject immediately while the client is disconnected.
- `withCommandTimeout` (2 s) bounds commands that are already in flight.

**Fails closed.**
- A failed store call reaches express-rate-limit with `passOnStoreError: false`, so the request errors with a 500.
- There is no fallback to per-instance memory limits after a disconnect. The `'memory'` value above is only a readiness signal; the limiters keep using Redis.
- While Redis is down, rate-limited endpoints are unavailable. Readiness takes the instance out of rotation.

**Tests**
- `tests/s06-redis-readiness.test.ts`, mocked.
- A manual run against a real `redis-server` with real `redis`, `rate-limit-redis` and express-rate-limit over HTTP (limit 3):

| Phase | Backend | Ping | Requests |
|---|---|---|---|
| UP | `redis` | true | 200, 200, 200, 429 |
| Killed (SIGKILL) | `memory` | false | 500 ×4, each 1–8 ms |
| Restarted | `redis` | true | 200, 200, 200, 429 |

## 2. ESLint tooling (fixes S04 pre-production note 1)

- **Packages:** pinned exact devDependencies: eslint 9.39.5, @eslint/js 9.39.5, typescript-eslint 8.72.1, eslint-plugin-react-hooks 5.2.0, eslint-plugin-react-refresh 0.4.26, globals 15.15.0.
- **Scripts:** `npm run lint` and `npm run lint:changed`.
- **Config:**
  - Browser globals and the React rules apply to `client/` and `src/`. Node globals apply to the server, shared code, scripts and tests.
  - Bug-class rules are errors: rules-of-hooks, no-undef and parse errors.
  - Pre-existing style debt is temporarily downgraded to warnings.
- **Result:** 0 errors and 939 warnings, catalogued in `docs/recovery/S06-lint-baseline.md`.
- **Fixes:** a few mechanical, behaviour-preserving fixes. S04/S05-owned academic, Flight Deck and Roadmap files were deliberately left untouched.

## 3. Student degree-progress endpoint security (`GET /api/student/degree-progress`)

`tests/s06-student-degree-progress-security.test.ts` adds 93 negative tests with synthetic records. They run through the real `requireAuth`, `requireRole` and account-status gate, with only Supabase and the data dependencies mocked.

- **Identity:**
  - Missing, malformed, expired, tampered, `alg=none` and wrong-issuer tokens get 401.
  - Inactive, archived, pending or unknown status, and a missing or erroring profile, get 403.
  - Demo mode in production fails closed with 500.
- **Isolation:** every lookup uses only the authenticated user's ids, even when another student's ids are supplied in the query or headers.
- **Client identifiers:**
  - `studentId` in any form gets 400.
  - Other id-like query params and headers are ignored and never reach a dependency.
  - Path variants and other HTTP methods get 404.
- **Roles:**
  - Non-student roles and role-string variants get 403 on the student endpoint.
  - Students, coaches and staff get 403 on the admin degree-progress route. An active admin gets 200 (control).
- **No diagnostics:** deep key and value scans find no diagnostics, fingerprints, provenance, snapshot or rule ids, stacks, SQL or paths. The scans cover:
  - success responses;
  - CONFLICT, MANUAL_REVIEW, UNDER_REVIEW and NO_ACTIVE_PROGRAM responses;
  - every dependency-failure response, all of which return `{"error":"Internal server error"}`;
  - 401 and 403 bodies.

  A self-test proves that the scanner detects planted leaks.

No security defect was found and no production code was changed.

**Disposable integration run** (local Supabase CLI 2.122.0 stack in Docker, `apply-schema.sh` with 64 tables, three real GoTrue users, real routers over loopback; torn down afterwards):
- **401:** no token, a garbage token, a tampered token, an expired token, and a user with no `users` row.
- **200 `NO_ACTIVE_PROGRAM`:** real tokens for students A and B.
- **400:** `?studentId=`.
- **404:** the path variant, and a student with no student row.
- **403:**
  - an admin on the student endpoint;
  - a student on the admin route;
  - an inactive, archived or pending profile, and a missing profile.
- **Expected, not a defect:** a token self-signed with the stack's JWT secret is accepted. Anyone holding the JWT secret can mint tokens.

## Test results (integration of all three tasks)
- **`tsc --noEmit`:** pass.
- **`vitest run`:** 56 files and 1396 tests passed; 8 files and 192 tests skipped. The skipped tests are the hosted-project-gated suites.
- **`npm run build`:** pass.
- **`npm run lint`:** 0 errors, 939 warnings (baseline).

## NOT verified
- **Endpoint on real data:**
  - COMPOSED, UNDER_REVIEW and CONFLICT responses on real academic data. The live run covered only NO_ACTIVE_PROGRAM.
  - Cross-student isolation of real credit records.
  - Real engine and repository error shapes.
- **Production-like conditions:**
  - `NODE_ENV=production` against a real Supabase deployment.
  - Real GoTrue session expiry and revocation.
  - The full `server/index.ts` middleware stack with Redis-backed limiting.
  - Multi-instance Redis limiting and Redis failover or Sentinel.
- **Schema:** production schema parity. The disposable schema is a reconstruction.
- **S03 requirements:** all of the S03 behavioural security requirements outside this endpoint remain NOT TESTED.

## Production gates
- **Independent security acceptance:** an authorized tester must run it on a production-like environment.
- **Product decision on the Redis outage policy:** confirm that a Redis outage should make every rate-limited endpoint unavailable (current fail-closed behaviour). The alternative is that only auth endpoints fail closed.
- **Lint debt:** triage the lint baseline before promoting any warning back to an error.
