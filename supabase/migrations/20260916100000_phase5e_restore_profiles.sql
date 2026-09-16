/*
  Phase 5E — canonical public.profiles restoration.
  This migration is intentionally additive and is not applied by the app.
*/

DO $$
DECLARE
  actual_labels text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.status AS ENUM ('active', 'inactive', 'pending', 'archived');
  ELSE
    SELECT array_agg(enumlabel ORDER BY enumsortorder)
      INTO actual_labels
      FROM pg_enum
     WHERE enumtypid = 'public.status'::regtype;
    IF actual_labels IS DISTINCT FROM ARRAY['active', 'inactive', 'pending', 'archived'] THEN
      RAISE EXCEPTION 'public.status does not match the canonical profiles status enum';
    END IF;
  END IF;
END $$;

-- Production is known to have no profiles table. Fail loudly if an unexpected
-- partial table exists rather than certifying an unknown schema as canonical.
CREATE TABLE public.profiles (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
  user_id varchar NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  timezone text,
  phone text,
  status public.status NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX profiles_user_id_idx ON public.profiles(user_id);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Keep profile access scoped to the owner; staff access is mediated by the
-- existing SECURITY DEFINER public.current_user_role() helper.
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()::varchar));

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()::varchar))
  WITH CHECK (user_id = (SELECT auth.uid()::varchar));

DROP POLICY IF EXISTS "Staff can view profiles" ON public.profiles;
CREATE POLICY "Staff can view profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('admin', 'staff', 'coach'));

DROP POLICY IF EXISTS "Staff can manage profiles" ON public.profiles;
CREATE POLICY "Staff can manage profiles" ON public.profiles
  FOR ALL TO authenticated
  USING (public.current_user_role() IN ('admin', 'staff'))
  WITH CHECK (public.current_user_role() IN ('admin', 'staff'));