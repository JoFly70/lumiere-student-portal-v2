/*
  S07: roadmap audit event types

  audit_logs.event_type is the public.audit_event_type enum, so the roadmap
  events emitted by server/routes/roadmap-audit.ts must exist in it or the
  (non-blocking) audit insert is rejected and only logged.

  ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent and additive.
*/
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'roadmap.import_created';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'roadmap.import_replayed';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'roadmap.draft_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'roadmap.exceptions_acknowledged';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'roadmap.draft_discarded';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'roadmap.draft_opened_from_published';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'roadmap.published';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'roadmap.publish_rejected';
