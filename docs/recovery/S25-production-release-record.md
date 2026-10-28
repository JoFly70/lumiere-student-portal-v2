# S25 production release record

2026-10-28. Branch `claude/s25-production-release-and-student-visibility`, started at `0b72bfb` (S22b/S24 HEAD).
Supporting records: `s25-git-reconciliation-and-hosting.md`, `s25-security-readiness.md`,
`s25-production-migration-plan.md`. Production (Repl `lumiere-student-portal-v2`, Supabase `rheronevecsffaejteoj`)
and the `lumiereportal.app` domain were not changed in S25.

## 1. Branch and SHA

Final S25 application code: `a970639` plus the S26 production-config commit (`.replit` production env); later commits are documentation only. The release SHA is stated in the S26 package.

| Commit | Content |
|--------|---------|
| `f9c7969` | Owner View as Student; server-side EN/FR preference; production auth fail-closed guard; S25 client write lockdown migration; staging smoke script preserved |
| `df69352` | Production migration, storage and advisor-triage plan with pre/post verification SQL |
| `45489a4` | French translation of the high-school student pages |
| `18092e2` | Awarding school's identity removed from student-reachable assistant knowledge, retrieval and memory |
| `a1cb646` | Guarded published-staging mode for the staging launcher |
| `230bcbc` | S20/S21 first-student journey fixtures repaired for provider-verified auth |
| `1caf1af` | French 404 page and phrasing |
| `a970639` | Unknown `/api` paths return JSON 404 (found by hosted acceptance) |

## 2. Git divergence resolution

The staging Repl workspace (`8a493dd`, 10 local-only commits) had zero diff to `0b72bfb` in `server/ shared/ client/ src/
tests/ package*.json`. The only useful local-only file, `scripts/staging/first-student-smoke.mjs`, was copied verbatim
into S25. Staging `.replit`, agent memory notes and smoke evidence stay local to the Repl. Before syncing, the Replit Agent
created the local backup branch `s24-replit-local-backup-8a493dd` at `8a493dd` and saved copies of `.replit` and memory.
Nothing was reset, force-pushed or deleted. The workspace now tracks the S25 branch; its staging-only `.replit`
lives in an unpushed local commit there.

## 3. Owner View as Student

`/admin/students/:studentId/view-as-student` (Admin only, button "View as student" in the student workspace).
- Server: `GET /api/admin/students/:id/view-as-student` returns the same `StudentHighSchoolView` and
  `AcademicProjection` the student's own endpoints return, plus a staff summary built only from stored records:
  credits earned (official) / remaining, reported-awaiting-school credit (never counted), courses underway,
  student-reported tasks, official results, pending evidence (review queue), last recorded activity (newest HS event),
  next milestone, and the student's saved language. No student session, token or password is used; there is no write
  route (POST/PUT/PATCH/DELETE 404). `Cache-Control: no-store`. Each view is audited (`profile.viewed`,
  surface `view_as_student`); staff/coach/student are refused 403 and audited as `high_school.access_denied`.
