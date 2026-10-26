/*
# S05 — Lumière-assigned interactive student roadmap

Additive and idempotent. No existing table is modified.

  student_roadmap_plans            one plan per student (created lazily), points at the published version
  student_roadmap_versions         immutable-once-published versioned JSON roadmap documents
  student_roadmap_imports          audit + idempotency record of every workbook/package import
  student_roadmap_progress         student-reported coursework activity, keyed by (item_key, task_key)
  student_roadmap_progress_events  append-only history of every progress change

Doctrine: staff own, modify and publish the roadmap; the student only reports
activity. Credit is never stored here (canonical S04 engine only). Progress is
keyed by stable item/task keys and is NEVER deleted by plan changes.

FK type mapping (as phase2a): students.id = text, users.id = varchar -> text.
Writes go through the server (service-role / owner connection); RLS grants
staff/admin full read and students read of their own plan, published
versions and progress only.
*/

DO $$ BEGIN
  CREATE TYPE student_roadmap_version_status AS ENUM ('draft', 'published', 'superseded', 'discarded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Helper functions (identical definitions to phase2a; safe to re-create)
CREATE OR REPLACE FUNCTION is_staff_or_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::text AND role IN ('staff', 'admin'));
$$;

CREATE OR REPLACE FUNCTION student_owns_record(p_student_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id AND user_id = auth.uid()::text);
$$;

-- A. plans
CREATE TABLE IF NOT EXISTS student_roadmap_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL UNIQUE REFERENCES students(id) ON DELETE RESTRICT,
  published_version_id uuid,
  revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- B. versions
CREATE TABLE IF NOT EXISTS student_roadmap_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES student_roadmap_plans(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number >= 1),
  status student_roadmap_version_status NOT NULL DEFAULT 'draft',
  content jsonb NOT NULL,
  base_version_id uuid REFERENCES student_roadmap_versions(id) ON DELETE RESTRICT,
  import_id uuid,
  draft_revision integer NOT NULL DEFAULT 0,
  exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  acknowledgements jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by text REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz,
  superseded_at timestamptz,
  discarded_at timestamptz,
  CONSTRAINT student_roadmap_versions_plan_number_unique UNIQUE (plan_id, version_number)
);
CREATE INDEX IF NOT EXISTS student_roadmap_versions_plan_idx ON student_roadmap_versions(plan_id);
DO $$ BEGIN
  CREATE UNIQUE INDEX student_roadmap_versions_one_draft_idx ON student_roadmap_versions(plan_id) WHERE status = 'draft';
EXCEPTION WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  CREATE UNIQUE INDEX student_roadmap_versions_one_published_idx ON student_roadmap_versions(plan_id) WHERE status = 'published';
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- plans.published_version_id -> versions (added after both tables exist)
DO $$ BEGIN
  ALTER TABLE student_roadmap_plans
    ADD CONSTRAINT student_roadmap_plans_published_version_fk
    FOREIGN KEY (published_version_id) REFERENCES student_roadmap_versions(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- C. imports
CREATE TABLE IF NOT EXISTS student_roadmap_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES student_roadmap_plans(id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  file_sha256 text NOT NULL,
  file_name text,
  template_id text NOT NULL,
  base_version_id uuid REFERENCES student_roadmap_versions(id) ON DELETE RESTRICT,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  resulting_version_id uuid REFERENCES student_roadmap_versions(id) ON DELETE SET NULL,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_roadmap_imports_plan_idx ON student_roadmap_imports(plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS student_roadmap_imports_idempotency_idx
  ON student_roadmap_imports(plan_id, file_sha256, (COALESCE(base_version_id::text, '')));

DO $$ BEGIN
  ALTER TABLE student_roadmap_versions
    ADD CONSTRAINT student_roadmap_versions_import_fk
    FOREIGN KEY (import_id) REFERENCES student_roadmap_imports(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- D. progress (never deleted by plan changes)
CREATE TABLE IF NOT EXISTS student_roadmap_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  item_key text NOT NULL,
  task_key text NOT NULL,
  status text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_roadmap_progress_status_check
    CHECK (status IN ('not_started', 'in_progress', 'submitted', 'graded', 'provider_complete')),
  CONSTRAINT student_roadmap_progress_key_unique UNIQUE (student_id, item_key, task_key)
);
CREATE INDEX IF NOT EXISTS student_roadmap_progress_student_idx ON student_roadmap_progress(student_id);

-- E. progress events (append-only)
CREATE TABLE IF NOT EXISTS student_roadmap_progress_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  item_key text NOT NULL,
  task_key text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  revision integer NOT NULL,
  plan_version_id uuid REFERENCES student_roadmap_versions(id) ON DELETE SET NULL,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_roadmap_progress_events_student_idx
  ON student_roadmap_progress_events(student_id, item_key, task_key);

-- RLS
ALTER TABLE student_roadmap_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_roadmap_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_roadmap_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_roadmap_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_roadmap_progress_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_roadmap_plans_select" ON student_roadmap_plans;
CREATE POLICY "student_roadmap_plans_select" ON student_roadmap_plans FOR SELECT TO authenticated
  USING (is_staff_or_admin() OR student_owns_record(student_id));

DROP POLICY IF EXISTS "student_roadmap_versions_select" ON student_roadmap_versions;
CREATE POLICY "student_roadmap_versions_select" ON student_roadmap_versions FOR SELECT TO authenticated
  USING (
    is_staff_or_admin()
    OR (
      status = 'published'
      AND EXISTS (
        SELECT 1 FROM student_roadmap_plans p
        WHERE p.id = student_roadmap_versions.plan_id AND student_owns_record(p.student_id)
      )
    )
  );

DROP POLICY IF EXISTS "student_roadmap_imports_select" ON student_roadmap_imports;
CREATE POLICY "student_roadmap_imports_select" ON student_roadmap_imports FOR SELECT TO authenticated
  USING (is_staff_or_admin());

DROP POLICY IF EXISTS "student_roadmap_progress_select" ON student_roadmap_progress;
CREATE POLICY "student_roadmap_progress_select" ON student_roadmap_progress FOR SELECT TO authenticated
  USING (is_staff_or_admin() OR student_owns_record(student_id));

DROP POLICY IF EXISTS "student_roadmap_progress_events_select" ON student_roadmap_progress_events;
CREATE POLICY "student_roadmap_progress_events_select" ON student_roadmap_progress_events FOR SELECT TO authenticated
  USING (is_staff_or_admin() OR student_owns_record(student_id));

-- Append-only guard for the progress history
CREATE OR REPLACE FUNCTION student_roadmap_progress_events_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'student_roadmap_progress_events is append-only';
END;
$$;
DROP TRIGGER IF EXISTS student_roadmap_progress_events_no_update ON student_roadmap_progress_events;
CREATE TRIGGER student_roadmap_progress_events_no_update
  BEFORE UPDATE OR DELETE ON student_roadmap_progress_events
  FOR EACH ROW EXECUTE FUNCTION student_roadmap_progress_events_immutable();

-- Published and superseded versions are immutable documents
CREATE OR REPLACE FUNCTION student_roadmap_versions_content_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('published', 'superseded') AND NEW.content IS DISTINCT FROM OLD.content THEN
    RAISE EXCEPTION 'student_roadmap_versions.content is immutable once published';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS student_roadmap_versions_content_guard ON student_roadmap_versions;
CREATE TRIGGER student_roadmap_versions_content_guard
  BEFORE UPDATE ON student_roadmap_versions
  FOR EACH ROW EXECUTE FUNCTION student_roadmap_versions_content_guard();
