/*
  # Two-Factor Authentication Support

  1. Schema Changes
    - Add 2FA columns to users table
      - `two_factor_enabled` (boolean) - Whether 2FA is active
      - `two_factor_secret` (text) - TOTP secret (base32 encoded)
      - `two_factor_secret_temp` (text) - Temporary secret during setup
      - `two_factor_backup_codes` (jsonb) - Hashed backup recovery codes

  2. Security
    - Secrets are encrypted at rest by Supabase
    - Backup codes are hashed using SHA-256
    - Only admin, coach, and staff can enable 2FA
    - Password required to disable 2FA

  3. Notes
    - This migration is safe to run multiple times
    - Existing users will have 2FA disabled by default
    - Backup codes are one-time use
*/

-- Add 2FA columns to users table if they don't exist
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'two_factor_enabled'
  ) THEN
    ALTER TABLE users ADD COLUMN two_factor_enabled BOOLEAN DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'two_factor_secret'
  ) THEN
    ALTER TABLE users ADD COLUMN two_factor_secret TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'two_factor_secret_temp'
  ) THEN
    ALTER TABLE users ADD COLUMN two_factor_secret_temp TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'two_factor_backup_codes'
  ) THEN
    ALTER TABLE users ADD COLUMN two_factor_backup_codes JSONB;
  END IF;
END $$;

-- Add index for faster 2FA lookups
CREATE INDEX IF NOT EXISTS idx_users_two_factor_enabled
  ON users(two_factor_enabled)
  WHERE two_factor_enabled = true;

-- Add comment for documentation
COMMENT ON COLUMN users.two_factor_enabled IS 'Whether two-factor authentication is enabled for this user';
COMMENT ON COLUMN users.two_factor_secret IS 'TOTP secret (base32 encoded) for 2FA - encrypted at rest';
COMMENT ON COLUMN users.two_factor_secret_temp IS 'Temporary TOTP secret during 2FA setup - deleted after verification';
COMMENT ON COLUMN users.two_factor_backup_codes IS 'Array of SHA-256 hashed backup recovery codes for 2FA';
