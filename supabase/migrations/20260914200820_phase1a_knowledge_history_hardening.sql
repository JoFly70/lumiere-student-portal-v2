/*
# Phase 1A Final History Hardening

## Purpose
Protects Knowledge Core historical/provenance data from being silently destroyed
through DELETE and CASCADE behavior.

## Changes

### 1. Remove Direct DELETE Access
Drops the `knowledge_delete` RLS policy from ALL 24 Knowledge Core tables.
Authenticated clients — including admins — can no longer hard-delete Knowledge Core records.
Future retirement/removal will use statuses (INCORRECT, SUPERSEDED, RETIRED).

### 2. Protect Verification History
Changes `knowledge_verification_events.claim_version_id` FK from ON DELETE CASCADE
to ON DELETE RESTRICT. Deleting a claim version can no longer silently delete its
verification events.

### 3. Protect Claim Version History
Changes `knowledge_claim_versions.claim_id` FK from ON DELETE CASCADE
to ON DELETE RESTRICT. Deleting a claim can no longer cascade-delete its versions.

### 4. Protect Evidence History
- `knowledge_evidence_excerpts.evidence_source_id`: CASCADE → RESTRICT
- `knowledge_claim_evidence.claim_version_id`: CASCADE → RESTRICT
- `knowledge_claim_evidence.evidence_excerpt_id`: CASCADE → RESTRICT

### 5. Protect Canonical Provenance Links
- `knowledge_academic_rules.claim_version_id`: SET NULL → RESTRICT
- `knowledge_equivalencies_v2.claim_version_id`: SET NULL → RESTRICT
- `knowledge_articulations_v2.claim_version_id`: SET NULL → RESTRICT
- `knowledge_claim_versions.supersedes_version_id`: SET NULL → RESTRICT

### 6. Protect Conflict History
- `knowledge_conflicts.claim_version_a_id`: CASCADE → RESTRICT
- `knowledge_conflicts.claim_version_b_id`: SET NULL → RESTRICT

### 7. current_version_id Stays SET NULL
`knowledge_claims.current_version_id` remains ON DELETE SET NULL — it is a
convenience pointer, not historical provenance.

## Safety
- All changes are additive ALTER statements on existing constraints.
- No tables dropped or recreated. Seed data preserved.
- Previous migrations left untouched.
*/

-- ── 1. Remove all authenticated DELETE policies from Knowledge Core tables ────

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
    EXECUTE format('DROP POLICY IF EXISTS "knowledge_delete" ON %I', tbl);
  END LOOP;
END $$;

-- ── 2. Protect Verification History ──────────────────────────────────────────

ALTER TABLE knowledge_verification_events
  DROP CONSTRAINT IF EXISTS knowledge_verification_events_claim_version_id_fkey;

ALTER TABLE knowledge_verification_events
  ADD CONSTRAINT knowledge_verification_events_claim_version_id_fkey
  FOREIGN KEY (claim_version_id) REFERENCES knowledge_claim_versions(id)
  ON DELETE RESTRICT;

-- ── 3. Protect Claim Version History ─────────────────────────────────────────

ALTER TABLE knowledge_claim_versions
  DROP CONSTRAINT IF EXISTS knowledge_claim_versions_claim_id_fkey;

ALTER TABLE knowledge_claim_versions
  ADD CONSTRAINT knowledge_claim_versions_claim_id_fkey
  FOREIGN KEY (claim_id) REFERENCES knowledge_claims(id)
  ON DELETE RESTRICT;

-- ── 4. Protect Evidence History ──────────────────────────────────────────────

ALTER TABLE knowledge_evidence_excerpts
  DROP CONSTRAINT IF EXISTS knowledge_evidence_excerpts_evidence_source_id_fkey;

ALTER TABLE knowledge_evidence_excerpts
  ADD CONSTRAINT knowledge_evidence_excerpts_evidence_source_id_fkey
  FOREIGN KEY (evidence_source_id) REFERENCES knowledge_evidence_sources(id)
  ON DELETE RESTRICT;

ALTER TABLE knowledge_claim_evidence
  DROP CONSTRAINT IF EXISTS knowledge_claim_evidence_claim_version_id_fkey;

ALTER TABLE knowledge_claim_evidence
  ADD CONSTRAINT knowledge_claim_evidence_claim_version_id_fkey
  FOREIGN KEY (claim_version_id) REFERENCES knowledge_claim_versions(id)
  ON DELETE RESTRICT;

ALTER TABLE knowledge_claim_evidence
  DROP CONSTRAINT IF EXISTS knowledge_claim_evidence_evidence_excerpt_id_fkey;

ALTER TABLE knowledge_claim_evidence
  ADD CONSTRAINT knowledge_claim_evidence_evidence_excerpt_id_fkey
  FOREIGN KEY (evidence_excerpt_id) REFERENCES knowledge_evidence_excerpts(id)
  ON DELETE RESTRICT;

-- ── 5. Protect Canonical Provenance Links ────────────────────────────────────

ALTER TABLE knowledge_academic_rules
  DROP CONSTRAINT IF EXISTS academic_rules_claim_version_fk;

ALTER TABLE knowledge_academic_rules
  ADD CONSTRAINT academic_rules_claim_version_fk
  FOREIGN KEY (claim_version_id) REFERENCES knowledge_claim_versions(id)
  ON DELETE RESTRICT;

ALTER TABLE knowledge_equivalencies_v2
  DROP CONSTRAINT IF EXISTS equiv_v2_claim_version_fk;

ALTER TABLE knowledge_equivalencies_v2
  ADD CONSTRAINT equiv_v2_claim_version_fk
  FOREIGN KEY (claim_version_id) REFERENCES knowledge_claim_versions(id)
  ON DELETE RESTRICT;

ALTER TABLE knowledge_articulations_v2
  DROP CONSTRAINT IF EXISTS artic_v2_claim_version_fk;

ALTER TABLE knowledge_articulations_v2
  ADD CONSTRAINT artic_v2_claim_version_fk
  FOREIGN KEY (claim_version_id) REFERENCES knowledge_claim_versions(id)
  ON DELETE RESTRICT;

ALTER TABLE knowledge_claim_versions
  DROP CONSTRAINT IF EXISTS claim_versions_supersedes_fk;

ALTER TABLE knowledge_claim_versions
  ADD CONSTRAINT claim_versions_supersedes_fk
  FOREIGN KEY (supersedes_version_id) REFERENCES knowledge_claim_versions(id)
  ON DELETE RESTRICT;

-- ── 6. Protect Conflict History ─────────────────────────────────────────────

ALTER TABLE knowledge_conflicts
  DROP CONSTRAINT IF EXISTS knowledge_conflicts_claim_version_a_id_fkey;

ALTER TABLE knowledge_conflicts
  ADD CONSTRAINT knowledge_conflicts_claim_version_a_id_fkey
  FOREIGN KEY (claim_version_a_id) REFERENCES knowledge_claim_versions(id)
  ON DELETE RESTRICT;

ALTER TABLE knowledge_conflicts
  DROP CONSTRAINT IF EXISTS knowledge_conflicts_claim_version_b_id_fkey;

ALTER TABLE knowledge_conflicts
  ADD CONSTRAINT knowledge_conflicts_claim_version_b_id_fkey
  FOREIGN KEY (claim_version_b_id) REFERENCES knowledge_claim_versions(id)
  ON DELETE RESTRICT;
