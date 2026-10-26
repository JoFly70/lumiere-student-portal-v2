/*
# S12 — Graduate programs audit events

1. Purpose
   Adds graduate-programme event types (ENEB programmes and the
   Unimarconi-linked university route) to the existing public.audit_event_type
   enum so graduate activity is recorded with meaningful audit history.

2. New enum values
   graduate.offering_created, graduate.rule_set_created,
   graduate.program_enrolled, graduate.program_updated,
   graduate.subject_created, graduate.result_recorded,
   graduate.student_progress_reported, graduate.record_created,
   graduate.record_updated, graduate.record_verified,
   graduate.record_rejected, graduate.official_change_blocked,
   graduate.credit_recorded, graduate.access_denied,
   graduate.evaluation_recorded, graduate.evaluation_updated,
   graduate.evaluation_verified

3. Compatibility
   - Each ADD VALUE is guarded with IF NOT EXISTS (safe to re-run).
   - No table, function, policy or grant changes.
   - New values cannot be used inside the same transaction that adds them;
     this migration only adds them.
*/

ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.offering_created';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.rule_set_created';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.program_enrolled';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.program_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.subject_created';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.result_recorded';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.student_progress_reported';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.record_created';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.record_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.record_verified';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.record_rejected';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.official_change_blocked';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.credit_recorded';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.access_denied';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.evaluation_recorded';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.evaluation_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'graduate.evaluation_verified';
