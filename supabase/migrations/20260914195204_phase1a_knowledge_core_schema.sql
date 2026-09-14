/*
# Phase 1A: Lumière Knowledge Core — Canonical Knowledge Schema Foundation

## Purpose
Creates the database foundation for the canonical Lumière Knowledge Core.
This is ADDITIVE only — no existing tables are modified, renamed, or deleted.

## Conceptual Model
EVIDENCE → CLAIM → VERIFICATION → CANONICAL KNOWLEDGE

Raw evidence remains separate from interpreted claims and canonical academic rules.

## New Tables (24 total)

### 1. Institutions
- `knowledge_institutions` — Institution identity (slug, name, active, metadata)
- `knowledge_institution_versions` — Historical institution versions with effective dates

### 2. Programs
- `knowledge_programs_v2` — Programs belonging to institutions (code, name, degree_level)
- `knowledge_program_versions` — Program catalog versions with credit requirements

### 3. Requirements
- `knowledge_requirement_groups` — Hierarchical requirement groups within program versions
- `knowledge_requirements_v2` — Individual requirements within groups

### 4. Institution Courses
- `knowledge_institution_courses` — Course catalog at an institution
- `knowledge_institution_course_versions` — Versioned course details (credits, level, dates)

### 5. Credit Providers
- `knowledge_credit_providers` — External credit providers (slug, name, type)
- `knowledge_provider_courses` — Courses offered by providers
- `knowledge_provider_course_versions` — Versioned provider course details

### 6. Evidence
- `knowledge_evidence_sources` — Raw evidence sources with authority levels
- `knowledge_evidence_excerpts` — Text excerpts from evidence sources

### 7. Claims
- `knowledge_claims` — Top-level knowledge claims with status
- `knowledge_claim_versions` — Versioned claim statements with confidence
- `knowledge_claim_evidence` — Links between claim versions and evidence excerpts

### 8. Verification
- `knowledge_verification_events` — Append-only verification actions on claim versions

### 9. Conflicts
- `knowledge_conflicts` — Tracks conflicts between claim versions

### 10. Canonical Academic Rules
- `knowledge_academic_rules` — Canonical academic rules linked to claims
- `knowledge_transfer_rules` — Typed transfer rule details
- `knowledge_residency_rules` — Typed residency rule details
- `knowledge_upper_level_rules` — Typed upper-level rule details

### 11. Equivalencies
- `knowledge_equivalencies_v2` — Provider-to-institution course equivalencies

### 12. Articulations
- `knowledge_articulations_v2` — Program-level articulation mappings

## Enums (14 total)
- knowledge_status, version_status, claim_status
- source_type, authority_level, claim_type, subject_type
- verification_action, conflict_status, conflict_type
- rule_kind, institution_version_status, program_version_status
- evidence_relationship_type

## Constraints
- Unique: institution slugs, provider slugs, program+code within institution,
  course+code within institution/provider, claim_id+version_number
- CHECK: confidence 0–100 on claim_versions, equivalencies_v2
- CHECK: effective_to >= effective_from where practical
- Composite PK on claim_evidence (claim_version_id, evidence_excerpt_id)

## Seed Data
- Three stable institution identities: TESU, UMPI, Excelsior

## Security
- RLS enabled on all tables
- Admin/staff-only access (knowledge management is internal to Lumière)
*/

