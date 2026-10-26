# S07 security acceptance matrix

Run 2026-10-26 in a container with **no hosted credentials**. Everything below ran against (a) a disposable local PostgreSQL 16 with the repository's real migrations behind a Supabase shim, (b) real Express routing/middleware with **locally signed HS256 JWTs**, or (c) mocked dependencies / unit tests. **Nothing here is production clearance and nothing was run against hosted Supabase Auth, hosted Postgres or Storage.** An "S07 Neon proxy credential" that exists in the environment is not designated for this portal and was not used.

Legend. Method: **PG+HTTP** = real local Postgres, real routes, local JWT. **PG** = real local Postgres, service-level. **MOCK** = HTTP/unit tests with Supabase and data dependencies mocked. **UNIT** = pure logic. Result: PASS / NOT TESTED / PARTIAL.

## A. S03 behavioural requirements (the eight "NOT TESTED" items from S03 closeout)

| # | S03 requirement | Exercised how in S07 | Result | Still UNVERIFIED against hosted Supabase |
|---|---|---|---|---|
| 1 | RLS under real anon/authenticated JWTs, incl. inactive accounts | Roadmap tables only: `s05-roadmap-db-integration` g (student reads own plan/progress, not versions/imports, cannot write any roadmap table), PG with role switching on the shim. Legacy and canonical tables: not exercised | PARTIAL (roadmap tables only) | RLS of the 18 legacy and 32 canonical tables under real Supabase JWT roles; shim roles are an approximation; inactive-account RLS helper `current_user_is_active()` |
| 2 | End-to-end HTTP flows: invite -> signup -> login; archived-user rejection incl. existing tokens; ban; logout | Not exercised (needs GoTrue). Account-status gate covered by S06 mocked tests (inactive/archived/pending/missing profile -> 403) | NOT TESTED / MOCK | Invitation lifecycle on hosted auth, token lifetime after archive/ban, logout revocation, `disable_signup` |
| 3 | Document workflows against real Storage | Not exercised | NOT TESTED | Signed upload/download, object existence, legacy paths |
| 4 | Cross-student access (horizontal authorization) | **S07 PG+HTTP** `s07-security-http`: student A cannot read or write student B's academic record, degree progress, profile or roadmap; B's title/ids/code/email never appear in A's responses even with `studentId`/header/query injection; reverse direction too. Existing: S06 (93 MOCK negatives), `s05-roadmap-http-e2e` (item keys resolve only in own plan) | PASS for academic record, degree progress, roadmap, profile write gate; documents/contacts/tickets/enrollments: PARTIAL (profile+contacts read gate 403/404 only; documents not run) | Real user<->student linkage from hosted `users`/`profiles`; documents, tickets on real data |
| 5 | Coach workflows (deny by default) | **S07 PG+HTTP**: coach is 403 on all 12 academic-credit mutations. Existing: `s05-roadmap-http-e2e` (coach 403 on roadmap API) | PASS (deny-by-default only) | Product decision on coach scope and any assignment model remains open |
| 6 | Rate limiting, CSRF, session revocation | S06 mocked Redis readiness + manual real-Redis run (limit, kill, restart). Not re-run in S07 | PARTIAL (S06 evidence only) | Multi-instance Redis limiting, failover, CSRF coverage, session revocation |
| 7 | Production-schema questions | Not exercised; local schema is migrations + shim | NOT TESTED | Whole production schema parity; whether S03 SQL was ever applied |
| 8 | 192 hosted-project-gated tests | Still skipped (they refuse non-matching projects) | NOT TESTED | All 192 |

## B. Academic-integrity guarantees (S03 section 4, S05, S06)

