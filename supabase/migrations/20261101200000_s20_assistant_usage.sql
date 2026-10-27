/*
# S20 - Academic Assistant monthly usage accounting

Server-side monthly spend counter for the live model (micro-USD). Holds only a month key,
an aggregate cost and a request count: no user ids, no message content.
RLS is enabled with NO policies: students/anon (PostgREST) cannot read or write it; the
server connects with the database owner role (DATABASE_URL) which bypasses RLS.
Additive and idempotent.
*/
CREATE TABLE IF NOT EXISTS assistant_usage_monthly (
  month text PRIMARY KEY CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  cost_micro_usd bigint NOT NULL DEFAULT 0 CHECK (cost_micro_usd >= 0),
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE assistant_usage_monthly ENABLE ROW LEVEL SECURITY;
