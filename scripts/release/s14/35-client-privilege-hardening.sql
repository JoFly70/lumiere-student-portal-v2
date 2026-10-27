-- S14 release step 35 (after 30-account-gate.sql). Classification B: changes grants on
-- EXISTING production objects. Content: scripts/disposable-env/60_s03_security_remediation.sql
-- sections 3 and 5, verbatim. S03 sections 2 (reconstructed legacy tables) and 4 (coach
-- policy rewrites) are deliberately NOT included: the pilot has no coach and the server
-- reaches every table through the service role.
--
-- Why it is safe: the browser never queries Postgres directly (client/src has no
-- supabase.from()/rpc()/storage calls; all data goes through Express with the service
-- role). Revoking anon and the profiles.status write removes no working path.
-- What it closes: anon table privileges on legacy tables (verify G2) and a signed-in user
-- rewriting their own profiles.status, which is the account-status gate (verify V8).
-- Rollback: re-grant from the grants snapshot taken in runbook step 2 (no data is touched).
-- Idempotent.
BEGIN;
-- ---------------------------------------------------------------------------
-- 3. Anonymous role: no table privileges anywhere in public. Policies on
--    these tables are all TO authenticated, so this removes no working path.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- Future tables created by the migration owner start with no client grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- Trigger / utility functions are not an RPC surface.
DO $$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN (
         'generate_student_code', 'student_cp_cross_binding_guard',
         'student_cp_guard_immutable_history', 'student_cp_guard_lifecycle',
         'student_cp_guard_terminal_updates', 'student_cp_validate_lifecycle_graph',
         'update_pricing_rules_timestamp', 'update_weekly_metrics_timestamp',
         'validate_english_requirement')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;


-- ---------------------------------------------------------------------------
-- 5. Profiles: a user may read their own row but may only change contact
--    preferences, never status (which gates account access).
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (timezone, phone) ON public.profiles TO authenticated;
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM authenticated;

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()::varchar) AND status = 'active')
  WITH CHECK (user_id = (SELECT auth.uid()::varchar) AND status = 'active');


COMMIT;
