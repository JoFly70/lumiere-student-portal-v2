/*
  Phase 4B — Canonical Student Credit Placement

  A placement is a recorded fact connecting a credit decision to a requirement.
  It does not calculate, infer, or persist an academic result. This migration is
  additive and idempotent; it is source only and must be applied separately.
*/

DO $$ BEGIN
  CREATE TYPE student_credit_placement_status AS ENUM ('active', 'revoked', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS student_credit_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_credit_decision_id uuid NOT NULL REFERENCES student_credit_decisions(id) ON DELETE RESTRICT,
  program_assignment_id uuid NOT NULL REFERENCES student_program_assignments(id) ON DELETE RESTRICT,
  requirement_id uuid NOT NULL REFERENCES knowledge_requirements_v2(id) ON DELETE RESTRICT,
  academic_rule_id uuid REFERENCES knowledge_academic_rules(id) ON DELETE RESTRICT,
  status student_credit_placement_status NOT NULL DEFAULT 'active',
  supersedes_placement_id uuid REFERENCES student_credit_placements(id) ON DELETE RESTRICT,
  superseded_by_placement_id uuid REFERENCES student_credit_placements(id) ON DELETE RESTRICT,
  actor text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rationale text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  revoked_by text REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revocation_rationale text,
  superseded_by text REFERENCES users(id) ON DELETE SET NULL,
  superseded_at timestamptz,
  supersede_rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_cp_no_self_supersession
    CHECK (supersedes_placement_id IS NULL OR supersedes_placement_id <> id),
  CONSTRAINT student_cp_no_zero_academic_rule
    CHECK (
      academic_rule_id IS NULL
      OR academic_rule_id <> '00000000-0000-0000-0000-000000000000'::uuid
    )
);

CREATE INDEX IF NOT EXISTS student_cp_decision_idx
  ON student_credit_placements(student_credit_decision_id);
CREATE INDEX IF NOT EXISTS student_cp_assignment_idx
  ON student_credit_placements(program_assignment_id);
CREATE INDEX IF NOT EXISTS student_cp_requirement_idx
  ON student_credit_placements(requirement_id);
CREATE INDEX IF NOT EXISTS student_cp_rule_idx
  ON student_credit_placements(academic_rule_id);
CREATE INDEX IF NOT EXISTS student_cp_status_idx
  ON student_credit_placements(status);
CREATE INDEX IF NOT EXISTS student_cp_supersedes_idx
  ON student_credit_placements(supersedes_placement_id);
CREATE INDEX IF NOT EXISTS student_cp_superseded_by_idx
  ON student_credit_placements(superseded_by_placement_id);

