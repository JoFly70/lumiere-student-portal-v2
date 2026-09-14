/*
# Add sequence column to verification_events for deterministic chronological ordering

## Purpose
The `getLatestVerificationEvent` query previously ordered by `created_at DESC LIMIT 1`.
When two verification events are inserted in the same transaction (or within the same
millisecond), they receive identical `created_at` values. UUID primary keys are not
monotonically ordered, so the "latest" event was nondeterministic.

## Changes
- Add `seq BIGSERIAL NOT NULL` to `knowledge_verification_events`.
- Create an index on `(claim_version_id, seq DESC)` to support the latest-event query.
- The `seq` column is additive and does not affect existing rows or queries.

## Security
- No RLS policy changes.
- No new tables.
- Column is internal ordering only; not exposed to users.

## Idempotency
- `ADD COLUMN IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` make this safe to re-run.
- The migration has already been applied to rheronevecsffaejteoj; re-running is a no-op.
*/

ALTER TABLE knowledge_verification_events
  ADD COLUMN IF NOT EXISTS seq BIGSERIAL NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_verif_events_cv_seq_idx
  ON knowledge_verification_events (claim_version_id, seq DESC);
