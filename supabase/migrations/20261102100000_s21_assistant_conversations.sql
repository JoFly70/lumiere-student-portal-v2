/*
# S21 - Durable, tamper-evident Lumiere Guide conversations

Tables: assistant_conversations, assistant_messages (append-only, SHA-256 hash chain),
assistant_message_attachments, assistant_audit_events, assistant_integrity_checkpoints.

* owner_user_id is the auth user id (text, same representation as users.id); no FK so the
  tables work whether users.id is uuid or varchar, and so audit rows can outlive a user.
* assistant_messages is append-only: UPDATE of anything except `status` and DELETE are rejected by
  triggers. The only deletion path is assistant_purge_owner(owner, reason) (retention/erasure),
  executable by the table-owner role only, which writes a content-free tombstone audit event.
* A BEFORE INSERT trigger enforces seq = previous seq + 1 and prev_hash = previous hash, so the
  chain cannot be forked through the normal write path. Hashes themselves are computed by the
  application (see server/services/assistant-conversations/integrity.ts).
* Honest limit: a database superuser / table owner can disable triggers and rewrite rows AND the
  checkpoints table. The out-of-database anchor is the structured log line
  `assistant_integrity_checkpoint` plus backups. See docs/recovery/s21/conversations.md.
* The FK to student_documents(id) is created only when that table exists (its id type differs between
  lineages); attachment ownership is always enforced in the application transaction as well.
* Additive and idempotent. RLS enabled; the server uses the owner role (bypasses RLS).
*/

CREATE TABLE IF NOT EXISTS assistant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  title text NOT NULL DEFAULT 'New conversation' CHECK (char_length(title) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  client_request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_conversations_owner_request_uidx
  ON assistant_conversations (owner_user_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS assistant_conversations_owner_activity_idx
  ON assistant_conversations (owner_user_id, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL,
  seq integer NOT NULL CHECK (seq >= 1),
  role text NOT NULL CHECK (role IN ('student', 'assistant', 'system')),
  author_user_id text,
  content text NOT NULL,
  language text NOT NULL CHECK (language IN ('en', 'fr')),
  mode text CHECK (mode IN ('local', 'live')),
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  links jsonb NOT NULL DEFAULT '[]'::jsonb,
  private_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  notice text,
  client_request_id text,
  reply_to_message_id uuid REFERENCES assistant_messages(id),
  status text NOT NULL DEFAULT 'complete',
  prev_hash text NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, content)) STORED,
  CONSTRAINT assistant_messages_conv_seq_uniq UNIQUE (conversation_id, seq),
  CONSTRAINT assistant_messages_reply_uniq UNIQUE (reply_to_message_id),
  CONSTRAINT assistant_messages_author_chk CHECK (
    (role = 'student' AND author_user_id IS NOT NULL) OR (role <> 'student')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS assistant_messages_student_request_uidx
  ON assistant_messages (conversation_id, client_request_id) WHERE role = 'student' AND client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS assistant_messages_owner_idx ON assistant_messages (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assistant_messages_search_gin ON assistant_messages USING GIN (search_vector);

-- document_id type follows student_documents.id when that table exists (text in some lineages, uuid in others).
DO $$
DECLARE doc_type text;
BEGIN
  IF to_regclass('public.assistant_message_attachments') IS NULL THEN
    SELECT format_type(a.atttypid, a.atttypmod) INTO doc_type
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.student_documents') AND a.attname = 'id' AND NOT a.attisdropped;
    IF doc_type IS NULL THEN doc_type := 'text'; END IF;
    EXECUTE format($f$
      CREATE TABLE assistant_message_attachments (
        message_id uuid NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
        document_id %s NOT NULL %s,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT assistant_message_attachments_pair_uniq UNIQUE (message_id, document_id)
      )$f$, doc_type,
      CASE WHEN to_regclass('public.student_documents') IS NOT NULL
           THEN 'REFERENCES student_documents(id)' ELSE '' END);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS assistant_message_attachments_doc_idx ON assistant_message_attachments (document_id);

-- Audit events keep no FK to conversations/messages so tombstones survive a purge. No message content.
CREATE TABLE IF NOT EXISTS assistant_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  actor_user_id text,
  conversation_id uuid,
  message_id uuid,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_audit_events_owner_idx ON assistant_audit_events (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assistant_audit_events_conv_idx ON assistant_audit_events (conversation_id);

CREATE TABLE IF NOT EXISTS assistant_integrity_checkpoints (
  conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, seq)
);

-- ---------------------------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assistant_purge_active() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('lumiere.assistant_purge', true), '') = 'on' $$;

CREATE OR REPLACE FUNCTION assistant_messages_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last_row record; conv_owner text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF assistant_purge_active() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'assistant_messages is append-only: DELETE rejected' USING ERRCODE = 'integrity_constraint_violation';
  ELSIF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'status' - 'search_vector') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'search_vector') THEN
      RAISE EXCEPTION 'assistant_messages is append-only: only status may change' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- INSERT: structural chain checks (hash value itself is verified by the application verifier).
  SELECT owner_user_id INTO conv_owner FROM assistant_conversations WHERE id = NEW.conversation_id;
  IF conv_owner IS NULL OR conv_owner <> NEW.owner_user_id THEN
    RAISE EXCEPTION 'assistant_messages owner must equal conversation owner' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.role = 'student' AND NEW.author_user_id IS DISTINCT FROM NEW.owner_user_id THEN
    RAISE EXCEPTION 'student message author must be the conversation owner' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.role = 'assistant' AND NEW.author_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'assistant message must have no author' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT seq, hash INTO last_row FROM assistant_messages WHERE conversation_id = NEW.conversation_id ORDER BY seq DESC LIMIT 1;
  IF NEW.seq <> coalesce(last_row.seq, 0) + 1
     OR NEW.prev_hash <> coalesce(last_row.hash, repeat('0', 64)) THEN
    RAISE EXCEPTION 'assistant_messages chain violation (seq/prev_hash)' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS assistant_messages_guard_trg ON assistant_messages;
