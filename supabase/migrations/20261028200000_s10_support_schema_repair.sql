/*
# S10 - Support schema repair (idempotent, fix-forward)

1. Purpose
   The legacy production lineage (PRODUCTION_DATABASE_SETUP.sql) creates
   support_tickets and ticket_comments but NOT ticket_attachments or
   ticket_status_history, which the S08 support API reads and writes. Without
   them attachments return 503 and status history is silently empty.
   This migration creates them only when absent and leaves any existing
   (e.g. migrations/010) table, row and policy untouched.

2. Tables (CREATE TABLE IF NOT EXISTS; definitions match migrations/010, which
   is what any already-existing production table was created from)
   - public.ticket_attachments
   - public.ticket_status_history

3. Security (private by default, same convention as the S03 remediation)
   - Row Level Security enabled on both tables.
   - No client policies are created. anon and authenticated lose every table
     privilege; service_role (the server) keeps full access. Storage objects
     stay in a private bucket and are reached only via server-issued signed URLs.
   - Note: if migrations/010 was applied earlier its policies still exist but
     are inert once the privileges are revoked; this migration does not drop them.

4. Legacy trigger fix (fix forward, history is not rewritten)
   migrations/010 installs track_ticket_status_change(), which inserts
   COALESCE(current_setting('app.current_user_id', true), 'system') into
   ticket_status_history.changed_by, a NOT NULL foreign key to users(id).
   Nothing sets app.current_user_id, so every status change on a database
   that has this trigger fails with a foreign key violation and the whole
   UPDATE on support_tickets is rolled back. If (and only if) the function
   already exists it is replaced by a version that records a row only when the
   setting names an existing user, and otherwise does nothing (the S08 API
   records history itself with the real actor). The trigger is never created
   here.

5. Idempotency
   Every statement is IF NOT EXISTS, CREATE OR REPLACE, or a no-op re-grant.
   Safe to run any number of times and on top of a database that already has
   the tables.

6. Prerequisites (fail loudly if missing)
   public.users(id text), public.support_tickets, public.ticket_comments and
   the ticket_status enum, all created by PRODUCTION_DATABASE_SETUP.sql.
*/

CREATE TABLE IF NOT EXISTS public.ticket_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES public.ticket_comments(id) ON DELETE CASCADE,

  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,

  uploaded_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  CONSTRAINT valid_file_size CHECK (file_size > 0 AND file_size <= 10485760),
  CONSTRAINT valid_file_name CHECK (LENGTH(file_name) > 0 AND LENGTH(file_name) <= 255)
);

CREATE TABLE IF NOT EXISTS public.ticket_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,

  old_status public.ticket_status,
  new_status public.ticket_status NOT NULL,
  changed_by TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  change_reason TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket ON public.ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_attachments_storage_path ON public.ticket_attachments(storage_path);
CREATE INDEX IF NOT EXISTS idx_ticket_status_history_ticket ON public.ticket_status_history(ticket_id, created_at DESC);

ALTER TABLE public.ticket_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_status_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ticket_attachments FROM anon, authenticated;
REVOKE ALL ON public.ticket_status_history FROM anon, authenticated;
GRANT ALL ON public.ticket_attachments TO service_role;
GRANT ALL ON public.ticket_status_history TO service_role;

COMMENT ON TABLE public.ticket_attachments IS 'File attachments for support tickets (server-only access; objects in a private bucket)';
COMMENT ON TABLE public.ticket_status_history IS 'Audit trail for support ticket status changes (server-only access)';

-- Fix-forward for the legacy 010 trigger function, only where it already exists.
DO $fix$
BEGIN
  IF to_regprocedure('public.track_ticket_status_change()') IS NOT NULL THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.track_ticket_status_change()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SET search_path = public, pg_temp
      AS $fn$
      DECLARE
        actor TEXT;
      BEGIN
        IF OLD.status IS DISTINCT FROM NEW.status THEN
          actor := NULLIF(current_setting('app.current_user_id', true), '');
          IF actor IS NOT NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = actor) THEN
            INSERT INTO public.ticket_status_history (ticket_id, old_status, new_status, changed_by)
            VALUES (NEW.id, OLD.status, NEW.status, actor);
          END IF;
        END IF;
        RETURN NEW;
      END;
      $fn$
    $body$;
    REVOKE EXECUTE ON FUNCTION public.track_ticket_status_change() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.track_ticket_status_change() TO service_role;
  END IF;
END
$fix$;
