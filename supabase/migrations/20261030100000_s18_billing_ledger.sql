/*
# S18 — Billing ledger (staff-entered, read-only for students)

Additive and idempotent. NOT a payment gateway: no card, token or processor
data is stored anywhere. Amounts are integer minor units (cents) with an ISO
currency on the obligation.

  student_billing_obligations   agreed program price (one row per student)
  student_billing_discounts     approved discounts (reason + approver)
  student_billing_installments  schedule that ALLOCATES the obligation (never extra debt)
  student_billing_receipts      staff-confirmed money received (the only thing that counts as paid)
  student_billing_evidence      student-submitted proof (document id) awaiting staff review; never counts as paid

FK type mapping (as S05/S11): students.id = text, users.id = varchar -> text.
Writes go through the server (owner / service-role connection). RLS is enabled
with SELECT for staff/admin only and NO student policies at all: students read
their own billing through the server projection (GET /api/student/billing).
There are no INSERT/UPDATE/DELETE policies for anyone.

Receipts are never updated or deleted by the application; a correction is a
staff decision outside this slice (see docs/recovery/s18-evidence).
*/

CREATE OR REPLACE FUNCTION is_staff_or_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid()::text AND role IN ('staff', 'admin'));
$$;

CREATE TABLE IF NOT EXISTS student_billing_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL UNIQUE REFERENCES students(id) ON DELETE RESTRICT,
  agreed_cents bigint NOT NULL CHECK (agreed_cents > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  note text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_billing_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_billing_discounts_student_idx ON student_billing_discounts(student_id);

CREATE TABLE IF NOT EXISTS student_billing_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  due_date date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  label text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_billing_installments_student_idx ON student_billing_installments(student_id, due_date);

CREATE TABLE IF NOT EXISTS student_billing_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  document_id text NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_review' CHECK (status IN ('awaiting_review', 'confirmed', 'rejected')),
  note text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  reviewed_by text,
  reviewed_at timestamptz,
  reject_reason text,
  receipt_id uuid,
  CHECK (status = 'awaiting_review' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS student_billing_evidence_student_idx ON student_billing_evidence(student_id, submitted_at);

CREATE TABLE IF NOT EXISTS student_billing_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  received_date date NOT NULL,
  method_label text NOT NULL CHECK (length(btrim(method_label)) > 0),
  reference text,
  note text,
  evidence_id uuid REFERENCES student_billing_evidence(id) ON DELETE RESTRICT,
  confirmed_by text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_billing_receipts_student_idx ON student_billing_receipts(student_id, received_date);

ALTER TABLE student_billing_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_billing_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_billing_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_billing_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_billing_receipts ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'student_billing_obligations', 'student_billing_discounts', 'student_billing_installments',
    'student_billing_evidence', 'student_billing_receipts'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (is_staff_or_admin())', t || '_select', t);
  END LOOP;
END $$;
