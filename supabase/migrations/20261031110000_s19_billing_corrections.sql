/*
# S19 — Billing corrections (void receipt / remove discount) and double-confirm guard

Additive and idempotent. Nothing is deleted: a void keeps the row and records who, when and why.
Voided rows are excluded from every total by the application (voided_at IS NULL = active).
Apply BEFORE deploying the S19 code (the ledger read selects the new columns).
*/
ALTER TABLE student_billing_receipts
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by text,
  ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE student_billing_discounts
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by text,
  ADD COLUMN IF NOT EXISTS void_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_billing_receipts_void_consistent') THEN
    ALTER TABLE student_billing_receipts ADD CONSTRAINT student_billing_receipts_void_consistent
      CHECK ((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
          OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(btrim(void_reason)) > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_billing_discounts_void_consistent') THEN
    ALTER TABLE student_billing_discounts ADD CONSTRAINT student_billing_discounts_void_consistent
      CHECK ((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
          OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(btrim(void_reason)) > 0));
  END IF;
END $$;

-- One evidence item can back at most one receipt (confirm-twice can never double count).
CREATE UNIQUE INDEX IF NOT EXISTS student_billing_receipts_evidence_uniq
  ON student_billing_receipts(evidence_id) WHERE evidence_id IS NOT NULL;

-- Audit event types for the corrections (as S18: audit_logs.event_type is an enum).
DO $$
BEGIN
  IF to_regtype('public.audit_event_type') IS NOT NULL THEN
    ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'billing.receipt_voided';
    ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'billing.discount_voided';
    ALTER TYPE public.audit_event_type ADD VALUE IF NOT EXISTS 'billing.installment_updated';
  END IF;
END $$;
