-- S14 release script. Reviewed by the S14 lead and rehearsed on disposable PG16 (scripts/release/s14/rehearse-local.sh). NOT applied to any hosted database.
-- Part 2 of 2: run AFTER supabase/migrations/20261029110000_s11 (LAST). S05, S09 and S11 each
-- CREATE OR REPLACE is_staff_or_admin() / student_owns_record(text) with definitions that LACK the
-- active-account check; running this last restores/installs the stronger versions.
-- Content = the minimum of scripts/disposable-env/60_s03_security_remediation.sql the S13 server
-- depends on: sections 1 (helper functions) and 6 (account_invitations), verbatim. It deliberately
-- omits S03 sections 2-5 (policy rewrites on existing tables, anon revoke, default privileges,
-- profiles column grants): those change existing production objects and are a separate owner
-- decision, see the report. Idempotent.
BEGIN;

CREATE OR REPLACE FUNCTION public.current_user_is_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid()::text AND p.status = 'active'); $$;
REVOKE EXECUTE ON FUNCTION public.current_user_is_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_active() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT u.role::text FROM public.users u WHERE u.id = auth.uid()::text AND public.current_user_is_active() $$;

CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::text AND role IN ('staff', 'admin'))
          AND public.current_user_is_active(); $$;

CREATE OR REPLACE FUNCTION public.student_owns_record(p_student_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id AND user_id = auth.uid()::text)
          AND public.current_user_is_active(); $$;

CREATE TABLE IF NOT EXISTS public.account_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'student' CHECK (role = 'student'),
  created_by varchar REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  consumed_at timestamptz,
  consumed_by varchar REFERENCES public.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  CONSTRAINT account_invitations_email_lower CHECK (email = lower(email)),
  CONSTRAINT account_invitations_expiry_after_create CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS account_invitations_email_idx ON public.account_invitations (email);
ALTER TABLE public.account_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_invitations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.account_invitations TO service_role;

-- New HS/roadmap/profile tables inherit Supabase's default grants (ALL to anon/authenticated); RLS
-- blocks rows but audit gate G2 fails. Close it for the tables this release added (no policy grants
-- anon anything; authenticated keeps only what existing RLS SELECT policies need).
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'
             AND (c.relname LIKE 'hs\_%' OR c.relname LIKE 'student\_roadmap\_%' OR c.relname IN ('student_identity_corrections','ticket_attachments','ticket_status_history'))
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

COMMIT;