- Client: the student dashboard and High School pages render with the student components outside the actions
  provider (inert), with link navigation blocked inside the preview, a sticky "Read-only preview" banner,
  an EN/FR preview switch in a nested i18n provider (the owner's own language is not changed) and
  "Return to staff workspace".
- Tests: `tests/s25-view-as-student.test.ts` (API, refusals, no write surface, privacy, summary, screen).
- Hosted: see section 6.

## 4. French student experience

- High-school pathway (journey, subjects, graduation, family, prior education, states, actions) translated in a new
  `client/src/i18n/modules/high-school.ts`; English output unchanged. Official course titles, school names, grades and
  scores are data and stay as delivered. Credits use the French decimal comma.
- Dashboard (cockpit), auth, welcome, assistant, attachments, profile (S20) and support (S18) already had French.
  404 page translated.
- The EN/FR choice is now stored server-side (`user_language_preference`, `/api/student/preferences`) and synced on
  sign-in, so it follows the student across devices and is visible to the owner.
- Known English remainder on the student path: the generic school description and program title supplied as data by
  the server (e.g. "An accredited U.S. online high school") until the institution is disclosed.

## 5. Hosted staging

Staging Repl `AllGullibleBase` (`12005f5d-…`), Supabase `tqgwoyzlnkqwkcjsiocd`.
- S25 migrations `20261104100000_s25_user_language_preference.sql` and `20261104110000_s25_client_write_lockdown.sql`
  applied to staging in order, exit 0 each. Read-only verification afterwards: 190 passed, 0 failed, 1 informational
  (hosted-verify 130/130).
- Install, offline guard check, production build: PASS on the Repl. Development preview `/health`, `/live`, `/ready`,
  `/login`: 200.
- Published deployment: **https://all-gullible-base.replit.app** (Autoscale, deployment `587ed13b-c7e9-46b1-a47f-cf5ca05eb9a5`).
  Run command `node scripts/staging/start.mjs --serve`: the guarded launcher serves the production build with
  `NODE_ENV=production` and only the verified `STAGING_DATABASE_URL`; it refuses any origin but the declared
  `*.replit.app` one. Two-step first publish: the guard refused to serve until Replit had assigned the hostname and
  `STAGING_PUBLISHED_ORIGIN`/`APP_URL`/`PUBLIC_APP_URL` were set to it (fail-closed), then republished.
- Owner-configured staging Supabase Auth: Site URL = the published origin; redirects `/auth/verify`, `/verify-email`,
  `/reset-password`; public sign-ups, manual linking and anonymous sign-ins OFF; Confirm email ON.
- External checks of the published site: `/health` 200 (`environment: production`, database ok); `/login` renders
  (EN/FR, invitation tab); `/ready` 503 as expected for staging (`customSmtpDeclared=false` because staging uses the
  Supabase default mailer, `distributedRateLimit=false` because there is no Redis).

### Hosted acceptance, round 1 (published site, 22:53–22:55 UTC, no email, no new accounts)

| Check | Result |
|-------|--------|
| Guest: student profile, view-as-student | 401 PASS |
| Student: profile, HS view, academic projection, own documents, tickets, `/api/me` | 200 PASS |
| Roadmap totals 21 credits (16 core + 5 elective); all five electives labelled TEST ONLY; official earned 0 | PASS |
| Student → admin endpoints; student → a non-existent student's documents | 403 PASS |
| Language: save FR 200, read FR 200, `de` 400 | PASS |
| `/api/auth/me` (non-existent path) returned the SPA HTML with 200 | FAIL → fixed in `a970639` (JSON 404) |
| Admin View as Student, staff denial, real second-student isolation | NOT RUN (no synthetic admin/staff/second student) → round 2 |
| Browser: Flight Deck, prototype link absent, EN→FR toggle | partial; HS French headings not reached (timeout) → round 2 |

## 6. Application and database checks completed

Local (disposable PostgreSQL 16, no inherited credentials):
- Full bootstrap manifest applied twice: PASS, 71 file applications, verification 189/190 pass + 1 info.
- DB-backed suites (37 files): 572 passed, 0 skipped.
- S25 targeted: view-as-student, language preference, production auth guard, assistant confidentiality, HS French,
  staging launcher published mode, bootstrap manifest: all pass.
- S20/S21 first-student journey rehearsals: 38/38 (were failing since S22 provider-verified auth; fixture repaired).
- TypeScript: 0 errors. Production build: PASS; no service-role key in the client bundle.

Hosted: see status.

## 7. Security status

See `s25-security-readiness.md`. Summary:
- PASS: email-confirmation and inactive-account enforcement on every auth path; demo mode and local JWTs disabled
  in production; session-derived student scoping; credit awards only by staff with verified evidence;
  no unsafe legacy upload/attachment route; service key server-only; assistant has no write or cross-student access.
- FIXED: production now refuses to start without `ENABLE_EMAIL_VERIFICATION=true` (or with demo mode); `authenticated`
  lost all write privileges on public tables (defence in depth against permissive RLS such as a legacy
  `users_update_own`); `search_path` pinned on 20 helper/guard functions; awarding school's identity removed from
  student-reachable assistant output.
- Live advisor findings triaged (production plan section 6): the 6 authenticated-callable SECURITY DEFINER functions
  are intended RLS helpers; mutable search_path covered by the lockdown file; RLS-no-policy tables are server-only;
  pg_graphql exposure: optional revoke script; leaked-password protection: dashboard toggle.
- Production's `is_staff_or_admin()` and `student_owns_record()` already check active status (live evidence); the plan
  runs the S18 billing migration and the S22 restore in one transaction so that check is never lost.

### Not tested (deferred by owner order, 2026-10-28 ~23:40 UTC; NOT passed)

Round 2 of hosted acceptance was cancelled before it ran. The following were never executed on hosted staging and are
**DEFERRED**, not passed:

- Admin View as Student on the published site (incl. method rejection and the `profile.viewed` audit row). Locally
  covered by `tests/s25-view-as-student.test.ts` only.
- Staff role denials on the published site (locally covered by RBAC suites).
- Isolation between two real synthetic students on the published site (round 1 covered a non-existent foreign id only).
- Browser check of the French High School pages and the View as Student page on the published site (locally covered
  by render tests; round 1 browser run timed out before the HS page).
- Real email journey on hosted staging: invitation, verification email delivery, verify link, login/logout, password
  reset email, inactive-account denial. Never run in S25; no test email was sent.

The Replit Agent was told to stop the exercise, deactivate any "S25 QA" privileged identity it had created (the
23:26 UTC evidence shows none had been created), and delete any uncommitted harness.

## 8. Production deployment status

NOT DEPLOYED. Production remains the S16 build (`cd21764`, deployment `a24d52bb-…`). See S26 below.

## 9. Domain status

Unchanged: `lumiereportal.app` is attached to MockPortalNode. Cutover and rollback steps: `s25-git-reconciliation-and-hosting.md` §4.3.

## 10. Unresolved launch blockers

1. Production schema: 16 missing tables plus S25 objects (plan: `s25-production-migration-plan.md`), not applied.
2. Production deployment config: `ENABLE_EMAIL_VERIFICATION=true` was missing, so the S25 build would refuse to start
   in production. Fixed in the tracked `.replit` `[userenv.production]` (with `ALLOW_DEMO_MODE=false`); takes effect
   when the production workspace moves to the release SHA.
3. Distributed rate limiting: production has no `REDIS_URL`; production `/ready` returns 503
   (`distributedRateLimit=false`) by design. Owner decision in S26 package.
4. Production email delivery (custom SMTP in production Supabase Auth): declared (`AUTH_EMAIL_MODE=custom_smtp`) but
   never delivery-tested; the deferred email journey above is the gate.
5. Production Supabase Auth URLs for the production origins; production storage bucket (10 MiB, PDF/images only)
   must be raised to 20 MiB and 11 MIME types for S21 attachments.
6. Approved elective course selections for the first student (separate enrollment gate; the five electives remain
   STAGING TEST ONLY).
7. Repository is public; owner wants it private before real-student launch (owner action in GitHub settings).

## 11. GO / NO-GO

S25 (staging): **CLOSED.** Software release candidate built, migrated and live on staging; the student journey
verified on the published site; deferred items listed above.

First-student production release: **NO-GO until the S26 cutover package below is approved and executed**, and the
real-email login journey has passed once on production before the student is invited.

## 12. Immediate next action

Owner approves (or amends) the S26 cutover package in `docs/recovery/S26-production-cutover-package.md`.
