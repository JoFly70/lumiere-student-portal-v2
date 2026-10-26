# S07 integration record (S05 roadmap + S06 security/infra)

## Merge details

- Base: `claude/s05-excel-first-roadmap` @ 83e9829 (S05 final progress record).
- Merged: `claude/s06-security-infra-hardening` @ 5f7cbbc, merge commit **903b0c7**.
- Conflicts: **only `package-lock.json`**. Resolved by regenerating the lock with `npm install` from the S05 lock plus S06's devDependencies (ESLint toolchain), not by hand-merging. `package.json` merged cleanly.
- 64903c3 cleared the two S05-introduced ESLint errors (irregular whitespace, `ts-ignore`).
- dfc0822 extended the roadmap contract for two-workbook import (other S07 work). The S07 integration/audit work in this record is layered on dfc0822.

## Verification (this branch)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | clean |
| Full suite | `npx vitest run` | 71 files passed, 8 skipped; 1669 tests passed, 192 skipped. The 8 skipped files are DB-gated suites that need a hosted/credentialed database (phase1da, phase1db, phase1dc, phase2a, phase2b, phase2d x2, pre-replit-security) |
| S05 + S06 + S03 limiter + S07 | `npx vitest run tests/s05 tests/s06 tests/s03-rate-limit-store.test.ts tests/s07` | 18 files, 373 tests passed (includes real-Postgres S05 DB integration and HTTP e2e on the local PG 16 harness) |
| Lint | `npx eslint .` | 0 errors, 981 warnings (see `S06-lint-baseline.md`, "S07 integration") |
| Build | `npm run build` | succeeds (dist/index.js 939.8 kB) |

No hosted database or credential was used; Postgres tests run on the disposable local cluster from `tests/helpers/s05-local-pg.ts`.

## Redis and rate-limit evidence

- (a) S06 Redis disconnect/recovery and `/ready`: `server/index.ts` still calls `trackRedisHealth(redisClient)`, `configureRateLimitBackend(...)` with `sendCommand` wrapped in `withCommandTimeout`, and the periodic `checkRedisHealth`; `server/routes/health.ts` reports `rateLimitBackend: getRateLimitBackend()` (falls to `memory` when Redis is lost). `tests/s06-redis-readiness.test.ts` (ready, disconnect, failed ping, stalled ping, recovery) and `tests/s03-rate-limit-store.test.ts` pass unchanged on the merged tree.
- (b) Fail closed: no limiter sets `passOnStoreError` (asserted in `tests/s07-integration-compat.test.ts`). `tests/s06-redis-readiness.test.ts` proves a generic limiter errors (handler never reached) on a failing store. New in S07: the real exported `authRateLimit` (its `NODE_ENV=test` skip lifted for the request) is re-pointed via `configureRateLimitBackend` at a backend whose commands time out, and it errors without reaching the handler.
- Roadmap routes alongside the S06 changes: production `registerRoutes` serves all 8 staff and 2 student roadmap routes, each answering 401 without a token (mounted, requireAuth runs first). `server/index.ts` keeps the order: webhooks, `/api/admin` limiter, `/api` limiter, roadmap 2 MB JSON parser, default parser, health, routes.
- (c)/(d) Lint and S05 roadmap/academic tests: see the table above.

## Audit events (S07)

Existing infrastructure only: `createAuditLog` in `server/lib/audit.ts` (no second audit system). Events: `roadmap.import_created`, `roadmap.import_replayed`, `roadmap.draft_updated`, `roadmap.exceptions_acknowledged`, `roadmap.draft_discarded`, `roadmap.draft_opened_from_published`, `roadmap.published`, `roadmap.publish_rejected` (409 stale or 422 not publishable). Emitted through `server/routes/roadmap-audit.ts`, one line per route in `admin-student-roadmap.ts`, fire-and-forget. `createAuditLog` already no-ops when Supabase is unconfigured and swallows insert errors, and the helper additionally catches synchronous throws, so audit can never fail a request.

- Metadata is ids and counts only (actor id and role, studentId, versionId/Number, draftRevision, import id/sha256/template id, exception counts by severity, acknowledged count, rejection code). No workbook content, file names, notes or student personal data.
- The student is recorded as `target_resource_type=student_roadmap`, `target_resource_id=students.id`, not `target_user_id` (a FK to `users.id`).
- Operator step: `audit_logs.event_type` is the Postgres enum `audit_event_type`. Apply `supabase/migrations/20261026110000_s07_roadmap_audit_event_types.sql` (additive `ALTER TYPE ... ADD VALUE IF NOT EXISTS`); until then inserts for the new events are rejected and logged, with no effect on requests. It was not applied to any hosted database.
- Not audited: `preview_viewed` (read-only, noisy) and student progress writes. The append-only `student_roadmap_progress_events` table already records each progress write with actor and revision.
- Stale/concurrent publish rejection is covered by `tests/s05-roadmap-db-integration.test.ts` (concurrent publishes: exactly one wins; stale `expectedPublishedVersionId` or draft revision refused). Its audit is tested in `tests/s07-roadmap-audit.test.ts` (route level, captured sink, including a sink that rejects or throws) and `tests/s07-roadmap-audit-http.test.ts` (real HTTP stack over local Postgres: 422 and 409 rejections, acknowledge, publish).
