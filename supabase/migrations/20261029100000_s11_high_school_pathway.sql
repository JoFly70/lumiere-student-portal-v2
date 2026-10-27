/*
# S11 — High School Pathway

Additive and idempotent. A high school enrollment is a program SEPARATE from the
university degree: no university table (student_credit_records,
student_credit_decisions, student_credit_verification_events,
student_program_assignments, student_roadmap_*) is read-modified here.

  hs_curriculum_templates     versioned requirement templates (immutable rows)
  hs_enrollments              one row per high school enrollment; at most one OPEN per student
  hs_prior_education          prior schooling reported/evaluated (never credit)
  hs_transfer_claims          claims of transferable courses (never credit)
  hs_roadmap_versions         staff-authored plan; published versions are immutable
  hs_task_progress            student-REPORTED task status (never official, never deleted)
  hs_task_progress_events     append-only history of reported changes
  hs_official_results         school results recorded by staff against verified evidence
  hs_credit_awards            the official credit ledger, integer half-units, no deletes
  hs_graduation_records       graduation workflow (one per enrollment)
  hs_events                   append-only pathway history (incl. staff-only guardian notes)

Credits are integer HALF-UNITS (1 credit = 2). evidence_document_id columns
reference student_documents.id by value only (no FK: that table is created
outside the migration chain in the disposable harness); the server verifies
the row belongs to the same student and has status 'verified' before any write.

FK type mapping (as S05): students.id = text, users.id = varchar -> text.
Writes go through the server (owner / service-role connection); RLS lets
staff/admin read everything and students read only their own reported
progress and its history. Credit awards, official results, claims, graduation
records and events (recorded_by, evidence document ids, staff notes, financial
standing) are staff/admin only: students read them through the server
projection, never directly.
*/

CREATE OR REPLACE FUNCTION is_staff_or_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::text AND role IN ('staff', 'admin'));
$$;

CREATE OR REPLACE FUNCTION student_owns_record(p_student_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id AND user_id = auth.uid()::text);
$$;

-- A. templates (immutable once inserted; a change is a new version)
CREATE TABLE IF NOT EXISTS hs_curriculum_templates (
  template_key text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  title text NOT NULL,
  jurisdiction text,
  total_required_half_units integer NOT NULL CHECK (total_required_half_units >= 2),
  definition jsonb NOT NULL,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_key, version)
);

-- B. enrollments
CREATE TABLE IF NOT EXISTS hs_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  template_key text NOT NULL,
  template_version integer NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  total_required_half_units integer NOT NULL CHECK (total_required_half_units >= 2),
  required_override_reason text,
  started_on date,
  target_completion_date date,
  institution_disclosed boolean NOT NULL DEFAULT false,
  awarding_school_name text,
  school_student_ref text,
  is_historical boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 0,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_enrollments_template_fk FOREIGN KEY (template_key, template_version)
    REFERENCES hs_curriculum_templates(template_key, version) ON DELETE RESTRICT,
  CONSTRAINT hs_enrollments_status_check
    CHECK (status IN ('planned', 'active', 'on_hold', 'completed', 'withdrawn', 'transferred_out'))
);
CREATE INDEX IF NOT EXISTS hs_enrollments_student_idx ON hs_enrollments(student_id);
CREATE UNIQUE INDEX IF NOT EXISTS hs_enrollments_one_open_idx
  ON hs_enrollments(student_id) WHERE status IN ('planned', 'active', 'on_hold');

