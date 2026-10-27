-- ============================================================================
-- POST-MIGRATION VERIFICATION (READ-ONLY) for the S13 release.
-- Paste into the Supabase SQL editor after the migrations. One SELECT, no writes.
-- Every row must show pass = true. A row with pass = false lists what is wrong in
-- `detail`. This is the single-result-set version of the gates in
-- scripts/disposable-env/audit-config.sql (that file uses psql \echo / \pset and a
-- per-table listing; run it with psql for the full table-by-table report - it is
-- referenced, not copied, for the listing parts).
-- Gate numbering: G1-G5 = audit-config.sql gates; V* = S13-specific additions.
-- ============================================================================
WITH
pub_tables AS (
  SELECT c.oid, c.relname, c.relrowsecurity AS rls
  FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
),
expected_tables(t) AS (VALUES
  ('account_invitations'), ('profiles'), ('users'), ('students'),
  ('student_roadmap_plans'), ('student_roadmap_versions'), ('student_roadmap_imports'),
  ('student_roadmap_progress'), ('student_roadmap_progress_events'),
  ('student_identity_corrections'), ('student_documents'), ('student_contacts'), ('student_english_proof'),
  ('ticket_attachments'), ('ticket_status_history'), ('support_tickets'), ('ticket_comments'), ('audit_logs'),
  ('hs_curriculum_templates'), ('hs_enrollments'), ('hs_prior_education'), ('hs_transfer_claims'),
  ('hs_roadmap_versions'), ('hs_task_progress'), ('hs_task_progress_events'), ('hs_official_results'),
  ('hs_credit_awards'), ('hs_graduation_records'), ('hs_events')
),
expected_enum(label) AS (VALUES
  ('support.ticket_created'),('support.ticket_updated'),('support.status_changed'),('support.assignment_changed'),
  ('support.priority_changed'),('support.comment_added'),('support.internal_note_added'),('support.attachment_added'),
  ('support.attachment_downloaded'),('support.access_denied'),
  ('roadmap.import_created'),('roadmap.import_replayed'),('roadmap.draft_updated'),('roadmap.exceptions_acknowledged'),
  ('roadmap.draft_discarded'),('roadmap.draft_opened_from_published'),('roadmap.published'),('roadmap.publish_rejected'),
  ('high_school.enrollment_created'),('high_school.enrollment_updated'),('high_school.prior_education_recorded'),
  ('high_school.transfer_claim_changed'),('high_school.roadmap_draft_saved'),('high_school.roadmap_published'),
  ('high_school.progress_reported'),('high_school.official_result_recorded'),('high_school.credit_awarded'),
  ('high_school.credit_voided'),('high_school.graduation_updated'),('high_school.guardian_note_added'),
  ('high_school.access_denied'),
  ('admin.permission_granted'),('admin.permission_revoked')      -- account linkage / unlinking (S13)
),
v7 AS (   -- evaluated lazily: the query text only runs when the table exists
  SELECT coalesce((xpath('/table/row/bad/text()', x))[1]::text::int, -1) AS bad,
         coalesce((xpath('/table/row/total/text()', x))[1]::text::int, -1) AS total
  FROM (SELECT CASE WHEN to_regclass('public.ticket_attachments') IS NULL THEN NULL::xml
          ELSE query_to_xml($q$SELECT count(*) FILTER (WHERE storage_path NOT LIKE 'tickets/' || ticket_id::text || '/%' OR storage_path LIKE '%..%') AS bad,
                                      count(*) AS total FROM public.ticket_attachments$q$, false, false, '') END AS x) q
),
gates(ord, name, pass, detail) AS (
  -- G1 audit-config: RLS on every public table
  SELECT 1, 'G1 RLS enabled on every public table',
         NOT EXISTS (SELECT 1 FROM pub_tables WHERE NOT rls),
         coalesce((SELECT string_agg(relname, ', ' ORDER BY relname) FROM pub_tables WHERE NOT rls), 'none missing')
  UNION ALL
  -- G2 audit-config: no anon table privilege
  SELECT 2, 'G2 anon has no privilege on any public table',
         NOT EXISTS (SELECT 1 FROM pub_tables p WHERE has_table_privilege('anon', p.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
         coalesce((SELECT string_agg(relname, ', ' ORDER BY relname) FROM pub_tables p
                   WHERE has_table_privilege('anon', p.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')), 'clean')
  UNION ALL
  -- G3 audit-config: authenticated holds table privileges only where a policy exists
  SELECT 3, 'G3 authenticated has no grant on policy-less public tables',
         NOT EXISTS (SELECT 1 FROM pub_tables p WHERE has_table_privilege('authenticated', p.oid, 'SELECT,INSERT,UPDATE,DELETE')
                       AND NOT EXISTS (SELECT 1 FROM pg_policies x WHERE x.schemaname='public' AND x.tablename = p.relname)),
         coalesce((SELECT string_agg(relname, ', ' ORDER BY relname) FROM pub_tables p
                   WHERE has_table_privilege('authenticated', p.oid, 'SELECT,INSERT,UPDATE,DELETE')
                     AND NOT EXISTS (SELECT 1 FROM pg_policies x WHERE x.schemaname='public' AND x.tablename = p.relname)), 'clean')
  UNION ALL
  -- G4 audit-config: no function in public executable by anon
  SELECT 4, 'G4 no non-trigger public function executable by anon',
         NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE')
                     AND p.prorettype <> 'trigger'::regtype
                     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')),
         coalesce((SELECT string_agg(DISTINCT p.proname, ', ') FROM pg_proc p
                   WHERE p.pronamespace='public'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE')
                     AND p.prorettype <> 'trigger'::regtype
                     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')), 'clean (trigger functions and extension functions excluded)')
  UNION ALL
  -- G5 audit-config: SECURITY DEFINER functions pin search_path
  SELECT 5, 'G5 SECURITY DEFINER functions pin search_path',
         NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef
                       AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%')),
         coalesce((SELECT string_agg(DISTINCT p.proname, ', ') FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef
                   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%')), 'clean')
  UNION ALL
  -- V1 required tables exist (account_invitations, roadmap, support, HS, documents/contacts)
  SELECT 6, 'V1 every S13 table exists',
         NOT EXISTS (SELECT 1 FROM expected_tables e WHERE to_regclass('public.' || e.t) IS NULL),
         coalesce((SELECT string_agg(t, ', ') FROM expected_tables e WHERE to_regclass('public.' || e.t) IS NULL), 'all 29 present')
  UNION ALL
  -- V2 account_invitations: RLS on, zero client privilege, token hash unique
  SELECT 7, 'V2 account_invitations locked down (RLS, no anon/authenticated privilege, token_hash unique)',
         to_regclass('public.account_invitations') IS NOT NULL
         AND (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.account_invitations'))
         AND NOT coalesce(has_table_privilege('anon', to_regclass('public.account_invitations'),'SELECT,INSERT,UPDATE,DELETE'), true)
         AND NOT coalesce(has_table_privilege('authenticated', to_regclass('public.account_invitations'),'SELECT,INSERT,UPDATE,DELETE'), true)
         AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='account_invitations' AND indexdef ILIKE '%unique%token_hash%'),
         'service_role must hold ALL: ' || coalesce(has_table_privilege('service_role', to_regclass('public.account_invitations'),'INSERT,UPDATE,SELECT')::text,'n/a')
  UNION ALL
  -- V3 account gate present and RLS helpers carry it (S05/S09/S11 overwrite them; S03 must be applied LAST)
  SELECT 8, 'V3 current_user_is_active() exists and is_staff_or_admin()/student_owns_record() call it',
         to_regprocedure('public.current_user_is_active()') IS NOT NULL
         AND coalesce(pg_get_functiondef(to_regprocedure('public.is_staff_or_admin()')) ILIKE '%current_user_is_active%', false)
         AND coalesce(pg_get_functiondef(to_regprocedure('public.student_owns_record(text)')) ILIKE '%current_user_is_active%', false),
         'if false after S05-S11, re-apply the account-status migration last'
  UNION ALL
  -- V4 audit enum values (support.*, roadmap.*, high_school.*, admin.permission_*)
  SELECT 9, 'V4 audit_event_type has every S13 value',
         NOT EXISTS (SELECT 1 FROM expected_enum x WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e WHERE e.enumtypid = to_regtype('public.audit_event_type') AND e.enumlabel = x.label)),
         coalesce((SELECT string_agg(label, ', ') FROM expected_enum x WHERE NOT EXISTS (
            SELECT 1 FROM pg_enum e WHERE e.enumtypid = to_regtype('public.audit_event_type') AND e.enumlabel = x.label)), 'all present')
  UNION ALL
  -- V5 buckets: all three private; none missing for the two the HS/support flows use
  SELECT 10, 'V5 storage buckets student-documents and documents exist and are private (none public)',
         NOT EXISTS (SELECT 1 FROM storage.buckets WHERE public IS TRUE)
         AND (SELECT count(*) FROM storage.buckets WHERE id IN ('student-documents','documents')) = 2,
         coalesce((SELECT string_agg(id || '=' || CASE WHEN public THEN 'PUBLIC' ELSE 'private' END, ', ') FROM storage.buckets), 'no buckets')
  UNION ALL
  -- V6 storage.objects policies: no policy lets anon, or authenticated, read these private buckets directly
  SELECT 11, 'V6 no storage.objects policy exposes the private buckets to anon/authenticated (server uses signed URLs)',
         NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
                       AND (roles && ARRAY['anon','authenticated','public']::name[])
                       AND (coalesce(qual,'') ~ '(student-documents|documents|knowledge-evidence)' OR coalesce(qual,'') = 'true' OR qual IS NULL)),
         coalesce((SELECT string_agg(policyname || ' [' || cmd || ']', ', ') FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
                   AND (roles && ARRAY['anon','authenticated','public']::name[])), 'no client policies')
  UNION ALL
  -- V7 ticket_attachments: every registered path stays inside its own ticket folder (legacy flaw evidence)
  SELECT 12, 'V7 ticket_attachments: no path escapes tickets/<ticket_id>/ (0 offending rows = no legacy abuse)',
         (SELECT bad FROM v7) = 0, (SELECT bad::text || ' offending rows of ' || total::text FROM v7)
  UNION ALL
  -- V8 profiles: authenticated cannot change status (account gate), cannot insert/delete
  SELECT 13, 'V8 profiles.status not writable by authenticated; no INSERT/DELETE for authenticated',
         to_regclass('public.profiles') IS NOT NULL
         AND NOT coalesce(has_column_privilege('authenticated','public.profiles','status','UPDATE'), true)
         AND NOT coalesce(has_table_privilege('authenticated','public.profiles','INSERT,DELETE'), true),
         'S03 section 5'
  UNION ALL
  -- V9 HS immutability triggers present (credit ledger / append-only history)
  SELECT 14, 'V9 HS guard triggers installed (append-only events, credit/result guards, no-delete)',
         (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN
            ('hs_task_progress_events_append_only','hs_events_append_only','hs_curriculum_templates_immutable','hs_roadmap_versions_guard',
             'hs_official_results_guard','hs_credit_awards_guard','hs_task_progress_no_delete')) = 7,
         (SELECT count(*)::text || ' of 7' FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN
            ('hs_task_progress_events_append_only','hs_events_append_only','hs_curriculum_templates_immutable','hs_roadmap_versions_guard',
             'hs_official_results_guard','hs_credit_awards_guard','hs_task_progress_no_delete'))
  UNION ALL
  -- V10 contact authority columns (S09 skips them silently when student_contacts did not exist at run time)
  SELECT 15, 'V10 student_contacts.authority_status present (re-run S09 if false)',
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='student_contacts' AND column_name='authority_status'),
         ''
  UNION ALL
  -- V11 no student is linked to a non-student account and no user_id is shared by two students
  SELECT 16, 'V11 students.user_id: unique per account, only student-role accounts',
         NOT EXISTS (SELECT 1 FROM public.students GROUP BY user_id HAVING user_id IS NOT NULL AND count(*) > 1)
         AND NOT EXISTS (SELECT 1 FROM public.students s JOIN public.users u ON u.id = s.user_id::text WHERE u.role::text <> 'student'),
         ''
  UNION ALL
  SELECT 17, 'V12 trigger trg_generate_student_code exists (staff Add student needs it)',
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_generate_student_code' AND NOT tgisinternal), ''
)
SELECT ord, name, pass, detail FROM gates ORDER BY ord;
