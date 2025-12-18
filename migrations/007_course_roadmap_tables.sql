-- Migration 007: Course Roadmap Tables
-- Extends enrollments, adds weekly_metrics, pricing_rules, snapshots_weekly

-- ============================================================================
-- 1. EXTEND ENROLLMENTS TABLE
-- ============================================================================

-- Add new enums for course source
DO $$ BEGIN
  CREATE TYPE enrollment_source_enum AS ENUM ('self', 'advisor');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add new columns to enrollments
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS course_code TEXT,
  ADD COLUMN IF NOT EXISTS course_url TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS source enrollment_source_enum DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS assigned_by VARCHAR REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS proof_url TEXT;

-- Create index for source filtering
CREATE INDEX IF NOT EXISTS idx_enrollments_source ON enrollments(source);
CREATE INDEX IF NOT EXISTS idx_enrollments_assigned_by ON enrollments(assigned_by);

-- Migrate existing proofUri to proof_url (proof_url is now the single source of truth)
UPDATE enrollments 
SET proof_url = proof_uri 
WHERE proof_uri IS NOT NULL AND (proof_url IS NULL OR proof_url = '');

-- Note: proof_uri column kept for backward compatibility but deprecated
-- All new code should use proof_url only

-- ============================================================================
-- 2. WEEKLY METRICS TABLE (for study hours tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS weekly_metrics (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_of DATE NOT NULL, -- Monday of the week
  hours_studied INTEGER NOT NULL DEFAULT 0, -- Total hours that week
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Unique constraint: one record per user per week
CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_metrics_user_week 
  ON weekly_metrics(user_id, week_of);

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_weekly_metrics_week_of 
  ON weekly_metrics(week_of);

-- ============================================================================
-- 3. PRICING RULES TABLE
-- ============================================================================

-- Create pricing model enum (idempotent)
DO $$ BEGIN
  CREATE TYPE pricing_model_enum AS ENUM ('subscription', 'per_session', 'hybrid');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS pricing_rules (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL, -- 'Sophia', 'Study.com', 'UMPI', etc.
  school TEXT, -- 'UMPI', 'Purdue', 'TESU', NULL for provider courses
  model pricing_model_enum NOT NULL,
  monthly_price INTEGER, -- in cents (e.g., 7900 = $79)
  per_session_price INTEGER, -- in cents (e.g., 140000 = $1400)
  courses_per_month INTEGER, -- for subscription model
  fee INTEGER DEFAULT 0, -- one-time or recurring fee in cents
  starts_on DATE, -- when this pricing took effect
  ends_on DATE, -- when this pricing expired (NULL = current)
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Unique constraint to prevent duplicate pricing records
-- Ensures idempotent seeding (ON CONFLICT DO NOTHING works)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_rules_unique
  ON pricing_rules(provider, COALESCE(school, ''), starts_on);

-- Index for provider lookups
CREATE INDEX IF NOT EXISTS idx_pricing_rules_provider 
  ON pricing_rules(provider);

-- Index for active pricing (ends_on IS NULL)
CREATE INDEX IF NOT EXISTS idx_pricing_rules_active 
  ON pricing_rules(provider, school) WHERE ends_on IS NULL;

-- Seed initial pricing rules (current 2024 prices)
INSERT INTO pricing_rules (provider, school, model, monthly_price, per_session_price, courses_per_month, starts_on)
VALUES 
  -- Provider subscriptions
  ('Sophia', NULL, 'subscription', 9900, NULL, 2, '2024-01-01'), -- $99/mo, 2 courses
  ('Study.com', NULL, 'subscription', 23900, NULL, 5, '2024-01-01'), -- $239/mo, up to 5 courses
  
  -- University sessions
  ('UMPI', 'UMPI', 'per_session', NULL, 140000, NULL, '2024-01-01'), -- $1400/session
  ('Purdue Global', 'Purdue', 'per_session', NULL, 250000, NULL, '2024-01-01'), -- $2500/term
  ('TESU', 'TESU', 'hybrid', NULL, 340000, NULL, '2024-01-01'), -- $3400 waiver
  
  -- Lumiere fee
  ('Lumiere', NULL, 'hybrid', NULL, NULL, NULL, '2024-01-01')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. WEEKLY SNAPSHOTS TABLE (for trend tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS snapshots_weekly (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_of DATE NOT NULL, -- Monday of the week
  
  -- Flight Deck metrics at that time
  projected_total INTEGER NOT NULL, -- in cents
  eta_months INTEGER NOT NULL,
  pace_hours INTEGER NOT NULL, -- weekly study hours
  credits_completed INTEGER NOT NULL DEFAULT 0,
  credits_in_progress INTEGER NOT NULL DEFAULT 0,
  credits_remaining INTEGER NOT NULL DEFAULT 0,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Unique constraint: one snapshot per user per week
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_user_week 
  ON snapshots_weekly(user_id, week_of);

-- Index for trend queries
CREATE INDEX IF NOT EXISTS idx_snapshots_week_of 
  ON snapshots_weekly(week_of);

-- ============================================================================
-- 5. RLS POLICIES - DEFERRED
-- ============================================================================

-- NOTE: RLS policies are deferred because this deployment uses Neon Postgres,
-- not Supabase. The auth.uid(), current_user_role(), and is_assigned_coach() 
-- helper functions don't exist in standard PostgreSQL.
--
-- Authorization is handled at the application layer via Express middleware
-- which validates JWT tokens and enforces role-based access control.
--
-- Tables created without RLS:
-- - weekly_metrics (app-level: students see own, coaches see assigned, admins see all)
-- - pricing_rules (app-level: all can read, only admins can write)
-- - snapshots_weekly (app-level: students see own, coaches see assigned, admins see all)
-- - enrollments (existing app-level policies extended for advisor assignment)
--
-- If Supabase auth is added in future, RLS policies can be restored from:
-- migrations/002_rls_policies.sql (reference implementation)

-- ============================================================================
-- 6. UPDATE TRIGGERS (idempotent)
-- ============================================================================

-- Auto-update updated_at for weekly_metrics
CREATE OR REPLACE FUNCTION update_weekly_metrics_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS weekly_metrics_updated_at ON weekly_metrics;
CREATE TRIGGER weekly_metrics_updated_at
  BEFORE UPDATE ON weekly_metrics
  FOR EACH ROW
  EXECUTE FUNCTION update_weekly_metrics_timestamp();

-- Auto-update updated_at for pricing_rules
CREATE OR REPLACE FUNCTION update_pricing_rules_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pricing_rules_updated_at ON pricing_rules;
CREATE TRIGGER pricing_rules_updated_at
  BEFORE UPDATE ON pricing_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_pricing_rules_timestamp();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE weekly_metrics IS 'Weekly study hours tracking for pace calculations';
COMMENT ON TABLE pricing_rules IS 'Provider and university pricing models for cost projections';
COMMENT ON TABLE snapshots_weekly IS 'Weekly snapshots of Flight Deck metrics for trend analysis';
COMMENT ON COLUMN enrollments.source IS 'How course was added: self-added or advisor-assigned';
COMMENT ON COLUMN enrollments.assigned_by IS 'User ID of advisor who assigned this course (if source=advisor)';
COMMENT ON COLUMN enrollments.course_code IS 'Course code from provider (e.g., SOC-1010)';
COMMENT ON COLUMN enrollments.course_url IS 'Direct link to enroll in course';
