/*
# S08 — Support Center audit events

1. Purpose
   Adds ticket-specific event types to the existing public.audit_event_type
   enum so support activity is recorded with meaningful audit history instead
   of reusing system.maintenance_mode / admin.bulk_operation.

2. New enum values
   support.ticket_created, support.ticket_updated, support.status_changed,
   support.assignment_changed, support.priority_changed,
   support.comment_added, support.internal_note_added,
   support.attachment_added, support.attachment_downloaded,
   support.access_denied

3. Compatibility
   - Each ADD VALUE is guarded with IF NOT EXISTS (safe to re-run).
   - No table, function, policy or grant changes: create_audit_log() and the
     audit_logs table take the enum type directly, and neither the phase 2D
     migration nor its hardening migration whitelists event types elsewhere.
   - New values cannot be used inside the same transaction that adds them;
     this migration only adds them.
*/

ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'support.ticket_created';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'support.ticket_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'support.status_changed';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'support.assignment_changed';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'support.priority_changed';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'support.comment_added';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'support.internal_note_added';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'support.attachment_added';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'support.attachment_downloaded';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'support.access_denied';
