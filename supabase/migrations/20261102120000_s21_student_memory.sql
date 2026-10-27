-- S21: student-visible assistant memory (owner-scoped, provenance-tracked).
-- Additive and idempotent. Memory is informational: it never feeds credits, verification,
-- billing, acceptance or graduation. Superseded and retracted rows are kept (linked), not deleted.

CREATE TABLE IF NOT EXISTS public.student_assistant_memory (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    text NOT NULL,
  category         text NOT NULL,
  statement        text NOT NULL,
  normalized_key   text NOT NULL,
  basis            text NOT NULL DEFAULT 'student_reported',
  status           text NOT NULL DEFAULT 'active',
  supersedes_id    uuid REFERENCES public.student_assistant_memory(id),
  superseded_by_id uuid REFERENCES public.student_assistant_memory(id),
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_assistant_memory_category_chk CHECK (category IN (
    'intended_major','education_goal','preferred_language','country_interest','institution_interest',
    'degree_pathway','academic_priority','schedule_constraint','preference','approved_plan','open_question')),
  CONSTRAINT student_assistant_memory_basis_chk CHECK (basis IN ('student_reported','official_record')),
  CONSTRAINT student_assistant_memory_status_chk CHECK (status IN ('active','superseded','retracted')),
  CONSTRAINT student_assistant_memory_statement_chk CHECK (char_length(statement) BETWEEN 1 AND 500),
  CONSTRAINT student_assistant_memory_version_chk CHECK (version >= 1)
);

-- At most one ACTIVE row per owner and normalised fact (duplicates become extra sources instead).
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_assistant_memory_active_key
  ON public.student_assistant_memory (owner_user_id, normalized_key) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_student_assistant_memory_owner
  ON public.student_assistant_memory (owner_user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.assistant_memory_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id   uuid NOT NULL REFERENCES public.student_assistant_memory(id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  source_id   text NOT NULL,
  excerpt     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_memory_sources_kind_chk CHECK (source_kind IN ('message','document','academic_record','student_correction')),
  CONSTRAINT assistant_memory_sources_excerpt_chk CHECK (excerpt IS NULL OR char_length(excerpt) <= 500)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_memory_sources_ref
  ON public.assistant_memory_sources (memory_id, source_kind, source_id);
CREATE INDEX IF NOT EXISTS idx_assistant_memory_sources_ref
  ON public.assistant_memory_sources (source_kind, source_id);

ALTER TABLE public.student_assistant_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_memory_sources ENABLE ROW LEVEL SECURITY;

-- Students may read (never write) their own rows through PostgREST; the server uses the owner role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auth' AND p.proname = 'uid') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_assistant_memory' AND policyname = 'student_assistant_memory_owner_read') THEN
      CREATE POLICY student_assistant_memory_owner_read ON public.student_assistant_memory
        FOR SELECT USING (owner_user_id = auth.uid()::text);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'assistant_memory_sources' AND policyname = 'assistant_memory_sources_owner_read') THEN
      CREATE POLICY assistant_memory_sources_owner_read ON public.assistant_memory_sources
        FOR SELECT USING (EXISTS (
          SELECT 1 FROM public.student_assistant_memory m
          WHERE m.id = assistant_memory_sources.memory_id AND m.owner_user_id = auth.uid()::text));
    END IF;
  END IF;
END $$;