CREATE TRIGGER assistant_messages_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON assistant_messages
  FOR EACH ROW EXECUTE FUNCTION assistant_messages_guard();

-- Generic immutability for attachments, audit events and checkpoints.
CREATE OR REPLACE FUNCTION assistant_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF assistant_purge_active() AND TG_OP IN ('DELETE', 'TRUNCATE') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NULL;
  END IF;
  RAISE EXCEPTION '% is append-only: % rejected', TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE OR REPLACE FUNCTION assistant_conversations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF assistant_purge_active() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'assistant_conversations cannot be deleted; archive instead' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.owner_user_id <> OLD.owner_user_id OR NEW.created_at <> OLD.created_at
     OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id THEN
    RAISE EXCEPTION 'assistant_conversations: id/owner/created_at/client_request_id are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assistant_conversations_guard_trg ON assistant_conversations;
CREATE TRIGGER assistant_conversations_guard_trg BEFORE UPDATE OR DELETE ON assistant_conversations
  FOR EACH ROW EXECUTE FUNCTION assistant_conversations_guard();

DROP TRIGGER IF EXISTS assistant_attachments_guard_trg ON assistant_message_attachments;
CREATE TRIGGER assistant_attachments_guard_trg BEFORE UPDATE OR DELETE ON assistant_message_attachments
  FOR EACH ROW EXECUTE FUNCTION assistant_immutable_guard();
DROP TRIGGER IF EXISTS assistant_audit_guard_trg ON assistant_audit_events;
CREATE TRIGGER assistant_audit_guard_trg BEFORE UPDATE OR DELETE ON assistant_audit_events
  FOR EACH ROW EXECUTE FUNCTION assistant_immutable_guard();
DROP TRIGGER IF EXISTS assistant_checkpoints_guard_trg ON assistant_integrity_checkpoints;
CREATE TRIGGER assistant_checkpoints_guard_trg BEFORE UPDATE OR DELETE ON assistant_integrity_checkpoints
  FOR EACH ROW EXECUTE FUNCTION assistant_immutable_guard();

DROP TRIGGER IF EXISTS assistant_messages_truncate_trg ON assistant_messages;
CREATE TRIGGER assistant_messages_truncate_trg BEFORE TRUNCATE ON assistant_messages
  FOR EACH STATEMENT EXECUTE FUNCTION assistant_immutable_guard();
DROP TRIGGER IF EXISTS assistant_audit_truncate_trg ON assistant_audit_events;
CREATE TRIGGER assistant_audit_truncate_trg BEFORE TRUNCATE ON assistant_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION assistant_immutable_guard();

-- ---------------------------------------------------------------------------------------------
-- Explicit, audited retention purge (owner role only). Leaves a tombstone with counts and the
-- reason, never message content or titles.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assistant_purge_owner(p_owner text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE n_conv integer; n_msg integer;
BEGIN
  IF p_owner IS NULL OR btrim(p_owner) = '' THEN RAISE EXCEPTION 'owner required'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason required'; END IF;
  PERFORM set_config('lumiere.assistant_purge', 'on', true);
  SELECT count(*) INTO n_msg FROM assistant_messages WHERE owner_user_id = p_owner;
  SELECT count(*) INTO n_conv FROM assistant_conversations WHERE owner_user_id = p_owner;
  DELETE FROM assistant_audit_events WHERE owner_user_id = p_owner;
  DELETE FROM assistant_conversations WHERE owner_user_id = p_owner;  -- cascades messages, attachments, checkpoints
  INSERT INTO assistant_audit_events (owner_user_id, actor_user_id, event_type, details)
  VALUES (p_owner, NULL, 'owner_purged',
          jsonb_build_object('reason', p_reason, 'conversations', n_conv, 'messages', n_msg, 'purged_at', now()));
  PERFORM set_config('lumiere.assistant_purge', 'off', true);
  RETURN jsonb_build_object('conversations', n_conv, 'messages', n_msg);
END $$;

REVOKE ALL ON FUNCTION assistant_purge_owner(text, text) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION assistant_purge_owner(text, text) FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- RLS: students may read only their own rows through PostgREST; all writes go through the server.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_integrity_checkpoints ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    DROP POLICY IF EXISTS assistant_conversations_owner_read ON assistant_conversations;
    CREATE POLICY assistant_conversations_owner_read ON assistant_conversations
      FOR SELECT TO authenticated USING (owner_user_id = auth.uid()::text);
    DROP POLICY IF EXISTS assistant_messages_owner_read ON assistant_messages;
    CREATE POLICY assistant_messages_owner_read ON assistant_messages
      FOR SELECT TO authenticated USING (owner_user_id = auth.uid()::text);
  END IF;
END $$;
