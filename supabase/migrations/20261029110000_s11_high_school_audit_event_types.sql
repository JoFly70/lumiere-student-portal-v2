/*
  S11: high school pathway audit event types

  audit_logs.event_type is the public.audit_event_type enum, so the events
  emitted by server/routes/high-school-audit.ts must exist in it or the
  (non-blocking) audit insert is rejected and only logged.

  Kept in its own file, like S07/S08: ALTER TYPE ... ADD VALUE cannot be used
  in the transaction that adds it, so this file only adds.
*/
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'high_school.enrollment_created';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'high_school.enrollment_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'high_school.prior_education_recorded';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'high_school.transfer_claim_changed';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'high_school.roadmap_draft_saved';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'high_school.roadmap_published';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'high_school.progress_reported';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'high_school.official_result_recorded';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'high_school.credit_awarded';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'high_school.credit_voided';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'high_school.graduation_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'high_school.guardian_note_added';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'high_school.access_denied';
