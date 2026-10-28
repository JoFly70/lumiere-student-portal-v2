-- S25 PRODUCTION, OPTIONAL hardening (not a repo migration; the repo uses no GraphQL and no client data API).
-- Idempotent. Run after the migrations, before the post-verify file.

-- A. pg_graphql: nothing in the repo calls GraphQL (git grep finds no usage). Remove the anon/authenticated entry
--    point instead of dropping the extension (reversible with GRANT EXECUTE).
DO $$
BEGIN
  IF to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION graphql_public.graphql(text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;
-- Stronger alternative (dashboard: Database > Extensions > pg_graphql off, or: DROP EXTENSION pg_graphql;).
-- Keep the REVOKE route unless the owner also wants the schema objects removed.

-- B. Server-only (policy-less) tables: no client privilege at all, and anon never holds table privileges.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND c.relrowsecurity
       AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t.relname);
  END LOOP;
END $$;
