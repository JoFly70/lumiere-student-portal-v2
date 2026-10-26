/*
# S12 addendum — Foreign credential evaluations

Additive and idempotent. Safe to run twice.

  graduate_credential_evaluations   a foreign evaluator's opinion about an awarded
                                    qualification (WES U.S., WES Canada, Nuffic, ...)

Kept apart from the Italian award: nothing in this table is read by, or writes to,
offerings, cohort rule sets, records, credit entries or subjects. A preliminary
equivalency-tool result is stored as `preliminary_tool` and is never an official outcome.

Defense in depth for the server-side guard:
  - WES U.S. reports for US only, WES Canada for CA only, Nuffic for NL only.
  - `verified` needs a completed evaluation with report date, a reference or a
    document, a real conclusion, the evaluator's wording and a reviewer.

student_documents is created by the disposable supplement AFTER migrations, so
document_id is plain text with no foreign key.

Writes go through the server. RLS: staff read all; a student reads only their own.
Nobody gets direct write access through anon/authenticated.
*/

-- Helper functions (identical definitions to S05/S09/S12; safe to re-create)
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

CREATE TABLE IF NOT EXISTS graduate_credential_evaluations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  program_id text REFERENCES student_graduate_programs(id) ON DELETE SET NULL,
  evaluator text NOT NULL
    CHECK (evaluator IN ('wes_us', 'wes_canada', 'nuffic', 'ece', 'ierf', 'enic_naric_other', 'other')),
  evaluator_name text,
  destination_country text NOT NULL CHECK (destination_country ~ '^[A-Z]{2}$'),
  qualification_evaluated text NOT NULL,
  awarding_institution text NOT NULL
    CHECK (awarding_institution IN ('eneb', 'unimarconi', 'ui1', 'lumiere', 'verification_service', 'other')),
  intended_use text NOT NULL
    CHECK (intended_use IN ('employment', 'further_study', 'immigration', 'professional_licensing', 'other')),
  evaluation_type text NOT NULL
    CHECK (evaluation_type IN ('preliminary_tool', 'completed_report', 'advisory_statement')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'submitted', 'in_progress', 'completed', 'withdrawn')),
  report_date date,
  report_reference text,
  document_id text,
  conclusion text NOT NULL DEFAULT 'not_yet_known'
    CHECK (conclusion IN (
      'not_yet_known', 'masters_equivalent', 'professional_masters_equivalent', 'research_masters_equivalent',
      'graduate_certificate_or_diploma', 'bachelors_equivalent', 'other'
    )),
  conclusion_text text,
  verification_status text NOT NULL DEFAULT 'unknown'
    CHECK (verification_status IN ('unknown', 'student_reported', 'institution_stated', 'evidence_received', 'verified', 'rejected', 'conflicting')),
  conflicting_evidence text,
  reviewer_user_id text,
  reviewed_at timestamptz,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- WES U.S., WES Canada and Nuffic each report for one country only.
  CONSTRAINT graduate_evaluations_evaluator_country_check CHECK (
    (evaluator <> 'wes_us' OR destination_country = 'US')
    AND (evaluator <> 'wes_canada' OR destination_country = 'CA')
    AND (evaluator <> 'nuffic' OR destination_country = 'NL')
  ),
  -- Defense in depth: `verified` needs a completed report with the evaluator's conclusion.
  CONSTRAINT graduate_evaluations_verified_evidence_check CHECK (
    verification_status <> 'verified' OR (
      status = 'completed'
      AND report_date IS NOT NULL
      AND (report_reference IS NOT NULL OR document_id IS NOT NULL)
      AND conclusion <> 'not_yet_known'
      AND conclusion_text IS NOT NULL
      AND reviewer_user_id IS NOT NULL
    )
  )
);
CREATE INDEX IF NOT EXISTS graduate_evaluations_student_idx ON graduate_credential_evaluations(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS graduate_evaluations_program_idx ON graduate_credential_evaluations(program_id);

ALTER TABLE graduate_credential_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "graduate_evaluations_select" ON graduate_credential_evaluations;
CREATE POLICY "graduate_evaluations_select" ON graduate_credential_evaluations FOR SELECT TO authenticated
  USING (is_staff_or_admin() OR student_owns_record(student_id));

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.graduate_credential_evaluations FROM %I', r);
    END IF;
  END LOOP;
END $$;
