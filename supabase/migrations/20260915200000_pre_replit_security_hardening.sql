/*
# Pre-Replit Security Hardening

1. Purpose
   Narrow, live-inspection-driven corrections from the Bolt security audit.
   No table drops, no schema redesign, no data migration. Safe to re-run
   (REVOKE/GRANT are idempotent; trigger recreation is DROP IF EXISTS).

2. Confirmed findings and decisions

   a. Mutable search_path on SECURITY DEFINER helpers
      (is_staff_or_admin, knowledge_is_admin, knowledge_is_staff_or_admin,
      student_owns_record): pinned to `public, pg_temp`.

   b. Mutable search_path on plpgsql helpers
      (generate_ticket_number, set_ticket_number,
      knowledge_update_updated_at): pinned to `public, pg_temp`.

   c. PUBLIC/anon EXECUTE on SECURITY DEFINER RLS helpers — corrected:
      anon and PUBLIC may no longer execute is_staff_or_admin,
      knowledge_is_admin, knowledge_is_staff_or_admin, or
      student_owns_record. authenticated + service_role retain EXECUTE —
      every RLS policy that references these helpers evaluates them with
      the calling (authenticated) user's privileges.

   d. Trigger helpers are not RPC surface: direct EXECUTE revoked from
      PUBLIC/anon/authenticated for update_updated_at_column,
      knowledge_update_updated_at, generate_ticket_number,
      set_ticket_number. Trigger execution is unaffected: a trigger fires
      with the table owner's rights and does not consult the invoking
      role's EXECUTE privilege. service_role retains EXECUTE for
      administration.

   e. Sensitive-table anon privileges removed. Live audit confirmed anon
      held full DML (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
      TRIGGER) on users, students, documents, support_tickets,
      ticket_comments, weekly_metrics, student_program_enrollments and all
      Phase 2 student_* academic tables. RLS policies in place only
      constrain authenticated, so with anon grants present the RLS-on-
      other-roles default of "no policy = deny" did NOT apply to the
      grant itself — PostgREST/GraphQL would expose the tables and RLS
      with no anon policy would deny row access but leak schema. Revoking
      anon table privileges removes both.
      audit_logs already had no anon grant (Phase 2D).

   f. Knowledge core: anon table privileges removed (24 knowledge_* tables).
      authenticated retains full grants: the Phase 1 RLS model
      (knowledge_is_staff_or_admin SELECT; admin mutation policies) still
      governs row access. Ordinary students/coaches are denied by policy,
      proven by real tests.

   g. Legacy reference tables (courses, degree_programs, program_courses):
      RETAINED intentionally. They are public reference data (course
      catalog / program mappings, no private information) with explicit
      "Anyone can view active ..." RLS policies, and legacy public frontend
      code (public/index.html) plus server routes reference this model.
      GraphQL visibility warnings for these tables are intentional.

   h. Phase 2D audit security untouched (already proven): audit function
      privileges, audit RLS, retention trigger unchanged. No regression
      found in this sweep.
*/

-- 3. Pin search_path on SECURITY DEFINER RLS helpers
ALTER FUNCTION public.is_staff_or_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.knowledge_is_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.knowledge_is_staff_or_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.student_owns_record(text) SET search_path = public, pg_temp;

-- 4. Pin search_path on plpgsql helpers
ALTER FUNCTION public.generate_ticket_number() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_ticket_number() SET search_path = public, pg_temp;
ALTER FUNCTION public.knowledge_update_updated_at() SET search_path = public, pg_temp;

-- 5. RLS helper functions: authenticated + service_role only
REVOKE EXECUTE ON FUNCTION public.is_staff_or_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.knowledge_is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.knowledge_is_staff_or_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.student_owns_record(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_or_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.knowledge_is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.knowledge_is_staff_or_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.student_owns_record(text) TO authenticated, service_role;

-- 6. Trigger helpers: not an RPC surface (triggers still fire normally)
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.knowledge_update_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_ticket_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_ticket_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;
GRANT EXECUTE ON FUNCTION public.knowledge_update_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_ticket_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_ticket_number() TO service_role;

-- 7. Sensitive tables: remove all anon privileges
REVOKE ALL ON public.users FROM anon;
REVOKE ALL ON public.students FROM anon;
REVOKE ALL ON public.documents FROM anon;
REVOKE ALL ON public.support_tickets FROM anon;
REVOKE ALL ON public.ticket_comments FROM anon;
REVOKE ALL ON public.weekly_metrics FROM anon;
REVOKE ALL ON public.student_program_enrollments FROM anon;
REVOKE ALL ON public.student_program_assignments FROM anon;
REVOKE ALL ON public.student_academic_sources FROM anon;
REVOKE ALL ON public.student_credit_records FROM anon;
REVOKE ALL ON public.student_credit_verification_events FROM anon;
REVOKE ALL ON public.student_credit_decisions FROM anon;
REVOKE ALL ON public.student_academic_exceptions FROM anon;

-- 8. Knowledge core: remove anon privileges; authenticated unchanged
--    (Phase 1 RLS model governs authenticated row access)
REVOKE ALL ON public.knowledge_academic_rules FROM anon;
REVOKE ALL ON public.knowledge_articulations_v2 FROM anon;
REVOKE ALL ON public.knowledge_claim_evidence FROM anon;
REVOKE ALL ON public.knowledge_claim_versions FROM anon;
REVOKE ALL ON public.knowledge_claims FROM anon;
REVOKE ALL ON public.knowledge_conflicts FROM anon;
REVOKE ALL ON public.knowledge_credit_providers FROM anon;
REVOKE ALL ON public.knowledge_equivalencies_v2 FROM anon;
REVOKE ALL ON public.knowledge_evidence_excerpts FROM anon;
REVOKE ALL ON public.knowledge_evidence_sources FROM anon;
REVOKE ALL ON public.knowledge_institution_course_versions FROM anon;
REVOKE ALL ON public.knowledge_institution_courses FROM anon;
REVOKE ALL ON public.knowledge_institution_versions FROM anon;
REVOKE ALL ON public.knowledge_institutions FROM anon;
REVOKE ALL ON public.knowledge_program_versions FROM anon;
REVOKE ALL ON public.knowledge_programs_v2 FROM anon;
REVOKE ALL ON public.knowledge_provider_course_versions FROM anon;
REVOKE ALL ON public.knowledge_provider_courses FROM anon;
REVOKE ALL ON public.knowledge_requirement_groups FROM anon;
REVOKE ALL ON public.knowledge_requirements_v2 FROM anon;
REVOKE ALL ON public.knowledge_residency_rules FROM anon;
REVOKE ALL ON public.knowledge_transfer_rules FROM anon;
REVOKE ALL ON public.knowledge_upper_level_rules FROM anon;
REVOKE ALL ON public.knowledge_verification_events FROM anon;
