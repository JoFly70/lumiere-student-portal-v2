-- Quick Setup for Lumiere Student Portal
-- Copy this entire file and paste into Supabase SQL Editor
-- https://supabase.com/dashboard/project/_/sql/new

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  timezone TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create providers table
CREATE TABLE IF NOT EXISTS providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

-- Create requirements table
CREATE TABLE IF NOT EXISTS requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
CREATE INDEX IF NOT EXISTS requirements_program_id_idx ON requirements(program_id);

-- Create plans table
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES programs(id),
  catalog_year INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS plans_user_id_idx ON plans(user_id);

-- Success message
SELECT 'Tables created successfully! ✅' as message;
