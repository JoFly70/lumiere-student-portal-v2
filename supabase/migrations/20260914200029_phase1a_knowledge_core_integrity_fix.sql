/*
# Phase 1A Correction: Knowledge Core Integrity Fix

## Purpose
Corrects issues found during independent review of the Phase 1A Knowledge Core migration.

## Changes

### 1. Provenance Foreign Keys (5 columns)
Converts plain text provenance columns to UUID with real foreign keys:
- `knowledge_claim_versions.supersedes_version_id` → `knowledge_claim_versions.id` (self-ref, ON DELETE SET NULL)
- `knowledge_claims.current_version_id` → `knowledge_claim_versions.id` (ON DELETE SET NULL, circular)
- `knowledge_academic_rules.claim_version_id` → `knowledge_claim_versions.id` (ON DELETE SET NULL)
- `knowledge_equivalencies_v2.claim_version_id` → `knowledge_claim_versions.id` (ON DELETE SET NULL)
- `knowledge_articulations_v2.claim_version_id` → `knowledge_claim_versions.id` (ON DELETE SET NULL)

All use ON DELETE SET NULL to preserve historical provenance.

### 2. RLS Role Source Correction
Replaces `knowledge_is_staff()` (which used `auth.users.raw_app_meta_data->>'role'`)
with two new helpers that derive authorization from the Lumière `public.users` table:
- `knowledge_is_admin()` — checks role='admin'
- `knowledge_is_staff_or_admin()` — checks role IN ('staff', 'admin')

### 3. Knowledge Mutation Policy
- READ: admin + staff (SELECT)
- DIRECT CLIENT MUTATION: admin only (INSERT, UPDATE, DELETE)
- Students and coaches: no access

### 4. Verification Events Append-Only
Removes UPDATE and DELETE policies from `knowledge_verification_events`.

### 5. ON DELETE Behavior
All provenance FKs use SET NULL. No destructive CASCADE changes needed.

## Safety
- All changes are additive ALTER statements on existing tables.
- No tables dropped or recreated. Seed data preserved.
*/

-- ── Step 1: Drop ALL existing RLS policies first (they depend on knowledge_is_staff) ──

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'knowledge_institutions', 'knowledge_institution_versions',
    'knowledge_programs_v2', 'knowledge_program_versions',
    'knowledge_requirement_groups', 'knowledge_requirements_v2',
    'knowledge_institution_courses', 'knowledge_institution_course_versions',
    'knowledge_credit_providers', 'knowledge_provider_courses', 'knowledge_provider_course_versions',
    'knowledge_evidence_sources', 'knowledge_evidence_excerpts',
    'knowledge_claims', 'knowledge_claim_versions', 'knowledge_claim_evidence',
    'knowledge_verification_events', 'knowledge_conflicts',
    'knowledge_academic_rules', 'knowledge_transfer_rules', 'knowledge_residency_rules', 'knowledge_upper_level_rules',
    'knowledge_equivalencies_v2', 'knowledge_articulations_v2'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "staff_read_knowledge" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "staff_insert_knowledge" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "staff_update_knowledge" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "staff_delete_knowledge" ON %I', tbl);
  END LOOP;
END $$;

-- ── Step 2: Drop old helper and create new ones ──────────────────────────────

DROP FUNCTION IF EXISTS knowledge_is_staff();

CREATE OR REPLACE FUNCTION knowledge_is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE public.users.id::text = auth.uid()::text
    AND public.users.role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION knowledge_is_staff_or_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE public.users.id::text = auth.uid()::text
    AND public.users.role IN ('staff', 'admin')
  );
$$;

-- ── Step 3: Provenance Foreign Keys ──────────────────────────────────────────

-- 3a. knowledge_claim_versions.supersedes_version_id: text → uuid with self-ref FK
ALTER TABLE knowledge_claim_versions
  ALTER COLUMN supersedes_version_id TYPE uuid
  USING NULLIF(supersedes_version_id, '')::uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claim_versions_supersedes_fk'
  ) THEN
    ALTER TABLE knowledge_claim_versions
      ADD CONSTRAINT claim_versions_supersedes_fk
      FOREIGN KEY (supersedes_version_id) REFERENCES knowledge_claim_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3b. knowledge_claims.current_version_id: text → uuid with FK (circular)
