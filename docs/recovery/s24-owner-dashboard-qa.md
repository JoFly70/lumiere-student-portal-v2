# Retained synthetic high-school dashboard QA

Date: 2026-10-28. Scope: isolated development preview and Supabase staging
project `tqgwoyzlnkqwkcjsiocd` only. GitHub review base:
`63eeed792ba86c08cc11c31cf8181a04c2ea957e`.

## Retained fixture and limits

The previously confirmed, owner-authorized synthetic Auth identity is still a
student, with its original password unchanged. It now has one linked, clearly
marked synthetic student profile, activated using the same administrative status
operation as the existing admin endpoint. The provisioner used explicitly
owner-authorized server/service-role authority, not a fabricated admin login or
an elevation of the student's role. Admin UI activation was not repeated.

Its active high-school enrollment uses `us-hs-diploma-21`, version 2. The existing
16-core-credit template structure was retained. Five one-credit electives are
explicitly labelled **STAGING TEST ONLY / NOT SCHOOL-APPROVED** placeholders,
not claimed school offerings. The published student message repeats that warning.
The existing publication validator accepted the 21-credit plan without exceptions
or validation bypass. No official credits, results, grades, tuition, receipts,
graduation or school certification were recorded.

The owner requested retention: account, profile, enrollment, QA plan and their
audit evidence remain available for personal inspection. No preexisting records
were deleted, no new Auth account created, and no external mail sent.

## Actual hosted checks: PASS

Guard verified the running server's launcher, expected project and Supabase URL,
verified staging connection/TLS, and absence of PG overrides before provisioning
or hosted data access. The managed Replit database was not used.

All returned 200 with the actual synthetic student's authenticated session:

- `/api/me`
- `/api/students/me` — exact account/profile linkage checked privately
- `/api/student/programs` — exactly one high-school program, no university program
- `/api/student/high-school`
- `/api/student/academic-projection`
- `/api/documents/student/<synthetic-student>`
- `/api/tickets`

Authorization: unauthenticated student profile request **401**; student request
to administrative high-school route **403**; request for a different,
nonexistent synthetic student's documents **403**.

Browser automation used a real, no-email Supabase session obtained for the
existing confirmed account through admin magic-link generation and SDK exchange.
No password was retrieved, changed or submitted. SDK session refresh passed.
Only the runner's own refresh session was revoked afterward; other owner sessions
were not globally signed out.

Actual browser interactions:

1. Opened the real `/flight-deck`; high-school dashboard rendered, showing
   **0 official credits out of 21**, with the QA credits planned.
2. Reloaded; authenticated high-school dashboard persisted.
3. Confirmed the prototype navigation link was absent.
4. Clicked the **High School** sidebar link, then **My Subjects** and expanded
   **Electives**; all five labelled placeholder courses were visible.
5. Clicked **Documents**; the actual document screen and upload input rendered.
   No file was uploaded in this run.
6. Clicked **Support**, then **Create Ticket**; the dialog opened.
   No ticket was submitted.
7. Opened `/roadmap`; the existing university-only notice prevented university
   content. Clicked its **Go to my High School page** link successfully.
8. Opened `/preview/flight-deck` directly: synthetic prototype rendered without
   an error. The reported broken prototype was not reproduced. Its student
   navigation entry has nevertheless been removed entirely.

Screenshots were inspected locally with rendered email addresses masked.
They and browser profiles are not committed; temporary browser session profiles
are removed after the run. No tokens, links, passwords, account identifiers or
email addresses are included in this evidence.

## Verification

- Relevant high-school, publication, auth, startup-guard, privacy/security and
  S24 regression tests: **383 passed; 110 opt-in database tests skipped**.
- Separate student-navigation/empty-state regression tests: **2 passed**.
- Total executed: **385 passed**. Skipped tests are not claimed as passing.
- TypeScript: **PASS**.
- Explicit `NODE_ENV=production npm run build`: **PASS**.
  Existing PostCSS, Zod annotation and bundle-size warnings are nonblocking.
- Source/tests were checked in a separate worktree based on the current remote
  staging branch, with no production settings or environment files copied.

A parallel preview/QA database failure (SQLSTATE XX000) was resolved by bounding
both guarded development process pools. Production pool options are unchanged.
Driver diagnostics now preserve safe cause codes without SQL/bound data.
The runner closes its database pool explicitly.

Repeated exploratory QA also exhausted the existing API rate quota. The final
runner honored Retry-After rather than weakening protections, spoofing an IP or
restarting solely to clear the quota. Browser waits synchronize navigation,
program-aware sidebar loading and collapsed subject groups.

## Reproduce safely

Use the existing guarded staging development preview. Set the original synthetic
owner address privately in `S24_OWNER_TEST_EMAIL` for the invoking process; do not
commit it or use a real student's address. Remove inherited `DATABASE_URL` and
all PG-prefixed environment variables before invocation.

Run with `node --import tsx scripts/staging/owner-dashboard-qa.mjs --verify`.
The explicitly authorized `--provision` mode is idempotent for the exact marked
fixture, and refuses an already linked non-QA student. It must not be used for
ordinary enrollment. Session generation is no-email and does not reset passwords.

## Owner's next view and release boundary

Refresh the preview and open Flight Deck → High School → My Subjects.
This is now a retained, usable **synthetic staging demonstration**, not approval
for a real student's curriculum. School-approved elective names/course selection
and the separate production release approvals remain outstanding. Production,
domains, DNS, payments, SMTP and public deployment were untouched.
