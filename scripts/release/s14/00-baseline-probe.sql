-- ============================================================================
-- BASELINE PROBE (READ-ONLY) - which Lumiere migrations are already present?
-- Paste the whole file into the Supabase SQL editor of the TARGET project and run.
-- It is one SELECT: no DDL, no DML, no function creation, no writes. It returns
-- one result set (the SQL editor shows only the last result, so everything is
-- in this single statement). ok = true  -> the signature object is present.
--
-- Read the output as follows:
--   section 'A_migration'  one row per supabase/migrations file: APPLIED / PARTIAL / ABSENT
--   section 'B_s13_gap'    objects the S13 release needs that NO supabase/migrations
--                          file creates (see report). ok=false => must be supplied.
--   section 'C_detail'     every signature check behind section A (ordered).
--   section 'D_ledger'     supabase_migrations.schema_migrations, if it exists
--                          (the ledger can be wrong if files were pasted by hand:
--                          trust the object checks over the ledger).
-- Signatures are structural (tables, columns, enum labels, functions, grants),
-- so they work whether or not the migrations were applied through the CLI.
-- ============================================================================
WITH
fn_exec_anon AS (          -- helper: does anon (or PUBLIC) hold EXECUTE?
  SELECT p.proname, bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) AS anon_exec
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace GROUP BY p.proname
),
chk0(mig, ord, name, ok) AS (
  VALUES
  -- ---- baseline: PRODUCTION_DATABASE_SETUP.sql + 011 -------------------------------------
  ('00_PRODUCTION_DATABASE_SETUP', 1,  'table users',              to_regclass('public.users') IS NOT NULL),
  ('00_PRODUCTION_DATABASE_SETUP', 2,  'table students',           to_regclass('public.students') IS NOT NULL),
  ('00_PRODUCTION_DATABASE_SETUP', 3,  'table documents',          to_regclass('public.documents') IS NOT NULL),
  ('00_PRODUCTION_DATABASE_SETUP', 4,  'table support_tickets',    to_regclass('public.support_tickets') IS NOT NULL),
  ('00_PRODUCTION_DATABASE_SETUP', 5,  'table ticket_comments',    to_regclass('public.ticket_comments') IS NOT NULL),
  ('00_PRODUCTION_DATABASE_SETUP', 6,  'table weekly_metrics',     to_regclass('public.weekly_metrics') IS NOT NULL),
  ('00_PRODUCTION_DATABASE_SETUP', 7,  'enum role',                EXISTS (SELECT 1 FROM pg_type WHERE typname = 'role' AND typnamespace = 'public'::regnamespace)),
  ('00_PRODUCTION_DATABASE_SETUP', 8,  'enum doc_status_enum',     EXISTS (SELECT 1 FROM pg_type WHERE typname = 'doc_status_enum' AND typnamespace = 'public'::regnamespace)),
  ('00_PRODUCTION_DATABASE_SETUP', 9,  'enum contact_type_enum',   EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contact_type_enum' AND typnamespace = 'public'::regnamespace)),
  ('20251217230356_011_degree_programs_courses', 1, 'tables degree_programs/courses/program_courses/student_program_enrollments',
      to_regclass('public.degree_programs') IS NOT NULL AND to_regclass('public.courses') IS NOT NULL
      AND to_regclass('public.program_courses') IS NOT NULL AND to_regclass('public.student_program_enrollments') IS NOT NULL),
  ('20251217230356_011_degree_programs_courses', 2, 'policy "Anyone can view active degree programs" (011 marker; NOT idempotent)',
      EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='degree_programs' AND policyname ILIKE 'Anyone can view active degree%')),
  -- ---- early chain ------------------------------------------------------------------------
  ('20251217235151_fix_rls_performance_security', 1, 'update_updated_at_column has pinned search_path',
      EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname='update_updated_at_column' AND p.pronamespace='public'::regnamespace
              AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%'))),
  ('20260914182506_phase0_add_staff_role', 1, 'enum role has value staff',
      EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='role' AND t.typnamespace='public'::regnamespace AND e.enumlabel='staff')),
  ('20260914195204_phase1a_knowledge_core_schema', 1, 'table knowledge_institutions',   to_regclass('public.knowledge_institutions') IS NOT NULL),
  ('20260914195204_phase1a_knowledge_core_schema', 2, 'table knowledge_claim_versions', to_regclass('public.knowledge_claim_versions') IS NOT NULL),
  ('20260914195204_phase1a_knowledge_core_schema', 3, 'table knowledge_verification_events', to_regclass('public.knowledge_verification_events') IS NOT NULL),
  ('20260914200029_phase1a_knowledge_core_integrity_fix', 1, 'function knowledge_is_admin()',
      EXISTS (SELECT 1 FROM pg_proc WHERE proname='knowledge_is_admin' AND pronamespace='public'::regnamespace)),
  ('20260914200820_phase1a_knowledge_history_hardening', 1, 'no knowledge_delete policy remains',
      to_regclass('public.knowledge_institutions') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'knowledge\_%' AND policyname='knowledge_delete')),
  ('20260914234000_phase1db_verification_event_sequence', 1, 'column knowledge_verification_events.seq',
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='knowledge_verification_events' AND column_name='seq')),
  ('20260915160000_phase2a_student_academic_record', 1, 'table student_credit_records',      to_regclass('public.student_credit_records') IS NOT NULL),
  ('20260915160000_phase2a_student_academic_record', 2, 'table student_program_assignments', to_regclass('public.student_program_assignments') IS NOT NULL),
  ('20260915160000_phase2a_student_academic_record', 3, 'function student_owns_record(text)',
      to_regprocedure('public.student_owns_record(text)') IS NOT NULL),
  ('20260915180000_phase2d_audit_logging', 1, 'table audit_logs',        to_regclass('public.audit_logs') IS NOT NULL),
  ('20260915180000_phase2d_audit_logging', 2, 'enum audit_event_type',   EXISTS (SELECT 1 FROM pg_type WHERE typname='audit_event_type' AND typnamespace='public'::regnamespace)),
  ('20260915180000_phase2d_audit_logging', 3, 'function create_audit_log exists',
      EXISTS (SELECT 1 FROM pg_proc WHERE proname='create_audit_log' AND pronamespace='public'::regnamespace)),
  ('20260915190000_phase2d_audit_security_hardening', 1, 'create_audit_log NOT executable by anon',
      EXISTS (SELECT 1 FROM fn_exec_anon WHERE proname='create_audit_log') AND NOT coalesce((SELECT anon_exec FROM fn_exec_anon WHERE proname='create_audit_log'), true)),
  ('20260915200000_pre_replit_security_hardening', 1, 'is_staff_or_admin NOT executable by anon',
      EXISTS (SELECT 1 FROM fn_exec_anon WHERE proname='is_staff_or_admin') AND NOT coalesce((SELECT anon_exec FROM fn_exec_anon WHERE proname='is_staff_or_admin'), true)),
  ('20260915210000_policy_auth_users_remediation', 1, 'no public policy still subqueries auth.users',
      NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND (coalesce(qual,'') ILIKE '%auth.users%' OR coalesce(with_check,'') ILIKE '%auth.users%'))),
  ('20260915220000_pre_replit_security_corrections', 1, 'documents "view own" policy resolves through students',
      EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='documents' AND policyname='Students can view own documents'
              AND (coalesce(qual,'') ILIKE '%students%' OR coalesce(qual,'') ILIKE '%student_owns_record%'))),
  ('20260916010000_phase4b_student_credit_placement', 1, 'table student_credit_placements', to_regclass('public.student_credit_placements') IS NOT NULL),
  ('20260916020000_phase4b_student_credit_placement_lifecycle_hardening', 1, 'function student_cp_guard_terminal_updates',
      EXISTS (SELECT 1 FROM pg_proc WHERE proname='student_cp_guard_terminal_updates' AND pronamespace='public'::regnamespace)),
  ('20260916100000_phase5e_restore_profiles', 1, 'table profiles',  to_regclass('public.profiles') IS NOT NULL),
  ('20260916100000_phase5e_restore_profiles', 2, 'profiles.status column',
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='status')),
  ('20260917100000_knowledge_evidence_source_metadata', 1, 'enum evidence_lifecycle_status',
      EXISTS (SELECT 1 FROM pg_type WHERE typname='evidence_lifecycle_status' AND typnamespace='public'::regnamespace)),
  -- ---- S05 ---------------------------------------------------------------------------------
  ('20261026100000_s05_student_roadmap', 1, 'student_roadmap_plans',             to_regclass('public.student_roadmap_plans') IS NOT NULL),
  ('20261026100000_s05_student_roadmap', 2, 'student_roadmap_versions',          to_regclass('public.student_roadmap_versions') IS NOT NULL),
  ('20261026100000_s05_student_roadmap', 3, 'student_roadmap_imports',           to_regclass('public.student_roadmap_imports') IS NOT NULL),
  ('20261026100000_s05_student_roadmap', 4, 'student_roadmap_progress',          to_regclass('public.student_roadmap_progress') IS NOT NULL),
  ('20261026100000_s05_student_roadmap', 5, 'student_roadmap_progress_events',   to_regclass('public.student_roadmap_progress_events') IS NOT NULL),
  ('20261026100000_s05_student_roadmap', 6, 'trigger student_roadmap_versions_content_guard',
      EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='student_roadmap_versions_content_guard' AND NOT tgisinternal)),
  -- ---- S07 / S08 / S11b audit enum values --------------------------------------------------
  ('20261026110000_s07_roadmap_audit_event_types', 1, 'audit_event_type has all 8 roadmap.* values',
      (SELECT count(*) FROM pg_enum e WHERE e.enumtypid = to_regtype('public.audit_event_type')
         AND e.enumlabel IN ('roadmap.import_created','roadmap.import_replayed','roadmap.draft_updated','roadmap.exceptions_acknowledged',
                             'roadmap.draft_discarded','roadmap.draft_opened_from_published','roadmap.published','roadmap.publish_rejected')) = 8),
  -- ---- S09 ---------------------------------------------------------------------------------
  ('20261026200000_s09_student_profile', 1, 'student_identity_corrections', to_regclass('public.student_identity_corrections') IS NOT NULL),
  ('20261026200000_s09_student_profile', 2, 'student_contacts.authority_status (S09 silently SKIPS this if student_contacts was absent)',
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='student_contacts' AND column_name='authority_status')),
  ('20261026200000_s09_student_profile', 3, 'contact_type_enum has emergency+representative',
      (SELECT count(*) FROM pg_enum e WHERE e.enumtypid = to_regtype('public.contact_type_enum') AND e.enumlabel IN ('emergency','representative')) = 2),
  ('20261027100000_s08_support_audit_events', 1, 'audit_event_type has all 10 support.* values',
      (SELECT count(*) FROM pg_enum e WHERE e.enumtypid = to_regtype('public.audit_event_type') AND e.enumlabel LIKE 'support.%') >= 10),
  ('20261028100000_s10_support_idempotency_index', 1, 'any unique index on support_tickets mentioning idempotency/metadata',
      EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='support_tickets' AND indexdef ILIKE '%unique%' AND (indexname ILIKE '%idem%' OR indexdef ILIKE '%metadata%'))),
  ('20261028200000_s10_support_schema_repair', 1, 'ticket_attachments',    to_regclass('public.ticket_attachments') IS NOT NULL),
  ('20261028200000_s10_support_schema_repair', 2, 'ticket_status_history', to_regclass('public.ticket_status_history') IS NOT NULL),
  ('20261028200000_s10_support_schema_repair', 3, 'ticket_attachments: authenticated has NO privilege (repair revokes it)',
      to_regclass('public.ticket_attachments') IS NOT NULL AND NOT has_table_privilege('authenticated','public.ticket_attachments','SELECT,INSERT,UPDATE,DELETE')),
  ('20261029100000_s11_high_school_pathway', 1, 'hs_enrollments',          to_regclass('public.hs_enrollments') IS NOT NULL),
  ('20261029100000_s11_high_school_pathway', 2, 'hs_curriculum_templates', to_regclass('public.hs_curriculum_templates') IS NOT NULL),
  ('20261029100000_s11_high_school_pathway', 3, 'hs_credit_awards',        to_regclass('public.hs_credit_awards') IS NOT NULL),
  ('20261029100000_s11_high_school_pathway', 4, 'hs_events',               to_regclass('public.hs_events') IS NOT NULL),
  ('20261029100000_s11_high_school_pathway', 5, 'hs_graduation_records',   to_regclass('public.hs_graduation_records') IS NOT NULL),
  ('20261029100000_s11_high_school_pathway', 6, 'hs_transfer_claims.accepted_half_units',
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hs_transfer_claims' AND column_name='accepted_half_units')),
  ('20261029110000_s11_high_school_audit_event_types', 1, 'audit_event_type has all 13 high_school.* values',
      (SELECT count(*) FROM pg_enum e WHERE e.enumtypid = to_regtype('public.audit_event_type') AND e.enumlabel LIKE 'high\_school.%') >= 13)
),
chk AS (SELECT mig, ord, name, coalesce(ok, false) AS ok FROM chk0),
per_mig AS (
  SELECT mig, count(*) AS n, count(*) FILTER (WHERE ok) AS n_ok,
         CASE WHEN count(*) FILTER (WHERE ok) = count(*) THEN 'APPLIED'
              WHEN count(*) FILTER (WHERE ok) = 0 THEN 'ABSENT' ELSE 'PARTIAL' END AS state
  FROM chk GROUP BY mig
),
s13_gap0(ord, name, ok, note) AS (
  VALUES
  (1,  'table account_invitations (sign-up + admin invitations; NOT in any supabase/migrations file)',
       to_regclass('public.account_invitations') IS NOT NULL, 'only in scripts/disposable-env/60_s03 (disposable)'),
  (2,  'account_invitations: RLS on, no anon/authenticated privilege',
       to_regclass('public.account_invitations') IS NOT NULL
       AND (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.account_invitations'))
       AND NOT has_table_privilege('anon','public.account_invitations','SELECT,INSERT,UPDATE,DELETE')
       AND NOT has_table_privilege('authenticated','public.account_invitations','SELECT,INSERT,UPDATE,DELETE'), 'S03 grants'),
  (3,  'function current_user_is_active() (RLS account-status gate)',
       to_regprocedure('public.current_user_is_active()') IS NOT NULL, 'only in 60_s03'),
  (4,  'is_staff_or_admin()/student_owns_record() include the active-account check (S05/S09/S11 REGRESS this)',
       to_regprocedure('public.is_staff_or_admin()') IS NOT NULL
       AND pg_get_functiondef(to_regprocedure('public.is_staff_or_admin()')) ILIKE '%current_user_is_active%', 'order: S03 must run AFTER S05-S11'),
  (5,  'table student_documents (HS evidence verification; NOT in supabase/migrations)',
       to_regclass('public.student_documents') IS NOT NULL, 'legacy migrations/005 or 50_runtime_supplement'),
  (6,  'student_documents has status, doc_type, soft_deleted',
       (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='student_documents' AND column_name IN ('status','doc_type','soft_deleted','storage_path','student_id')) = 5, 'HS repo queries these'),
  (7,  'table student_contacts (guardian standing; NOT in supabase/migrations)',
       to_regclass('public.student_contacts') IS NOT NULL, 'legacy 005 / supplement'),
  (8,  'table student_english_proof', to_regclass('public.student_english_proof') IS NOT NULL, 'document-service.ts'),
  (9,  'storage bucket student-documents exists and is private',
       EXISTS (SELECT 1 FROM storage.buckets WHERE id='student-documents' AND public IS NOT TRUE), 'server can auto-create (public?) - see verify.sql'),
  (10, 'storage bucket documents (ticket attachments) exists and is private',
       EXISTS (SELECT 1 FROM storage.buckets WHERE id='documents' AND public IS NOT TRUE), 'tickets.ts'),
  (11, 'ticket_attachments / ticket_status_history (S10 repair)',
       to_regclass('public.ticket_attachments') IS NOT NULL AND to_regclass('public.ticket_status_history') IS NOT NULL, 'in supabase/migrations'),
  (13, 'trigger trg_generate_student_code on students (staff "Add student" omits student_code, which is NOT NULL)',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_generate_student_code' AND NOT tgisinternal), 'legacy 005 / 50_runtime_supplement'),
  (12, 'profiles RLS: authenticated cannot UPDATE status column',
       to_regclass('public.profiles') IS NOT NULL AND NOT has_column_privilege('authenticated','public.profiles','status','UPDATE'), 'S03 section 5')
),
s13_gap AS (SELECT ord, name, coalesce(ok, false) AS ok, note FROM s13_gap0),
ledger AS (
  SELECT CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL
              THEN 'supabase_migrations.schema_migrations does not exist'
              ELSE (SELECT string_agg(v::text, ', ')
                    FROM unnest(xpath('//version/text()',
                           query_to_xml('select version from supabase_migrations.schema_migrations order by 1', false, false, ''))) v)
         END AS versions
)
SELECT section, label, ok, detail FROM (
  SELECT 'A_migration' AS section, 1 AS s, mig AS label, state = 'APPLIED' AS ok, state || ' (' || n_ok || '/' || n || ')' AS detail, mig AS k1, 0 AS k2 FROM per_mig
  UNION ALL
  SELECT 'B_s13_gap', 2, name, ok, note, '', ord FROM s13_gap
  UNION ALL
  SELECT 'C_detail', 3, mig || ' :: ' || name, ok, '', mig, ord FROM chk
  UNION ALL
  SELECT 'D_ledger', 4, 'schema_migrations versions', NULL, versions, '', 0 FROM ledger
) q ORDER BY s, k1, k2;
