-- ===========================================
-- Lumiere Portal: Full Initialization Script
-- Creates all tables + seeds demo degree + demo student (0 credits)
-- Safe to run from scratch; re-running won't duplicate.
-- ===========================================

create extension if not exists pgcrypto;

-- ============= TABLES =============

-- USERS / STUDENTS
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  created_at timestamptz not null default now()
);

-- DEGREE TEMPLATES
create table if not exists degree_templates (
  id uuid primary key default gen_random_uuid(),
  university text not null,
  degree_name text not null,
  total_credits int not null,
  min_upper_credits int not null default 0,
  residency_credits int not null default 0,
  capstone_code text,
  last_updated timestamptz not null default now()
);

-- REQUIREMENTS
create table if not exists degree_requirements (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references degree_templates(id) on delete cascade,
  area_code text not null,
  area_name text not null,
  required_credits int not null,
  must_take_course_codes text[] default '{}',
  notes text default ''
);

-- REQUIREMENT MAPPINGS
create table if not exists requirement_mappings (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references degree_requirements(id) on delete cascade,
  course_code_pattern text,
  title_keywords text[] default '{}',
  fulfills_credits int not null default 3,
  level text check (level in ('lower','upper') or level is null),
  provider_filter text[] default '{}',
  notes text default ''
);

-- PROVIDER CATALOG
create table if not exists provider_catalog (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  course_code text not null,
  title text not null,
  credits int not null,
  level text check (level in ('lower','upper')),
  est_hours int default 45,
  url text,
  price_est numeric(10,2) default 0,
  area_tags text[] default '{}'
);

-- ROADMAP PLANS (each student's degree plan)
create table if not exists roadmap_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  template_id uuid not null references degree_templates(id) on delete cascade,
  status text default 'draft',
  total_remaining_credits int default 0,
  est_cost numeric(10,2) default 0,
  est_months int default 0,
  version int default 1,
  created_at timestamptz not null default now()
);

-- ROADMAP STEPS (individual course steps)
create table if not exists roadmap_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references roadmap_plans(id) on delete cascade,
  step_index int,
  item_type text,
  ref_code text,
  title text,
  credits int,
  est_cost numeric(10,2),
  est_weeks int,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_degree_requirements_template on degree_requirements(template_id);
create index if not exists idx_reqmap_requirement on requirement_mappings(requirement_id);
create index if not exists idx_provider_course on provider_catalog(provider, course_code);

-- ============= SEED DEGREE TEMPLATE + RULES =============
do $$
declare
  v_tmpl_id uuid;
  v_user_id uuid;
  v_plan_id uuid;
