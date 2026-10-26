/*
# S09 — Student profile: identity corrections and contact authority

Additive and idempotent. Safe to run twice.

  contact_type_enum              + 'emergency', 'representative'
  student_contacts               + authority_status / authority_verified_by /
                                   authority_verified_at / authority_note
  student_identity_corrections   NEW: student-requested legal identity changes
                                 that staff approve or reject. The students row
                                 changes only on approval.

Parts that touch student_contacts / contact_type_enum are guarded with
to_regclass / pg_type checks: in the disposable harness those objects are
created AFTER supabase/migrations (scripts/disposable-env/50_runtime_supplement.sql),
so tests/helpers/s09-apply-migration.ts re-runs this file once the base schema
exists.

Writes go through the server (service role / owner connection). RLS lets staff
read everything and a student read their own correction requests; nobody gets
direct write access through anon/authenticated.
*/

-- A. contact types
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contact_type_enum') THEN
    ALTER TYPE contact_type_enum ADD VALUE IF NOT EXISTS 'emergency';
    ALTER TYPE contact_type_enum ADD VALUE IF NOT EXISTS 'representative';
  END IF;
END $$;

-- B. contact authority
DO $$ BEGIN
  IF to_regclass('public.student_contacts') IS NOT NULL THEN
    ALTER TABLE student_contacts
      ADD COLUMN IF NOT EXISTS authority_status text NOT NULL DEFAULT 'listed',
      ADD COLUMN IF NOT EXISTS authority_verified_by text,
      ADD COLUMN IF NOT EXISTS authority_verified_at timestamptz,
      ADD COLUMN IF NOT EXISTS authority_note text;
    BEGIN
      ALTER TABLE student_contacts
        ADD CONSTRAINT student_contacts_authority_status_check
        CHECK (authority_status IN ('listed', 'pending_verification', 'verified', 'revoked'));
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- Helper functions (identical definitions to S05/phase2a; safe to re-create)
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

-- C. identity corrections
DO $$ BEGIN
  IF to_regclass('public.students') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS student_identity_corrections (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      requested_by text NOT NULL,
      requested_changes jsonb NOT NULL,
      current_snapshot jsonb NOT NULL,
      reason text NOT NULL,
      evidence_document_id text,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
      reviewer_user_id text,
      reviewed_at timestamptz,
      review_note text,
      applied_previous jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS student_identity_corrections_student_idx
      ON student_identity_corrections(student_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS student_identity_corrections_status_idx
      ON student_identity_corrections(status, created_at);
    -- At most one pending request per student (concurrency-safe).
    CREATE UNIQUE INDEX IF NOT EXISTS student_identity_corrections_one_pending_idx
      ON student_identity_corrections(student_id) WHERE status = 'pending';

    ALTER TABLE student_identity_corrections ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "student_identity_corrections_select" ON student_identity_corrections;
    CREATE POLICY "student_identity_corrections_select" ON student_identity_corrections FOR SELECT TO authenticated
      USING (is_staff_or_admin() OR student_owns_record(student_id));
    -- No INSERT/UPDATE/DELETE policies: anon/authenticated cannot write directly.
  END IF;
END $$;
