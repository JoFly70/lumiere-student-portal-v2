-- Read-only configuration audit for the DISPOSABLE database (catalog queries
-- only; it does not exercise any access path). Usage:
--   psql "$DISPOSABLE_DB_URL" -X -A -f scripts/disposable-env/audit-config.sql
\pset footer off

\echo '== public tables: RLS state, policy count, client-role privileges'
SELECT c.relname AS tbl,
       c.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
       concat_ws(',',
         CASE WHEN has_table_privilege('anon', c.oid, 'SELECT') THEN 'S' END,
         CASE WHEN has_table_privilege('anon', c.oid, 'INSERT') THEN 'I' END,
         CASE WHEN has_table_privilege('anon', c.oid, 'UPDATE') THEN 'U' END,
         CASE WHEN has_table_privilege('anon', c.oid, 'DELETE') THEN 'D' END) AS anon_priv,
       concat_ws(',',
         CASE WHEN has_table_privilege('authenticated', c.oid, 'SELECT') THEN 'S' END,
         CASE WHEN has_table_privilege('authenticated', c.oid, 'INSERT') THEN 'I' END,
         CASE WHEN has_table_privilege('authenticated', c.oid, 'UPDATE') THEN 'U' END,
         CASE WHEN has_table_privilege('authenticated', c.oid, 'DELETE') THEN 'D' END) AS auth_priv
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
 ORDER BY c.relrowsecurity, c.relname;

\echo '== gate: tables with RLS disabled (expect 0 rows)'
SELECT relname FROM pg_class
 WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND NOT relrowsecurity;

\echo '== gate: any anon table privilege in public (expect 0 rows)'
SELECT c.relname FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
   AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE');

\echo '== gate: authenticated privileges on tables with zero policies (expect 0 rows)'
SELECT c.relname FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
   AND has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
   AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname);

\echo '== gate: policies granting the coach role blanket access (expect only ticket rows)'
SELECT tablename, policyname, cmd FROM pg_policies
 WHERE schemaname = 'public' AND (qual ILIKE '%coach%' OR with_check ILIKE '%coach%')
 ORDER BY 1, 2;

\echo '== profiles column-level UPDATE privilege for authenticated'
SELECT a.attname AS column,
       has_column_privilege('authenticated', 'public.profiles'::regclass, a.attname, 'UPDATE') AS can_update
  FROM pg_attribute a
 WHERE a.attrelid = 'public.profiles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
 ORDER BY a.attnum;

\echo '== functions executable by anon (expect 0 rows)'
SELECT p.proname FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND has_function_privilege('anon', p.oid, 'EXECUTE')
 ORDER BY 1;

\echo '== SECURITY DEFINER functions without a pinned search_path (expect 0 rows)'
SELECT p.proname FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg WHERE cfg LIKE 'search_path=%');

\echo '== storage buckets (expect all private) and storage.objects policies'
SELECT id, public FROM storage.buckets ORDER BY id;
SELECT policyname, cmd, roles FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';