-- ── ENUMS ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE knowledge_status AS ENUM ('working','open','confirmed','conflict','incorrect','superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE version_status AS ENUM ('working','open','confirmed','conflict','incorrect','superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE claim_status AS ENUM ('working','open','confirmed','conflict','incorrect','superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE source_type AS ENUM (
    'official_web','official_catalog','official_pdf','advisor_email',
    'advisor_statement','institutional_document','provider_document',
    'internal_research','third_party','community','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE authority_level AS ENUM (
    'primary','official_advisor','institutional','provider','third_party','community','unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE claim_type AS ENUM (
    'equivalency','requirement','rule','course_attribute','program_attribute','institution_attribute','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE subject_type AS ENUM (
    'institution','program','program_version','requirement',
    'institution_course','provider_course','provider','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE verification_action AS ENUM (
    'submitted','verified','rejected','needs_review','superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE conflict_status AS ENUM ('open','resolved','ignored');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE conflict_type AS ENUM (
    'contradiction','temporal','source_conflict','interpretation','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE rule_kind AS ENUM (
    'general','transfer','residency','upper_level','admission','graduation','course','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE institution_version_status AS ENUM ('active','retired','draft');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE program_version_status AS ENUM ('active','retired','draft');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE evidence_relationship_type AS ENUM (
    'supports','contradicts','contextual','source_for'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 1. INSTITUTIONS ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_institution_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES knowledge_institutions(id) ON DELETE CASCADE,
  version_label text NOT NULL,
  effective_from timestamptz,
  effective_to timestamptz,
  status institution_version_status NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inst_ver_eff_chk CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS knowledge_inst_versions_inst_idx ON knowledge_institution_versions(institution_id);

-- ── 2. PROGRAMS ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_programs_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES knowledge_institutions(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  degree_level text,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_programs_v2_inst_code_unique UNIQUE (institution_id, code)
);

CREATE INDEX IF NOT EXISTS knowledge_programs_v2_inst_idx ON knowledge_programs_v2(institution_id);

CREATE TABLE IF NOT EXISTS knowledge_program_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES knowledge_programs_v2(id) ON DELETE CASCADE,
  version_label text NOT NULL,
  catalog_year integer,
  effective_from timestamptz,
  effective_to timestamptz,
  status program_version_status NOT NULL DEFAULT 'active',
  total_credits_required integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prog_ver_eff_chk CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS knowledge_prog_versions_prog_idx ON knowledge_program_versions(program_id);

-- ── 3. REQUIREMENTS ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_requirement_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_version_id uuid NOT NULL REFERENCES knowledge_program_versions(id) ON DELETE CASCADE,
  parent_group_id uuid REFERENCES knowledge_requirement_groups(id) ON DELETE SET NULL,
  code text NOT NULL,
  title text NOT NULL,
  sequence integer NOT NULL DEFAULT 0,
  min_credits integer,
  max_credits integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_req_groups_pv_idx ON knowledge_requirement_groups(program_version_id);
CREATE INDEX IF NOT EXISTS knowledge_req_groups_parent_idx ON knowledge_requirement_groups(parent_group_id);

CREATE TABLE IF NOT EXISTS knowledge_requirements_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_version_id uuid NOT NULL REFERENCES knowledge_program_versions(id) ON DELETE CASCADE,
  requirement_group_id uuid REFERENCES knowledge_requirement_groups(id) ON DELETE SET NULL,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  credits_required integer,
  level_requirement text,
  sequence integer NOT NULL DEFAULT 0,
  rule_expression jsonb,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_req_v2_pv_idx ON knowledge_requirements_v2(program_version_id);
CREATE INDEX IF NOT EXISTS knowledge_req_v2_group_idx ON knowledge_requirements_v2(requirement_group_id);

-- ── 4. INSTITUTION COURSES ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_institution_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES knowledge_institutions(id) ON DELETE CASCADE,
  course_code text NOT NULL,
  title text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_inst_courses_inst_code_unique UNIQUE (institution_id, course_code)
);

CREATE INDEX IF NOT EXISTS knowledge_inst_courses_inst_idx ON knowledge_institution_courses(institution_id);

CREATE TABLE IF NOT EXISTS knowledge_institution_course_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_course_id uuid NOT NULL REFERENCES knowledge_institution_courses(id) ON DELETE CASCADE,
  version_label text NOT NULL,
  credits integer NOT NULL,
  level text,
  effective_from timestamptz,
  effective_to timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inst_course_ver_eff_chk CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS knowledge_inst_course_ver_course_idx ON knowledge_institution_course_versions(institution_course_id);

-- ── 5. CREDIT PROVIDERS ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_credit_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  provider_type text,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_provider_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES knowledge_credit_providers(id) ON DELETE CASCADE,
  course_code text NOT NULL,
  title text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_provider_courses_prov_code_unique UNIQUE (provider_id, course_code)
);

CREATE INDEX IF NOT EXISTS knowledge_provider_courses_prov_idx ON knowledge_provider_courses(provider_id);

