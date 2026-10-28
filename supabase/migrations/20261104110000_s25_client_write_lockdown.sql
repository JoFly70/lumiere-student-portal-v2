-- S25 security readiness: defence in depth for the PostgREST surface. Idempotent, additive, no data change.
--
-- 1. The browser ships no Supabase data client (client/src has no supabase.from()/rpc()/storage calls) and
--    the Express server reaches Postgres only through the service role / the owner connection, both of
--    which bypass these grants. The `authenticated` role therefore needs NO write privilege on any public
--    table. Revoking INSERT/UPDATE/DELETE/TRUNCATE closes a class of direct-API writes that RLS policies
--    would otherwise have to get exactly right, for example a permissive "update own row" policy on
--    public.users (role) or public.student_documents (status), or an over-broad staff write policy:
--    official-record integrity (credit awards, document verification) then depends on the server only.
--    Reads (SELECT) and all RLS policies are untouched. public.profiles is skipped on purpose: S14 step 35
--    grants authenticated column-level UPDATE(timezone, phone) there and a table-level REVOKE would remove it.
-- 2. Pin search_path on the remaining non-SECURITY DEFINER functions the Supabase advisor flags as
--    "function_search_path_mutable" (trigger guards and helpers). They reference only public objects and
--    pg_catalog builtins, so pinning does not change behaviour. SECURITY DEFINER helpers were pinned in
--    earlier migrations (20260915200000, S22).
BEGIN;

DO $$
DECLARE
  t record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    FOR t IN
      SELECT c.relname
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace
         AND c.relkind IN ('r', 'p')
         AND c.relname <> 'profiles'
    LOOP
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t.relname);
    END LOOP;
  END IF;
END
$$;

DO $$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prokind = 'f'
       AND p.proname IN (
         'assistant_conversations_guard', 'assistant_immutable_guard', 'assistant_messages_guard',
         'assistant_purge_active', 'assistant_purge_owner',
         'hs_append_only_guard', 'hs_credit_awards_guard', 'hs_no_delete_guard',
         'hs_official_results_guard', 'hs_roadmap_versions_guard',
         'student_cp_cross_binding_guard', 'student_cp_guard_immutable_history',
         'student_cp_guard_lifecycle', 'student_cp_guard_terminal_updates',
         'student_cp_validate_lifecycle_graph',
         'student_roadmap_progress_events_immutable', 'student_roadmap_versions_content_guard',
         'generate_student_code', 'validate_english_requirement', 'set_audit_retention')
       AND NOT EXISTS (
         SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c WHERE c LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f);
  END LOOP;
END
$$;

COMMIT;
