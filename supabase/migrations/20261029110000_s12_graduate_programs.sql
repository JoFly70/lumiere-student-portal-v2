/*
# S12 — Graduate programs (ENEB postgraduate programmes, Unimarconi-linked route)

Additive and idempotent. Safe to run twice.

  graduate_program_offerings   catalogue of programmes (ENEB-only or with a university route)
  graduate_cohort_rule_sets    versioned, IMMUTABLE cohort rules (only active -> superseded)
  student_graduate_programs    a student's enrollment; pins the rule set accepted at enrollment
  graduate_subjects            ENEB and university subjects (separate rows, separate authorities)
  graduate_records             academic events and evidence; official states need full evidence
  graduate_credit_entries      credits by authority, append-only, never summed across authorities
  graduate_events              append-only before/after history

Defense in depth for the server-side evidence guard: a record can only be
`verified` when issuer, document type, document reference/id, decision date and
reviewer are present (and the effective date, for a formal conferral).

students and users exist in the migration chain. student_documents is created by
the disposable supplement AFTER migrations, so document ids are stored as plain
text with no foreign key.

Writes go through the server (service role / owner connection). RLS lets staff
read everything and a student read only their own programme, subjects, records
and credits; graduate_events and the catalogue are staff-only. Nobody gets
direct write access through anon/authenticated.
*/

-- Helper functions (identical definitions to S05/S09; safe to re-create)
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

-- A. offerings
CREATE TABLE IF NOT EXISTS graduate_program_offerings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN ('mba', 'big_data_bi', 'sales_marketing', 'hr_talent', 'other')),
  route text NOT NULL CHECK (route IN ('eneb_only', 'eneb_unimarconi')),
  marketing_title text NOT NULL,
  alternative_marketing_titles jsonb NOT NULL DEFAULT '[]'::jsonb,
  university_legal_title text,
  university_legal_title_status text NOT NULL DEFAULT 'unknown'
    CHECK (university_legal_title_status IN ('unknown', 'student_reported', 'institution_stated', 'evidence_received', 'verified', 'rejected', 'conflicting')),
  awarding_institution text NOT NULL
    CHECK (awarding_institution IN ('eneb', 'unimarconi', 'ui1', 'lumiere', 'verification_service', 'other')),
  qualification_classification text NOT NULL DEFAULT 'unknown'
    CHECK (qualification_classification IN ('eneb_private_qualification', 'university_first_level_master', 'unknown')),
  classification_status text NOT NULL DEFAULT 'unknown'
    CHECK (classification_status IN ('unknown', 'student_reported', 'institution_stated', 'evidence_received', 'verified', 'rejected', 'conflicting')),
  program_version text NOT NULL,
  published_duration_months integer CHECK (published_duration_months IS NULL OR published_duration_months > 0),
  published_ects numeric CHECK (published_ects IS NULL OR published_ects >= 0),
  evidence_note text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graduate_offerings_verified_title_check
    CHECK (university_legal_title_status <> 'verified' OR university_legal_title IS NOT NULL)
);

-- B. cohort rule sets (immutable once created)
CREATE TABLE IF NOT EXISTS graduate_cohort_rule_sets (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  offering_id text NOT NULL REFERENCES graduate_program_offerings(id) ON DELETE RESTRICT,
  cohort_label text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  effective_from date NOT NULL,
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  supersedes_id text REFERENCES graduate_cohort_rule_sets(id) ON DELETE RESTRICT,
  note text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graduate_rule_sets_offering_version_unique UNIQUE (offering_id, version)
);
CREATE INDEX IF NOT EXISTS graduate_rule_sets_offering_idx ON graduate_cohort_rule_sets(offering_id, cohort_label);
-- At most one active rule set per offering and cohort (concurrency-safe).
CREATE UNIQUE INDEX IF NOT EXISTS graduate_rule_sets_one_active_idx
  ON graduate_cohort_rule_sets(offering_id, cohort_label) WHERE status = 'active';

