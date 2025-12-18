-- =====================================
-- Financial & Timeline Integration
-- =====================================

-- Financial rules (global constants)
create table if not exists financial_rules (
  id uuid primary key default gen_random_uuid(),
  total_projection numeric(10,2) not null default 15000,
  lumiere_fee numeric(10,2) not null default 7000,
  umpi_session_cost numeric(10,2) not null default 1800,
  baseline_sessions int not null default 2,
  card_fee_pct numeric(5,2) not null default 3.00,
  ach_fee_pct numeric(5,2) not null default 0.00,
  wire_fee_flat numeric(10,2) not null default 25.00,
  created_at timestamptz not null default now()
);

-- Premium exam catalog
create table if not exists exam_catalog (
  id uuid primary key default gen_random_uuid(),
  exam_code text not null unique,
  provider text not null,
  title text not null,
  credits int not null,
  exam_cost numeric(10,2) not null,
  replaces_provider text default 'Sophia',
  notes text default ''
);

-- Duration multipliers
create table if not exists duration_rules (
  id uuid primary key default gen_random_uuid(),
  months int unique not null,
  cost_multiplier numeric(5,2) not null,
  description text default '',
  created_at timestamptz not null default now()
);

-- Per-plan financial calculations
create table if not exists plan_financials (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null unique,
  pace_months int not null,
  sessions_actual int not null,
  phase1_cost numeric(10,2) not null,
  exam_selected boolean not null default false,
  exam_code text,
  exam_credits int default 0,
  exam_cost numeric(10,2) default 0,
  replaced_provider_cost numeric(10,2) default 0,
  projected_total numeric(10,2) not null,
  over_15k boolean not null default false,
  overage_reasons text[] default '{}',
  payment_method text not null default 'card',
  monthly_payment numeric(10,2) not null,
  upfront_due numeric(10,2) not null,
  start_date date not null default current_date,
  completion_target date,
  monthly_schedule jsonb default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Seed financial rules
insert into financial_rules (id, total_projection, lumiere_fee, umpi_session_cost, baseline_sessions)
values (gen_random_uuid(), 15000, 7000, 1800, 2)
on conflict do nothing;

-- Seed duration multipliers (faster completion costs more due to compressed timeline)
insert into duration_rules (months, cost_multiplier, description)
values
  (6, 1.50, 'Fast-track 6-month path'),
  (9, 1.20, 'Accelerated 9-month path'),
  (12, 1.00, 'Standard 12-month path'),
  (15, 0.90, 'Extended 15-month path'),
  (18, 0.80, 'Extended 18-month path')
on conflict (months) do nothing;

-- Seed premium exam catalog (examples)
insert into exam_catalog (exam_code, provider, title, credits, exam_cost, replaces_provider, notes)
values
  ('ACTFL-OPI', 'ACTFL', 'ACTFL Oral Proficiency Interview', 6, 350, 'Sophia', 'Spanish/French oral exam'),
  ('NYU-12CR', 'NYU', 'NYU Language Exam (12 credits)', 12, 600, 'Sophia', 'Spanish/French written + oral'),
  ('CLEP-SPAN', 'CLEP', 'CLEP Spanish Language (Level 2)', 12, 95, 'Sophia', 'Spanish CLEP exam')
on conflict (exam_code) do nothing;

-- Indexes
create index if not exists idx_plan_financials_plan on plan_financials(plan_id);

select 'OK: Financial and timeline tables created successfully.' as status;