CREATE TABLE IF NOT EXISTS knowledge_provider_course_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_course_id uuid NOT NULL REFERENCES knowledge_provider_courses(id) ON DELETE CASCADE,
  version_label text NOT NULL,
  credits integer NOT NULL,
  credit_type text,
  level text,
  effective_from timestamptz,
  effective_to timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prov_course_ver_eff_chk CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS knowledge_provider_course_ver_course_idx ON knowledge_provider_course_versions(provider_course_id);

-- ── 6. EVIDENCE ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_evidence_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type source_type NOT NULL,
  institution_id uuid REFERENCES knowledge_institutions(id) ON DELETE SET NULL,
  provider_id uuid REFERENCES knowledge_credit_providers(id) ON DELETE SET NULL,
  title text NOT NULL,
  source_url text,
  external_file_id text,
  content_hash text,
  authority_level authority_level NOT NULL DEFAULT 'unknown',
  published_at timestamptz,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  effective_from timestamptz,
  effective_to timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  CONSTRAINT evidence_src_eff_chk CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS knowledge_evidence_sources_type_idx ON knowledge_evidence_sources(source_type);
CREATE INDEX IF NOT EXISTS knowledge_evidence_sources_inst_idx ON knowledge_evidence_sources(institution_id);
CREATE INDEX IF NOT EXISTS knowledge_evidence_sources_prov_idx ON knowledge_evidence_sources(provider_id);

CREATE TABLE IF NOT EXISTS knowledge_evidence_excerpts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_source_id uuid NOT NULL REFERENCES knowledge_evidence_sources(id) ON DELETE CASCADE,
  excerpt_text text NOT NULL,
  locator text,
  page_number integer,
  section text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_evidence_excerpts_source_idx ON knowledge_evidence_excerpts(evidence_source_id);

-- ── 7. CLAIMS ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_key text NOT NULL UNIQUE,
  claim_type claim_type NOT NULL,
  subject_type subject_type NOT NULL,
  subject_id text,
  current_version_id text,
  status claim_status NOT NULL DEFAULT 'working',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

