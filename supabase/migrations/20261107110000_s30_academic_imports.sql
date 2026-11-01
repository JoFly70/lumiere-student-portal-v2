/*
  S30 Phase B: Academic Data Import Center. Additive and idempotent (IF NOT EXISTS everywhere); no existing table,
  column or row is changed or removed. Sorts after 20261107100000_s30_academic_calendar.sql; depends only on students.

    academic_import_mappings  reusable column mappings (header -> field)
    academic_import_batches   one uploaded file and its workflow state (uploaded -> validated -> approved -> committed ->
                              rolled_back, or discarded) with provenance: file SHA-256, size, format, uploader and times
    academic_import_rows      parsed, normalised rows with their validation outcome and difference class
    academic_reported_records committed provider- / institution-REPORTED records. The tier is explicit and can never be
                              'verified': verified outcomes stay in hs_official_results / hs_credit_awards, written only
                              through the existing evidence-review flow. One ACTIVE record per (student, identity); an
                              identical re-import is a no-op; a rollback restores the record a batch replaced.

  The original file is not stored (its SHA-256 identifies it). academic_import_rows.raw keeps only the MAPPED cells of
  each row while the import is open, and is cleared when the import is committed, rolled back or discarded (server-side
  in imports/service.ts). Events, notifications and the review exception go to the S29
  operational layer through server/services/s30/imports-port.ts.

  Access: the Express server only (service role / owner connection). RLS on, no client policy, every client privilege
  revoked (consistent with 20261104110000_s25_client_write_lockdown.sql).

  Enum values first and no BEGIN/COMMIT: a new enum value cannot be used in the transaction that adds it.
*/

ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'import.batch_uploaded';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'import.batch_validated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'import.batch_approved';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'import.batch_committed';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'import.batch_rolled_back';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'import.batch_discarded';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'import.mapping_saved';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'import.record_reviewed';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'import.access_denied';

-- ── Academic Data Import Center ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS academic_import_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  source_kind text NOT NULL CHECK (source_kind IN ('provider_progress', 'course_progress_report', 'school_results')),
  columns jsonb NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academic_import_mappings_name_unique UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS academic_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'validated', 'approved', 'committed', 'rolled_back', 'discarded')),
  source_kind text NOT NULL CHECK (source_kind IN ('provider_progress', 'course_progress_report', 'school_results')),
  provider_label text CHECK (provider_label IS NULL OR char_length(provider_label) <= 80),
  file_name text CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  file_format text NOT NULL CHECK (file_format IN ('csv', 'xlsx')),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_bytes integer NOT NULL CHECK (file_bytes >= 0),
  sheet_name text,
  headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  mapping jsonb,
  mapping_id uuid REFERENCES academic_import_mappings(id) ON DELETE SET NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  committed_by text,
  committed_at timestamptz,
  rolled_back_by text,
  rolled_back_at timestamptz,
  rollback_reason text CHECK (rollback_reason IS NULL OR char_length(rollback_reason) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS academic_import_batches_uploaded_idx ON academic_import_batches(uploaded_at DESC);

CREATE TABLE IF NOT EXISTS academic_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES academic_import_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL CHECK (row_number >= 1),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized jsonb,
  student_id text REFERENCES students(id) ON DELETE CASCADE,
  fingerprint text,
  outcome text NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'valid', 'warning', 'invalid')),
  diff text CHECK (diff IS NULL OR diff IN ('new', 'changed', 'unchanged', 'duplicate_in_file')),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT academic_import_rows_unique UNIQUE (batch_id, row_number)
);
CREATE INDEX IF NOT EXISTS academic_import_rows_batch_idx ON academic_import_rows(batch_id, row_number);

CREATE TABLE IF NOT EXISTS academic_reported_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES academic_import_batches(id) ON DELETE RESTRICT,
  row_id uuid REFERENCES academic_import_rows(id) ON DELETE SET NULL,
  -- Explicit evidence tier. 'verified' is deliberately impossible here.
  tier text NOT NULL CHECK (tier IN ('provider_reported', 'institution_reported')),
  provider_label text CHECK (provider_label IS NULL OR char_length(provider_label) <= 80),
  course_key text CHECK (course_key IS NULL OR char_length(course_key) <= 120),
  course_label text NOT NULL CHECK (char_length(course_label) BETWEEN 1 AND 200),
  task_label text CHECK (task_label IS NULL OR char_length(task_label) <= 200),
  progress_status text CHECK (progress_status IS NULL OR progress_status IN ('not_started', 'in_progress', 'completed')),
  percent_complete integer CHECK (percent_complete IS NULL OR percent_complete BETWEEN 0 AND 100),
  score_percent numeric(5,2) CHECK (score_percent IS NULL OR score_percent BETWEEN 0 AND 100),
  credits_reported numeric(6,2) CHECK (credits_reported IS NULL OR credits_reported BETWEEN 0 AND 60),
  reported_on date,
  identity_key text NOT NULL CHECK (char_length(identity_key) <= 400),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'rolled_back')),
  review_state text NOT NULL DEFAULT 'none' CHECK (review_state IN ('none', 'needs_review', 'reviewed')),
  -- The record this one replaced (restored to active if this record's batch is rolled back).
  supersedes_id uuid REFERENCES academic_reported_records(id) ON DELETE SET NULL,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One ACTIVE record per (student, tier, course, task) identity; a re-import of identical data is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS academic_reported_records_identity_idx ON academic_reported_records(student_id, identity_key) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS academic_reported_records_batch_idx ON academic_reported_records(batch_id);
CREATE INDEX IF NOT EXISTS academic_reported_records_review_idx ON academic_reported_records(student_id) WHERE status = 'active' AND review_state = 'needs_review';

-- ── access ──────────────────────────────────────────────────────────────────

ALTER TABLE academic_import_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_reported_records ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['academic_import_mappings', 'academic_import_batches', 'academic_import_rows', 'academic_reported_records'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
