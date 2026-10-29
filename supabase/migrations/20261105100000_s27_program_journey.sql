/*
  S27: program journey. Additive and idempotent (IF NOT EXISTS everywhere), no destructive change.

  Tables (server-side access only; see "Access" below):
    student_agreements      one row per student: signing/activation dates, configurable terms, language-test and
                            prior-schooling-proof status, post-secondary goal (jsonb)
    student_checkpoints     Lumiere coordination milestones (planned / done dates)
    orientation_sessions    30-minute orientation sessions (student requests, staff confirm/complete)
    student_staff_notes     internal staff notes on the student file (never student-visible)

  Access: the Express server reads and writes these through the service role / owner connection, both of which
  bypass RLS. RLS is enabled with NO client policy, and every client privilege is revoked, consistent with
  20261104110000_s25_client_write_lockdown.sql. Student-facing data is served only through server projections
  (agreement view, checkpoints, own sessions); staff notes are never part of any student projection.

  Audit: the new audit event types are added first (ALTER TYPE ... ADD VALUE IF NOT EXISTS). This file
  deliberately has no BEGIN/COMMIT so each statement commits on its own (a new enum value cannot be used in the
  transaction that adds it, and nothing here uses them).
*/

-- Enum values FIRST: a run that stops part-way can never leave the tables present without their audit event types
-- (the release check treats "4 tables + RLS + privileges + 6 enum values" as applied).
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'program.agreement_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'program.checkpoint_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'program.session_requested';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'program.session_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'program.note_added';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'program.access_denied';

CREATE TABLE IF NOT EXISTS student_agreements (
  student_id text PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  signed_on date,
  activated_on date,
  support_months integer NOT NULL DEFAULT 9 CHECK (support_months BETWEEN 1 AND 60),
  access_months integer NOT NULL DEFAULT 36 CHECK (access_months BETWEEN 1 AND 120),
  language_test_days integer NOT NULL DEFAULT 30 CHECK (language_test_days BETWEEN 1 AND 365),
  prior_schooling_days integer NOT NULL DEFAULT 90 CHECK (prior_schooling_days BETWEEN 1 AND 365),
  orientation_sessions_included integer NOT NULL DEFAULT 2 CHECK (orientation_sessions_included BETWEEN 0 AND 10),
  language_test_status text NOT NULL DEFAULT 'open' CHECK (language_test_status IN ('open', 'done', 'waived')),
  language_test_done_on date,
  language_test_score integer CHECK (language_test_score IS NULL OR language_test_score BETWEEN 0 AND 200),
  language_test_target text CHECK (language_test_target IS NULL OR char_length(language_test_target) <= 40),
  prior_schooling_status text NOT NULL DEFAULT 'open' CHECK (prior_schooling_status IN ('open', 'done', 'waived')),
  prior_schooling_done_on date,
  goal jsonb,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key IN ('file_opened', 'program_activated', 'kickoff_call', 'language_test', 'midpoint_check', 'readiness_check', 'closing')),
  planned_on date,
  done_on date,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_checkpoints_student_key_unique UNIQUE (student_id, key)
);

CREATE TABLE IF NOT EXISTS orientation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  slot_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'completed', 'cancelled')),
  prep jsonb NOT NULL DEFAULT '{}'::jsonb,
  channel text NOT NULL DEFAULT 'portal' CHECK (channel IN ('portal', 'whatsapp')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 4000),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orientation_sessions_student_idx ON orientation_sessions(student_id, slot_at);
CREATE INDEX IF NOT EXISTS orientation_sessions_status_idx ON orientation_sessions(status) WHERE status = 'requested';

CREATE TABLE IF NOT EXISTS student_staff_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  author_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Insertion order breaks ties between notes written in the same instant (uuid order is random).
ALTER TABLE student_staff_notes ADD COLUMN IF NOT EXISTS seq bigint GENERATED BY DEFAULT AS IDENTITY;
CREATE INDEX IF NOT EXISTS student_staff_notes_student_idx ON student_staff_notes(student_id, created_at DESC);

ALTER TABLE student_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE orientation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_staff_notes ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_agreements', 'student_checkpoints', 'orientation_sessions', 'student_staff_notes'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
