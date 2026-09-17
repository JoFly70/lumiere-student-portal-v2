-- Knowledge PR 1: additive evidence-source metadata only.
DO $$ BEGIN
  CREATE TYPE evidence_lifecycle_status AS ENUM ('current', 'historical', 'superseded', 'pending_review');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE knowledge_evidence_sources
  ADD COLUMN IF NOT EXISTS academic_year text,
  ADD COLUMN IF NOT EXISTS version_label text,
  ADD COLUMN IF NOT EXISTS lifecycle_status evidence_lifecycle_status NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by text;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'knowledge_evidence_sources'::regclass
      AND attname = 'academic_year'
      AND NOT attisdropped
      AND atttypid <> 'text'::regtype
  ) THEN
    ALTER TABLE knowledge_evidence_sources
      ALTER COLUMN academic_year TYPE text
      USING academic_year::text;
  END IF;
END $$;