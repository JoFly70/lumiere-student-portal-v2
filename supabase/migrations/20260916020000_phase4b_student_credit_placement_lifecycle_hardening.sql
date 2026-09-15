/*
  Phase 4B forward hardening — terminal placement lifecycle updates.

  Terminal audit fields and terminal statuses are immutable after their
  lifecycle transition. The deferred graph validator remains responsible for
  reciprocal and cycle validation, including the two-step supersession flow.
*/

CREATE OR REPLACE FUNCTION student_cp_guard_terminal_updates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- A terminal row can only receive the reciprocal child link completion.
  IF OLD.status IN ('revoked', 'superseded')
     AND NEW.status IS DISTINCT FROM OLD.status
  THEN
    RAISE EXCEPTION 'terminal student credit placement status is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'revoked'
     AND (
       OLD.revoked_by IS DISTINCT FROM NEW.revoked_by
       OR OLD.revoked_at IS DISTINCT FROM NEW.revoked_at
       OR OLD.revocation_rationale IS DISTINCT FROM NEW.revocation_rationale
     )
  THEN
    RAISE EXCEPTION 'revoked student credit placement audit is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'superseded'
     AND (
       OLD.superseded_by IS DISTINCT FROM NEW.superseded_by
       OR OLD.superseded_at IS DISTINCT FROM NEW.superseded_at
       OR OLD.supersede_rationale IS DISTINCT FROM NEW.supersede_rationale
     )
  THEN
    RAISE EXCEPTION 'superseded student credit placement audit is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The intended second supersession step is NULL -> non-null only.
  IF OLD.superseded_by_placement_id IS NOT NULL
     AND NEW.superseded_by_placement_id IS DISTINCT FROM OLD.superseded_by_placement_id
  THEN
    RAISE EXCEPTION 'student credit placement reciprocal child link is immutable once populated'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS student_cp_guard_terminal_updates ON student_credit_placements;
CREATE TRIGGER student_cp_guard_terminal_updates
  BEFORE UPDATE ON student_credit_placements
  FOR EACH ROW EXECUTE FUNCTION student_cp_guard_terminal_updates();