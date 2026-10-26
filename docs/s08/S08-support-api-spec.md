# S08 Support Center — API and module contract

Source of truth for types and pure rules: `shared/support-contract.ts`.
This file fixes the HTTP surface, module boundaries and the test seams so the
three S08 workstreams can build in parallel.

Storage: the EXISTING tables only (`support_tickets`, `ticket_comments`,
`ticket_attachments`, `ticket_status_history`) through the existing
`supabaseAdmin` client. The finer student topic, verified academic context and
the "awaiting since" clock live in `support_tickets.metadata` (existing JSONB
column). The only database addition is a guarded migration adding `support.*`
values to the existing `audit_event_type` enum.

## Router construction (server/routes/tickets.ts)

```ts
export interface TicketsRouterDeps {
  supabase: SupportSupabase;              // supabaseAdmin in production
  isConfigured: () => boolean;            // isSupabaseConfigured
  authenticate: RequestHandler;           // requireAuth in production
  getAccountStatus: (userId: string) => Promise<AccountStatus>;   // assignee must be active
  resolveStudentUserId: (studentId: string) => Promise<string | null>;
  getStudentByUserId: (userId: string) => Promise<{ id: string } | null>;
  loadPublishedRoadmap: (studentId: string) => Promise<StudentRoadmapView>; // read-only S05 service
  audit: (entry: AuditLogEntry) => Promise<void>;                 // createAuditLog
  notify: SupportNotifier;                                        // server/lib/support-notifications.ts
  now: () => Date;
}
export function createTicketsRouter(deps: TicketsRouterDeps): Router;
export default createTicketsRouter(defaultTicketsRouterDeps());   // keeps routes.ts unchanged
```

### Supabase builder subset (the only calls the router may make)

Tests replace `supabase` with an in-memory fake that implements exactly this:

- `from(table)` then one of `select(cols?, { count: 'exact' }?)`, `insert(row | rows)`, `update(patch)`
- `cols`: `'*'` or a comma list of plain column names. **No embedded resources** (`ticket_comments(*)` etc.).
- filters: `eq`, `neq`, `in`, `is(col, null)`, `gte`, `lte`, `ilike`
- modifiers: `order(col, { ascending })`, `range(from, to)`, `limit(n)`, `single()`, `maybeSingle()`
- after `insert`/`update`: optional `.select(cols?)` then optional `.single()`
- awaiting the builder resolves `{ data, error, count? }`
- `storage.from(bucket)`: `createSignedUploadUrl(path)` -> `{ data: { signedUrl, token, path }, error }`,
  `createSignedUrl(path, seconds)` -> `{ data: { signedUrl }, error }`,
  `list(folder, { search })` -> `{ data: [{ name }], error }`

Tables touched: `support_tickets`, `ticket_comments`, `ticket_attachments`,
`ticket_status_history`, `users` (read only: name/role of people). Nothing else.

## Endpoints (all under /api/tickets, all behind `authenticate`)

