/*
# S25 - Portal language preference (server-side)

The EN/FR choice was stored only in the browser (localStorage), so it did not follow the student to another
device and staff could not see it. One row per auth user id (text, same representation as users.id; no FK, like
student_welcome_state). Holds only the language code. Additive and idempotent. RLS enabled; the server uses the
owner role, and a signed-in user may only read their own row.
*/

CREATE TABLE IF NOT EXISTS user_language_preference (
  user_id text PRIMARY KEY,
  language text NOT NULL CHECK (language IN ('en', 'fr')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_language_preference ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON user_language_preference FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON user_language_preference FROM authenticated;
    DROP POLICY IF EXISTS user_language_preference_owner_read ON user_language_preference;
    CREATE POLICY user_language_preference_owner_read ON user_language_preference
      FOR SELECT TO authenticated USING (user_id = auth.uid()::text);
  END IF;
END $$;