ALTER TABLE knowledge_claims
  ALTER COLUMN current_version_id TYPE uuid
  USING NULLIF(current_version_id, '')::uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claims_current_version_fk'
  ) THEN
    ALTER TABLE knowledge_claims
      ADD CONSTRAINT claims_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES knowledge_claim_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3c. knowledge_academic_rules.claim_version_id: text → uuid with FK
ALTER TABLE knowledge_academic_rules
  ALTER COLUMN claim_version_id TYPE uuid
  USING NULLIF(claim_version_id, '')::uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academic_rules_claim_version_fk'
  ) THEN
    ALTER TABLE knowledge_academic_rules
      ADD CONSTRAINT academic_rules_claim_version_fk
      FOREIGN KEY (claim_version_id) REFERENCES knowledge_claim_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3d. knowledge_equivalencies_v2.claim_version_id: text → uuid with FK
ALTER TABLE knowledge_equivalencies_v2
  ALTER COLUMN claim_version_id TYPE uuid
  USING NULLIF(claim_version_id, '')::uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'equiv_v2_claim_version_fk'
  ) THEN
    ALTER TABLE knowledge_equivalencies_v2
      ADD CONSTRAINT equiv_v2_claim_version_fk
      FOREIGN KEY (claim_version_id) REFERENCES knowledge_claim_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3e. knowledge_articulations_v2.claim_version_id: text → uuid with FK
ALTER TABLE knowledge_articulations_v2
  ALTER COLUMN claim_version_id TYPE uuid
  USING NULLIF(claim_version_id, '')::uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'artic_v2_claim_version_fk'
  ) THEN
    ALTER TABLE knowledge_articulations_v2
      ADD CONSTRAINT artic_v2_claim_version_fk
      FOREIGN KEY (claim_version_id) REFERENCES knowledge_claim_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ── Step 4: New RLS policies ────────────────────────────────────────────────
--
-- Policy matrix:
--   SELECT  → TO authenticated USING (knowledge_is_staff_or_admin())
--   INSERT  → TO authenticated WITH CHECK (knowledge_is_admin())
--   UPDATE  → TO authenticated USING (knowledge_is_admin()) WITH CHECK (knowledge_is_admin())
--   DELETE  → TO authenticated USING (knowledge_is_admin())
--
-- Exception: knowledge_verification_events is append-only (no UPDATE/DELETE)

DO $$
DECLARE
  tbl text;
  is_append_only boolean;
  tables text[] := ARRAY[
    'knowledge_institutions', 'knowledge_institution_versions',
    'knowledge_programs_v2', 'knowledge_program_versions',
    'knowledge_requirement_groups', 'knowledge_requirements_v2',
    'knowledge_institution_courses', 'knowledge_institution_course_versions',
    'knowledge_credit_providers', 'knowledge_provider_courses', 'knowledge_provider_course_versions',
    'knowledge_evidence_sources', 'knowledge_evidence_excerpts',
    'knowledge_claims', 'knowledge_claim_versions', 'knowledge_claim_evidence',
    'knowledge_verification_events', 'knowledge_conflicts',
    'knowledge_academic_rules', 'knowledge_transfer_rules', 'knowledge_residency_rules', 'knowledge_upper_level_rules',
    'knowledge_equivalencies_v2', 'knowledge_articulations_v2'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- SELECT: admin + staff
    EXECUTE format(
      'CREATE POLICY "knowledge_select" ON %I FOR SELECT TO authenticated USING (knowledge_is_staff_or_admin())',
      tbl
    );

    -- INSERT: admin only
    EXECUTE format(
      'CREATE POLICY "knowledge_insert" ON %I FOR INSERT TO authenticated WITH CHECK (knowledge_is_admin())',
      tbl
    );

    -- UPDATE + DELETE: admin only (except verification_events which is append-only)
    is_append_only := (tbl = 'knowledge_verification_events');

    IF NOT is_append_only THEN
      EXECUTE format(
        'CREATE POLICY "knowledge_update" ON %I FOR UPDATE TO authenticated USING (knowledge_is_admin()) WITH CHECK (knowledge_is_admin())',
        tbl
      );
      EXECUTE format(
        'CREATE POLICY "knowledge_delete" ON %I FOR DELETE TO authenticated USING (knowledge_is_admin())',
        tbl
      );
    END IF;
  END LOOP;
END $$;
