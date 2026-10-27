-- ============================================================================
-- S22 HOSTED VERIFY (READ-ONLY). One SELECT, no DDL/DML. Output: check | pass | detail.
-- Run through scripts/s22/hosted-verify.ts (BEGIN TRANSACTION READ ONLY ... ROLLBACK) or paste into the
-- Supabase SQL editor of the STAGING project. It complements, and does not duplicate, scripts/release/s14/
-- 00-baseline-probe.sql (migration signatures), 01-account-readiness.sql and 90-verify.sql (G1-G5 RLS/anon/
-- search_path gates, V1-V12), which the TS runner executes too.
-- Every row must show pass = true.
-- ============================================================================
WITH
req_tables(t) AS (VALUES
  ('students'), ('users'), ('profiles'), ('account_invitations'), ('student_documents'),
  ('support_tickets'), ('ticket_comments'), ('ticket_attachments'),
  ('hs_curriculum_templates'), ('hs_enrollments'), ('hs_prior_education'), ('hs_transfer_claims'),
  ('hs_roadmap_versions'), ('hs_task_progress'), ('hs_task_progress_events'), ('hs_official_results'),
  ('hs_credit_awards'), ('hs_graduation_records'), ('hs_events'),
  ('student_billing_obligations'), ('student_billing_discounts'), ('student_billing_installments'),
  ('student_billing_evidence'), ('student_billing_receipts'),
  ('assistant_conversations'), ('assistant_messages'), ('assistant_message_attachments'),
  ('assistant_audit_events'), ('assistant_integrity_checkpoints'), ('assistant_usage_monthly'),
  ('student_assistant_memory'), ('assistant_memory_sources'), ('student_welcome_state'),
  ('student_storage_quota'), ('student_document_text')
),
-- (table, constraint name, kind): kind p = primary key, u = unique
req_constraints(tbl, cname, kind) AS (VALUES
  ('students', 'students_pkey', 'p'), ('students', 'students_student_code_key', 'u'), ('students', 'students_email_key', 'u'),
  ('users', 'users_pkey', 'p'), ('users', 'users_email_key', 'u'),
  ('profiles', 'profiles_pkey', 'p'),
  ('account_invitations', 'account_invitations_pkey', 'p'), ('account_invitations', 'account_invitations_token_hash_key', 'u'),
  ('student_documents', 'student_documents_pkey', 'p'),
  ('support_tickets', 'support_tickets_pkey', 'p'), ('support_tickets', 'support_tickets_ticket_number_key', 'u'),
  ('ticket_comments', 'ticket_comments_pkey', 'p'), ('ticket_attachments', 'ticket_attachments_pkey', 'p'),
  ('student_billing_obligations', 'student_billing_obligations_pkey', 'p'),
  ('student_billing_obligations', 'student_billing_obligations_student_id_key', 'u'),
  ('student_billing_evidence', 'student_billing_evidence_pkey', 'p'),
  ('assistant_conversations', 'assistant_conversations_pkey', 'p'),
  ('assistant_messages', 'assistant_messages_pkey', 'p'),
  ('assistant_messages', 'assistant_messages_conv_seq_uniq', 'u'),
  ('assistant_messages', 'assistant_messages_reply_uniq', 'u'),
  ('student_assistant_memory', 'student_assistant_memory_pkey', 'p'),
  ('assistant_memory_sources', 'assistant_memory_sources_pkey', 'p'),
  ('student_welcome_state', 'student_welcome_state_pkey', 'p'),
  ('student_storage_quota', 'student_storage_quota_pkey', 'p')
),
pub AS (
  SELECT c.oid, c.relname, c.relrowsecurity AS rls
  FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
),
pol AS (
  SELECT tablename, count(*) AS n, string_agg(policyname || ' [' || cmd || ']', '; ' ORDER BY policyname) AS names
  FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename
),
-- bucket requirements for student-documents (S21 raises the limit and adds the chat attachment types)
sd_mimes(m) AS (VALUES
  ('application/pdf'), ('image/png'), ('image/jpeg'), ('image/webp'),
  ('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  ('text/csv'), ('text/plain')
),
-- (table, trigger name, required tgtype mask, label)  tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update, 32 truncate
req_triggers(tbl, tg, mask, label) AS (VALUES
  ('assistant_messages', 'assistant_messages_guard_trg', 31, 'BEFORE ROW insert+update+delete (append-only, hash chain)'),
  ('assistant_messages', 'assistant_messages_truncate_trg', 34, 'BEFORE TRUNCATE'),
  ('assistant_conversations', 'assistant_conversations_guard_trg', 27, 'BEFORE ROW update+delete'),
  ('assistant_message_attachments', 'assistant_attachments_guard_trg', 27, 'BEFORE ROW update+delete'),
  ('assistant_audit_events', 'assistant_audit_guard_trg', 27, 'BEFORE ROW update+delete'),
  ('assistant_audit_events', 'assistant_audit_truncate_trg', 34, 'BEFORE TRUNCATE'),
  ('assistant_integrity_checkpoints', 'assistant_checkpoints_guard_trg', 27, 'BEFORE ROW update+delete')
),
fn(name, sig) AS (VALUES
  ('current_user_is_active', 'public.current_user_is_active()'),
  ('current_user_role', 'public.current_user_role()'),
  ('is_staff_or_admin', 'public.is_staff_or_admin()'),
  ('student_owns_record', 'public.student_owns_record(text)')
),
checks(ord, grp, check_name, pass, detail) AS (
  -- 1 connectivity (the project ref is reported by the TS runner from the guard, never read from the DB)
  SELECT 100, 'connectivity', 'server version >= 15', current_setting('server_version_num')::int >= 150000, version()
  UNION ALL SELECT 101, 'connectivity', 'current_database', current_database() IS NOT NULL, current_database()
  UNION ALL SELECT 102, 'connectivity', 'session is read-only', current_setting('transaction_read_only') = 'on', 'transaction_read_only=' || current_setting('transaction_read_only')
  UNION ALL SELECT 103, 'connectivity', 'current_user', true, current_user::text

  -- 2 required tables
  UNION ALL
  SELECT 200 + row_number() OVER (ORDER BY t), 'tables', 'table ' || t, to_regclass('public.' || t) IS NOT NULL,
         CASE WHEN to_regclass('public.' || t) IS NOT NULL THEN 'present' ELSE 'MISSING' END
  FROM req_tables

  -- 3 key constraints
  UNION ALL
  SELECT 300 + row_number() OVER (ORDER BY tbl, cname), 'constraints', tbl || '.' || cname || ' (' || CASE kind WHEN 'p' THEN 'primary key' ELSE 'unique' END || ')',
         EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = rc.cname AND c.contype::text = rc.kind AND c.conrelid = to_regclass('public.' || rc.tbl)),
         ''
  FROM req_constraints rc

  -- 4 RLS per required table + policies; policy-less tables must be unreachable for the API roles
  UNION ALL
  SELECT 400 + row_number() OVER (ORDER BY t), 'rls', 'rls ' || t,
         coalesce(p.rls, false)
         AND (coalesce(pl.n, 0) > 0
              OR NOT (has_table_privilege('authenticated', p.oid, 'SELECT,INSERT,UPDATE,DELETE')
                      OR has_table_privilege('anon', p.oid, 'SELECT,INSERT,UPDATE,DELETE'))),
         CASE WHEN p.oid IS NULL THEN 'table missing'
              ELSE 'rls=' || p.rls::text || '; ' || coalesce(pl.n, 0)::text || ' policies' ||
                   CASE WHEN pl.names IS NULL THEN ' (deny-all for API roles)' ELSE ': ' || pl.names END END
  FROM req_tables r LEFT JOIN pub p ON p.relname = r.t LEFT JOIN pol pl ON pl.tablename = r.t
  UNION ALL
  SELECT 480, 'rls', 'rls enabled on EVERY public table', NOT EXISTS (SELECT 1 FROM pub WHERE NOT rls),
         coalesce((SELECT string_agg(relname, ', ' ORDER BY relname) FROM pub WHERE NOT rls), 'none missing') || ' (' || (SELECT count(*) FROM pub)::text || ' public tables)'

  -- 5 account-gate helper functions
  UNION ALL
  SELECT 500 + row_number() OVER (ORDER BY name), 'account-gate', 'function ' || name || ' exists, SECURITY DEFINER, search_path pinned',
         to_regprocedure(sig) IS NOT NULL
         AND coalesce((SELECT p.prosecdef AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
                       FROM pg_proc p WHERE p.oid = to_regprocedure(sig)), false),
         sig
  FROM fn
  UNION ALL
  SELECT 510, 'account-gate', 'is_staff_or_admin() applies the active-account check',
         coalesce(pg_get_functiondef(to_regprocedure('public.is_staff_or_admin()')) ILIKE '%current_user_is_active%', false),
         'if false, a later migration (S18) overwrote the helper: re-apply scripts/release/s14/30-account-gate.sql'
  UNION ALL
  SELECT 511, 'account-gate', 'student_owns_record(text) applies the active-account check',
         coalesce(pg_get_functiondef(to_regprocedure('public.student_owns_record(text)')) ILIKE '%current_user_is_active%', false), ''
  UNION ALL
  SELECT 512, 'account-gate', 'current_user_role() applies the active-account check',
         coalesce(pg_get_functiondef(to_regprocedure('public.current_user_role()')) ILIKE '%current_user_is_active%', false), ''
  UNION ALL
  SELECT 513, 'account-gate', 'current_user_is_active() reads profiles.status = active',
         coalesce(pg_get_functiondef(to_regprocedure('public.current_user_is_active()')) ILIKE '%profiles%status%active%', false), ''
  UNION ALL
  SELECT 514, 'account-gate', 'gate helpers not executable by anon',
         NOT EXISTS (SELECT 1 FROM fn WHERE to_regprocedure(sig) IS NOT NULL AND has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE')),
         coalesce((SELECT string_agg(name, ', ') FROM fn WHERE to_regprocedure(sig) IS NOT NULL AND has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE')), 'clean')

  -- 6 storage buckets: private, limits, mime types
  UNION ALL
  SELECT 600 + row_number() OVER (ORDER BY b.id), 'storage', 'bucket ' || b.id || ' exists and is private (public=false)',
         b.public = false,
         'public=' || b.public::text || '; file_size_limit=' || coalesce(b.file_size_limit::text, 'null') || '; allowed_mime_types=' || coalesce(array_to_string(b.allowed_mime_types, ','), 'any')
  FROM storage.buckets b WHERE b.id IN ('student-documents', 'documents', 'knowledge-evidence')
  UNION ALL
  SELECT 610 + row_number() OVER (ORDER BY id), 'storage', 'bucket ' || id || ' present',
         EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = v.id), ''
  FROM (VALUES ('student-documents'), ('documents'), ('knowledge-evidence')) v(id)
  UNION ALL
  SELECT 620, 'storage', 'student-documents file_size_limit = 20 MB (20971520)',
         coalesce((SELECT file_size_limit = 20971520 FROM storage.buckets WHERE id = 'student-documents'), false),
         coalesce((SELECT file_size_limit::text FROM storage.buckets WHERE id = 'student-documents'), 'bucket missing')
  UNION ALL
  SELECT 621, 'storage', 'student-documents allows pdf, png, jpeg, webp, docx, xlsx, csv, txt',
         coalesce((SELECT NOT EXISTS (SELECT 1 FROM sd_mimes m WHERE m.m <> ALL (coalesce(b.allowed_mime_types, '{}')))
                   FROM storage.buckets b WHERE b.id = 'student-documents'), false),
         coalesce((SELECT string_agg(m.m, ', ') FROM sd_mimes m, storage.buckets b
                   WHERE b.id = 'student-documents' AND m.m <> ALL (coalesce(b.allowed_mime_types, '{}'))), 'all 8 present') || ' (missing listed)'

  -- 7 append-only / immutability triggers
  UNION ALL
  SELECT 700 + row_number() OVER (ORDER BY tbl, tg), 'append-only', tbl || ' trigger ' || tg || ' ' || label,
         EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = rt.tg AND t.tgrelid = to_regclass('public.' || rt.tbl)
                   AND NOT t.tgisinternal AND t.tgenabled = 'O' AND (t.tgtype & rt.mask) = rt.mask),
         ''
  FROM req_triggers rt
  UNION ALL
  SELECT 720, 'append-only', 'HS append-only/guard triggers (7) installed and enabled',
         (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgname IN
            ('hs_task_progress_events_append_only','hs_events_append_only','hs_curriculum_templates_immutable','hs_roadmap_versions_guard',
             'hs_official_results_guard','hs_credit_awards_guard','hs_task_progress_no_delete')) = 7, ''
  UNION ALL
  SELECT 721, 'append-only', 'API roles cannot write assistant_messages / audit / checkpoints directly',
         NOT EXISTS (SELECT 1 FROM unnest(ARRAY['assistant_messages','assistant_audit_events','assistant_integrity_checkpoints','assistant_message_attachments']) x
                     WHERE to_regclass('public.' || x) IS NOT NULL
                       AND (has_table_privilege('anon', 'public.' || x, 'INSERT,UPDATE,DELETE,TRUNCATE')
                            OR has_table_privilege('authenticated', 'public.' || x, 'INSERT,UPDATE,DELETE,TRUNCATE'))),
         coalesce((SELECT string_agg(x, ', ') FROM unnest(ARRAY['assistant_messages','assistant_audit_events','assistant_integrity_checkpoints','assistant_message_attachments']) x
                   WHERE to_regclass('public.' || x) IS NOT NULL
                     AND (has_table_privilege('anon', 'public.' || x, 'INSERT,UPDATE,DELETE,TRUNCATE')
                          OR has_table_privilege('authenticated', 'public.' || x, 'INSERT,UPDATE,DELETE,TRUNCATE'))), 'clean')

  -- 8 client privilege hardening (35-client-privilege-hardening.sql); table-level anon is also gate G2 of 90-verify
  UNION ALL
  SELECT 800, 'privileges', 'anon has no privilege on any public table or sequence',
         NOT EXISTS (SELECT 1 FROM pub p WHERE has_table_privilege('anon', p.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
         AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
                         AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE') END),
         coalesce((SELECT string_agg(relname, ', ') FROM pub p WHERE has_table_privilege('anon', p.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')), 'tables clean') ||
         '; sequences: ' || coalesce((SELECT string_agg(c.relname, ', ') FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
                         AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE') END), 'clean')
  UNION ALL
  SELECT 801, 'privileges', 'default privileges no longer grant anon/authenticated on new public tables',
         NOT EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a, pg_roles r
                     WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r' AND r.oid = d.defaclrole AND r.rolname = 'postgres'
                       AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated'))),
         'pg_default_acl for role postgres, tables'
  UNION ALL
  SELECT 802, 'privileges', 'profiles: authenticated cannot write status, INSERT or DELETE',
         to_regclass('public.profiles') IS NOT NULL
         AND NOT has_column_privilege('authenticated', 'public.profiles', 'status', 'UPDATE')
         AND NOT has_table_privilege('authenticated', 'public.profiles', 'INSERT,DELETE,TRUNCATE'),
         ''
  UNION ALL
  SELECT 803, 'privileges', 'profiles: authenticated may update only timezone and phone',
         to_regclass('public.profiles') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.profiles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                         AND a.attname NOT IN ('timezone', 'phone') AND has_column_privilege('authenticated', 'public.profiles', a.attname, 'UPDATE')),
         coalesce((SELECT string_agg(a.attname, ', ') FROM pg_attribute a WHERE a.attrelid = to_regclass('public.profiles') AND a.attnum > 0 AND NOT a.attisdropped
                   AND has_column_privilege('authenticated', 'public.profiles', a.attname, 'UPDATE')), 'none')
  UNION ALL
  SELECT 804, 'privileges', 'service-only functions (35) not executable by anon/authenticated',
         NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN
           ('generate_student_code','student_cp_cross_binding_guard','student_cp_guard_immutable_history','student_cp_guard_lifecycle',
            'student_cp_guard_terminal_updates','student_cp_validate_lifecycle_graph','update_pricing_rules_timestamp',
            'update_weekly_metrics_timestamp','validate_english_requirement')
           AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
         ''
)
SELECT grp || ' | ' || check_name AS "check", pass, detail FROM checks ORDER BY ord;