Errors are `{ error: string, code: SupportErrorCode, details? }`.
Supabase not configured -> `503 SUPPORT_UNAVAILABLE` (never a fake success).
A ticket the caller may not see -> `404 NOT_FOUND` (no existence leak).

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/` | all | Student: own only. Coach: assigned to them only. Admin/staff: all. Query: `status`, `category`, `priority`, `search` (subject ilike), `view=active\|resolved`, `awaiting=staff\|student`, `assignedTo=me\|unassigned\|<userId>` (staff), `overdue=true` (staff), `studentId` (admin only, as in Phase 5D; resolved server-side), `limit` (1-100, default 50), `offset`. Returns `SupportTicketListResponse`. |
| GET | `/stats/summary` | admin, staff, coach (coach: own assigned) | `SupportStatsResponse`. Registered BEFORE `/:id`. |
| GET | `/staff-directory` | admin, staff | `{ staff: SupportPerson[] }` — users with role admin/staff/coach whose account is active. |
| GET | `/context-options` | student | `{ available: boolean, planVersion: number \| null, items: { key, title, code, kind, phaseTitle }[] }` from the student's CURRENT PUBLISHED roadmap (active items only). `available:false` when no published plan. 503 CONTEXT_UNAVAILABLE if the roadmap service fails. |
| GET | `/:id` | access holders | `{ ticket: SupportTicketDetail }`. Students never receive internal comments, attachments linked to internal comments, `metadata`, `assigned_to`, `reporter_email`, `changed_by`. |
| POST | `/` | student (staff may not open tickets for themselves through this path: 403) | Body `createTicketInputSchema`. Student priority is forced to `medium`. Optional `context.roadmapItemKey` verified against the student's published plan (400 CONTEXT_NOT_IN_PLAN / 503 CONTEXT_UNAVAILABLE). Writes ticket + first public comment (the description). 201 `{ ticket: SupportTicketDetail }`. |
| PATCH | `/:id` | see rules | Body `updateTicketInputSchema`. |
| POST | `/:id/comments` | access holders | Body `createCommentInputSchema`. 201 `{ comment, ticket }` (ticket = updated summary). |
| POST | `/:id/attachments/upload-url` | access holders, ticket not closed | Body `{ file_name, file_size, file_type }`. Type allow-list + 10 MB. Returns `{ uploadUrl, token, storagePath }` where `storagePath = tickets/<ticketId>/<userId>/<ts>-<rand>.<ext>`. No public URL. |
| POST | `/:id/attachments` | access holders, ticket not closed | Body `{ file_name, file_size, file_type, storage_path, comment_id? }`. `storage_path` must be under `tickets/<ticketId>/<callerId>/` and exist in storage. `comment_id` must belong to this ticket (students: their own public comment). |
| GET | `/:id/attachments/:attachmentId/download-url` | access holders | Students: not for internal-note attachments (404). Signed URL, 5 minutes. Audited. |

### Rules

- **Students** reply only on their own ticket. Reply on `waiting_on_student` -> `in_progress`;
  on `resolved` within 14 days -> `open` (reopen); after that or on `closed` -> 409
  (`REOPEN_WINDOW_EXPIRED` / `TICKET_CLOSED`). `isInternal: true` or `nextStatus` from a student -> 403.
- **Student PATCH**: only `subject`/`description`, only while `open`, unassigned and no staff reply yet.
  `status`, `priority`, `assignedTo`, `resolutionNotes` -> 403.
- **Staff status changes** follow `canStaffTransition`. Same-status or illegal -> 409 `INVALID_TRANSITION`.
  `resolved` requires `resolutionNotes` (400 `RESOLUTION_REQUIRED`) and sets `resolved_at/by`;
  leaving resolved/closed clears `resolved_at/by` (notes kept).
- **Assignment** (`assignedTo`): admin/staff only. Assignee must be an existing admin/staff/coach
  user whose account status is `active` (400 `INVALID_ASSIGNEE`). `null` unassigns.
- **Priority**: admin/staff, or the assigned coach.
- **Coach**: acts only on tickets assigned to them; cannot assign, close or reopen closed.
- **Staff public reply** without `nextStatus` on an `open` ticket moves it to `in_progress`.
  `nextStatus` is validated like a PATCH; resolving through a reply uses the reply as resolution notes.
- **Internal notes** never change status and never notify the student.
- Staff do not edit the student's subject/description.
- Every status change inserts a `ticket_status_history` row (`changed_by` = caller, `change_reason`)
  — best effort, logged on failure — and an audit event.
- `metadata.awaiting_since` is reset on create, on every status change and on every student reply.

### Audit (existing createAuditLog infrastructure)

`targetResourceType: 'support_ticket'`, `targetResourceId: ticket.id`, `targetUserId: reporter_id`,
`actorUserId`/`actorRole` = caller. Event types (new enum values, migration
`supabase/migrations/20261027100000_s08_support_audit_events.sql`):
`support.ticket_created`, `support.ticket_updated`, `support.status_changed`,
`support.assignment_changed`, `support.priority_changed`, `support.comment_added`,
`support.internal_note_added`, `support.attachment_added`,
`support.attachment_downloaded`, `support.access_denied`.
Replaces the former `system.maintenance_mode` (create) and `admin.bulk_operation` (status) misuse.
Audit content never includes message bodies.

### Notifications (server/lib/support-notifications.ts)

`SupportNotifier` = `{ ticketCreated, staffReplied, studentReplied, statusChanged }`, each
returning `Promise<boolean>` and called fire-and-forget (failures logged, never surfaced as success).
All interpolated values HTML-escaped. Internal notes never notify. Student replies go to the assignee
(or the support inbox), never back to the student. Built on the existing `sendEmail` in
`server/lib/email.ts` (which has no live transport configured in this repository).

## Client hooks (client/src/hooks/use-tickets.ts)

Backwards compatible exports kept: `ticketQueryParams`, `Ticket`, `useTickets`, `useTicket`,
`useCreateTicket`, `useUpdateTicket`, `useCreateComment`, `useGenerateAttachmentUpload`,
`useCreateAttachment`. Added:

- `useTickets(filters)` filters also accept `view`, `awaiting`, `assignedTo`, `overdue`, `limit`.
- `useTicketStats(enabled: boolean)` -> `SupportStatsResponse`
- `useSupportStaffDirectory(enabled: boolean)` -> `{ staff: SupportPerson[] }`
- `useSupportContextOptions(enabled: boolean)` -> context-options response
- `useUploadTicketAttachment(ticketId)` -> mutation `(file: File, commentId?: string)` doing upload-url -> PUT -> record
- `useAttachmentDownload(ticketId)` -> mutation `(attachmentId) => { downloadUrl, fileName }`

## UI ownership

- `client/src/pages/support.tsx`: role switch only. Students -> `StudentSupportCenter`;
  admin/staff/coach -> `StaffSupportDesk` (`client/src/components/support/staff-support-desk.tsx`,
  `export function StaffSupportDesk()`; no props).
- Student components: `client/src/components/support/student-*.tsx`, shared pieces in
  `client/src/components/support/support-ui.tsx`, pure presentation in
  `client/src/components/support/support-presentation.ts`.
- `?item=<roadmapItemKey>` on `/support` pre-selects academic context (future integration point for
  the S07 roadmap / Flight Deck; S08 does not modify those files).
