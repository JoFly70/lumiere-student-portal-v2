-- =============================================================================
-- DISPOSABLE ENVIRONMENT ONLY — runtime supplement (S02)
--
-- The production lineage (PRODUCTION_DATABASE_SETUP.sql + supabase/migrations)
-- does not create several legacy tables the running server still queries.
-- This file adds them so the existing code paths can be exercised against a
-- disposable database. Blocks marked "verbatim" are copied unchanged from the
-- cited legacy file/lines; blocks marked "S02 addition" have no SQL source in
-- the repository and are derived from shared/schema.ts.
--
-- RLS is intentionally NOT added here: the repository defines none for these
-- tables (migrations/005_student_profiles.sql:376-383 leaves it commented out),
-- and S02 measures that repository-defined state as-is.
--
-- Never apply this file to a hosted Supabase project.
-- =============================================================================

-- S02 addition: enums used by 001 tables but absent from the production lineage
DO $$ BEGIN CREATE TYPE document_status AS ENUM ('pending', 'parsed', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- verbatim: migrations/001_initial_schema.sql:34-43 (programs)
CREATE TABLE programs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  title TEXT NOT NULL,
  catalog_year INTEGER NOT NULL,
  residency_required INTEGER NOT NULL DEFAULT 30,
  ul_required INTEGER NOT NULL DEFAULT 24,
  total_required INTEGER NOT NULL DEFAULT 120,
  rules JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- verbatim: migrations/001_initial_schema.sql:61-80 (providers, courses_catalog)
CREATE TABLE providers (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX providers_key_idx ON providers(key);

-- Courses catalog table
CREATE TABLE courses_catalog (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  provider_id VARCHAR NOT NULL REFERENCES providers(id),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  credits INTEGER NOT NULL,
  level TEXT NOT NULL DEFAULT 'lower',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  meta JSONB DEFAULT '{}'
);

-- verbatim: migrations/001_initial_schema.sql:97-104 (plans)
CREATE TABLE plans (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id VARCHAR NOT NULL REFERENCES programs(id),
  catalog_year INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMP
);

-- verbatim: migrations/001_initial_schema.sql:119-132 (enrollments)
CREATE TABLE enrollments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id VARCHAR NOT NULL REFERENCES providers(id),
  course_id VARCHAR REFERENCES courses_catalog(id),
  title TEXT NOT NULL,
  credits INTEGER NOT NULL,
  status enrollment_status NOT NULL DEFAULT 'todo',
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  proof_uri TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX enrollments_user_id_status_idx ON enrollments(user_id, status);

-- verbatim: migrations/001_initial_schema.sql:147-172 (metrics, payments)
CREATE TABLE metrics (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id VARCHAR NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  credits_total INTEGER NOT NULL DEFAULT 0,
  credits_phase1 INTEGER NOT NULL DEFAULT 0,
  credits_residency INTEGER NOT NULL DEFAULT 0,
  credits_ul INTEGER NOT NULL DEFAULT 0,
  pct_complete INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX metrics_user_id_idx ON metrics(user_id);
CREATE UNIQUE INDEX metrics_plan_id_idx ON metrics(plan_id);

-- Payments table
CREATE TABLE payments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::VARCHAR,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  invoice_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status payment_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX payments_user_id_idx ON payments(user_id);

-- S02 addition: provider keys referenced by server/services/provider-utils.ts
INSERT INTO providers (key, name) VALUES
  ('sophia', 'Sophia'), ('study_com', 'Study.com'), ('ace', 'ACE'),
  ('umpi', 'UMPI'), ('other', 'Other')
ON CONFLICT (key) DO NOTHING;

-- S02 addition: shared/schema.ts:363 queries documents.user_id
-- (student-academic-repo.ts:173); the production-lineage documents table has
-- only student_id.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id VARCHAR REFERENCES users(id);

-- verbatim: migrations/005_student_profiles.sql:154-249 (english proof, contacts, student_documents, student_audit_log)
create table if not exists student_english_proof (
  id text primary key default gen_random_uuid()::text,
  student_id text not null references students(id) on delete cascade,
  
  proof_type english_proof_type_enum not null,
  score numeric not null,
  test_date date not null,
  issuer text,
  test_id text,
  meets_requirement boolean not null default false,
  doc_url text,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  -- Only one active proof per student
  constraint unique_student_english unique (student_id)
);

-- Authorized contacts
create table if not exists student_contacts (
  id text primary key default gen_random_uuid()::text,
  student_id text not null references students(id) on delete cascade,
  
  type contact_type_enum not null,
  full_name text not null,
  relationship text not null,
  phone text not null,
  email text,
  language text,
  
  -- Authorization scopes (array of: academic, financial, emergency, release)
  scopes text[] not null default '{}'::text[],
  
  consent_doc_url text,
  created_at timestamptz not null default now(),
  
  constraint valid_contact_email check (email is null or email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Document storage
create table if not exists student_documents (
  id text primary key default gen_random_uuid()::text,
  student_id text not null references students(id) on delete cascade,
  
  -- Document metadata
  doc_type doc_type_enum not null,
  file_name text not null,
  issuer text,
  doc_date date,
  score text, -- numeric or textual grade/score
  country text,
  notes text,
  
  -- Storage & access control
  url text not null, -- Supabase storage URL
  storage_path text not null, -- canonical path: students/{code}/{type}/{timestamp}_{file}
  visibility visibility_enum not null default 'student_staff',
  required_for_enrollment boolean not null default false,
  
  -- Verification workflow
  status doc_status_enum not null default 'pending',
  verified boolean not null default false,
  verified_by text references users(id),
  verified_at timestamptz,
  admin_notes text,
  
  -- OCR (optional)
  ocr_text text,
  
  -- Soft delete for audit trail
  soft_deleted boolean not null default false,
  
  -- Timestamps
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Audit log for all student profile changes
create table if not exists student_audit_log (
  id text primary key default gen_random_uuid()::text,
  student_id text references students(id) on delete cascade,
  actor_id text references users(id),
  
  action text not null, -- created, updated, deleted, verified, rejected, etc.
  entity_type text not null, -- student, document, contact, english_proof
  entity_id text,
  field text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb, -- additional context
  
  created_at timestamptz not null default now()
);


-- verbatim: migrations/005_student_profiles.sql:257-271 (indexes)
create index idx_student_english_student_id on student_english_proof(student_id);
create index idx_student_english_proof_type on student_english_proof(proof_type);

create index idx_student_contacts_student_id on student_contacts(student_id);
create index idx_student_contacts_type on student_contacts(type);

create index idx_student_docs_student_id on student_documents(student_id);
create index idx_student_docs_status on student_documents(status);
create index idx_student_docs_doc_type on student_documents(doc_type);
create index idx_student_docs_student_status on student_documents(student_id, status);

create index idx_student_audit_log_student_id on student_audit_log(student_id);
create index idx_student_audit_log_actor_id on student_audit_log(actor_id);
create index idx_student_audit_log_entity on student_audit_log(entity_type, entity_id);
create index idx_student_audit_log_created_at on student_audit_log(created_at desc);

-- verbatim: migrations/005_student_profiles.sql:273-304 (student_code generator; required because POST /api/students omits student_code)
-- Trigger: Auto-generate student_code on insert
create or replace function generate_student_code()
returns trigger as $$
declare
  year_part text;
  sequence_num int;
  new_code text;
begin
  -- Extract year
  year_part := to_char(now(), 'YYYY');
  
  -- Get next sequence number for this year
  select coalesce(max(
    cast(substring(student_code from 'LCA-' || year_part || '-(.*)') as int)
  ), 0) + 1
  into sequence_num
  from students
  where student_code like 'LCA-' || year_part || '-%';
  
  -- Generate code: LCA-{YYYY}-{XXXX}
  new_code := 'LCA-' || year_part || '-' || lpad(sequence_num::text, 4, '0');
  
  new.student_code := new_code;
  return new;
end;
$$ language plpgsql;

create trigger trg_generate_student_code
  before insert on students
  for each row
  when (new.student_code is null)
  execute function generate_student_code();

-- verbatim: migrations/005_student_profiles.sql:330-350 (English requirement trigger)
-- Trigger: Auto-validate English proof thresholds
create or replace function validate_english_requirement()
returns trigger as $$
begin
  new.meets_requirement := case
    when new.proof_type = 'duolingo' and new.score >= 100 then true
    when new.proof_type = 'ielts' and new.score >= 6.0 then true
    when new.proof_type = 'toefl' and new.score >= 70 then true
    when new.proof_type = 'cambridge' and new.score >= 160 then true -- B2 band
    when new.proof_type = 'lumiere_placement' and new.score >= 70 then true
    else false
  end;
  
  return new;
end;
$$ language plpgsql;

create trigger trg_validate_english_requirement
  before insert or update on student_english_proof
  for each row
  execute function validate_english_requirement();

-- S02 addition: course_templates (shared/schema.ts:344-356; no SQL source exists)
CREATE TABLE IF NOT EXISTS course_templates (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  courses JSONB NOT NULL DEFAULT '[]',
  created_by VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- verbatim: migrations/010_support_tickets_system.sql:110-146 (ticket_attachments, ticket_status_history)
-- Ticket attachments table
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES ticket_comments(id) ON DELETE CASCADE, -- Optional: attach to specific comment

  -- File info
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_type TEXT NOT NULL,
  storage_path TEXT NOT NULL, -- Path in Supabase Storage

  -- Uploader
  uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  -- Constraints
  CONSTRAINT valid_file_size CHECK (file_size > 0 AND file_size <= 10485760), -- 10MB max
  CONSTRAINT valid_file_name CHECK (LENGTH(file_name) > 0 AND LENGTH(file_name) <= 255)
);

-- Ticket status history table (for audit trail)
CREATE TABLE IF NOT EXISTS ticket_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,

  -- Status change
  old_status ticket_status,
  new_status ticket_status NOT NULL,
  changed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  change_reason TEXT,

  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
-- (010's track_ticket_status_change trigger is NOT installed: it inserts an
--  unset app.current_user_id / 'system' into an FK to users(id).)
ALTER TABLE ticket_attachments ENABLE ROW LEVEL SECURITY;      -- as 010:249-251
ALTER TABLE ticket_status_history ENABLE ROW LEVEL SECURITY;   -- (its policies cannot be created)
