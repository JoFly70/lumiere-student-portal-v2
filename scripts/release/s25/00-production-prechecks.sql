-- S25 PRODUCTION pre-checks. READ-ONLY (SELECT only). Run in the Supabase SQL editor on the PRODUCTION project
-- BEFORE any migration. Save the output with the backup record. Nothing here writes.

-- P1. Which of the 16 expected-missing tables (+ language preference) exist? Expect all 'MISSING' except any already applied.
SELECT t.name AS table_name,
       CASE WHEN to_regclass('public.' || t.name) IS NULL THEN 'MISSING' ELSE 'present' END AS state
  FROM (VALUES
    ('student_billing_obligations'),('student_billing_discounts'),('student_billing_installments'),
    ('student_billing_evidence'),('student_billing_receipts'),
    ('assistant_usage_monthly'),
    ('assistant_conversations'),('assistant_messages'),('assistant_message_attachments'),
    ('assistant_audit_events'),('assistant_integrity_checkpoints'),
    ('student_document_text'),('student_storage_quota'),
    ('student_assistant_memory'),('assistant_memory_sources'),
    ('student_welcome_state'),
    ('user_language_preference')
  ) AS t(name)
 ORDER BY 1;

-- P2. Prerequisites that the pending files assume already exist. All must be 'present'.
SELECT t.name, CASE WHEN to_regclass('public.' || t.name) IS NULL THEN 'MISSING - STOP' ELSE 'present' END AS state
  FROM (VALUES ('users'),('profiles'),('students'),('student_documents'),('support_tickets'),('ticket_comments'),
               ('ticket_attachments'),('audit_logs'),('hs_enrollments'),('student_roadmap_plans')) AS t(name);
SELECT 'audit_event_type enum' AS item, CASE WHEN to_regtype('public.audit_event_type') IS NULL THEN 'MISSING - STOP' ELSE 'present' END AS state
UNION ALL SELECT 'doc_type_enum', CASE WHEN to_regtype('public.doc_type_enum') IS NULL THEN 'MISSING - STOP' ELSE 'present' END
UNION ALL SELECT 'student_documents.required_for_enrollment column (S21 CHECK needs it)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='student_documents' AND column_name='required_for_enrollment') THEN 'present' ELSE 'MISSING - STOP' END
UNION ALL SELECT 'students.id type', (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.students'::regclass AND attname = 'id')
UNION ALL SELECT 'student_documents.id type', (SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.student_documents'::regclass AND attname = 'id');

-- P3. Existing audit_event_type labels the pending files add (ADD VALUE IF NOT EXISTS is safe either way).
SELECT e.enumlabel FROM pg_enum e WHERE e.enumtypid = 'public.audit_event_type'::regtype
   AND (e.enumlabel LIKE 'billing.%' OR e.enumlabel LIKE 'high_school.%' OR e.enumlabel LIKE 'roadmap.%' OR e.enumlabel LIKE 'support.%') ORDER BY 1;

-- P4. Account-gate helpers: record the CURRENT production definitions (rollback reference). Expect the active check in both.
SELECT p.oid::regprocedure AS fn,
       pg_get_functiondef(p.oid) ILIKE '%current_user_is_active%' AS has_active_check,
       p.prosecdef AS security_definer, p.proconfig AS config
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('is_staff_or_admin','student_owns_record','current_user_is_active','current_user_role');
SELECT pg_get_functiondef(p.oid) AS definition_to_save FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('is_staff_or_admin','student_owns_record','current_user_is_active','current_user_role');

-- P5. Columns the small pending files add (informational: 'present' means that file is already applied).
SELECT 'student_documents.student_message (S18)' AS item, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='student_documents' AND column_name='student_message') AS applied
UNION ALL SELECT 'ticket_comments.idempotency_key (S19)', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ticket_comments' AND column_name='idempotency_key')
UNION ALL SELECT 'student_documents.source (S21)', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='student_documents' AND column_name='source');

-- P6. Row counts that justify "non-destructive" (student_documents is the only existing table altered with constraints).
SELECT (SELECT count(*) FROM public.student_documents) AS student_documents_rows,
       (SELECT count(*) FROM public.users) AS users_rows, (SELECT count(*) FROM public.students) AS students_rows;

-- P7. Client privilege state before the lockdown: expect anon = 0 rows; authenticated write grants are what 10c removes.
SELECT grantee, count(DISTINCT table_name) AS tables, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privileges
  FROM information_schema.table_privileges WHERE table_schema='public' AND grantee IN ('anon','authenticated') GROUP BY grantee;
-- Default privileges (so tables created by the migrations do not silently get anon/authenticated grants):
SELECT defaclrole::regrole AS owner_role, defaclobjtype, defaclacl FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace;

-- P8. Policies that could let a non-staff user write directly (review each; expect none).
SELECT tablename, policyname, cmd, roles FROM pg_policies
 WHERE schemaname='public' AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
   AND tablename IN ('users','students','student_documents','profiles','hs_credit_awards','hs_official_results','student_credit_decisions','student_credit_records')
 ORDER BY 1,2;

-- P9. Storage buckets (expect 3, all public = false) and the student-documents settings now.
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id;
SELECT policyname, cmd, roles FROM pg_policies WHERE schemaname='storage' AND tablename='objects';

-- P10. Free headroom sanity: database size.
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;
