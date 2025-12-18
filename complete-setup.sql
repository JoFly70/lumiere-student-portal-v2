-- Lumiere Student Portal - Complete Database Setup
-- This creates all tables needed for the application
-- Safe to run multiple times (uses IF NOT EXISTS)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Programs table (degree programs like BLS)
CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  catalog_year INTEGER NOT NULL,
  residency_required INTEGER NOT NULL DEFAULT 30,
  ul_required INTEGER NOT NULL DEFAULT 24,
  total_required INTEGER NOT NULL DEFAULT 120,
  rules JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users table (student, coach, admin accounts)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Profiles table (extended user information)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  timezone TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Providers table (Sophia, Study.com, ACE, UMPI)
CREATE TABLE IF NOT EXISTS providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

-- Requirements table (distribution buckets per program)
CREATE TABLE IF NOT EXISTS requirements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  area TEXT NOT NULL,
  min_credits INTEGER NOT NULL,
  max_credits INTEGER,
  is_upper_level BOOLEAN NOT NULL DEFAULT FALSE,
  sequence INTEGER NOT NULL DEFAULT 0,
  meta JSONB DEFAULT '{}'
);

-- Plans table (student degree plans)
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES programs(id),
  catalog_year INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  locked_at TIMESTAMPTZ
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE INDEX IF NOT EXISTS requirements_program_id_idx ON requirements(program_id);
CREATE INDEX IF NOT EXISTS plans_user_id_idx ON plans(user_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- Public read policies (you'll customize these later)
DROP POLICY IF EXISTS "read_programs" ON programs;
CREATE POLICY "read_programs" ON programs FOR SELECT USING (true);

DROP POLICY IF EXISTS "read_providers" ON providers;
CREATE POLICY "read_providers" ON providers FOR SELECT USING (true);

DROP POLICY IF EXISTS "read_requirements" ON requirements;
CREATE POLICY "read_requirements" ON requirements FOR SELECT USING (true);

-- User can read their own data
DROP POLICY IF EXISTS "read_own_profile" ON profiles;
CREATE POLICY "read_own_profile" ON profiles FOR SELECT USING (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "read_own_plan" ON plans;
CREATE POLICY "read_own_plan" ON plans FOR SELECT USING (auth.uid()::text = user_id::text);

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Insert BLS program (safe - won't duplicate)
INSERT INTO programs (title, catalog_year, residency_required, ul_required, total_required, rules)
VALUES (
  'Bachelor of Liberal Studies',
  2024,
  30,
  24,
  120,
  '{"minResidencyCredits": 30, "minUpperLevelCredits": 24, "minTotalCredits": 120, "phase1MaxCredits": 90}'::jsonb
)
ON CONFLICT DO NOTHING;

-- Insert providers (safe - won't duplicate)
INSERT INTO providers (key, name) VALUES
  ('sophia', 'Sophia Learning'),
  ('study_com', 'Study.com'),
  ('ace', 'ACE Credit'),
  ('umpi', 'UMPI')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

SELECT 
  '✅ Database setup complete!' as status,
  (SELECT COUNT(*) FROM programs) as programs_count,
  (SELECT COUNT(*) FROM providers) as providers_count,
  (SELECT COUNT(*) FROM users) as users_count;
