-- S21 (B): chat attachments reuse the Documents system.
-- Additive and idempotent. student_documents is not created by this repository's migration chain
-- (it exists in production and in the disposable supplement), so every change to it is guarded with
-- to_regclass, exactly like 20261030110000_s18_document_student_message.sql. Re-apply this file after
-- the table exists to pick up the guarded parts (the S21 test harness does).

-- 1. New document type. doc_type is the enum doc_type_enum (migrations/005); ADD VALUE IF NOT EXISTS is idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'doc_type_enum') THEN
    ALTER TYPE doc_type_enum ADD VALUE IF NOT EXISTS 'chat_attachment';
  END IF;
END
$$;

-- 2. student_documents additive columns + invariants.
DO $$
BEGIN
  IF to_regclass('public.student_documents') IS NOT NULL THEN
    ALTER TABLE public.student_documents
      ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'documents',
      ADD COLUMN IF NOT EXISTS mime_type text,
      ADD COLUMN IF NOT EXISTS size_bytes bigint,
      ADD COLUMN IF NOT EXISTS content_sha256 text,
      ADD COLUMN IF NOT EXISTS extraction_status text;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_documents_source_check') THEN
      ALTER TABLE public.student_documents
        ADD CONSTRAINT student_documents_source_check CHECK (source IN ('documents', 'chat'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_documents_extraction_status_check') THEN
      ALTER TABLE public.student_documents
        ADD CONSTRAINT student_documents_extraction_status_check
        CHECK (extraction_status IS NULL OR extraction_status IN ('pending', 'indexed', 'stored_only', 'failed'));
    END IF;
    -- A chat_attachment row can only be created by the chat path (which sniffs and quota-checks), never
    -- through the generic Documents upload. Compared as text so the new enum value is not "used" here.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_documents_chat_source_check') THEN
      ALTER TABLE public.student_documents
        ADD CONSTRAINT student_documents_chat_source_check
        CHECK ((source = 'chat') = (doc_type::text = 'chat_attachment'));
    END IF;
    -- Chat attachments never count toward enrollment requirements.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_documents_chat_not_required_check') THEN
      ALTER TABLE public.student_documents
        ADD CONSTRAINT student_documents_chat_not_required_check
        CHECK (source <> 'chat' OR required_for_enrollment = false);
    END IF;

    CREATE INDEX IF NOT EXISTS idx_student_docs_student_sha
      ON public.student_documents (student_id, content_sha256) WHERE content_sha256 IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_student_docs_student_source
      ON public.student_documents (student_id, source);
  END IF;
END
$$;

-- 3. Extracted text chunks (B writes, C reads). ids are text because student_documents.id / students.id are text.
CREATE TABLE IF NOT EXISTS public.student_document_text (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id text NOT NULL,
  student_id text NOT NULL,
  chunk_index integer NOT NULL,
  location text,
  content text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_document_text_doc_chunk_key UNIQUE (document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_student_document_text_search ON public.student_document_text USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_student_document_text_student ON public.student_document_text (student_id);

DO $$
BEGIN
  IF to_regclass('public.student_documents') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_document_text_document_fk') THEN
    BEGIN
      ALTER TABLE public.student_document_text
        ADD CONSTRAINT student_document_text_document_fk
        FOREIGN KEY (document_id) REFERENCES public.student_documents(id) ON DELETE CASCADE;
    EXCEPTION WHEN datatype_mismatch OR undefined_column THEN
      RAISE NOTICE 'student_document_text FK skipped (student_documents.id type differs)';
    END;
  END IF;
END
$$;

-- 4. Per-student quota override (default comes from STUDENT_STORAGE_QUOTA_MB, 250 MB).
CREATE TABLE IF NOT EXISTS public.student_storage_quota (
  student_id text PRIMARY KEY,
  quota_bytes bigint NOT NULL CHECK (quota_bytes >= 0),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. RLS: server-only tables (owner role bypasses RLS). A student may read only their own chunks via PostgREST.
ALTER TABLE public.student_document_text ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_storage_quota ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.students') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth')
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_document_text'
                     AND policyname = 'student_document_text_owner_select') THEN
    CREATE POLICY student_document_text_owner_select ON public.student_document_text
      FOR SELECT USING (
        student_id IN (SELECT s.id::text FROM public.students s WHERE s.user_id::text = auth.uid()::text)
      );
  END IF;
END
$$;

-- 6. The documents bucket must accept the chat attachment types (the Documents page keeps its stricter
--    10 MB PDF/image limit in server/lib/document-storage.ts validateFile; this is only the storage ceiling).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    UPDATE storage.buckets
       SET file_size_limit = 20971520,
           allowed_mime_types = ARRAY[
             'application/pdf','image/png','image/jpeg','image/jpg','image/webp',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             'text/csv','application/csv','application/vnd.ms-excel','text/plain'
           ]
     WHERE id = 'student-documents';
  END IF;
END
$$;