| Guarantee | Source | Exercised how | Result |
|---|---|---|---|
| Student cannot change credit, program assignment, decisions, exceptions or placements | S03/S04/S07 | **S07 PG+HTTP**: 12 staff/admin mutation endpoints -> 403 for student (other and own record) and coach, 401 anonymous; `student_credit_records`, `student_credit_decisions`, `student_credit_verification_events`, `student_program_assignments` byte-identical (count+md5), no exceptions, no placements | PASS |
| Staff access is not a blanket deny (control) | S07 | staff GET of student record 200 | PASS |
| Student cannot see staff academic/degree-progress/workspace/roadmap views | S06/S07 | **S07 PG+HTTP** 403 for own and other id | PASS |
| `GET /api/student/academic-record` and `/degree-progress` resolve only the authenticated user | S04/S06/S07 | **S07 PG+HTTP** with two real students, injected `studentId`/`student_id`/`x-student-id`; `?studentId` -> 400 | PASS |
| Roadmap APIs: student 403 on all admin endpoints; `studentId` anywhere -> 400; publish admin-only; unauthenticated 401; staff cannot use student API | S05 | `s05-roadmap-http-e2e` PG+HTTP (22 tests); S07 adds draft/acknowledge/discard/from-published/publish 403 and zero plans created | PASS |
| Published content immutable, events append-only, one open draft/one published per plan, student cannot write any roadmap table | S05 | `s05-roadmap-db-integration` g (DB triggers, unique indexes, RLS) | PASS |
| Concurrent publish: exactly one wins, stale -> 409 | S05/S07 | PG: S05 e (x4) + **S07** concurrent publish of a draft carrying acknowledged review warnings | PASS |
| Optimistic revisions on student progress; stale -> 409 | S05 | PG + HTTP | PASS |
| Plan review cannot create/alter credit; reported history is not credit | S07 | UNIT + PG: reported credits compared against the canonical record only to raise a warning; canonical tables identical after publish and student report | PASS |
| Student cannot report official acceptance; provider-complete is not accepted | S05/S07 | UNIT/PG: schema rejects the status; only a staff link to a canonical record shows `officially_accepted` | PASS |
| Legacy `/api/enrollments` locked for students (`ROADMAP_STAFF_MANAGED`); table stays empty | S05 | `s05-roadmap-http-e2e` (Supabase-token path mocked) | PASS (MOCK for token path) |
| Student profile controlled fields (residency, eligibility, status) -> 403 | S03 | `s03-student-records` MOCK only. S07 attempted real HTTP: the legacy students repo reads through Supabase, which is mocked here, so the own-profile case could not run (500). Cross-student write gate (403) is covered | PARTIAL (MOCK) |
| Degree-progress endpoint: 401 for missing/malformed/expired/tampered/alg=none/wrong-issuer; 403 for inactive/archived/pending/no profile; no diagnostics leaks | S06 | `s06-student-degree-progress-security` (93 MOCK tests) + the manual disposable GoTrue run recorded in S06 | PASS (MOCK + S06 manual) |
| Roadmap student view hides staff-only data (staff notes, credit links, reported history) | S05/S07 | `s05-roadmap-projection`, preview tests; reported history lives in content that the projection does not emit | PASS (UNIT) |

## C. Result counts (final run of this change)

- `npx tsc --noEmit`: 0 errors.
- `npx eslint` on the changed files: 0 errors, 0 warnings.
- `npx vitest run` (full suite): **70 files passed, 8 skipped (78); 1700 tests passed, 192 skipped (1892)**. The 192 skipped are the hosted-project-gated suites (unchanged).
- New in this change: `tests/s07-academic-regression.test.ts` 31 tests (28 unit/service, 3 real Postgres; includes 1 `it.fails` pinning a documented projection gap), `tests/s07-security-http.test.ts` 11 tests (real Postgres + HTTP).

## D. Explicitly unverified (hosted Supabase and production)

1. Real Supabase Auth: JWT issuance/verification against GoTrue, token expiry, revocation after ban/archive, `disable_signup`, email provider. Local tests sign their own HS256 token; anyone holding the secret can mint one.
2. Hosted `users`/`profiles` account-status lookup (mocked in every HTTP test here).
3. RLS on hosted Postgres under real anon/authenticated roles; production schema parity; whether the S05 migration and S03 SQL are applied there.
4. Storage, documents, tickets, signed URLs.
5. Full `server/index.ts` stack (helmet/CORS/CSRF, Redis rate limiting), multi-instance behaviour.
6. Browser behaviour and admin UI for the new plan-review warnings.
7. Independent third-party security testing. This matrix is developer-run evidence, not a penetration test.