CREATE OR REPLACE FUNCTION graduate_rule_sets_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.offering_id IS DISTINCT FROM OLD.offering_id
     OR NEW.cohort_label IS DISTINCT FROM OLD.cohort_label
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.rules IS DISTINCT FROM OLD.rules
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'graduate_cohort_rule_sets rows are immutable; create a new version instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'active' AND NEW.status = 'superseded') THEN
    RAISE EXCEPTION 'a rule set can only move from active to superseded'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS graduate_rule_sets_immutable_trg ON graduate_cohort_rule_sets;
CREATE TRIGGER graduate_rule_sets_immutable_trg
  BEFORE UPDATE ON graduate_cohort_rule_sets
  FOR EACH ROW EXECUTE FUNCTION graduate_rule_sets_immutable();

-- C. student programmes (enrollments)
CREATE TABLE IF NOT EXISTS student_graduate_programs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  offering_id text NOT NULL REFERENCES graduate_program_offerings(id) ON DELETE RESTRICT,
  -- Pinned at enrollment: the terms the student accepted. Never re-pointed.
  rule_set_id text NOT NULL REFERENCES graduate_cohort_rule_sets(id) ON DELETE RESTRICT,
  route text NOT NULL CHECK (route IN ('eneb_only', 'eneb_unimarconi')),
  cohort_label text NOT NULL,
  enrollment_contract_title text,
  enrolled_at date NOT NULL,
  eneb_status text NOT NULL DEFAULT 'enrolled'
    CHECK (eneb_status IN ('enrolled', 'in_progress', 'coursework_complete', 'completed', 'withdrawn')),
  prior_bachelor_source text NOT NULL DEFAULT 'unknown' CHECK (prior_bachelor_source IN ('lumiere', 'external', 'unknown')),
  note text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_graduate_programs_student_idx ON student_graduate_programs(student_id, enrolled_at DESC);
CREATE INDEX IF NOT EXISTS student_graduate_programs_rule_set_idx ON student_graduate_programs(rule_set_id);

CREATE OR REPLACE FUNCTION student_graduate_programs_pinned()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM graduate_cohort_rule_sets WHERE id = NEW.rule_set_id AND offering_id = NEW.offering_id) THEN
      RAISE EXCEPTION 'rule set does not belong to the offering'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.rule_set_id IS DISTINCT FROM OLD.rule_set_id
     OR NEW.offering_id IS DISTINCT FROM OLD.offering_id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.route IS DISTINCT FROM OLD.route THEN
    RAISE EXCEPTION 'the rule set, offering, student and route are pinned at enrollment'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS student_graduate_programs_pinned_trg ON student_graduate_programs;
CREATE TRIGGER student_graduate_programs_pinned_trg
  BEFORE INSERT OR UPDATE ON student_graduate_programs
  FOR EACH ROW EXECUTE FUNCTION student_graduate_programs_pinned();

