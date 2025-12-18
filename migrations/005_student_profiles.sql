-- Migration 005: Student Profiles and Document Management
-- Creates comprehensive student profile system with document management,
-- English proficiency tracking, authorized contacts, and audit logging

-- Document type enumeration
create type doc_type_enum as enum (
  'id_gov',
  'hs_diploma',
  'hs_transcript',
  'degree_certificate',
  'college_transcript',
  'foreign_eval',
  'english_cert',
  'residency_doc',
  'consent_form',
  'other'
);

-- Document status enumeration
create type doc_status_enum as enum (
  'pending',
  'verified',
  'rejected',
  'resubmit_requested'
);

-- Student status enumeration
create type student_status_enum as enum (
  'lead',
  'active',
  'paused',
  'graduated'
);

-- Residency type enumeration
create type residency_enum as enum (
  'us',
  'foreign'
);

-- High school path enumeration
create type hs_path_enum as enum (
  'local_diploma',
  'ged',
  'foreign'
);

-- English proof type enumeration
create type english_proof_type_enum as enum (
  'duolingo',
  'ielts',
  'toefl',
  'cambridge',
  'lumiere_placement'
);

-- Target pace enumeration
create type target_pace_enum as enum (
  'fast',
  'standard',
  'extended'
);

-- Contact type enumeration
create type contact_type_enum as enum (
  'parent',
  'spouse',
  'guardian',
  'other'
);

-- Visibility enumeration
create type visibility_enum as enum (
  'student_staff',
  'staff_only',
  'public'
);

-- Main students table
create table if not exists students (
  id text primary key default gen_random_uuid()::text,
  user_id text references users(id) on delete cascade,
  
  -- Auto-generated student code: LCA-{YYYY}-{XXXX}
  student_code text unique not null,
  
  -- Status tracking
  status student_status_enum not null default 'lead',
  
  -- Identity
  first_name text not null,
  middle_name text,
  last_name text not null,
  preferred_name text,
  dob date not null,
  sex text,
  nationality text[] not null default '{}'::text[], -- array of country codes
  gov_id_type text,
  gov_id_number text, -- encrypted at rest (handled by RLS/app layer)
  photo_url text,
  
  -- Residency & Eligibility
  residency residency_enum not null,
  hs_completion boolean not null default false,
  hs_path hs_path_enum,
  hs_country text,
  hs_school text,
  hs_year smallint,
  hs_doc_url text,
  
  -- Contact Information
  email text unique not null,
  email_verified_at timestamptz,
  phone_primary text not null,
  phone_secondary text,
  whatsapp_primary boolean not null default false,
  timezone text,
  preferred_contact_channel text default 'email',
  
  -- Address
  address_country text not null,
  address_state text,
  address_city text,
  address_postal text,
  address_line1 text not null,
  address_line2 text,
  
  -- Program Intent
  target_degree text,
  target_major text,
  start_term date, -- month anchor
  prior_credits boolean not null default false,
  prior_credits_est smallint,
  prior_sources text[] not null default '{}'::text[], -- array of source names
  transcripts_url text[] not null default '{}'::text[], -- array of URLs
  target_pace target_pace_enum,
  
  -- Compliance
  marketing_opt_in boolean not null default false,
  media_release boolean not null default false,
  consent_signed_at timestamptz,
  consent_signature text,
  
  -- Metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  -- Constraints
  constraint valid_dob check (dob <= current_date - interval '13 years'),
  constraint valid_email check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- English proficiency proof
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

-- Indexes for performance
create index idx_students_user_id on students(user_id);
create index idx_students_student_code on students(student_code);
create index idx_students_status on students(status);
create index idx_students_email on students(email);
create index idx_students_residency on students(residency);

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

-- Trigger: Update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_students_updated_at
  before update on students
  for each row
  execute function update_updated_at_column();

create trigger trg_student_english_updated_at
  before update on student_english_proof
  for each row
  execute function update_updated_at_column();

create trigger trg_student_docs_updated_at
  before update on student_documents
  for each row
  execute function update_updated_at_column();

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

-- Trigger: Audit log for student changes
create or replace function audit_student_changes()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    insert into student_audit_log (student_id, actor_id, action, entity_type, entity_id, new_value)
    values (new.id, nullif(current_setting('app.current_user_id', true), '')::text, 'created', 'student', new.id, to_jsonb(new));
  elsif TG_OP = 'UPDATE' then
    insert into student_audit_log (student_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (new.id, nullif(current_setting('app.current_user_id', true), '')::text, 'updated', 'student', new.id, to_jsonb(old), to_jsonb(new));
  elsif TG_OP = 'DELETE' then
    insert into student_audit_log (student_id, actor_id, action, entity_type, entity_id, old_value)
    values (old.id, nullif(current_setting('app.current_user_id', true), '')::text, 'deleted', 'student', old.id, to_jsonb(old));
  end if;
  
  return new;
end;
$$ language plpgsql;

create trigger trg_audit_student_changes
  after insert or update or delete on students
  for each row
  execute function audit_student_changes();

-- Note: RLS policies disabled for now as we're using application-level authorization
-- alter table students enable row level security;
-- alter table student_english_proof enable row level security;
-- alter table student_contacts enable row level security;
-- alter table student_documents enable row level security;
-- alter table student_audit_log enable row level security;

select 'OK: Student profile tables, enums, indexes, and triggers created successfully.' as status;