begin
  -- only seed if template doesn't exist
  if not exists (select 1 from degree_templates where degree_name='BA Liberal Studies (Demo)') then
    insert into degree_templates (university, degree_name, total_credits, min_upper_credits, residency_credits, capstone_code)
    values ('UMPI-style', 'BA Liberal Studies (Demo)', 120, 30, 30, 'CAP-499')
    returning id into v_tmpl_id;

    -- create buckets
    insert into degree_requirements (template_id, area_code, area_name, required_credits, notes) values
    (v_tmpl_id,'GEN-ENG','General Ed: English Composition & Writing',6,''),
    (v_tmpl_id,'GEN-MATH','General Ed: Quantitative Reasoning',3,''),
    (v_tmpl_id,'GEN-SCI','General Ed: Natural Science',7,''),
    (v_tmpl_id,'GEN-SOC','General Ed: Social Science',6,''),
    (v_tmpl_id,'GEN-HUM','General Ed: Humanities',6,''),
    (v_tmpl_id,'GEN-COM','General Ed: Communication/Info Literacy',3,''),
    (v_tmpl_id,'GEN-OPEN','General Ed: Open GenEd',9,''),
    (v_tmpl_id,'MAJOR-CORE','Major Core',24,'At least 12cr upper-level within Major'),
    (v_tmpl_id,'MAJOR-CAP','Major Capstone',6,'University-only, upper-level'),
    (v_tmpl_id,'POLICY-UL','Upper-Level Minimum',30,'Satisfied by any UL credits'),
    (v_tmpl_id,'POLICY-RES','Residency (university-only)',30,'University credits only'),
    (v_tmpl_id,'ELECTIVES','Free Electives',50,'Fill remaining to 120');

    -- mappings
    insert into requirement_mappings (requirement_id, course_code_pattern, title_keywords, fulfills_credits, level, notes)
    select id,'^ENG[- ]?1(0|1)1$',array['composition','writing'],3,'lower','Freshman English'
    from degree_requirements where template_id=v_tmpl_id and area_code='GEN-ENG';
    insert into requirement_mappings (requirement_id, course_code_pattern, title_keywords, fulfills_credits, level)
    select id,'^ENG[- ]?1(0|1)2$',array['composition','rhetoric'],3,'lower'
    from degree_requirements where template_id=v_tmpl_id and area_code='GEN-ENG';
    insert into requirement_mappings (requirement_id, course_code_pattern, title_keywords, fulfills_credits, level)
    select id,'^(MAT|MTH|STA)[- ]?1..$',array['algebra','statistics','quantitative'],3,'lower'
    from degree_requirements where template_id=v_tmpl_id and area_code='GEN-MATH';
    insert into requirement_mappings (requirement_id, course_code_pattern, title_keywords, fulfills_credits, level)
    select id,'.*',array['biology','chemistry','physics','earth','environmental'],3,'lower'
    from degree_requirements where template_id=v_tmpl_id and area_code='GEN-SCI';
    insert into requirement_mappings (requirement_id, course_code_pattern, title_keywords, fulfills_credits, level)
    select id,'.*',array['psychology','sociology','economics','political','anthropology'],3,'lower'
    from degree_requirements where template_id=v_tmpl_id and area_code='GEN-SOC';
    insert into requirement_mappings (requirement_id, course_code_pattern, title_keywords, fulfills_credits, level)
    select id,'.*',array['history','literature','philosophy','ethics','art','music'],3,'lower'
    from degree_requirements where template_id=v_tmpl_id and area_code='GEN-HUM';
    insert into requirement_mappings (requirement_id, course_code_pattern, title_keywords, fulfills_credits, level)
    select id,'.*',array['communication','public speaking','information literacy'],3,'lower'
    from degree_requirements where template_id=v_tmpl_id and area_code='GEN-COM';
    insert into requirement_mappings (requirement_id, course_code_pattern, title_keywords, fulfills_credits)
    select id,'.*',array['gen ed','general education'],3
    from degree_requirements where template_id=v_tmpl_id and area_code='GEN-OPEN';
    insert into requirement_mappings (requirement_id, course_code_pattern, title_keywords, fulfills_credits)
    select id,'.*',array['management','marketing','finance','accounting','operations','analytics','strategy'],3
    from degree_requirements where template_id=v_tmpl_id and area_code='MAJOR-CORE';
    insert into requirement_mappings (requirement_id, course_code_pattern, title_keywords, fulfills_credits, level, provider_filter)
    select id,'^CAP[- ]?499$',array['capstone'],6,'upper',array['University']::text[]
    from degree_requirements where template_id=v_tmpl_id and area_code='MAJOR-CAP';
    insert into requirement_mappings (requirement_id, course_code_pattern, fulfills_credits)
    select id,'.*',3 from degree_requirements where template_id=v_tmpl_id and area_code='ELECTIVES';

    -- provider catalog (expanded for realistic roadmap generation)
    insert into provider_catalog (provider, course_code, title, credits, level, url, price_est, area_tags) values
    -- English / Writing (GEN-ENG)
    ('Sophia','ENG101','English Composition I',3,'lower','https://www.sophia.org',149.00,array['ENG','GEN-ENG']),
    ('Study.com','ENG102','English Composition II',3,'lower','https://study.com',199.00,array['ENG','GEN-ENG']),
    -- Math (GEN-MATH)
    ('Sophia','MAT110','Introduction to Algebra',3,'lower','https://www.sophia.org',149.00,array['MATH','GEN-MATH']),
    -- Science (GEN-SCI)
    ('Study.com','BIO101','Introduction to Biology',3,'lower','https://study.com',199.00,array['SCI','GEN-SCI']),
    ('Sophia','ENV101','Environmental Science',4,'lower','https://www.sophia.org',149.00,array['SCI','GEN-SCI']),
    -- Social Science (GEN-SOC)
    ('Sophia','PSY101','Introduction to Psychology',3,'lower','https://www.sophia.org',149.00,array['SOC','GEN-SOC']),
    ('Study.com','SOC101','Introduction to Sociology',3,'lower','https://study.com',199.00,array['SOC','GEN-SOC']),
    -- Humanities (GEN-HUM)
    ('Sophia','HIS101','U.S. History I',3,'lower','https://www.sophia.org',149.00,array['HUM','GEN-HUM']),
    ('Study.com','LIT201','American Literature',3,'lower','https://study.com',199.00,array['HUM','GEN-HUM']),
    -- Communication (GEN-COM)
    ('Sophia','COM101','Public Speaking',3,'lower','https://www.sophia.org',149.00,array['COM','GEN-COM']),
    -- Open GenEd (GEN-OPEN)
    ('Sophia','PHI101','Introduction to Philosophy',3,'lower','https://www.sophia.org',149.00,array['GEN-OPEN']),
    ('Study.com','ART101','Art Appreciation',3,'lower','https://study.com',199.00,array['GEN-OPEN']),
    ('Sophia','MUS101','Music Appreciation',3,'lower','https://www.sophia.org',149.00,array['GEN-OPEN']),
    -- Major Core (MAJOR-CORE)
    ('Study.com','BUS201','Principles of Management',3,'lower','https://study.com',199.00,array['MAJOR-CORE']),
    ('Sophia','MKT101','Introduction to Marketing',3,'lower','https://www.sophia.org',149.00,array['MAJOR-CORE']),
    ('Study.com','ACC201','Financial Accounting',3,'lower','https://study.com',199.00,array['MAJOR-CORE']),
    ('Sophia','FIN101','Personal Finance',3,'lower','https://www.sophia.org',149.00,array['MAJOR-CORE']),
    ('Study.com','ECO201','Microeconomics',3,'lower','https://study.com',199.00,array['MAJOR-CORE']),
    ('Sophia','STA101','Introduction to Statistics',3,'lower','https://www.sophia.org',149.00,array['MAJOR-CORE']),
    ('Study.com','BUS301','Business Ethics',3,'lower','https://study.com',199.00,array['MAJOR-CORE']),
    ('Sophia','HRM201','Human Resource Management',3,'lower','https://www.sophia.org',149.00,array['MAJOR-CORE']),
    -- Electives (ELECTIVES)
    ('Sophia','CIS101','Introduction to Computers',3,'lower','https://www.sophia.org',149.00,array['ELECTIVES']),
    ('Study.com','WEB101','Web Development Fundamentals',3,'lower','https://study.com',199.00,array['ELECTIVES']),
    ('Sophia','COM201','Interpersonal Communication',3,'lower','https://www.sophia.org',149.00,array['ELECTIVES']),
    ('Study.com','PSY201','Developmental Psychology',3,'lower','https://study.com',199.00,array['ELECTIVES']),
    ('Sophia','SOC201','Social Problems',3,'lower','https://www.sophia.org',149.00,array['ELECTIVES']),
    ('Study.com','HIS201','World History',3,'lower','https://study.com',199.00,array['ELECTIVES']),
    ('Sophia','BIO201','Anatomy and Physiology',4,'lower','https://www.sophia.org',149.00,array['ELECTIVES']),
    ('Study.com','PHY101','Introduction to Physics',3,'lower','https://study.com',199.00,array['ELECTIVES']),
    ('Sophia','CHE101','Chemistry Fundamentals',3,'lower','https://www.sophia.org',149.00,array['ELECTIVES']),
    ('Study.com','MAT201','College Algebra',3,'lower','https://study.com',199.00,array['ELECTIVES']),
    ('Sophia','SPA101','Spanish I',3,'lower','https://www.sophia.org',149.00,array['ELECTIVES']),
    ('Study.com','FRE101','French I',3,'lower','https://study.com',199.00,array['ELECTIVES']),
    ('Sophia','ENG201','Creative Writing',3,'lower','https://www.sophia.org',149.00,array['ELECTIVES']),
    ('Study.com','GEO101','Introduction to Geography',3,'lower','https://study.com',199.00,array['ELECTIVES']),
    ('Sophia','POL101','American Government',3,'lower','https://www.sophia.org',149.00,array['ELECTIVES']),
    ('Study.com','ANT101','Cultural Anthropology',3,'lower','https://study.com',199.00,array['ELECTIVES']),
    ('Sophia','REL101','World Religions',3,'lower','https://www.sophia.org',149.00,array['ELECTIVES']),
    -- University Courses (for Residency + UL requirements)
    ('University','CAP-499','Capstone Seminar',6,'upper',null,1800.00,array['CAPSTONE','MAJOR-CAP','UNIV']),
    ('University','BUS401','Strategic Management',3,'upper',null,1200.00,array['MAJOR-CORE','UNIV']),
    ('University','BUS402','Organizational Behavior',3,'upper',null,1200.00,array['MAJOR-CORE','UNIV']),
    ('University','BUS403','Operations Management',3,'upper',null,1200.00,array['MAJOR-CORE','UNIV']),
    ('University','BUS404','Business Analytics',3,'upper',null,1200.00,array['MAJOR-CORE','UNIV']),
    ('University','MKT301','Marketing Strategy',3,'upper',null,1200.00,array['MAJOR-CORE','UNIV']),
    ('University','FIN301','Corporate Finance',3,'upper',null,1200.00,array['MAJOR-CORE','UNIV']),
    ('University','MGT301','Leadership and Ethics',3,'upper',null,1200.00,array['MAJOR-CORE','UNIV']),
    ('University','ACC301','Managerial Accounting',3,'upper',null,1200.00,array['MAJOR-CORE','UNIV']),
    ('University','ECO301','Macroeconomics',3,'upper',null,1200.00,array['ELECTIVES','UNIV']);
  else
    select id into v_tmpl_id from degree_templates where degree_name='BA Liberal Studies (Demo)';
  end if;

  -- Add demo student if missing
  if not exists (select 1 from users where email='demo@student.lumiere.college') then
    insert into users (name, email) values ('Demo Student', 'demo@student.lumiere.college') returning id into v_user_id;
  else
    select id into v_user_id from users where email='demo@student.lumiere.college';
  end if;

  -- Create empty roadmap plan for that student (use table-qualified column names to avoid ambiguity)
  if not exists (select 1 from roadmap_plans rp where rp.user_id=v_user_id and rp.template_id=v_tmpl_id) then
    insert into roadmap_plans (user_id, template_id, status, total_remaining_credits, est_cost, est_months, version)
    values (v_user_id, v_tmpl_id, 'draft', 120, 0, 0, 1) returning id into v_plan_id;
  end if;

end $$;

select 'OK: All tables, degree template, and demo student initialized.' as status;
