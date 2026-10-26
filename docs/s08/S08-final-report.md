# S08 — Student Support Center: final record

Branch `claude/s08-student-support-center`, cut from S05 `83e9829`. Not merged, not deployed.
Synthetic data only; no production database, no ClientDesk, no PowerEd, no live email.

## Reused (not rebuilt)

- Tables `support_tickets`, `ticket_comments`, `ticket_attachments`, `ticket_status_history`
  (finer topic, verified academic context and the "awaiting since" clock live in the existing
  `support_tickets.metadata` JSONB column).
- `supabaseAdmin`, `requireAuth` (incl. its inactive-account gate), `createAuditLog`,
  `sendEmail`, `resolveStudentUserId`, the S05 read-only `getStudentView`, the `/support` route,
  `routes.ts` mounting, the admin workspace's per-student ticket list, the S05 student UI
  primitives (`StudentSurface`, tokens).

## Implemented

- **API** (`server/routes/tickets.ts` as `createTicketsRouter(deps)`): ownership (student own,
  coach assigned, admin/staff all; 404 on no access), internal notes and their attachments never
  reach students, validated transitions, resolution notes required, 14-day student reopen window,
  no student priority/assignment changes, active staff-only assignees, `/stats/summary` reachable
  and authenticated, `/staff-directory`, `/context-options`, 503 instead of fake success when
  Supabase/storage/roadmap are unavailable.
- **Attachments**: path pinned to `tickets/<ticket>/<uploader>/…`, type allow-list, 10 MB, object
  existence verified, 300 s signed URLs, no public URL. Closes the previous hole where a student
  could register and download any object in the `documents` bucket.
- **Audit**: ten `support.*` event types (migration `20261027100000_s08_support_audit_events.sql`)
  replace `system.maintenance_mode` (create) and `admin.bulk_operation` (status). No message bodies.
- **Notifications**: HTML-escaped; student replies go to the assignee or support inbox (previously
  sent back to the student); never for internal notes; never claimed in responses.
- **Academic context**: optional `roadmapItemKey`, verified server-side against the student's
  current published roadmap; `/support?item=<key>` pre-selects it (integration point for S07).
- **Student UI**: Support Center with outstanding count, "Needs your reply" / "With Lumière" /
  collapsed "Resolved", topic tiles, who-acts-next banner, advisor vs student bubbles, resolution
  outcome, attachments, mobile drill-in.
- **Staff UI** (same `/support` route for admin/staff/coach): stats strip, queues (needs response,
  waiting on student, overdue, mine, unassigned, resolved), internal notes, reply-and-status
  actions, assignment, priority, resolution notes.

## Verification

- `npx tsc --noEmit`: clean. `npm run build`: succeeds.
- `npx vitest run`: 70 files passed, 8 skipped; 1647 tests passed, 192 skipped (baseline 1561/192;
  the skipped suites need an external database and were skipped before S08).
- New: `s08-support-routes` (48, HTTP over an in-memory Supabase fake, incl. real `requireAuth`
  for inactive accounts), `s08-support-contract` (14), `s08-support-presentation` (17),
  `s08-support-migration-db` (7, real disposable PostgreSQL 16 with the full migration chain).
- Trial merge with S07 tip `d69ee32` (scratch worktree): no conflicts, `tsc` clean,
  S08 + Phase 5D + integration + harness tests 119/119.
- Screenshots `docs/s08/screens/` (fixture renders, API stubbed); axe-core clean on all 11.

## Not tested

Real Supabase/PostgREST, real storage uploads and signed URLs, any email transport (none exists in
the repo; `sendEmail` only logs), database RLS policies for support tables, the Supabase-token
auth path, click-through browser interaction.

## Shared files changed

- `server/lib/audit.ts` — additive (event types + `auditSupport`). S07 also adds `roadmap.*` types
  here; git auto-merges.
- `client/src/hooks/use-tickets.ts` — support hook, also used by `admin-student-workspace.tsx`
  (backwards compatible).
- `tests/integration.test.ts`, `tests/phase5d-router-ownership.test.ts` — support mocks updated;
  another student's ticket now expects 404 (was 403).
- New `shared/support-contract.ts`. Untouched: `routes.ts`, `index.ts`, `App.tsx`, navigation,
  tailwind/global styles, roadmap/Flight Deck/projection/importer files.

## Open issues / risks

1. The audit enum migration must be applied before deploy; until then `support.*` audit writes fail
   (logged, request unaffected).
2. Production lineage (`PRODUCTION_DATABASE_SETUP.sql`) has no `ticket_attachments` /
   `ticket_status_history`; reads degrade to empty, attachment writes return 503. Confirm the live
   schema. Legacy `migrations/010` trigger on status history writes `'system'` into an FK.
3. If the opening comment insert fails after the ticket is created, the ticket is still returned 201.
4. Admins land on `/admin`; reaching the staff desk needs a nav link (S07 owns navigation).
5. Overdue filtering scans up to 1000 rows in memory; stats up to 5000.
6. `apiRequest` surfaces only the error text, not the `code`.

## Integration after S07

Merge S07 first, then this branch (trial merge is clean), apply migrations in filename order,
run the full suite, add a `/support` link for admins in the S07 navigation, and optionally wire
"Ask for help" on roadmap items to `/support?item=<key>`.
