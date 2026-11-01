/*
  S30 Phase A: Academic Calendar. Additive and idempotent (IF NOT EXISTS everywhere); no existing table, column or row
  is changed or removed. Sorts after S29 (20261106100000_s29_student_intelligence.sql) and does not depend on it.

    calendar_events          staff-scheduled advisor meetings, support sessions, program checkpoints and academic
                             deadlines. Every other calendar item is DERIVED live from existing records (agreement
                             deadlines, Lumière checkpoints, orientation sessions, the published high-school plan and
                             degree roadmap milestones), so nothing is copied or scheduled twice.
    calendar_subscriptions   revocable iCalendar feed links (only a SHA-256 hash of the 256-bit token is stored)

  The calendar keeps no events, notifications or job state of its own: those belong to the S29 operational layer and
  are reached through server/services/s30/calendar-port.ts.

  Access: the Express server only (service role / owner connection). RLS on, no client policy, every client privilege
  revoked (consistent with 20261104110000_s25_client_write_lockdown.sql).

  Enum values first and no BEGIN/COMMIT: a new enum value cannot be used in the transaction that adds it.
*/

ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'calendar.event_changed';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'calendar.subscription_changed';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'calendar.access_denied';

-- ── academic calendar ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('advisor_meeting', 'support_session', 'program_checkpoint', 'academic_deadline')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  time_zone text NOT NULL DEFAULT 'UTC' CHECK (char_length(time_zone) <= 64),
  location text CHECK (location IS NULL OR char_length(location) <= 200),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  visible_to_student boolean NOT NULL DEFAULT true,
  sequence integer NOT NULL DEFAULT 0,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_end_after_start CHECK (ends_at IS NULL OR ends_at > starts_at)
);
-- No duplicate scheduling: one scheduled event of a kind per student per start instant.
CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_no_duplicate_idx ON calendar_events(student_id, kind, starts_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS calendar_events_range_idx ON calendar_events(starts_at);

CREATE TABLE IF NOT EXISTS calendar_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('student', 'staff')),
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  privacy text NOT NULL DEFAULT 'minimal' CHECK (privacy IN ('minimal', 'detailed')),
  label text CHECK (label IS NULL OR char_length(label) <= 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT calendar_subscriptions_token_unique UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS calendar_subscriptions_user_idx ON calendar_subscriptions(user_id) WHERE revoked_at IS NULL;

-- ── access ──────────────────────────────────────────────────────────────────

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['calendar_events', 'calendar_subscriptions'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
