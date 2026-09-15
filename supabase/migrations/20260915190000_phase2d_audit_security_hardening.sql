/*
# Phase 2D — Audit Security Hardening

1. Purpose
   Locks down the SECURITY DEFINER functions created by
   20260915180000_phase2d_audit_logging.sql. PostgreSQL grants EXECUTE to
   PUBLIC on new functions by default, which would let anon or ordinary
   authenticated users invoke privileged audit helpers directly. This
   migration revokes those defaults and grants only what each consumer
   needs. It also restores the table-level SELECT privilege for
   authenticated users (RLS policies require the grant to have any effect)
   while keeping anon at zero access. It touches no other objects.

2. Function privileges after this migration
   - create_audit_log():      EXECUTE only for service_role
   - purge_expired_audit_logs(): EXECUTE only for service_role
   - current_user_role():     EXECUTE for authenticated + service_role
     (needed by the admin audit SELECT RLS policy)
   - set_audit_retention():   EXECUTE only for service_role (trigger
     execution is unaffected — triggers run with table owner rights, not
     the invoking user's EXECUTE privilege)

3. Table privileges after this migration
   - audit_logs: anon = no privileges; authenticated = SELECT only
     (no INSERT/UPDATE/DELETE); service_role = unchanged full access.
   - RLS remains ENABLED with the same two SELECT policies.

4. Search path
   - set_audit_retention(), purge_expired_audit_logs(), and
     create_audit_log() all pin `SET search_path = public, pg_temp` so no
     SECURITY DEFINER function has a mutable search path.

5. Compatibility
   - Safe to re-run: REVOKE/GRANT are idempotent; trigger recreation is
     guarded by DROP IF EXISTS.
   - No roles are created or dropped; no table data is touched.
*/

-- 1. create_audit_log(): service_role only
REVOKE EXECUTE ON FUNCTION public.create_audit_log(public.audit_event_type, text, public.audit_severity, varchar, text, text, text, varchar, text, text, jsonb, boolean, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_audit_log(public.audit_event_type, text, public.audit_severity, varchar, text, text, text, varchar, text, text, jsonb, boolean, boolean, text, text)
  TO service_role;

-- 2. purge_expired_audit_logs(): service_role only
REVOKE EXECUTE ON FUNCTION public.purge_expired_audit_logs()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_audit_logs()
  TO service_role;

-- 3. current_user_role(): authenticated + service_role (used by RLS policy)
REVOKE EXECUTE ON FUNCTION public.current_user_role()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role()
  TO authenticated, service_role;

-- 4. set_audit_retention(): trigger function — not an RPC surface.
--    Triggers execute regardless of caller EXECUTE privilege; revoking
--    PUBLIC does not weaken trigger operation.
REVOKE EXECUTE ON FUNCTION public.set_audit_retention()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_audit_retention()
  TO service_role;

-- 5. Pin a safe, immutable search_path on every SECURITY DEFINER function
--    (defense against search-path hijacking inside definer execution).
ALTER FUNCTION public.set_audit_retention() SET search_path = public, pg_temp;
ALTER FUNCTION public.purge_expired_audit_logs() SET search_path = public, pg_temp;
ALTER FUNCTION public.create_audit_log(public.audit_event_type, text, public.audit_severity, varchar, text, text, text, varchar, text, text, jsonb, boolean, boolean, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.current_user_role() SET search_path = public, pg_temp;

-- 6. Table privileges: authenticated may SELECT (RLS filters rows);
--    anon has nothing; authenticated never INSERT/UPDATE/DELETE.
REVOKE ALL ON public.audit_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.audit_logs FROM authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

-- Re-assert service_role write path.
GRANT SELECT, INSERT ON public.audit_logs TO service_role;