-- C. prior education + transfer claims (claims never award credit)
CREATE TABLE IF NOT EXISTS hs_prior_education (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES hs_enrollments(id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  school_name text NOT NULL,
  country text NOT NULL,
  grade_levels text,
  status text NOT NULL DEFAULT 'reported',
  evidence_document_id text,
  staff_note text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_prior_education_status_check CHECK (status IN ('reported', 'documents_requested', 'evaluated'))
);
CREATE INDEX IF NOT EXISTS hs_prior_education_enrollment_idx ON hs_prior_education(enrollment_id);

CREATE TABLE IF NOT EXISTS hs_transfer_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES hs_enrollments(id) ON DELETE RESTRICT,
  prior_education_id uuid NOT NULL REFERENCES hs_prior_education(id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  course_title text NOT NULL,
  area_key text NOT NULL,
  claimed_half_units integer NOT NULL CHECK (claimed_half_units >= 1),
  -- What the school accepted; set when the claim is resolved as partially_accepted.
  accepted_half_units integer,
  status text NOT NULL DEFAULT 'claimed',
  resolution_note text,
  resolved_by text REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_transfer_claims_status_check
    CHECK (status IN ('claimed', 'submitted_to_school', 'accepted', 'partially_accepted', 'declined')),
  CONSTRAINT hs_transfer_claims_accepted_check
    CHECK (accepted_half_units IS NULL OR (accepted_half_units >= 1 AND accepted_half_units <= claimed_half_units))
);
ALTER TABLE hs_transfer_claims ADD COLUMN IF NOT EXISTS accepted_half_units integer;
CREATE INDEX IF NOT EXISTS hs_transfer_claims_enrollment_idx ON hs_transfer_claims(enrollment_id);

-- D. roadmap versions
CREATE TABLE IF NOT EXISTS hs_roadmap_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES hs_enrollments(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number >= 1),
  status text NOT NULL DEFAULT 'draft',
  content jsonb NOT NULL,
  base_version_id uuid REFERENCES hs_roadmap_versions(id) ON DELETE RESTRICT,
  draft_revision integer NOT NULL DEFAULT 0,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by text REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz,
  superseded_at timestamptz,
  discarded_at timestamptz,
  CONSTRAINT hs_roadmap_versions_number_unique UNIQUE (enrollment_id, version_number),
  CONSTRAINT hs_roadmap_versions_status_check CHECK (status IN ('draft', 'published', 'superseded', 'discarded'))
);
CREATE INDEX IF NOT EXISTS hs_roadmap_versions_enrollment_idx ON hs_roadmap_versions(enrollment_id);
CREATE UNIQUE INDEX IF NOT EXISTS hs_roadmap_versions_one_draft_idx
  ON hs_roadmap_versions(enrollment_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS hs_roadmap_versions_one_published_idx
  ON hs_roadmap_versions(enrollment_id) WHERE status = 'published';

-- E. student-reported progress (never deleted) and its append-only history
CREATE TABLE IF NOT EXISTS hs_task_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES hs_enrollments(id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  course_key text NOT NULL,
  task_key text NOT NULL,
  status text NOT NULL,
  reported_score_percent integer,
  note text,
  revision integer NOT NULL CHECK (revision >= 1),
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_task_progress_key_unique UNIQUE (enrollment_id, course_key, task_key),
  CONSTRAINT hs_task_progress_status_check CHECK (status IN ('not_started', 'in_progress', 'submitted')),
  CONSTRAINT hs_task_progress_score_check CHECK (reported_score_percent IS NULL OR reported_score_percent BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS hs_task_progress_student_idx ON hs_task_progress(student_id);

CREATE TABLE IF NOT EXISTS hs_task_progress_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES hs_enrollments(id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  course_key text NOT NULL,
  task_key text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  reported_score_percent integer,
  revision integer NOT NULL,
  plan_version_id uuid REFERENCES hs_roadmap_versions(id) ON DELETE SET NULL,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hs_task_progress_events_idx ON hs_task_progress_events(enrollment_id, course_key, task_key);

-- F. official results (school results, recorded by staff against verified evidence)
CREATE TABLE IF NOT EXISTS hs_official_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES hs_enrollments(id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  course_key text NOT NULL,
  task_key text,
  outcome text NOT NULL,
  score_percent integer,
  evidence_document_id text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'active',
  plan_version_id uuid REFERENCES hs_roadmap_versions(id) ON DELETE SET NULL,
  recorded_by text REFERENCES users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  CONSTRAINT hs_official_results_outcome_check
    CHECK (outcome IN ('passed', 'failed', 'retake_required', 'completed', 'not_passed')),
  CONSTRAINT hs_official_results_status_check CHECK (status IN ('active', 'voided')),
  CONSTRAINT hs_official_results_score_check CHECK (score_percent IS NULL OR score_percent BETWEEN 0 AND 100),
  CONSTRAINT hs_official_results_kind_check CHECK (
    (task_key IS NULL AND outcome IN ('completed', 'not_passed')) OR
    (task_key IS NOT NULL AND outcome IN ('passed', 'failed', 'retake_required'))
  )
);
CREATE INDEX IF NOT EXISTS hs_official_results_enrollment_idx ON hs_official_results(enrollment_id, course_key);
CREATE UNIQUE INDEX IF NOT EXISTS hs_official_results_one_course_result_idx
  ON hs_official_results(enrollment_id, course_key) WHERE task_key IS NULL AND status = 'active';

-- G. credit ledger (integer half-units; rows are never deleted, only voided)
CREATE TABLE IF NOT EXISTS hs_credit_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES hs_enrollments(id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  source text NOT NULL,
  course_key text,
  claim_id uuid REFERENCES hs_transfer_claims(id) ON DELETE RESTRICT,
  result_id uuid REFERENCES hs_official_results(id) ON DELETE RESTRICT,
  area_key text NOT NULL,
  half_units integer NOT NULL CHECK (half_units > 0),
  evidence_document_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  recorded_by text REFERENCES users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  void_reason text,
  voided_by text REFERENCES users(id) ON DELETE SET NULL,
  voided_at timestamptz,
  CONSTRAINT hs_credit_awards_source_check CHECK (
    (source = 'course_completion' AND course_key IS NOT NULL) OR
    (source = 'transfer' AND claim_id IS NOT NULL)
  ),
  CONSTRAINT hs_credit_awards_status_check CHECK (status IN ('active', 'voided')),
  CONSTRAINT hs_credit_awards_void_check CHECK (status = 'active' OR (void_reason IS NOT NULL AND voided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS hs_credit_awards_enrollment_idx ON hs_credit_awards(enrollment_id);
CREATE UNIQUE INDEX IF NOT EXISTS hs_credit_awards_one_course_idx
  ON hs_credit_awards(enrollment_id, course_key) WHERE source = 'course_completion' AND status = 'active';

-- H. graduation (one per enrollment)
CREATE TABLE IF NOT EXISTS hs_graduation_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL UNIQUE REFERENCES hs_enrollments(id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'in_progress',
  eligibility_evidence_document_id text,
  eligibility_confirmed_at timestamptz,
  eligibility_confirmed_by text REFERENCES users(id) ON DELETE SET NULL,
  conferred_on date,
  diploma_evidence_document_id text,
  transcript_evidence_document_id text,
  transcript_status text NOT NULL DEFAULT 'not_requested',
  diploma_delivery_status text NOT NULL DEFAULT 'not_requested',
  financial_clearance text NOT NULL DEFAULT 'unknown',
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_graduation_status_check CHECK (status IN ('in_progress', 'eligibility_confirmed', 'diploma_conferred')),
  CONSTRAINT hs_graduation_transcript_check CHECK (transcript_status IN ('not_requested', 'requested', 'issued', 'delivered')),
  CONSTRAINT hs_graduation_diploma_check CHECK (diploma_delivery_status IN ('not_requested', 'requested', 'issued', 'delivered')),
  CONSTRAINT hs_graduation_financial_check CHECK (financial_clearance IN ('unknown', 'cleared', 'hold'))
);

-- I. pathway history (append-only; staff only; guardian coordination notes live here)
CREATE TABLE IF NOT EXISTS hs_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  enrollment_id uuid REFERENCES hs_enrollments(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  summary text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hs_events_student_idx ON hs_events(student_id, created_at);

-- RLS
ALTER TABLE hs_curriculum_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE hs_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hs_prior_education ENABLE ROW LEVEL SECURITY;
ALTER TABLE hs_transfer_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE hs_roadmap_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hs_task_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE hs_task_progress_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hs_official_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE hs_credit_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE hs_graduation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hs_events ENABLE ROW LEVEL SECURITY;

-- Staff/admin read everything. Rows that carry institution identity, staff notes,
-- evidence or financial standing are never readable by a student client (the
-- student gets them through the server projection, which applies disclosure rules).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hs_curriculum_templates', 'hs_enrollments', 'hs_prior_education', 'hs_transfer_claims',
    'hs_roadmap_versions', 'hs_official_results', 'hs_credit_awards', 'hs_graduation_records', 'hs_events'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (is_staff_or_admin())', t || '_select', t);
  END LOOP;
END $$;

-- Students may read their own reported progress and its history (their own reports
-- only: no staff ids, evidence ids or official data). Credit awards are NOT
-- student-readable (they carry recorded_by and evidence_document_id).
DROP POLICY IF EXISTS "hs_task_progress_select" ON hs_task_progress;
CREATE POLICY "hs_task_progress_select" ON hs_task_progress FOR SELECT TO authenticated
  USING (is_staff_or_admin() OR student_owns_record(student_id));
DROP POLICY IF EXISTS "hs_task_progress_events_select" ON hs_task_progress_events;
CREATE POLICY "hs_task_progress_events_select" ON hs_task_progress_events FOR SELECT TO authenticated
  USING (is_staff_or_admin() OR student_owns_record(student_id));

-- Immutability guards
CREATE OR REPLACE FUNCTION hs_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS hs_task_progress_events_append_only ON hs_task_progress_events;
CREATE TRIGGER hs_task_progress_events_append_only
  BEFORE UPDATE OR DELETE ON hs_task_progress_events
  FOR EACH ROW EXECUTE FUNCTION hs_append_only_guard();

DROP TRIGGER IF EXISTS hs_events_append_only ON hs_events;
CREATE TRIGGER hs_events_append_only
  BEFORE UPDATE OR DELETE ON hs_events
  FOR EACH ROW EXECUTE FUNCTION hs_append_only_guard();

DROP TRIGGER IF EXISTS hs_curriculum_templates_immutable ON hs_curriculum_templates;
CREATE TRIGGER hs_curriculum_templates_immutable
  BEFORE UPDATE OR DELETE ON hs_curriculum_templates
  FOR EACH ROW EXECUTE FUNCTION hs_append_only_guard();

-- Published and superseded roadmap versions are immutable documents, and never deleted.
CREATE OR REPLACE FUNCTION hs_roadmap_versions_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published', 'superseded') THEN
      RAISE EXCEPTION 'hs_roadmap_versions published versions cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('published', 'superseded') AND NEW.content IS DISTINCT FROM OLD.content THEN
    RAISE EXCEPTION 'hs_roadmap_versions.content is immutable once published';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS hs_roadmap_versions_guard ON hs_roadmap_versions;
CREATE TRIGGER hs_roadmap_versions_guard
  BEFORE UPDATE OR DELETE ON hs_roadmap_versions
  FOR EACH ROW EXECUTE FUNCTION hs_roadmap_versions_guard();

-- Official results: never deleted; only the voided flag may change.
CREATE OR REPLACE FUNCTION hs_official_results_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'hs_official_results rows cannot be deleted';
  END IF;
  IF (NEW.enrollment_id, NEW.student_id, NEW.course_key, NEW.task_key, NEW.outcome, NEW.score_percent, NEW.evidence_document_id, NEW.recorded_by, NEW.recorded_at)
     IS DISTINCT FROM
     (OLD.enrollment_id, OLD.student_id, OLD.course_key, OLD.task_key, OLD.outcome, OLD.score_percent, OLD.evidence_document_id, OLD.recorded_by, OLD.recorded_at) THEN
    RAISE EXCEPTION 'hs_official_results is immutable except for voiding';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS hs_official_results_guard ON hs_official_results;
CREATE TRIGGER hs_official_results_guard
  BEFORE UPDATE OR DELETE ON hs_official_results
  FOR EACH ROW EXECUTE FUNCTION hs_official_results_guard();

-- Credit ledger: never deleted; amount, area, source and evidence are fixed; only voiding changes a row.
CREATE OR REPLACE FUNCTION hs_credit_awards_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'hs_credit_awards rows cannot be deleted; void the award instead';
  END IF;
  IF (NEW.enrollment_id, NEW.student_id, NEW.source, NEW.course_key, NEW.claim_id, NEW.area_key, NEW.half_units, NEW.evidence_document_id, NEW.recorded_by, NEW.recorded_at)
     IS DISTINCT FROM
     (OLD.enrollment_id, OLD.student_id, OLD.source, OLD.course_key, OLD.claim_id, OLD.area_key, OLD.half_units, OLD.evidence_document_id, OLD.recorded_by, OLD.recorded_at) THEN
    RAISE EXCEPTION 'hs_credit_awards is immutable except for voiding';
  END IF;
  IF OLD.status = 'voided' AND NEW.status <> 'voided' THEN
    RAISE EXCEPTION 'a voided hs_credit_awards row cannot be reactivated';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS hs_credit_awards_guard ON hs_credit_awards;
CREATE TRIGGER hs_credit_awards_guard
  BEFORE UPDATE OR DELETE ON hs_credit_awards
  FOR EACH ROW EXECUTE FUNCTION hs_credit_awards_guard();

-- Student-reported progress is never deleted (plan changes keep it).
CREATE OR REPLACE FUNCTION hs_no_delete_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME;
END;
$$;
DROP TRIGGER IF EXISTS hs_task_progress_no_delete ON hs_task_progress;
CREATE TRIGGER hs_task_progress_no_delete
  BEFORE DELETE ON hs_task_progress
  FOR EACH ROW EXECUTE FUNCTION hs_no_delete_guard();
