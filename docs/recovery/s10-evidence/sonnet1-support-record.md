# S10 Sonnet 1 — Support: record

Branch `s10-sonnet1-support`, from `cfd0119`. Not pushed, not deployed, no hosted database contacted.

## A. Opening-message defect (S08 open issue 3) — fixed

Design: **compensating rollback + idempotent retry; no RPC.** An RPC would need a migration applied
to the hosted DB, which has not happened, so the route must be correct on supabase-js alone.

- Opening comment fails -> delete the new ticket (children cascade; no status-history row is written
  on create) -> `503 SUPPORT_CREATE_INCOMPLETE`, `details {saved:false, mayHaveSaved:false}`, error log,
  audit `support.ticket_created` severity `error` / `outcome: rolled_back` (existing enum value, so no
  new migration needed for the audit). No notification.
- Compensating delete also fails -> same code with `mayHaveSaved:true` and wording that it may appear
  in the student's list; error log + audit severity `critical` / `outcome: rollback_failed`.
- Idempotency: body field `idempotencyKey` (strict schema in `shared/support-contract.ts`; header not
  used), stored in `metadata.idempotency_key`, looked up as `reporter_id = caller AND key` (no
  cross-student reach). Complete ticket -> `200 {replayed:true}`, same id. Incomplete leftover ->
  deleted and recreated. Documented in `docs/s08/S08-support-api-spec.md` (S10 addendum).
- Optional migration `supabase/migrations/20261028100000_s10_support_idempotency_index.sql`: partial
  unique index (reporter_id, key). Route works without it. No RPC added.
- Client: `apiRequest` throws `ApiError` (status/code/details; fixes S08 open issue 6),
  `useCreateTicket` input takes `idempotencyKey`, `student-support-center.tsx` keeps one content-bound
  key per submission, `student-request-form.tsx` only says "not sent" when the server said so
  (network loss / unconfirmed rollback -> "may have been received, sending again is safe").

## B. Audit migrations

Verified, no migration change needed: S07 and S08 files sort after phase-2D enum creation, every
`ADD VALUE` is `IF NOT EXISTS`, no value is added in two files, neither file wraps a transaction or
uses the new values, and after the full chain on local PostgreSQL 16 every member of `AuditEventType`
is in the enum and insertable into `audit_logs`. `server/lib/audit.ts` already logged failures and
never threw; added counters (`getAuditFailureStats`, `resetAuditFailureStats`) per event type.

## C. Navigation

Already present in the merged base (nothing to add): Support link in the admin, staff and student
sidebar lists and in the student bottom bar; `/support` is open to every authenticated role.
Added the roadmap "Ask for help with this item" link (`/support?item=<key>`, low weight, planned/hold
items only) in `item-card.tsx`. Server-side context verification already used the caller's CURRENT
published roadmap; added a regression test (other student's key, superseded-version key) and a
test that creation writes only `support_tickets` and `ticket_comments`.

## Tests added or changed

- `tests/s08-support-routes.test.ts` (48 -> 56): replaced the old "best effort 201" test; new
  S10 tests: comment-failure rollback (503, no orphan, audit, no notify), compensating-delete failure,
  retry after rolled-back failure, retry after failed rollback, replay after success, same key other
  student, keyless/malformed/key-not-exposed, writes only support tables, context from own current
  roadmap only.
- `tests/helpers/fake-supabase-support.ts`: `delete()` (with FK cascade) and `col->>key` filters.
- `tests/s10-audit-chain-db.test.ts` (9), `tests/s10-audit-failure-observability.test.ts` (4),
  `tests/s10-support-client.test.ts` (7).

## Results

- `npx tsc --noEmit`: clean.
- `npx eslint` on changed files: 0 errors (86 pre-existing `no-explicit-any` warnings).
- `npx vitest run`: 87 files passed, 8 skipped; 1929 tests passed, 192 skipped (base 1901/192).
- `docs/recovery/s07-evidence` rewritten by journey tests; restored with `git checkout`.

## Not done / caveats

- Concurrent double-submit with the same key is only fully closed with the optional index applied;
  without it two simultaneous requests could both create (client disables the button while pending).
  With it, the loser gets a generic 500 rather than the winner's ticket.
- Not exercised against real Supabase/PostgREST: the `metadata->>idempotency_key` filter and
  `.delete()` semantics are proven on the in-memory fake and (index/cascade) on local PostgreSQL only.
- No audit health endpoint wired to the new counters; only the API and tests.
- No browser click-through of the form or the roadmap link (static/unit tests only).
