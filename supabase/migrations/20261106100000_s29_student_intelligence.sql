/*
  S29: Student Intelligence & Operations. Additive and idempotent (IF NOT EXISTS everywhere), no destructive change,
  no change to any existing table or row.

  Tables (server-side access only, like S27: RLS enabled with NO client policy, every client privilege revoked):
    s29_settings                    key/value configuration (concierge thresholds)
    s29_notification_preferences    per-user notification preferences (email per category, quiet hours, zone)
    s29_attention_items             persisted rules-engine exceptions (first detection, dismiss/resolve trail)
    s29_notifications               notification outbox AND in-portal inbox (one row per notification)
    s29_jobs                        durable scheduler state (lease, last success, failures)
    s29_incidents                   bounded operational incidents (fingerprint + counts; no payloads)

  The Academic Calendar and Academic Imports are owned by S30 (its own migration); S29 is the operational layer the
  calendar plugs into (notification outbox, Concierge, scheduler, diagnostics) through S30's calendar operations port.

  Audit: the new audit event types are added first. No BEGIN/COMMIT (a new enum value cannot be used in the
  transaction that adds it).
*/

ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 's29.attention_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 's29.settings_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 's29.preferences_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 's29.calendar_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 's29.fleet_query';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 's29.diagnostic_run';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 's29.incident_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 's29.notification_retried';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 's29.access_denied';

CREATE TABLE IF NOT EXISTS s29_settings (
  key text PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 64),
  value jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS s29_notification_preferences (
  user_id text PRIMARY KEY,
  prefs jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS s29_attention_items (
  key text PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 300),
  kind text NOT NULL CHECK (char_length(kind) <= 40),
  workflow text NOT NULL CHECK (char_length(workflow) <= 20),
  priority text NOT NULL CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'resolved')),
  student_id text REFERENCES students(id) ON DELETE CASCADE,
  is_demo boolean NOT NULL DEFAULT false,
  title text NOT NULL CHECK (char_length(title) <= 200),
  detail text NOT NULL CHECK (char_length(detail) <= 400),
  reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint text NOT NULL CHECK (char_length(fingerprint) <= 128),
  action text NOT NULL CHECK (char_length(action) <= 40),
  href text NOT NULL CHECK (char_length(href) <= 300),
  arisen_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  snoozed_until timestamptz,
  resolved_at timestamptz,
  resolved_by text,
  resolution text CHECK (resolution IS NULL OR char_length(resolution) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS s29_attention_status_idx ON s29_attention_items(status, priority);
CREATE INDEX IF NOT EXISTS s29_attention_student_idx ON s29_attention_items(student_id);
CREATE INDEX IF NOT EXISTS s29_attention_resolved_idx ON s29_attention_items(resolved_at DESC) WHERE status <> 'open';

CREATE TABLE IF NOT EXISTS s29_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 300),
  audience text NOT NULL CHECK (audience IN ('student', 'staff')),
  recipient_user_id text,
  student_id text REFERENCES students(id) ON DELETE CASCADE,
  is_demo boolean NOT NULL DEFAULT false,
  category text NOT NULL CHECK (category IN ('support', 'documents', 'roadmap', 'progress', 'billing', 'appointments', 'operations')),
  template text NOT NULL CHECK (char_length(template) <= 60),
  source text NOT NULL CHECK (char_length(source) <= 40),
  language text NOT NULL DEFAULT 'fr' CHECK (language IN ('en', 'fr')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  title text NOT NULL CHECK (char_length(title) <= 200),
  body text NOT NULL CHECK (char_length(body) <= 2000),
  href text CHECK (href IS NULL OR char_length(href) <= 300),
  is_reminder boolean NOT NULL DEFAULT false,
  email_state text NOT NULL DEFAULT 'queued' CHECK (email_state IN ('queued', 'attempted', 'accepted', 'failed', 'not_configured', 'suppressed', 'in_app_only')),
  suppressed_reason text CHECK (suppressed_reason IS NULL OR char_length(suppressed_reason) <= 60),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  next_attempt_at timestamptz,
  lease_until timestamptz,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 120),
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT s29_notifications_dedupe_unique UNIQUE (dedupe_key)
);
CREATE INDEX IF NOT EXISTS s29_notifications_inbox_idx ON s29_notifications(recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS s29_notifications_due_idx ON s29_notifications(next_attempt_at) WHERE email_state IN ('queued', 'attempted');
CREATE INDEX IF NOT EXISTS s29_notifications_student_idx ON s29_notifications(student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS s29_jobs (
  name text PRIMARY KEY CHECK (char_length(name) <= 40),
  interval_seconds integer NOT NULL CHECK (interval_seconds BETWEEN 30 AND 86400),
  lease_owner text,
  lease_until timestamptz,
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 200),
  last_duration_ms integer,
  last_result jsonb,
  runs bigint NOT NULL DEFAULT 0,
  failures bigint NOT NULL DEFAULT 0,
  consecutive_failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS s29_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL CHECK (char_length(fingerprint) BETWEEN 1 AND 160),
  subsystem text NOT NULL CHECK (char_length(subsystem) <= 40),
  category text NOT NULL CHECK (char_length(category) <= 60),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrences integer NOT NULL DEFAULT 1,
  last_request_id text CHECK (last_request_id IS NULL OR char_length(last_request_id) <= 80),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  likely_cause text CHECK (likely_cause IS NULL OR char_length(likely_cause) <= 300),
  next_action text CHECK (next_action IS NULL OR char_length(next_action) <= 300),
  acknowledged_by text,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  alerted_at timestamptz,
  CONSTRAINT s29_incidents_fingerprint_unique UNIQUE (fingerprint)
);
CREATE INDEX IF NOT EXISTS s29_incidents_last_seen_idx ON s29_incidents(last_seen_at DESC);

DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['s29_settings', 's29_notification_preferences', 's29_attention_items', 's29_notifications', 's29_jobs',
                           's29_incidents'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END
$$;
