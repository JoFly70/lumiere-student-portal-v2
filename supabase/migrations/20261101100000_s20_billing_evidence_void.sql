/*
# S20 — Voided receipts release their payment evidence

S19 made student_billing_receipts_evidence_uniq unique on evidence_id for ALL rows, voided ones
included. Voiding a receipt that came from uploaded proof therefore left the evidence stuck
(re-confirming it would violate the index). The application now returns the evidence to
'awaiting_review' on void; this migration lets a second, ACTIVE receipt reference it.

Invariant kept: one evidence item backs at most one NON-voided receipt (no double counting).
The voided receipt keeps its evidence_id (auditable history, nothing deleted).
Additive and idempotent (new index name; old index dropped only if present).
*/
CREATE UNIQUE INDEX IF NOT EXISTS student_billing_receipts_evidence_active_uniq
  ON student_billing_receipts(evidence_id) WHERE evidence_id IS NOT NULL AND voided_at IS NULL;
DROP INDEX IF EXISTS student_billing_receipts_evidence_uniq;
