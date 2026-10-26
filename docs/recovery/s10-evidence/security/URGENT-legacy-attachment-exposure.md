# URGENT - Legacy ticket-attachment exposure in the Replit workspace

Date: 2026-10-26. Author: S10 Sonnet 3. Method: read-only inspection (Replit MCP `list_app_files` / `read_app_file`, replId `33a30f4f-b01b-4abc-a2d8-e08f31fe10d9`). Nothing was changed, published or deployed. No credentials were used.

## Verdict

**The Replit workspace still contains the pre-S08 vulnerable attachment logic, unchanged.** `server/routes/tickets.ts` in the workspace is the same as `72f89c9:server/routes/tickets.ts` (same header/imports, same handlers, the attachment section matches line for line; the workspace has none of the S08 `createTicketsRouter(deps)` code). Whether the *published* deployment runs this exact file is **not verified**: the workspace can differ from what was last published, and `get_publish_status` / the live site could not be checked (see Reachability).

**Severity: HIGH if exploitable, but exploitability is conditional and not confirmed. Treat as credible, ongoing, unconfirmed.** Recommendation: owner decides on the narrow hotfix below; do not wait for the full S07/S08 merge if the live DB has `ticket_attachments`.

## The flaw (workspace code)

- `POST /api/tickets/:ticketId/attachments` takes a client-supplied `storage_path` (`z.string()`, no prefix/ownership/existence check). Only ticket ownership of `:ticketId` is checked (`userOwnsTicket`). The row is inserted with that arbitrary path.
- `GET /api/tickets/:ticketId/attachments/:attachmentId/download-url` then calls `supabaseAdmin.storage.from('documents').createSignedUrl(attachment.storage_path, 3600)` (service-role key) for whatever path was registered, after checking only that the student owns the ticket.
- Net effect: an authenticated student can register any object path in the `documents` bucket against their own ticket and receive a 1 hour signed URL for it. Also `upload-url` returns `getPublicUrl(...)` (useless if the bucket is private; direct access if public) and `file_ext` is unrestricted.
- Auth: all handlers use `requireAuth` (Supabase `getUser` token; local JWT path disabled when `NODE_ENV=production`; demo mode refused in production). No unauthenticated access path was found in the code. Upload/ownership path for non-students: `userOwnsTicket` returns true for any non-student role (all staff can read all tickets/attachments - by design).

## What bounds the risk (why it is conditional)

1. **Bucket scope.** The route hardcodes bucket `documents`. Student identity documents live in the separate `student-documents` bucket (`server/lib/document-storage.ts`) and cannot be reached through this route (bucket is fixed server-side). Exposure is limited to objects in `documents`, i.e. other students' ticket attachments (paths `tickets/<ticketId>/<timestamp>-<rand>.<ext>`), plus anything else ever placed in `documents`.
2. **Path guessability.** There is no list endpoint and ticket ids are UUIDs; a student cannot read another student's ticket (403), so an attacker needs to know/obtain a path. Practically exploitable only with a leaked/known path (e.g. a `publicUrl` or storage path shown to someone, staff-visible metadata, logs).
3. **Schema.** `PRODUCTION_DATABASE_SETUP.sql` contains **no** `ticket_attachments` or `ticket_status_history` table (only legacy `migrations/010` defines them). If the live DB lacks the table, the insert fails (500) and the hole is closed in practice. S08's report also flags this as unconfirmed.
4. **Bucket existence/visibility.** No SQL in the repo creates a `documents` bucket (the disposable-env script `scripts/disposable-env/90_storage_buckets.sql` creates it *private*; production state unknown). If it does not exist, signed URLs fail. If it is **public**, the route is moot: every object is readable by URL to anyone, which is a worse, separate exposure (`upload-url` even hands out the public URL).

None of (3) and (4) could be verified from here (no database or storage access is permitted/designated).

## Reachability check (unauthenticated) - NOT PERFORMED

All outbound requests from this environment to `lumiere-student-portal-v-2.replit.app` and `lumiereportal.app` (5 planned GET requests: `/api/health`, `/api/tickets`, `/api/tickets/<random-uuid>/attachments/<random-uuid>/download-url` and `/download`) were refused by the sandbox egress proxy (`curl: (56) CONNECT tunnel failed, response 403`; proxy status lists connect denials by policy). I did not try to route around the policy. Route existence on the live host is therefore **unverified**. Note the actual route is `.../download-url`, not `.../download`; a request to `/download` would just 404. Please run from an unrestricted machine:

```
curl -s -o /dev/null -w '%{http_code}\n' https://lumiere-student-portal-v-2.replit.app/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://lumiere-student-portal-v-2.replit.app/api/tickets            # expect 401
curl -s -o /dev/null -w '%{http_code}\n' https://lumiere-student-portal-v-2.replit.app/api/tickets/00000000-0000-4000-8000-000000000000/attachments/00000000-0000-4000-8000-000000000001/download-url   # expect 401
```
A 401 shows auth is enforced (necessary, not sufficient: the flaw is for authenticated students).

## Owner checks to run (read-only, in the Supabase SQL editor / dashboard)

```sql
-- does the table exist?
select to_regclass('public.ticket_attachments');
-- any already-registered paths that escape their own ticket folder? (evidence of abuse or misuse)
select id, ticket_id, uploaded_by, storage_path, created_at
from public.ticket_attachments
where storage_path not like 'tickets/' || ticket_id::text || '/%'
   or storage_path like '%..%';
-- bucket visibility
select id, public from storage.buckets where id in ('documents','student-documents','knowledge-evidence');
```
If the first query returns null and the bucket is private or absent, the practical exposure today is nil. If rows are returned by the second query, treat as a possible incident (review storage access logs for those paths).

## Narrow remediation (not deployed - owner approval required)

Patch: `docs/recovery/s10-evidence/security/legacy-attachment-hotfix.patch`, written against the workspace/`72f89c9` version of `server/routes/tickets.ts` (4 hunks, 70 lines):

1. `POST .../attachments`: reject (400) unless `storage_path` is exactly `tickets/<ticketId>/<one segment>` (no `/`, `\`, `..`, NUL).
2. `GET .../download-url`: re-validate the stored path against the row's own `ticket_id` and return 404 otherwise, so rows planted before the fix stop working; signed URL TTL 3600 s to 300 s.
3. `upload-url`: stop returning `publicUrl`.

Apply notes: the source file has mixed CRLF line endings; the patch is LF. Normalise first (`tr -d '\r'`) or use `patch -l`; it was verified to apply cleanly with `patch --dry-run` to an LF copy of the `72f89c9` file. It is a stopgap, not the S08 fix (S08 additionally verifies object existence, type allow-list, uploader-pinned path, staff-only internal attachments, 503 on missing tables). It has no unit tests in the legacy tree. Preferred outcome: ship S07+S08 with its migrations; if that is not imminent and the first owner check shows the table exists, apply the stopgap.

Also (owner, independent of code): confirm `documents` is a **private** bucket and has no storage RLS policy granting `authenticated` read on it.

## Not verified

Live published code vs workspace; live route reachability; live DB table/bucket state; whether any abuse has occurred.
