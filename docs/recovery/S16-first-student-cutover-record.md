# S16: First high-school student production cutover

**Production was NOT deployed in S16.** No live database write, schema change or Replit publish happened. The session stopped at the owner approval point (section K). Two things block it: the owner has not yet authorized live actions, and this session cannot reach the hosts (section I).

## A. Branch and SHA

| Item | Value |
|---|---|
| Branch | `claude/s16-first-student-cutover` (started at `b2c7f11`, the S13 tip) |
| **Release-candidate code SHA** | `3bec8f7f06a2365540ca2d3ec044c87ad64f23e6` |
| Branch head | The commit that adds this record (docs only on top of `3bec8f7`; deploying the head is equivalent). The exact head SHA is reported in the chat closeout. |
| Verified input heads | S13 `b2c7f11`, S14 `11ea8e8`, S15 `34c24a7`. All match the brief. S12 and `main` were not touched. |

## B. Consolidation

| Input | Result |
|---|---|
| S13 | Base of S16, unchanged apart from the changes listed in C. |
| S14 | All 10 files were checked out verbatim from `11ea8e8`: the runbook, `scripts/release/s14/*` and the S14 record. S14 was a pure addition on S13's parent `21341a4`. S13 added no migration, `.replit` or `package.json` change after that commit, so S14's order still holds. Rehearsed again on S16 (F). |
| S15 | Used **read-only**. None of its four staff documents or its record was copied: they name the awarding school, and the repository is public. Only the sanitized title corrections went in. `git grep -i "penn foster\|pfhs"` on S16 returns nothing. |

## C. Application changes (commit `3bec8f7`)

1. **Curriculum template v2** (`shared/high-school-contract.ts`), described in E.
2. The **create-program picker** offers only the latest version of each template (`latestTemplateVersions`). Enrollments on v1 still load v1.
3. **School student reference**: staff can now edit it in the "Edit program" form (`program-section.tsx`). The server already accepted it.
4. **Elective status**: when no electives are planned yet, the student sees "Your electives are being confirmed with your school. Your advisor will add them here." (`subjects-tab.tsx`).
5. **Billing navigation** is hidden for high-school-only students, in the sidebar and the mobile bar. The page only said "not connected". The `/billing` route remains.
6. **`.replit` deployment build**: `build = ["sh","-c","npm ci && npm run build"]`. A publish can no longer ship a stale `dist/`.

There was no redesign. Themes and mobile layout are unchanged. The invitation and add-student controls were not touched.

## D. Database scripts (from S14, unchanged)

The release order is the same as S14 runbook step 4:

`10-prereq-tables` → S05, S07, S09, S08, S10 idx, S10 repair, S11, S11 audit (existing migrations) → `30-account-gate` → `35-client-privilege-hardening` → `scripts/disposable-env/90_storage_buckets.sql`.

The read-only checks are `00-baseline-probe`, `01-account-readiness`, `90-verify` and `smoke-hosted.sh`.

- **No schema change was needed for v2.** Templates are rows inserted on first use with `ON CONFLICT DO NOTHING`, so v2 is seeded automatically when the new server starts.
- Pre-S05 migrations are never replayed.

## E. Curriculum v2

`us-hs-diploma-21` **version 2**:

- **Totals:** 21 credits (42 half-units): 16 core (32 half-units) + 5 electives (10 half-units).
- **Courses:** 17 mandatory courses: 2 startup courses of 0.5 credit and 15 courses of 1 credit.
- **Title changes:**
  - `math-3` → `math-personal-finance` "Personal Finance"
  - `social-2` → `social-us-history` "U.S. History"
  - `social-3` → `social-us-gov-econ` "U.S. Government and Economics"
  - `health-pe` → `health-nutrition` "Health and Nutrition"
- These titles come from the school's public curriculum page. **The school's written confirmation is still pending.**
- **Order** is the listing order. No school-approved sequence was invented.
- **Unconfigured, as before:** transfer maximum, exam attempts, days between exams and passing percentage.
- **No electives in the template**, because the draft builder plans every template course. Staff add the 5 elective credits per student with "Add a course" (area: Electives). S15's five suggestions are recommendations and were **not** assigned.
- **v1 is unchanged:** placeholders, keys and the TN-22 template that derives from it all stay as they were. Existing drafts are not affected.

## F. Testing (all LOCAL; no hosted test ran)

| Check | Result |
|---|---|
| `tsc` | PASS |
| `npm run build` (vite + esbuild) | PASS. The client bundle contains no `SUPABASE_SERVICE` or `service_role` string. |
| ESLint, changed files | PASS: 0 errors (20 existing warnings) |
| `tests/s16-curriculum-v2.test.ts` (new) | 8/8 PASS. Checks the 21/16/5 totals, the 17 courses, the titles, v1 being preserved, the latest-version picker, the absence of an institution name, and that a v2 draft plus five 1-credit electives validates and publish-gates clean. |
| S13 first-student journey (local PG, real HTTP) | 13/13 PASS. The first student now enrolls on **v2** and the second student stays on v1, so both coexist. |
| S11 + S13 HS suites (projection, service-DB, HTTP e2e, staff UI, student views, presentation, security, account linkage, navigation) | 325/325 PASS after one expected update (the template-list assertion now lists 3 versions) |
| S14 SQL rehearsal (`rehearse-local.sh`, disposable PG 16) | PASS: both passes rc=0; probe shows all APPLIED; every `90-verify` gate passes; synthetic smoke passes |
| Hosted: `00`, `01`, `90-verify`, `smoke-hosted.sh` | **BLOCKED**. This container's egress proxy refuses `*.replit.app` and `*.supabase.co`, and no Supabase credentials are attached. |
| S13's 60 browser checks | NOT RUN. S16's UI changes are one label, one form field and one nav filter, covered by the unit and nav tests. |

