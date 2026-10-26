/*
# S10 — Support ticket creation idempotency (optional hardening)

The API (server/routes/tickets.ts) already makes ticket creation idempotent in
application code: a client-generated key in support_tickets.metadata
('idempotency_key'), looked up per reporter. This migration adds the database
guarantee for the one case application code cannot cover: two truly concurrent
requests with the same key from the same student.

- Partial unique index: only rows that carry a key are constrained, so every
  existing ticket and every keyless request is unaffected.
- Scoped by reporter_id: the same key from two students never collides.
- Additive and idempotent (IF NOT EXISTS); no data changes, no enum changes.
- The route works correctly WITHOUT this migration.
*/
CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_reporter_idempotency_key_uniq
  ON public.support_tickets (reporter_id, (metadata ->> 'idempotency_key'))
  WHERE metadata ? 'idempotency_key';
