-- ============================================================================
-- S14 PREFLIGHT (READ-ONLY): account lock-out, legacy attachment and bucket checks.
-- Paste into the Supabase SQL editor of the PRODUCTION project before deploying.
-- One SELECT, no writes. Returns counts only (no names, emails or ids).
--
-- Why: the S13 build (since S03, server/lib/account-status.ts) refuses to
-- authenticate any user whose public.profiles row is missing or not 'active'.
-- The current Replit build (b9079a5 baseline) does not check this, so an existing
-- admin/staff account without an active profile works today and is LOCKED OUT
-- after the deploy. Every admin/staff row below must show without_active_profile = 0
-- (or the owner accepts it), otherwise nobody can create the first student.
-- ============================================================================
WITH
prof AS (
  SELECT to_regclass('public.profiles') IS NOT NULL AS present
),
users_by_role AS (
  SELECT u.role::text AS role,
         count(*) AS total,
         count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM public.profiles p
           WHERE p.user_id::text = u.id::text AND p.status::text = 'active')) AS without_active_profile
  FROM public.users u
  GROUP BY u.role
),
att AS (
  SELECT to_regclass('public.ticket_attachments') IS NOT NULL AS present
),
buckets AS (
  SELECT string_agg(id || '=' || CASE WHEN public THEN 'PUBLIC' ELSE 'private' END, ', ' ORDER BY id) AS v
  FROM storage.buckets WHERE id IN ('documents', 'student-documents', 'knowledge-evidence')
)
SELECT 'A_profiles_table' AS section, 'public.profiles exists' AS check_name,
       (SELECT present::text FROM prof) AS value, (SELECT present FROM prof) AS pass
UNION ALL
SELECT 'B_lockout', 'role=' || role || ' total=' || total,
       'without_active_profile=' || without_active_profile,
       (role NOT IN ('admin', 'staff') OR without_active_profile = 0)
FROM users_by_role
UNION ALL
SELECT 'C_admin_count', 'admins with an active profile',
       (SELECT count(*)::text FROM public.users u WHERE u.role::text = 'admin' AND EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.user_id::text = u.id::text AND p.status::text = 'active')),
       (SELECT count(*) > 0 FROM public.users u WHERE u.role::text = 'admin' AND EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.user_id::text = u.id::text AND p.status::text = 'active'))
UNION ALL
SELECT 'D_legacy_attachments', 'public.ticket_attachments exists',
       (SELECT present::text FROM att), true
UNION ALL
SELECT 'E_buckets', 'bucket visibility (all must be private)',
       coalesce((SELECT v FROM buckets), 'none of the three buckets exist'),
       NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('documents', 'student-documents', 'knowledge-evidence') AND public)
ORDER BY 1, 2;

-- If D_legacy_attachments is true, ALSO run this second query (separately). Any row
-- returned is a path that escapes its own ticket folder = possible misuse of the
-- legacy route. Do NOT open the files; treat as a possible incident and review
-- Supabase storage access logs for those paths.
--
-- select count(*) as escaping_paths
-- from public.ticket_attachments
-- where storage_path not like 'tickets/' || ticket_id::text || '/%'
--    or storage_path like '%..%';
