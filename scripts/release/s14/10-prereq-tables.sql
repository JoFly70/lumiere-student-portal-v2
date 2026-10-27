-- S14 release script. Reviewed by the S14 lead and rehearsed on disposable PG16 (scripts/release/s14/rehearse-local.sh). NOT applied to any hosted database.
-- Part 1 of 2 of the "gap" objects the S13 server needs that no supabase/migrations file creates.
-- Run BEFORE 20261026200000_s09_student_profile.sql (S09 only adds contact-authority columns when
-- student_contacts already exists, and skips silently otherwise).
-- Definitions are the repo's own: scripts/disposable-env/50_runtime_supplement.sql (verbatim from
-- migrations/005_student_profiles.sql) plus the S03 convention (RLS on, no anon/authenticated
-- grants; the Express server uses the service role). Idempotent; every object is guarded, so it is
-- a no-op for anything production already has. Prerequisite enums come from PRODUCTION_DATABASE_SETUP.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS student_english_proof (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  proof_type english_proof_type_enum NOT NULL,
  score numeric NOT NULL,
  test_date date NOT NULL,
  issuer text,
  test_id text,
  meets_requirement boolean NOT NULL DEFAULT false,
  doc_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_student_english UNIQUE (student_id)
);

CREATE TABLE IF NOT EXISTS student_contacts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type contact_type_enum NOT NULL,
  full_name text NOT NULL,
  relationship text NOT NULL,
  phone text NOT NULL,
  email text,
  language text,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  consent_doc_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_contact_email CHECK (email IS NULL OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

CREATE TABLE IF NOT EXISTS student_documents (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  doc_type doc_type_enum NOT NULL,
  file_name text NOT NULL,
  issuer text,
  doc_date date,
  score text,
  country text,
  notes text,
  url text NOT NULL,
  storage_path text NOT NULL,
  visibility visibility_enum NOT NULL DEFAULT 'student_staff',
  required_for_enrollment boolean NOT NULL DEFAULT false,
  status doc_status_enum NOT NULL DEFAULT 'pending',
  verified boolean NOT NULL DEFAULT false,
  verified_by text REFERENCES users(id),
  verified_at timestamptz,
  admin_notes text,
  ocr_text text,
  soft_deleted boolean NOT NULL DEFAULT false,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_english_student_id ON student_english_proof(student_id);
CREATE INDEX IF NOT EXISTS idx_student_contacts_student_id ON student_contacts(student_id);
CREATE INDEX IF NOT EXISTS idx_student_docs_student_id ON student_documents(student_id);
CREATE INDEX IF NOT EXISTS idx_student_docs_status ON student_documents(status);
CREATE INDEX IF NOT EXISTS idx_student_docs_student_status ON student_documents(student_id, status);

-- student_code generator: staff "Add student" omits student_code (students.student_code is NOT NULL UNIQUE).
CREATE OR REPLACE FUNCTION generate_student_code() RETURNS trigger AS $$
DECLARE year_part text; sequence_num int; new_code text;
BEGIN
  year_part := to_char(now(), 'YYYY');
  SELECT coalesce(max(cast(substring(student_code from 'LCA-' || year_part || '-(.*)') AS int)), 0) + 1
    INTO sequence_num FROM students WHERE student_code LIKE 'LCA-' || year_part || '-%';
  new_code := 'LCA-' || year_part || '-' || lpad(sequence_num::text, 4, '0');
  new.student_code := new_code;
  RETURN new;
END; $$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION validate_english_requirement() RETURNS trigger AS $$
BEGIN
  new.meets_requirement := CASE
    WHEN new.proof_type = 'duolingo' AND new.score >= 100 THEN true
    WHEN new.proof_type = 'ielts' AND new.score >= 6.0 THEN true
    WHEN new.proof_type = 'toefl' AND new.score >= 70 THEN true
    WHEN new.proof_type = 'cambridge' AND new.score >= 160 THEN true
    WHEN new.proof_type = 'lumiere_placement' AND new.score >= 70 THEN true
    ELSE false END;
  RETURN new;
END; $$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_generate_student_code' AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_generate_student_code BEFORE INSERT ON students
      FOR EACH ROW WHEN (new.student_code IS NULL) EXECUTE FUNCTION generate_student_code();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_validate_english_requirement' AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_validate_english_requirement BEFORE INSERT OR UPDATE ON student_english_proof
      FOR EACH ROW EXECUTE FUNCTION validate_english_requirement();
  END IF;
END $$;

-- S03 convention: private by default (server = service role only). ONLY for tables this file created;
-- a pre-existing table keeps whatever production already has, so check it with verify.sql G2/G3.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['student_english_proof','student_contacts','student_documents'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
  REVOKE EXECUTE ON FUNCTION generate_student_code(), validate_english_requirement() FROM PUBLIC, anon, authenticated;
END $$;

COMMIT;
