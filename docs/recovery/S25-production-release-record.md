# S25 production release record

2026-10-28. Branch `claude/s25-production-release-and-student-visibility`, started at `0b72bfb` (S22b/S24 HEAD).
Supporting records: `s25-git-reconciliation-and-hosting.md`, `s25-security-readiness.md`,
`s25-production-migration-plan.md`. Production (Repl `lumiere-student-portal-v2`, Supabase `rheronevecsffaejteoj`)
and the `lumiereportal.app` domain were not changed in S25.

## 1. Branch and SHA

Final S25 code SHA: `1caf1af` (see the status section at the end for any later documentation-only commits).

| Commit | Content |
|--------|---------|
| `f9c7969` | Owner View as Student; server-side EN/FR preference; production auth fail-closed guard; S25 client write lockdown migration; staging smoke script preserved |
| `df69352` | Production migration, storage and advisor-triage plan with pre/post verification SQL |
| `45489a4` | French translation of the high-school student pages |
| `18092e2` | Awarding school's identity removed from student-reachable assistant knowledge, retrieval and memory |
| `a1cb646` | Guarded published-staging mode for the staging launcher |
| `230bcbc` | S20/S21 first-student journey fixtures repaired for provider-verified auth |
| `1caf1af` | French 404 page and phrasing |

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
- Published deployment: PENDING (see status).

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

## 8. Production deployment status

NOT DEPLOYED (owner approval required). Production remains the S16 build (`cd21764`, deployment `a24d52bb-…`).

## 9. Domain status

Unchanged: `lumiereportal.app` is attached to MockPortalNode. Cutover and rollback steps: `s25-git-reconciliation-and-hosting.md` §4.3.

## 10. Unresolved launch blockers

See status section.

## 11. GO / NO-GO

See status section.

## 12. Immediate next action

See status section.
