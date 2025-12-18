-- Migration 006: Complete Audit Logging for Student Profile Tables
-- Adds audit triggers for student_contacts, student_english_proof, and student_documents
--
-- NOTE: These triggers are defensive and handle NULL actor_id gracefully.
-- The application layer (server/lib/audit.ts) provides explicit audit logging
-- with actor attribution. Database triggers serve as a backup/safety net.
--
-- In Supabase serverless environment, session variables (SET LOCAL) don't work
-- reliably across connections, so we use explicit application-layer audit writes
-- instead of relying on app.current_user_id session variable.

-- Trigger: Audit log for student contacts changes
create or replace function audit_student_contacts_changes()
returns trigger as $$
declare
  v_actor_id uuid;
begin
  -- Get actor_id from session variable, use NULL if not set
  -- The application layer should set this via SET LOCAL in transactions
  v_actor_id := nullif(current_setting('app.current_user_id', true), '')::uuid;
  
  -- Log warning if actor_id is missing (indicates middleware/service bug)
  if v_actor_id is null then
    raise warning 'Audit trigger: app.current_user_id not set for % operation on student_contacts', TG_OP;
  end if;
  
  if TG_OP = 'INSERT' then
    insert into audit_log (student_id, actor_id, action, entity_type, entity_id, new_value)
    values (new.student_id, v_actor_id, 'created', 'contact', new.id, to_jsonb(new));
  elsif TG_OP = 'UPDATE' then
    insert into audit_log (student_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (new.student_id, v_actor_id, 'updated', 'contact', new.id, to_jsonb(old), to_jsonb(new));
  elsif TG_OP = 'DELETE' then
    insert into audit_log (student_id, actor_id, action, entity_type, entity_id, old_value)
    values (old.student_id, v_actor_id, 'deleted', 'contact', old.id, to_jsonb(old));
  end if;
  
  if TG_OP = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$ language plpgsql;

create trigger trg_audit_student_contacts_changes
  after insert or update or delete on student_contacts
  for each row
  execute function audit_student_contacts_changes();

-- Trigger: Audit log for English proof changes
create or replace function audit_english_proof_changes()
returns trigger as $$
declare
  v_actor_id uuid;
begin
  -- Get actor_id from session variable, use NULL if not set
  v_actor_id := nullif(current_setting('app.current_user_id', true), '')::uuid;
  
  -- Log warning if actor_id is missing
  if v_actor_id is null then
    raise warning 'Audit trigger: app.current_user_id not set for % operation on student_english_proof', TG_OP;
  end if;
  
  if TG_OP = 'INSERT' then
    insert into audit_log (student_id, actor_id, action, entity_type, entity_id, new_value)
    values (new.student_id, v_actor_id, 'created', 'english_proof', new.id, to_jsonb(new));
  elsif TG_OP = 'UPDATE' then
    insert into audit_log (student_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (new.student_id, v_actor_id, 'updated', 'english_proof', new.id, to_jsonb(old), to_jsonb(new));
  elsif TG_OP = 'DELETE' then
    insert into audit_log (student_id, actor_id, action, entity_type, entity_id, old_value)
    values (old.student_id, v_actor_id, 'deleted', 'english_proof', old.id, to_jsonb(old));
  end if;
  
  if TG_OP = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$ language plpgsql;

create trigger trg_audit_english_proof_changes
  after insert or update or delete on student_english_proof
  for each row
  execute function audit_english_proof_changes();

-- Trigger: Audit log for document changes
create or replace function audit_document_changes()
returns trigger as $$
declare
  v_actor_id uuid;
begin
  -- Get actor_id from session variable, use NULL if not set
  v_actor_id := nullif(current_setting('app.current_user_id', true), '')::uuid;
  
  -- Log warning if actor_id is missing
  if v_actor_id is null then
    raise warning 'Audit trigger: app.current_user_id not set for % operation on student_documents', TG_OP;
  end if;
  
  if TG_OP = 'INSERT' then
    insert into audit_log (student_id, actor_id, action, entity_type, entity_id, new_value)
    values (new.student_id, v_actor_id, 'created', 'document', new.id, to_jsonb(new));
  elsif TG_OP = 'UPDATE' then
    insert into audit_log (student_id, actor_id, action, entity_type, entity_id, old_value, new_value, metadata)
    values (
      new.student_id, 
      v_actor_id, 
      case 
        when new.status = 'verified' and old.status != 'verified' then 'verified'
        when new.status = 'rejected' and old.status != 'rejected' then 'rejected'
        when new.status = 'resubmit_requested' and old.status != 'resubmit_requested' then 'resubmit_requested'
        else 'updated'
      end,
      'document', 
      new.id, 
      to_jsonb(old), 
      to_jsonb(new),
      jsonb_build_object(
        'doc_type', new.doc_type,
        'status_changed', old.status != new.status,
        'old_status', old.status,
        'new_status', new.status
      )
    );
  elsif TG_OP = 'DELETE' then
    insert into audit_log (student_id, actor_id, action, entity_type, entity_id, old_value)
    values (old.student_id, v_actor_id, 'deleted', 'document', old.id, to_jsonb(old));
  end if;
  
  if TG_OP = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$ language plpgsql;

create trigger trg_audit_document_changes
  after insert or update or delete on student_documents
  for each row
  execute function audit_document_changes();

select 'OK: Audit triggers added for student_contacts, student_english_proof, and student_documents.' as status;