-- The reserved zero UUID makes NULL rule identities equal without a
-- version-specific null-equality index feature.
CREATE UNIQUE INDEX IF NOT EXISTS student_cp_active_identity_unique_idx
  ON student_credit_placements(
    student_credit_decision_id,
    program_assignment_id,
    requirement_id,
    coalesce(academic_rule_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS student_cp_supersedes_unique_idx
  ON student_credit_placements(supersedes_placement_id)
  WHERE supersedes_placement_id IS NOT NULL;

-- Validate every cross-entity binding at the database boundary. The joined
-- read is followed by share locks so a concurrent canonical-row change
-- cannot invalidate the facts being recorded.
CREATE OR REPLACE FUNCTION student_cp_cross_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  decision_assignment uuid;
  credit_student text;
  assignment_student text;
  assignment_program_version uuid;
  requirement_program_version uuid;
  rule_exists boolean;
  rule_program_version uuid;
BEGIN
  PERFORM d.id
    FROM student_credit_decisions d
   WHERE d.id = NEW.student_credit_decision_id
   FOR SHARE;
  PERFORM cr.id
    FROM student_credit_records cr
    JOIN student_credit_decisions d ON d.credit_record_id = cr.id
   WHERE d.id = NEW.student_credit_decision_id
   FOR SHARE;
  PERFORM pa.id
    FROM student_program_assignments pa
   WHERE pa.id = NEW.program_assignment_id
   FOR SHARE;
  PERFORM req.id
    FROM knowledge_requirements_v2 req
   WHERE req.id = NEW.requirement_id
   FOR SHARE;
  IF NEW.academic_rule_id IS NOT NULL THEN
    PERFORM ar.id
      FROM knowledge_academic_rules ar
     WHERE ar.id = NEW.academic_rule_id
      FOR SHARE;
  END IF;

  SELECT d.program_assignment_id,
         cr.student_id,
         pa.student_id,
         pa.program_version_id,
         req.program_version_id,
         (ar.id IS NOT NULL),
         ar.program_version_id
    INTO decision_assignment,
         credit_student,
         assignment_student,
         assignment_program_version,
         requirement_program_version,
         rule_exists,
         rule_program_version
    FROM student_credit_decisions d
    JOIN student_credit_records cr ON cr.id = d.credit_record_id
    JOIN student_program_assignments pa ON pa.id = NEW.program_assignment_id
    JOIN knowledge_requirements_v2 req ON req.id = NEW.requirement_id
    LEFT JOIN knowledge_academic_rules ar ON ar.id = NEW.academic_rule_id
   WHERE d.id = NEW.student_credit_decision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'student credit placement canonical binding is missing'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF decision_assignment IS DISTINCT FROM NEW.program_assignment_id THEN
    RAISE EXCEPTION 'student credit placement decision assignment mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
  IF credit_student IS DISTINCT FROM assignment_student THEN
    RAISE EXCEPTION 'student credit placement student mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
  IF requirement_program_version IS DISTINCT FROM assignment_program_version THEN
    RAISE EXCEPTION 'student credit placement requirement program mismatch'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.academic_rule_id IS NOT NULL
     AND (NOT rule_exists OR rule_program_version IS NULL
          OR rule_program_version IS DISTINCT FROM assignment_program_version)
  THEN
    RAISE EXCEPTION 'student credit placement academic rule program mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS student_cp_cross_binding_insert ON student_credit_placements;
CREATE TRIGGER student_cp_cross_binding_insert
  BEFORE INSERT ON student_credit_placements
  FOR EACH ROW EXECUTE FUNCTION student_cp_cross_binding_guard();

-- Immediate checks cover self-links and coherent lifecycle audit fields.
CREATE OR REPLACE FUNCTION student_cp_guard_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.supersedes_placement_id IS NOT NULL
     AND NEW.supersedes_placement_id = NEW.id
  THEN
    RAISE EXCEPTION 'student credit placement self-link is not allowed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'active'
     AND (NEW.revoked_by IS NOT NULL OR NEW.revoked_at IS NOT NULL
          OR NEW.revocation_rationale IS NOT NULL
          OR NEW.superseded_by IS NOT NULL OR NEW.superseded_at IS NOT NULL
          OR NEW.supersede_rationale IS NOT NULL
          OR NEW.superseded_by_placement_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'active placement cannot have lifecycle audit fields'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'revoked'
     AND (NEW.revoked_by IS NULL OR btrim(NEW.revoked_by) = ''
          OR NEW.revoked_at IS NULL OR NEW.revocation_rationale IS NULL
          OR btrim(NEW.revocation_rationale) = ''
          OR NEW.superseded_by IS NOT NULL OR NEW.superseded_at IS NOT NULL
          OR NEW.supersede_rationale IS NOT NULL
          OR NEW.superseded_by_placement_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'revoked placement has incoherent lifecycle audit fields'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS student_cp_guard_lifecycle ON student_credit_placements;
CREATE TRIGGER student_cp_guard_lifecycle
  BEFORE INSERT OR UPDATE ON student_credit_placements
  FOR EACH ROW EXECUTE FUNCTION student_cp_guard_lifecycle();

-- Final reciprocal, one-child, and cycle checks are deferred so a service can
-- transition the parent, insert the child, then set the reciprocal parent link
-- atomically. The partial unique index enforces one child per parent.
CREATE OR REPLACE FUNCTION student_cp_validate_lifecycle_graph()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_status student_credit_placement_status;
  current_supersedes uuid;
  current_superseded_by_placement_id uuid;
  current_superseded_by_actor text;
  current_decision uuid;
  current_assignment uuid;
  current_superseded_at timestamptz;
  current_supersede_rationale text;
  current_revoked_by text;
  current_revoked_at timestamptz;
  current_revocation_rationale text;
  parent_id uuid;
  parent_status student_credit_placement_status;
  parent_child uuid;
  parent_decision uuid;
  parent_assignment uuid;
  child_supersedes uuid;
  child_status student_credit_placement_status;
  current_id uuid;
  visited uuid[] := ARRAY[NEW.id];
BEGIN
  -- Deferred events may contain an intermediate tuple (the parent status
  -- transition precedes the child insert), so validate the committed row.
  SELECT p.status, p.supersedes_placement_id, p.superseded_by_placement_id,
         p.superseded_by, p.student_credit_decision_id, p.program_assignment_id,
         p.superseded_at, p.supersede_rationale,
         p.revoked_by, p.revoked_at, p.revocation_rationale
    INTO current_status, current_supersedes, current_superseded_by_placement_id,
         current_superseded_by_actor, current_decision, current_assignment,
         current_superseded_at,
         current_supersede_rationale, current_revoked_by,
         current_revoked_at, current_revocation_rationale
    FROM student_credit_placements p
   WHERE p.id = NEW.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student credit placement disappeared before lifecycle validation'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_status = 'superseded'
     AND (current_superseded_by_placement_id IS NULL
          OR current_superseded_by_actor IS NULL
          OR btrim(current_superseded_by_actor) = ''
          OR current_superseded_at IS NULL
          OR current_supersede_rationale IS NULL
          OR btrim(current_supersede_rationale) = ''
          OR current_revoked_by IS NOT NULL
          OR current_revoked_at IS NOT NULL
          OR current_revocation_rationale IS NOT NULL)
  THEN
    RAISE EXCEPTION 'superseded placement requires reciprocal lifecycle audit'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_supersedes IS NOT NULL THEN
    parent_id := current_supersedes;
    SELECT p.status, p.superseded_by_placement_id,
           p.student_credit_decision_id, p.program_assignment_id
      INTO parent_status, parent_child, parent_decision, parent_assignment
      FROM student_credit_placements p
     WHERE p.id = parent_id;
    IF NOT FOUND OR parent_status <> 'superseded'
       OR parent_child IS DISTINCT FROM NEW.id
       OR parent_decision IS DISTINCT FROM current_decision
       OR parent_assignment IS DISTINCT FROM current_assignment
       OR current_status NOT IN ('active', 'revoked', 'superseded')
    THEN
      RAISE EXCEPTION 'supersession reciprocal or historical binding mismatch'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF current_superseded_by_placement_id IS NOT NULL THEN
    SELECT c.supersedes_placement_id, c.status
      INTO child_supersedes, child_status
      FROM student_credit_placements c
     WHERE c.id = current_superseded_by_placement_id;
    IF NOT FOUND OR child_supersedes IS DISTINCT FROM NEW.id
       OR child_status NOT IN ('active', 'revoked', 'superseded')
    THEN
      RAISE EXCEPTION 'superseded-by reciprocal link mismatch'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF current_status = 'revoked'
     AND (current_revoked_by IS NULL OR btrim(current_revoked_by) = ''
          OR current_revoked_at IS NULL
          OR current_revocation_rationale IS NULL
          OR btrim(current_revocation_rationale) = '')
  THEN
    RAISE EXCEPTION 'revoked placement requires complete lifecycle audit'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Walk the self-link chain; encountering a visited id rejects a cycle.
  current_id := current_supersedes;
  WHILE current_id IS NOT NULL LOOP
    IF current_id = ANY(visited) THEN
      RAISE EXCEPTION 'student credit placement cycle is not allowed'
        USING ERRCODE = 'check_violation';
    END IF;
    visited := array_append(visited, current_id);
    SELECT p.supersedes_placement_id
      INTO current_id
      FROM student_credit_placements p
     WHERE p.id = current_id;
    EXIT WHEN NOT FOUND;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS student_cp_lifecycle_integrity ON student_credit_placements;
CREATE CONSTRAINT TRIGGER student_cp_lifecycle_integrity
  AFTER INSERT OR UPDATE ON student_credit_placements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION student_cp_validate_lifecycle_graph();

-- Placement identity and provenance are immutable historical facts. Only the
-- status and lifecycle audit columns may change after insertion.
CREATE OR REPLACE FUNCTION student_cp_guard_immutable_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.student_credit_decision_id IS DISTINCT FROM OLD.student_credit_decision_id
     OR NEW.program_assignment_id IS DISTINCT FROM OLD.program_assignment_id
     OR NEW.requirement_id IS DISTINCT FROM OLD.requirement_id
     OR NEW.academic_rule_id IS DISTINCT FROM OLD.academic_rule_id
     OR NEW.supersedes_placement_id IS DISTINCT FROM OLD.supersedes_placement_id
     OR NEW.actor IS DISTINCT FROM OLD.actor
     OR NEW.rationale IS DISTINCT FROM OLD.rationale
     OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW.provenance IS DISTINCT FROM OLD.provenance
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'student credit placement identity and provenance are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS student_cp_immutable_history ON student_credit_placements;
CREATE TRIGGER student_cp_immutable_history
  BEFORE UPDATE ON student_credit_placements
  FOR EACH ROW EXECUTE FUNCTION student_cp_guard_immutable_history();

ALTER TABLE student_credit_placements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_cp_staff_admin_select" ON student_credit_placements;
CREATE POLICY "student_cp_staff_admin_select" ON student_credit_placements
  FOR SELECT TO authenticated
  USING (
    is_staff_or_admin()
    OR EXISTS (
      SELECT 1
      FROM student_credit_decisions d
      JOIN student_credit_records cr ON cr.id = d.credit_record_id
      WHERE d.id = student_credit_placements.student_credit_decision_id
        AND student_owns_record(cr.student_id)
    )
  );

DROP POLICY IF EXISTS "student_cp_staff_admin_insert" ON student_credit_placements;
CREATE POLICY "student_cp_staff_admin_insert" ON student_credit_placements
  FOR INSERT TO authenticated
  WITH CHECK (is_staff_or_admin());

DROP POLICY IF EXISTS "student_cp_staff_admin_update" ON student_credit_placements;
CREATE POLICY "student_cp_staff_admin_update" ON student_credit_placements
  FOR UPDATE TO authenticated
  USING (is_staff_or_admin())
  WITH CHECK (is_staff_or_admin());