## G. Production status (read-only, verified via Replit connector, 2026-10-27)

| Item | State |
|---|---|
| Replit app | replId `33a30f4f-b01b-4abc-a2d8-e08f31fe10d9` |
| Published deployment | `a24d52bb-45d8-4fb8-89b8-4f688ba12b81`, status `success`, `https://lumiere-student-portal-v-2.replit.app`. Same as S14: nothing has changed since. |
| Workspace code | Still the pre-S01 legacy tree. `server/routes` has no `invitations`, `high-school` or `account` routes. `tickets.ts` is the legacy one. |
| Workspace `.replit` | No build step. It has an extra `postgresql-16` module, which is harmless. Keep the workspace's `[userenv]` and modules when replacing the code. |
| Supabase target | `rheronevecsffaejteoj`, according to the prior inventory. **Not re-verified** (blocked). Whether it is Portal-only is still **unknown**. |

## H. Deployment

**Not performed.**

## I. Blockers

1. **Owner authorization (APPROVE-B)** for the database steps and the publish. Not given yet.
2. **Hosted access from this session.** Egress to Supabase and Replit is refused, and there is no Supabase SQL access. The SQL steps and `smoke-hosted.sh` therefore have to run either from the owner's machine and Supabase SQL editor, or from a session whose network policy allows those hosts and has DB credentials.
3. **The production schema baseline (P2) and account readiness (P3) are unknown.** They must be read before any write.
4. **Shared-project scope.** The repo's own migration lineage includes `knowledge_evidence_source_metadata` and a `knowledge-evidence` bucket, so the knowledge records may belong to this Portal schema. That is still not proof that the project is Portal-only. **Decision: no reset. Apply only the additive Portal-scoped S14 sequence.** It drops nothing and touches no knowledge table.
5. **Rollback artifact.** The old deployment `a24d52b` is **not a safe rollback** because it carries the legacy ticket-attachment flaw. If S16 must be rolled back:
   - Preferred: redeploy S16 from the workspace tarball taken right after the build.
   - Otherwise: temporarily disable student access, by revoking invitations and keeping the student unlinked, rather than reopen the flaw.
   - Database changes are additive and can stay.
6. **School confirmations (not deployment blockers):** written confirmation of the four titles, the student's actual 5 elective credits, and disclosure authorization.

## J. First-student readiness

The code is ready for steps 1–12 of the mission, verified locally. The live sequence is S14 `RUNBOOK.md` steps 1–15, with these S16 differences:

- Step 3: the release SHA is the S16 branch head (A), not S13.
- Step 6: `npm ci && npm run build` now also runs automatically at publish. Still run it once by hand and record `sha256sum dist/index.js`.
- Step 11: enroll in **`us-hs-diploma-21` version 2**. It is the only version the picker offers.
- Step 12: the core titles are already corrected. Add the school-confirmed elective credits (5) under Electives, and enter the school reference in Edit program.

No student is invited until step 7 (hosted smoke) and `90-verify` pass.

## K. Owner approval package (APPROVE-B)

| Item | Value |
|---|---|
| Supabase | The project whose ref appears in Replit Secrets `SUPABASE_URL`/`DATABASE_URL` (expected `rheronevecsffaejteoj`). Scope: `public` Portal tables, functions, grants and policies, plus the `student-documents`/`documents` buckets as private. **No drops, no resets, no knowledge tables, no auth settings except "Allow new users to sign up = off".** |
| Replit | App `33a30f4f-…`, autoscale, max instances = 1, URL unchanged, Secrets unchanged |
| Git | `claude/s16-first-student-cutover` head (code `3bec8f7`) |
| Changes | S14 step 4 SQL sequence (additive); step 5 buckets and profile repair; step 6 code replacement and publish |
| Baseline results | **None yet.** P1–P3 must run first. Stop if a pre-S05 migration is ABSENT or PARTIAL, or if `escaping_paths > 0`. |
| Backup | Dashboard backup/PITR timestamp; `pg_dump -Fc` and `--schema-only`; workspace tarball before and after the build; old deployment id `a24d52b` |
| Risks | Staff lockout if an admin has no active profile (P3 detects it, step 5 fixes it); unknown baseline; rate limit per instance (no Redis) |
| Rollback | Section I.5. The DB stays as is. No destructive restore without separate authorization. |
| Unrelated resources | Not modified |

Reply with **"APPROVE-B S16"** (database steps 4–5 and publish of the S16 head), or approve them separately.

## L. Single next action

The owner runs P1 (confirm the project ref in Replit Secrets) and P2/P3 (`00-baseline-probe.sql` and `01-account-readiness.sql` in the Supabase SQL editor; read-only), shares the output, and replies APPROVE-B. The cutover then follows the runbook in one session.

## Confidentiality notice (owner action)

- The repository is **public** (verified).
- The S15 branch `claude/s15-hs-curriculum-enrollment` contains staff-only documents that **name the awarding school**.
- Recommendation: make the repository private, or delete that branch from GitHub after archiving it privately. Its commits remain reachable by SHA until GitHub garbage-collects them, so a private repo is the reliable fix.
- S16 did not change visibility, delete branches or rewrite history.
