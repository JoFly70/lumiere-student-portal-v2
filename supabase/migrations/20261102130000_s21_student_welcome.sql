/*
# S21 - Personalized welcome: server-side first-visit state

No existing field can tell a first-ever login from a returning one: audit_logs never receives
'auth.login.success' (sign-in happens in Supabase Auth, not in this server), and public.users /
public.profiles carry only created_at. So the first authenticated welcome request is recorded here.

* One row per auth user id (text, same representation as users.id; no FK so it never blocks user removal).
* first_seen_at is written once; welcomed_at is set when the student has actually been shown the welcome.
* Existing student accounts are backfilled as already welcomed, so nobody who has used the portal
  before is greeted as brand new.
* Holds no names, no content, no counts. Additive and idempotent. RLS enabled; the server uses the owner role.
*/

CREATE TABLE IF NOT EXISTS student_welcome_state (
  user_id text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  welcomed_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE student_welcome_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    DROP POLICY IF EXISTS student_welcome_state_owner_read ON student_welcome_state;
    CREATE POLICY student_welcome_state_owner_read ON student_welcome_state
      FOR SELECT TO authenticated USING (user_id = auth.uid()::text);
  END IF;
END $$;

-- Backfill: every student account that already exists counts as welcomed (returning).
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    INSERT INTO student_welcome_state (user_id, first_seen_at, welcomed_at, last_seen_at)
    SELECT u.id::text, now(), now(), now() FROM public.users u WHERE u.role::text = 'student'
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END $$;
