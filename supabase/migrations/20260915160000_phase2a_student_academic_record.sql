/*
# Phase 2A — Canonical Student Academic Record Schema

Creates the additive Student Academic Record layer that connects:
  STUDENT -> PROGRAM ASSIGNMENT -> ACADEMIC SOURCE -> CREDIT RECORD
          -> VERIFICATION -> CREDIT DECISION -> EXCEPTION

9 new enums, 6 new tables, RLS on all, SECURITY DEFINER helpers.
No existing tables modified. Purely additive. Idempotent.

FK type mapping:
  students.id  = text    -> student_id columns use text
  users.id     = varchar -> actor/reviewer columns use text (auth.uid()::text cast in helpers)
  documents.id = varchar -> document_id columns use text
  Knowledge Core IDs = uuid -> all Knowledge FK columns use uuid

Historical/provenance FKs use ON DELETE RESTRICT.
Actor/reviewer references use ON DELETE SET NULL.
Document linkage uses ON DELETE SET NULL.
seq columns are BIGSERIAL for deterministic ordering, not created_at.
*/

-- Enums
DO $$ BEGIN
  CREATE TYPE student_program_assignment_status AS ENUM ('active', 'completed', 'withdrawn', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE student_academic_source_type AS ENUM ('transcript', 'credential_evaluation', 'provider_record', 'exam_score', 'institution_record', 'manual', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE student_academic_source_status AS ENUM ('received', 'extracted', 'verified', 'rejected', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE student_credit_record_type AS ENUM ('course', 'exam', 'credential_award', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE student_credit_record_status AS ENUM ('extracted', 'verified', 'rejected', 'needs_review', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE student_credit_verification_action AS ENUM ('submitted', 'verified', 'rejected', 'needs_review', 'corrected', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE student_credit_decision_action AS ENUM ('accepted', 'rejected', 'needs_review', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE student_academic_exception_type AS ENUM ('requirement_waiver', 'course_substitution', 'credit_override', 'level_override', 'residency_override', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE student_academic_exception_status AS ENUM ('active', 'revoked', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Helper functions (auth.uid() returns uuid; public.users.id is varchar, so cast to text)
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

-- A. student_program_assignments
CREATE TABLE IF NOT EXISTS student_program_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  program_version_id uuid NOT NULL REFERENCES knowledge_program_versions(id) ON DELETE RESTRICT,
  status student_program_assignment_status NOT NULL DEFAULT 'active',
  cohort_label text,
  assigned_by text REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_pa_ended_after_assigned CHECK (ended_at IS NULL OR ended_at >= assigned_at)
);
CREATE INDEX IF NOT EXISTS student_pa_student_idx ON student_program_assignments(student_id);
CREATE INDEX IF NOT EXISTS student_pa_pv_idx ON student_program_assignments(program_version_id);
CREATE INDEX IF NOT EXISTS student_pa_status_idx ON student_program_assignments(status);
DO $$ BEGIN
  CREATE UNIQUE INDEX student_pa_active_unique_idx ON student_program_assignments(student_id) WHERE status = 'active';
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- B. student_academic_sources
CREATE TABLE IF NOT EXISTS student_academic_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  document_id text REFERENCES documents(id) ON DELETE SET NULL,
  source_type student_academic_source_type NOT NULL,
  status student_academic_source_status NOT NULL DEFAULT 'received',
  title text NOT NULL,
  issuing_institution_id uuid REFERENCES knowledge_institutions(id) ON DELETE RESTRICT,
  issuing_provider_id uuid REFERENCES knowledge_credit_providers(id) ON DELETE RESTRICT,
  external_file_id text,
  source_date date,
  received_at timestamptz,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_as_inst_xor_provider CHECK (issuing_institution_id IS NULL OR issuing_provider_id IS NULL)
);
CREATE INDEX IF NOT EXISTS student_as_student_idx ON student_academic_sources(student_id);
CREATE INDEX IF NOT EXISTS student_as_status_idx ON student_academic_sources(status);
CREATE INDEX IF NOT EXISTS student_as_inst_idx ON student_academic_sources(issuing_institution_id);
CREATE INDEX IF NOT EXISTS student_as_prov_idx ON student_academic_sources(issuing_provider_id);
DO $$ BEGIN
  CREATE UNIQUE INDEX student_as_student_doc_unique_idx ON student_academic_sources(student_id, document_id) WHERE document_id IS NOT NULL;
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- C. student_credit_records
CREATE TABLE IF NOT EXISTS student_credit_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES student_academic_sources(id) ON DELETE RESTRICT,
  record_type student_credit_record_type NOT NULL DEFAULT 'course',
  status student_credit_record_status NOT NULL DEFAULT 'extracted',
  source_line_key text,
  raw_course_code text,
  raw_title text NOT NULL,
  raw_credits numeric(6,2),
  raw_grade text,
  raw_level text,
  term text,
  completed_on date,
  institution_course_version_id uuid REFERENCES knowledge_institution_course_versions(id) ON DELETE RESTRICT,
  provider_course_version_id uuid REFERENCES knowledge_provider_course_versions(id) ON DELETE RESTRICT,
  normalized_credits numeric(6,2),
  normalized_level text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_cr_raw_credits_nonneg CHECK (raw_credits IS NULL OR raw_credits >= 0),
  CONSTRAINT student_cr_norm_credits_nonneg CHECK (normalized_credits IS NULL OR normalized_credits >= 0),
  CONSTRAINT student_cr_inst_xor_provider CHECK (institution_course_version_id IS NULL OR provider_course_version_id IS NULL)
);
CREATE INDEX IF NOT EXISTS student_cr_student_idx ON student_credit_records(student_id);
CREATE INDEX IF NOT EXISTS student_cr_source_idx ON student_credit_records(source_id);
CREATE INDEX IF NOT EXISTS student_cr_status_idx ON student_credit_records(status);
CREATE INDEX IF NOT EXISTS student_cr_icv_idx ON student_credit_records(institution_course_version_id);
CREATE INDEX IF NOT EXISTS student_cr_pcv_idx ON student_credit_records(provider_course_version_id);
DO $$ BEGIN
  CREATE UNIQUE INDEX student_cr_source_line_unique_idx ON student_credit_records(source_id, source_line_key) WHERE source_line_key IS NOT NULL;
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- D. student_credit_verification_events (append-only)
CREATE TABLE IF NOT EXISTS student_credit_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_record_id uuid NOT NULL REFERENCES student_credit_records(id) ON DELETE RESTRICT,
  seq bigserial NOT NULL,
  action student_credit_verification_action NOT NULL,
  reviewer_id text REFERENCES users(id) ON DELETE SET NULL,
  rationale text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_cve_cr_idx ON student_credit_verification_events(credit_record_id);
CREATE INDEX IF NOT EXISTS student_cve_cr_seq_idx ON student_credit_verification_events(credit_record_id, seq DESC);

-- E. student_credit_decisions (append-only)
CREATE TABLE IF NOT EXISTS student_credit_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_record_id uuid NOT NULL REFERENCES student_credit_records(id) ON DELETE RESTRICT,
  program_assignment_id uuid NOT NULL REFERENCES student_program_assignments(id) ON DELETE RESTRICT,
  seq bigserial NOT NULL,
  action student_credit_decision_action NOT NULL,
  credits_awarded numeric(6,2),
  level_awarded text,
  equivalency_id uuid REFERENCES knowledge_equivalencies_v2(id) ON DELETE RESTRICT,
  target_institution_course_version_id uuid REFERENCES knowledge_institution_course_versions(id) ON DELETE RESTRICT,
  basis_claim_version_id uuid REFERENCES knowledge_claim_versions(id) ON DELETE RESTRICT,
  decided_by text REFERENCES users(id) ON DELETE SET NULL,
  rationale text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_cd_credits_nonneg CHECK (credits_awarded IS NULL OR credits_awarded >= 0),
  CONSTRAINT student_cd_accepted_requires_credits CHECK (action != 'accepted' OR credits_awarded > 0),
  CONSTRAINT student_cd_non_accepted_no_credits CHECK (action IN ('accepted') OR credits_awarded IS NULL OR credits_awarded = 0)
);
CREATE INDEX IF NOT EXISTS student_cd_cr_idx ON student_credit_decisions(credit_record_id);
CREATE INDEX IF NOT EXISTS student_cd_pa_idx ON student_credit_decisions(program_assignment_id);
CREATE INDEX IF NOT EXISTS student_cd_action_idx ON student_credit_decisions(action);
CREATE INDEX IF NOT EXISTS student_cd_cr_pa_seq_idx ON student_credit_decisions(credit_record_id, program_assignment_id, seq DESC);

-- F. student_academic_exceptions
CREATE TABLE IF NOT EXISTS student_academic_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  program_assignment_id uuid NOT NULL REFERENCES student_program_assignments(id) ON DELETE RESTRICT,
  exception_type student_academic_exception_type NOT NULL,
  status student_academic_exception_status NOT NULL DEFAULT 'active',
  requirement_id uuid REFERENCES knowledge_requirements_v2(id) ON DELETE RESTRICT,
  academic_rule_id uuid REFERENCES knowledge_academic_rules(id) ON DELETE RESTRICT,
  credit_record_id uuid REFERENCES student_credit_records(id) ON DELETE RESTRICT,
  supersedes_exception_id uuid REFERENCES student_academic_exceptions(id) ON DELETE RESTRICT,
  approved_by text REFERENCES users(id) ON DELETE SET NULL,
  rationale text NOT NULL,
  effective_from timestamptz,
  effective_to timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_ae_effective_to_after_from CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS student_ae_student_idx ON student_academic_exceptions(student_id);
CREATE INDEX IF NOT EXISTS student_ae_pa_idx ON student_academic_exceptions(program_assignment_id);
CREATE INDEX IF NOT EXISTS student_ae_req_idx ON student_academic_exceptions(requirement_id);
CREATE INDEX IF NOT EXISTS student_ae_rule_idx ON student_academic_exceptions(academic_rule_id);
CREATE INDEX IF NOT EXISTS student_ae_cr_idx ON student_academic_exceptions(credit_record_id);
CREATE INDEX IF NOT EXISTS student_ae_status_idx ON student_academic_exceptions(status);

-- RLS
ALTER TABLE student_program_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_academic_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_credit_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_credit_verification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_credit_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_academic_exceptions ENABLE ROW LEVEL SECURITY;

-- A. student_program_assignments policies
DROP POLICY IF EXISTS "student_pa_staff_admin_select" ON student_program_assignments;
CREATE POLICY "student_pa_staff_admin_select" ON student_program_assignments FOR SELECT TO authenticated
  USING (is_staff_or_admin() OR student_owns_record(student_id));
DROP POLICY IF EXISTS "student_pa_staff_admin_insert" ON student_program_assignments;
CREATE POLICY "student_pa_staff_admin_insert" ON student_program_assignments FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin());
DROP POLICY IF EXISTS "student_pa_staff_admin_update" ON student_program_assignments;
CREATE POLICY "student_pa_staff_admin_update" ON student_program_assignments FOR UPDATE TO authenticated
  USING (is_staff_or_admin()) WITH CHECK (is_staff_or_admin());

-- B. student_academic_sources policies
DROP POLICY IF EXISTS "student_as_staff_admin_select" ON student_academic_sources;
CREATE POLICY "student_as_staff_admin_select" ON student_academic_sources FOR SELECT TO authenticated
  USING (is_staff_or_admin() OR student_owns_record(student_id));
DROP POLICY IF EXISTS "student_as_staff_admin_insert" ON student_academic_sources;
CREATE POLICY "student_as_staff_admin_insert" ON student_academic_sources FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin());
DROP POLICY IF EXISTS "student_as_staff_admin_update" ON student_academic_sources;
CREATE POLICY "student_as_staff_admin_update" ON student_academic_sources FOR UPDATE TO authenticated
  USING (is_staff_or_admin()) WITH CHECK (is_staff_or_admin());

-- C. student_credit_records policies
DROP POLICY IF EXISTS "student_cr_staff_admin_select" ON student_credit_records;
CREATE POLICY "student_cr_staff_admin_select" ON student_credit_records FOR SELECT TO authenticated
  USING (is_staff_or_admin() OR student_owns_record(student_id));
DROP POLICY IF EXISTS "student_cr_staff_admin_insert" ON student_credit_records;
CREATE POLICY "student_cr_staff_admin_insert" ON student_credit_records FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin());
DROP POLICY IF EXISTS "student_cr_staff_admin_update" ON student_credit_records;
CREATE POLICY "student_cr_staff_admin_update" ON student_credit_records FOR UPDATE TO authenticated
  USING (is_staff_or_admin()) WITH CHECK (is_staff_or_admin());

-- D. student_credit_verification_events policies (append-only: SELECT + INSERT only)
DROP POLICY IF EXISTS "student_cve_staff_admin_select" ON student_credit_verification_events;
CREATE POLICY "student_cve_staff_admin_select" ON student_credit_verification_events FOR SELECT TO authenticated
  USING (is_staff_or_admin() OR EXISTS (SELECT 1 FROM student_credit_records WHERE student_credit_records.id = student_credit_verification_events.credit_record_id AND student_owns_record(student_credit_records.student_id)));
DROP POLICY IF EXISTS "student_cve_staff_admin_insert" ON student_credit_verification_events;
CREATE POLICY "student_cve_staff_admin_insert" ON student_credit_verification_events FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin());

-- E. student_credit_decisions policies (append-only: SELECT + INSERT only)
DROP POLICY IF EXISTS "student_cd_staff_admin_select" ON student_credit_decisions;
CREATE POLICY "student_cd_staff_admin_select" ON student_credit_decisions FOR SELECT TO authenticated
  USING (is_staff_or_admin() OR EXISTS (SELECT 1 FROM student_credit_records WHERE student_credit_records.id = student_credit_decisions.credit_record_id AND student_owns_record(student_credit_records.student_id)));
DROP POLICY IF EXISTS "student_cd_staff_admin_insert" ON student_credit_decisions;
CREATE POLICY "student_cd_staff_admin_insert" ON student_credit_decisions FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin());

-- F. student_academic_exceptions policies
DROP POLICY IF EXISTS "student_ae_staff_admin_select" ON student_academic_exceptions;
CREATE POLICY "student_ae_staff_admin_select" ON student_academic_exceptions FOR SELECT TO authenticated
  USING (is_staff_or_admin() OR student_owns_record(student_id));
DROP POLICY IF EXISTS "student_ae_staff_admin_insert" ON student_academic_exceptions;
CREATE POLICY "student_ae_staff_admin_insert" ON student_academic_exceptions FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin());
DROP POLICY IF EXISTS "student_ae_staff_admin_update" ON student_academic_exceptions;
CREATE POLICY "student_ae_staff_admin_update" ON student_academic_exceptions FOR UPDATE TO authenticated
  USING (is_staff_or_admin()) WITH CHECK (is_staff_or_admin());
