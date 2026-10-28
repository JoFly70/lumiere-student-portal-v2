-- S25 PRODUCTION post-verify. READ-ONLY. Every row of the first query must have ok = true.
SELECT * FROM (
  SELECT 'all 17 tables present' AS check_name,
         (SELECT count(*) FROM unnest(ARRAY['student_billing_obligations','student_billing_discounts','student_billing_installments','student_billing_evidence','student_billing_receipts','assistant_usage_monthly','assistant_conversations','assistant_messages','assistant_message_attachments','assistant_audit_events','assistant_integrity_checkpoints','student_document_text','student_storage_quota','student_assistant_memory','assistant_memory_sources','student_welcome_state','user_language_preference']) n WHERE to_regclass('public.'||n) IS NOT NULL) = 17 AS ok
  UNION ALL SELECT 'RLS on for every public table',
         NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)
  UNION ALL SELECT 'is_staff_or_admin() keeps the active-account check',
         pg_get_functiondef('public.is_staff_or_admin()'::regprocedure) ILIKE '%current_user_is_active%'
  UNION ALL SELECT 'student_owns_record() keeps the active-account check',
         pg_get_functiondef('public.student_owns_record(text)'::regprocedure) ILIKE '%current_user_is_active%'
  UNION ALL SELECT 'RLS helpers pinned search_path',
         NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('is_staff_or_admin','student_owns_record','current_user_is_active','current_user_role') AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) c WHERE c LIKE 'search_path=%'))
  UNION ALL SELECT 'RLS helpers executable by authenticated (must stay true)',
         has_function_privilege('authenticated','public.is_staff_or_admin()','EXECUTE') AND has_function_privilege('authenticated','public.student_owns_record(text)','EXECUTE')
  UNION ALL SELECT 'RLS helpers not executable by anon',
         NOT has_function_privilege('anon','public.is_staff_or_admin()','EXECUTE') AND NOT has_function_privilege('anon','public.student_owns_record(text)','EXECUTE')
  UNION ALL SELECT 'anon has no table privilege in public',
         NOT EXISTS (SELECT 1 FROM information_schema.table_privileges WHERE table_schema='public' AND grantee='anon')
  UNION ALL SELECT 'authenticated has no write privilege (profiles column UPDATE excepted)',
         NOT EXISTS (SELECT 1 FROM information_schema.table_privileges WHERE table_schema='public' AND grantee='authenticated' AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE'))
  UNION ALL SELECT 'profiles.status not writable by authenticated',
         NOT has_column_privilege('authenticated','public.profiles','status','UPDATE')
  UNION ALL SELECT 'no unpinned search_path on the S25 function list',
         NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'
                     AND p.proname ~ '^(assistant_.*(guard|purge_active|purge_owner)|hs_.*_guard|student_cp_.*|student_roadmap_.*(immutable|guard))$'
                     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) c WHERE c LIKE 'search_path=%'))
  UNION ALL SELECT 'student-documents bucket private, 20 MiB, 11 MIME types',
         EXISTS (SELECT 1 FROM storage.buckets WHERE id='student-documents' AND NOT public AND file_size_limit = 20971520 AND cardinality(allowed_mime_types) = 11)
  UNION ALL SELECT 'all buckets private', NOT EXISTS (SELECT 1 FROM storage.buckets WHERE public)
  UNION ALL SELECT 'no storage.objects policy for anon/authenticated/public',
         NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND roles && ARRAY['anon','authenticated','public']::name[])
  UNION ALL SELECT 'audit_event_type has billing.ledger_updated and billing.receipt_voided',
         (SELECT count(*) FROM pg_enum WHERE enumtypid='public.audit_event_type'::regtype AND enumlabel IN ('billing.ledger_updated','billing.receipt_voided')) = 2
  UNION ALL SELECT 'doc_type_enum has chat_attachment',
         EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.doc_type_enum'::regtype AND enumlabel='chat_attachment')
) v ORDER BY ok, check_name;

-- Informational: tables with RLS on and no policy (server-only by design) and the authenticated-executable DEFINER functions.
SELECT c.relname AS rls_no_policy_table FROM pg_class c
 WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND c.relrowsecurity
   AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) ORDER BY 1;
SELECT p.oid::regprocedure AS definer_function_callable_by_authenticated FROM pg_proc p
 WHERE p.pronamespace='public'::regnamespace AND p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE') ORDER BY 1;
