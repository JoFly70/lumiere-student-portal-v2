/*
  S18: billing audit event types

  audit_logs.event_type is the public.audit_event_type enum, so the events emitted
  by server/routes/billing-audit.ts must exist in it or the (non-blocking) audit
  insert is rejected and only logged. Own file: ALTER TYPE ... ADD VALUE cannot be
  used in the transaction that adds it (as S07/S08/S11).
*/
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'billing.ledger_updated';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'billing.receipt_recorded';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'billing.evidence_reviewed';
ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'billing.access_denied';