-- D. subjects
CREATE TABLE IF NOT EXISTS graduate_subjects (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  program_id text NOT NULL REFERENCES student_graduate_programs(id) ON DELETE CASCADE,
  authority text NOT NULL CHECK (authority IN ('eneb', 'unimarconi')),
  title text NOT NULL,
  module_code text,
  stated_credits numeric CHECK (stated_credits IS NULL OR stated_credits >= 0),
  credit_unit text CHECK (credit_unit IS NULL OR credit_unit IN ('ECTS', 'CFU')),
  assessment_type text NOT NULL DEFAULT 'unknown'
    CHECK (assessment_type IN ('subject_exam', 'comprehensive_exam', 'assignment', 'project', 'other', 'unknown')),
  sort_order integer NOT NULL DEFAULT 0,
  student_progress text NOT NULL DEFAULT 'not_started' CHECK (student_progress IN ('not_started', 'in_progress', 'submitted')),
  result_status text NOT NULL DEFAULT 'none' CHECK (result_status IN ('none', 'passed', 'failed', 'reassessment_required')),
  grade_value numeric CHECK (grade_value IS NULL OR grade_value >= 0),
  grade_scale numeric CHECK (grade_scale IS NULL OR grade_scale > 0),
  grade_display text,
  issuing_institution text
    CHECK (issuing_institution IS NULL OR issuing_institution IN ('eneb', 'unimarconi', 'ui1', 'lumiere', 'verification_service', 'other')),
  verification_status text NOT NULL DEFAULT 'unknown'
    CHECK (verification_status IN ('unknown', 'student_reported', 'institution_stated', 'evidence_received', 'verified', 'rejected', 'conflicting')),
  document_id text,
  document_reference text,
  reassessment_count integer NOT NULL DEFAULT 0 CHECK (reassessment_count >= 0),
  correction_count integer NOT NULL DEFAULT 0 CHECK (correction_count >= 0),
  recorded_by text,
  recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS graduate_subjects_program_idx ON graduate_subjects(program_id, sort_order);

-- E. records (academic events and evidence)
CREATE TABLE IF NOT EXISTS graduate_records (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  program_id text NOT NULL REFERENCES student_graduate_programs(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'eneb_completion', 'eneb_certificate', 'eneb_transcript', 'ui1_ects_certification',
    'eligibility_review', 'undergraduate_documents', 'document_legalization', 'university_application',
    'university_admission', 'university_registration', 'recognition_request', 'recognition_decision',
    'thesis_topic', 'thesis_submission', 'thesis_result', 'time_requirement', 'graduation_procedure',
    'award_conferral', 'official_transcript', 'diploma_ordered', 'diploma_issued', 'diploma_delivered',
    'credential_verification', 'institutional_question'
  )),
  tracking_status text NOT NULL DEFAULT 'not_started'
    CHECK (tracking_status IN ('not_started', 'in_progress', 'submitted', 'completed', 'blocked', 'withdrawn', 'not_applicable')),
  verification_status text NOT NULL DEFAULT 'unknown'
    CHECK (verification_status IN ('unknown', 'student_reported', 'institution_stated', 'evidence_received', 'verified', 'rejected', 'conflicting')),
  outcome text,
  issuing_institution text
    CHECK (issuing_institution IS NULL OR issuing_institution IN ('eneb', 'unimarconi', 'ui1', 'lumiere', 'verification_service', 'other')),
  document_type_label text,
  document_reference text,
  document_id text,
  decision_date date,
  effective_date date,
  effective_cohort text,
  academic_consequence text,
  conflicting_evidence text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewer_user_id text,
  reviewed_at timestamptz,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Defense in depth: an official `verified` state needs the full evidence set.
  CONSTRAINT graduate_records_verified_evidence_check CHECK (
    verification_status <> 'verified' OR (
      issuing_institution IS NOT NULL
      AND document_type_label IS NOT NULL
      AND (document_reference IS NOT NULL OR document_id IS NOT NULL)
      AND decision_date IS NOT NULL
      AND reviewer_user_id IS NOT NULL
    )
  ),
  -- A formal conferral also needs the conferral date from the university's document.
  CONSTRAINT graduate_records_conferral_date_check CHECK (
    kind <> 'award_conferral' OR verification_status <> 'verified' OR effective_date IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS graduate_records_program_idx ON graduate_records(program_id, kind);
CREATE INDEX IF NOT EXISTS graduate_records_student_idx ON graduate_records(student_id);

-- F. credit entries (append-only; never summed across authorities)
CREATE TABLE IF NOT EXISTS graduate_credit_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  program_id text NOT NULL REFERENCES student_graduate_programs(id) ON DELETE CASCADE,
  authority text NOT NULL
    CHECK (authority IN ('eneb_stated', 'ui1_certified', 'recognition_requested', 'university_recognized', 'university_awarded')),
  record_id text NOT NULL REFERENCES graduate_records(id) ON DELETE CASCADE,
  subject_id text REFERENCES graduate_subjects(id),
  label text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  unit text NOT NULL CHECK (unit IN ('ECTS', 'CFU')),
  recognition_outcome text CHECK (recognition_outcome IS NULL OR recognition_outcome IN ('recognized', 'recognized_with_conditions', 'not_recognized')),
  conditions text,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graduate_credit_conditions_check
    CHECK (recognition_outcome IS DISTINCT FROM 'recognized_with_conditions' OR conditions IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS graduate_credit_entries_program_idx ON graduate_credit_entries(program_id, authority);

CREATE OR REPLACE FUNCTION graduate_credit_entries_no_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'graduate_credit_entries is append-only'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS graduate_credit_entries_no_update_trg ON graduate_credit_entries;
CREATE TRIGGER graduate_credit_entries_no_update_trg
  BEFORE UPDATE ON graduate_credit_entries
  FOR EACH ROW EXECUTE FUNCTION graduate_credit_entries_no_update();

-- G. events (append-only history; no FKs so history outlives any row)
CREATE TABLE IF NOT EXISTS graduate_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  program_id text,
  student_id text,
  actor_user_id text,
  actor_role text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS graduate_events_program_idx ON graduate_events(program_id, created_at);

CREATE OR REPLACE FUNCTION graduate_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'graduate_events is append-only'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS graduate_events_append_only_trg ON graduate_events;
CREATE TRIGGER graduate_events_append_only_trg
  BEFORE UPDATE OR DELETE ON graduate_events
  FOR EACH ROW EXECUTE FUNCTION graduate_events_append_only();

-- H. row level security: select-only, no write policies
ALTER TABLE graduate_program_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE graduate_cohort_rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_graduate_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE graduate_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE graduate_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE graduate_credit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE graduate_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "graduate_offerings_select" ON graduate_program_offerings;
CREATE POLICY "graduate_offerings_select" ON graduate_program_offerings FOR SELECT TO authenticated
  USING (is_staff_or_admin());

DROP POLICY IF EXISTS "graduate_rule_sets_select" ON graduate_cohort_rule_sets;
CREATE POLICY "graduate_rule_sets_select" ON graduate_cohort_rule_sets FOR SELECT TO authenticated
  USING (is_staff_or_admin());

DROP POLICY IF EXISTS "student_graduate_programs_select" ON student_graduate_programs;
CREATE POLICY "student_graduate_programs_select" ON student_graduate_programs FOR SELECT TO authenticated
  USING (is_staff_or_admin() OR student_owns_record(student_id));

DROP POLICY IF EXISTS "graduate_subjects_select" ON graduate_subjects;
CREATE POLICY "graduate_subjects_select" ON graduate_subjects FOR SELECT TO authenticated
  USING (
    is_staff_or_admin()
    OR EXISTS (
      SELECT 1 FROM student_graduate_programs p
      WHERE p.id = graduate_subjects.program_id AND student_owns_record(p.student_id)
    )
  );

DROP POLICY IF EXISTS "graduate_records_select" ON graduate_records;
CREATE POLICY "graduate_records_select" ON graduate_records FOR SELECT TO authenticated
  USING (is_staff_or_admin() OR student_owns_record(student_id));

DROP POLICY IF EXISTS "graduate_credit_entries_select" ON graduate_credit_entries;
CREATE POLICY "graduate_credit_entries_select" ON graduate_credit_entries FOR SELECT TO authenticated
  USING (
    is_staff_or_admin()
    OR EXISTS (
      SELECT 1 FROM student_graduate_programs p
      WHERE p.id = graduate_credit_entries.program_id AND student_owns_record(p.student_id)
    )
  );

DROP POLICY IF EXISTS "graduate_events_select" ON graduate_events;
CREATE POLICY "graduate_events_select" ON graduate_events FOR SELECT TO authenticated
  USING (is_staff_or_admin());

-- I. no direct writes through the Supabase API roles
DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY[
        'graduate_program_offerings', 'graduate_cohort_rule_sets', 'student_graduate_programs',
        'graduate_subjects', 'graduate_records', 'graduate_credit_entries', 'graduate_events'
      ] LOOP
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;