CREATE INDEX IF NOT EXISTS knowledge_claims_subject_idx ON knowledge_claims(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS knowledge_claims_status_idx ON knowledge_claims(status);

CREATE TABLE IF NOT EXISTS knowledge_claim_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES knowledge_claims(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  statement text NOT NULL,
  normalized_value jsonb,
  confidence integer NOT NULL DEFAULT 50,
  effective_from timestamptz,
  effective_to timestamptz,
  catalog_applicability text,
  cohort_applicability text,
  status version_status NOT NULL DEFAULT 'working',
  supersedes_version_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  CONSTRAINT claim_versions_confidence_chk CHECK (confidence >= 0 AND confidence <= 100),
  CONSTRAINT claim_versions_eff_chk CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  CONSTRAINT claim_versions_unique UNIQUE (claim_id, version_number)
);

CREATE INDEX IF NOT EXISTS knowledge_claim_versions_claim_idx ON knowledge_claim_versions(claim_id);
CREATE INDEX IF NOT EXISTS knowledge_claim_versions_status_idx ON knowledge_claim_versions(status);

CREATE TABLE IF NOT EXISTS knowledge_claim_evidence (
  claim_version_id uuid NOT NULL REFERENCES knowledge_claim_versions(id) ON DELETE CASCADE,
  evidence_excerpt_id uuid NOT NULL REFERENCES knowledge_evidence_excerpts(id) ON DELETE CASCADE,
  relationship_type evidence_relationship_type NOT NULL DEFAULT 'supports',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (claim_version_id, evidence_excerpt_id)
);

CREATE INDEX IF NOT EXISTS knowledge_claim_evidence_excerpt_idx ON knowledge_claim_evidence(evidence_excerpt_id);

-- ── 8. VERIFICATION ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_version_id uuid NOT NULL REFERENCES knowledge_claim_versions(id) ON DELETE CASCADE,
  action verification_action NOT NULL,
  reviewer_id text,
  rationale text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_verif_events_cv_idx ON knowledge_verification_events(claim_version_id);
CREATE INDEX IF NOT EXISTS knowledge_verif_events_action_idx ON knowledge_verification_events(action);

-- ── 9. CONFLICTS ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_version_a_id uuid NOT NULL REFERENCES knowledge_claim_versions(id) ON DELETE CASCADE,
  claim_version_b_id uuid REFERENCES knowledge_claim_versions(id) ON DELETE SET NULL,
  conflict_type conflict_type NOT NULL,
  description text NOT NULL,
  status conflict_status NOT NULL DEFAULT 'open',
  resolution_notes text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_conflicts_a_idx ON knowledge_conflicts(claim_version_a_id);
CREATE INDEX IF NOT EXISTS knowledge_conflicts_b_idx ON knowledge_conflicts(claim_version_b_id);
CREATE INDEX IF NOT EXISTS knowledge_conflicts_status_idx ON knowledge_conflicts(status);

-- ── 10. CANONICAL ACADEMIC RULES ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_academic_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES knowledge_institutions(id) ON DELETE CASCADE,
  program_version_id uuid REFERENCES knowledge_program_versions(id) ON DELETE SET NULL,
  rule_key text NOT NULL,
  rule_kind rule_kind NOT NULL,
  title text NOT NULL,
  rule_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  claim_version_id text,
  effective_from timestamptz,
  effective_to timestamptz,
  status knowledge_status NOT NULL DEFAULT 'working',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acad_rules_eff_chk CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS knowledge_academic_rules_inst_idx ON knowledge_academic_rules(institution_id);
CREATE INDEX IF NOT EXISTS knowledge_academic_rules_pv_idx ON knowledge_academic_rules(program_version_id);
CREATE INDEX IF NOT EXISTS knowledge_academic_rules_kind_idx ON knowledge_academic_rules(rule_kind);
CREATE INDEX IF NOT EXISTS knowledge_academic_rules_status_idx ON knowledge_academic_rules(status);

CREATE TABLE IF NOT EXISTS knowledge_transfer_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_rule_id uuid NOT NULL REFERENCES knowledge_academic_rules(id) ON DELETE CASCADE,
  max_transfer_credits integer,
  max_lower_level_transfer integer,
  max_upper_level_transfer integer,
  provider_restrictions jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS knowledge_transfer_rules_rule_idx ON knowledge_transfer_rules(academic_rule_id);

CREATE TABLE IF NOT EXISTS knowledge_residency_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_rule_id uuid NOT NULL REFERENCES knowledge_academic_rules(id) ON DELETE CASCADE,
  min_residency_credits integer,
  residency_type text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS knowledge_residency_rules_rule_idx ON knowledge_residency_rules(academic_rule_id);

CREATE TABLE IF NOT EXISTS knowledge_upper_level_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_rule_id uuid NOT NULL REFERENCES knowledge_academic_rules(id) ON DELETE CASCADE,
  min_upper_level_credits integer,
  level_threshold text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS knowledge_upper_level_rules_rule_idx ON knowledge_upper_level_rules(academic_rule_id);

-- ── 11. EQUIVALENCIES ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_equivalencies_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_provider_course_version_id uuid NOT NULL REFERENCES knowledge_provider_course_versions(id) ON DELETE CASCADE,
  target_institution_course_version_id uuid REFERENCES knowledge_institution_course_versions(id) ON DELETE SET NULL,
  institution_id uuid NOT NULL REFERENCES knowledge_institutions(id) ON DELETE CASCADE,
  effective_from timestamptz,
  effective_to timestamptz,
  status knowledge_status NOT NULL DEFAULT 'working',
  confidence integer NOT NULL DEFAULT 50,
  claim_version_id text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equiv_v2_confidence_chk CHECK (confidence >= 0 AND confidence <= 100),
  CONSTRAINT equiv_v2_eff_chk CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS knowledge_equiv_v2_source_idx ON knowledge_equivalencies_v2(source_provider_course_version_id);
CREATE INDEX IF NOT EXISTS knowledge_equiv_v2_target_idx ON knowledge_equivalencies_v2(target_institution_course_version_id);
CREATE INDEX IF NOT EXISTS knowledge_equiv_v2_inst_idx ON knowledge_equivalencies_v2(institution_id);
CREATE INDEX IF NOT EXISTS knowledge_equiv_v2_status_idx ON knowledge_equivalencies_v2(status);

-- ── 12. ARTICULATIONS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_articulations_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_version_id uuid NOT NULL REFERENCES knowledge_program_versions(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES knowledge_requirements_v2(id) ON DELETE CASCADE,
  institution_course_version_id uuid REFERENCES knowledge_institution_course_versions(id) ON DELETE SET NULL,
  equivalency_id uuid REFERENCES knowledge_equivalencies_v2(id) ON DELETE SET NULL,
  credits_applied integer,
  priority integer NOT NULL DEFAULT 0,
  effective_from timestamptz,
  effective_to timestamptz,
  status knowledge_status NOT NULL DEFAULT 'working',
  claim_version_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artic_v2_eff_chk CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS knowledge_artic_v2_pv_idx ON knowledge_articulations_v2(program_version_id);
CREATE INDEX IF NOT EXISTS knowledge_artic_v2_req_idx ON knowledge_articulations_v2(requirement_id);
CREATE INDEX IF NOT EXISTS knowledge_artic_v2_course_idx ON knowledge_articulations_v2(institution_course_version_id);
CREATE INDEX IF NOT EXISTS knowledge_artic_v2_equiv_idx ON knowledge_articulations_v2(equivalency_id);
CREATE INDEX IF NOT EXISTS knowledge_artic_v2_status_idx ON knowledge_articulations_v2(status);

-- ── RLS: Enable on all tables ────────────────────────────────────────────────

ALTER TABLE knowledge_institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_institution_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_programs_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_program_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_requirement_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_requirements_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_institution_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_institution_course_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_credit_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_provider_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_provider_course_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_evidence_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_evidence_excerpts ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_claim_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_claim_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_verification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_academic_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_transfer_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_residency_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_upper_level_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_equivalencies_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_articulations_v2 ENABLE ROW LEVEL SECURITY;

-- RLS Policies: admin/staff-only access for knowledge management
-- These are internal Lumière tables, not student-facing.

-- Helper: check if user is admin or staff
CREATE OR REPLACE FUNCTION knowledge_is_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE auth.users.id = auth.uid()
    AND auth.users.raw_app_meta_data->>'role' IN ('admin', 'staff')
  );
$$;

-- Apply uniform CRUD policies to all knowledge tables
-- Using a DO block to generate policies programmatically
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
    EXECUTE format('CREATE POLICY "staff_read_knowledge" ON %I FOR SELECT TO authenticated USING (knowledge_is_staff())', tbl);

    EXECUTE format('DROP POLICY IF EXISTS "staff_insert_knowledge" ON %I', tbl);
    EXECUTE format('CREATE POLICY "staff_insert_knowledge" ON %I FOR INSERT TO %I WITH CHECK (knowledge_is_staff())', tbl, 'authenticated');

    EXECUTE format('DROP POLICY IF EXISTS "staff_update_knowledge" ON %I', tbl);
    EXECUTE format('CREATE POLICY "staff_update_knowledge" ON %I FOR UPDATE TO %I USING (knowledge_is_staff()) WITH CHECK (knowledge_is_staff())', tbl, 'authenticated');

    EXECUTE format('DROP POLICY IF EXISTS "staff_delete_knowledge" ON %I', tbl);
    EXECUTE format('CREATE POLICY "staff_delete_knowledge" ON %I FOR DELETE TO %I USING (knowledge_is_staff())', tbl, 'authenticated');
  END LOOP;
END $$;

-- ── SEED DATA: Stable institution identities ──────────────────────────────────

INSERT INTO knowledge_institutions (slug, name, active, metadata)
VALUES
  ('tesu', 'Thomas Edison State University', true, '{"website": "https://www.tesu.edu", "country": "US"}'::jsonb),
  ('umpi', 'University of Maine at Presque Isle', true, '{"website": "https://www.umpi.edu", "country": "US"}'::jsonb),
  ('excelsior', 'Excelsior University', true, '{"website": "https://www.excelsior.edu", "country": "US"}'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- ── Updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION knowledge_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl text;
  trigger_name text;
  tables_with_updated_at text[] := ARRAY[
    'knowledge_institutions', 'knowledge_programs_v2',
    'knowledge_requirements_v2', 'knowledge_institution_courses',
    'knowledge_credit_providers', 'knowledge_provider_courses',
    'knowledge_academic_rules', 'knowledge_equivalencies_v2', 'knowledge_articulations_v2'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_with_updated_at LOOP
    trigger_name := 'update_' || tbl || '_updated_at';
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trigger_name, tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION knowledge_update_updated_at()', trigger_name, tbl);
  END LOOP;
END $$;
