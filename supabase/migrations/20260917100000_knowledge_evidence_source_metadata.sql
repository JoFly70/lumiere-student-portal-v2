-- Knowledge PR 1: additive evidence-source metadata only.
DO $$ BEGIN
  CREATE TYPE evidence_lifecycle_status AS ENUM ('current', 'historical', 'superseded', 'pending_review');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE knowledge_evidence_sources
  ADD COLUMN IF NOT EXISTS academic_year integer,
  ADD COLUMN IF NOT EXISTS version_label text,
  ADD COLUMN IF NOT EXISTS lifecycle_status evidence_lifecycle_status NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by text;