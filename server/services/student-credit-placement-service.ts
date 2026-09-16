/**
 * Phase 4B Student Credit Placement — invariant enforcement.
 *
 * A placement records a fact about a credit decision. This service never
 * computes an academic result and never infers a requirement outcome.
 */

import { db } from "../lib/db";
import {
  duplicateError,
  invalidStateError,
  notFoundError,
  provenanceMismatchError,
  validationError,
} from "../lib/student-academic-errors";
import type { StudentCreditPlacement } from "@shared/student-credit-placement-schema";
import {
  studentCreditPlacementRepository,
  type StudentCreditPlacementRepository,
  type StudentCreditPlacementTx,
} from "../repositories/student-credit-placement-repo";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CreatePlacementInput {
  studentCreditDecisionId: string;
  programAssignmentId: string;
  requirementId: string;
  academicRuleId?: string | null;
  actor: string;
  rationale: string;
  metadata?: JsonValue;
  provenance?: JsonValue;
}

export interface SupersedePlacementInput {
  oldPlacementId: string;
  requirementId: string;
  academicRuleId?: string | null;
  actor: string;
  rationale: string;
  metadata?: JsonValue;
  provenance?: JsonValue;
  studentCreditDecisionId?: string;
  programAssignmentId?: string;
}

export interface RevokePlacementInput {
  placementId: string;
  actor: string;
  rationale: string;
}

export interface AssertPlacementContextInput {
  placementId: string;
  studentId: string;
  programAssignmentId: string;
  programVersionId: string;
}

export interface StudentCreditPlacementMutationOptions {
  readonly beforeWrite?: (tx: StudentCreditPlacementTx) => Promise<void>;
}

export interface StudentCreditPlacementService {
  assertPlacementContext(input: AssertPlacementContextInput): Promise<StudentCreditPlacement>;
  createPlacement(
    input: CreatePlacementInput,
    options?: StudentCreditPlacementMutationOptions,
  ): Promise<StudentCreditPlacement>;
  supersedePlacement(
    input: SupersedePlacementInput,
    options?: StudentCreditPlacementMutationOptions,
  ): Promise<{
    oldPlacement: StudentCreditPlacement;
    newPlacement: StudentCreditPlacement;
  }>;
  revokePlacement(
    input: RevokePlacementInput,
    options?: StudentCreditPlacementMutationOptions,
  ): Promise<StudentCreditPlacement>;
}

type TransactionRunner = <T>(
  fn: (tx: StudentCreditPlacementTx) => Promise<T>,
) => Promise<T>;

function defaultTransactionRunner<T>(
  fn: (tx: StudentCreditPlacementTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => fn(tx));
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw validationError(`${field} must be a nonblank string`, { field });
  }
  return value;
}

function isJsonSafe(value: unknown, seen = new Set<unknown>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isJsonSafe(item, seen));
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.entries(value).every(([key, item]) =>
    typeof key === "string" && isJsonSafe(item, seen),
  );
}

function safeJson(value: JsonValue | undefined, field: string): Record<string, unknown> {
  const result = value ?? {};
  if (!isJsonSafe(result) || Array.isArray(result) || typeof result !== "object" || result === null) {
    throw validationError(`${field} must be a JSON object containing only JSON-safe values`, { field });
  }
  return result as Record<string, unknown>;
}

function uniqueConstraint(error: unknown): string | null {
  const candidate = error as { code?: unknown; constraint?: unknown; message?: unknown } | null;
  if (candidate?.code !== "23505") return null;
  if (typeof candidate.constraint === "string") return candidate.constraint;
  const match = typeof candidate.message === "string"
    ? candidate.message.match(/student_cp_[a-z0-9_]+/)
    : null;
  return match?.[0] ?? null;
}

function isActiveIdentityViolation(error: unknown): boolean {
  return uniqueConstraint(error) === "student_cp_active_identity_unique_idx";
}

function isSupersessionViolation(error: unknown): boolean {
  return uniqueConstraint(error) === "student_cp_supersedes_unique_idx";
}

export function createStudentCreditPlacementService(
  repository: StudentCreditPlacementRepository = studentCreditPlacementRepository,
  transactionRunner: TransactionRunner = defaultTransactionRunner,
): StudentCreditPlacementService {
  async function lockPlacementIdentity(
    decisionId: string,
    assignmentId: string,
    tx: StudentCreditPlacementTx,
  ): Promise<string> {
    // Decision writes serialize on the credit-record row. A placement must
    // first lock/read the selected decision to discover that immutable row,
    // then join the same credit-record lock domain before taking the assignment
    // lock. This avoids inverting recordCreditDecision's credit-record-first
    // order while retaining the existing decision and assignment locks.
    await repository.lockDecisionRow(decisionId, tx);
    const initialDecision = await repository.getDecisionContext(decisionId, tx);
    if (!initialDecision) {
      throw notFoundError("Student credit decision not found", {
        studentCreditDecisionId: decisionId,
      });
    }
    const creditRecordId = requireText(
      initialDecision.creditRecord.id,
      "creditRecordId",
    );
    await repository.lockCreditRecordRow(creditRecordId, tx);
    await repository.lockAssignmentRow(assignmentId, tx);
    return creditRecordId;
  }

  async function assertPlacementContext(
    input: AssertPlacementContextInput,
  ): Promise<StudentCreditPlacement> {
    const placementId = requireText(input.placementId, "placementId");
    const studentId = requireText(input.studentId, "studentId");
    const programAssignmentId = requireText(input.programAssignmentId, "programAssignmentId");
    const programVersionId = requireText(input.programVersionId, "programVersionId");
    const placement = await repository.getPlacement(placementId);
    if (!placement) {
      throw notFoundError("Student credit placement not found", { placementId });
    }
    if (placement.programAssignmentId !== programAssignmentId) {
      throw provenanceMismatchError(
        "Student credit placement does not belong to the active program assignment",
        { placementId, programAssignmentId },
      );
    }
    const assignmentContext = await repository.getAssignmentContext(
      placement.programAssignmentId,
    );
    if (!assignmentContext) {
      throw notFoundError("Program assignment not found", {
        programAssignmentId: placement.programAssignmentId,
      });
    }
    if (
      assignmentContext.assignment.studentId !== studentId
      || assignmentContext.assignment.programVersionId !== programVersionId
    ) {
      throw provenanceMismatchError(
        "Student credit placement does not belong to the resolved degree progress context",
        { placementId, studentId, programAssignmentId, programVersionId },
      );
    }
    return placement;
  }

  async function validateIdentity(
    input: {
      studentCreditDecisionId: string;
      programAssignmentId: string;
      requirementId: string;
      academicRuleId?: string | null;
      actor: string;
      rationale: string;
      metadata?: JsonValue;
      provenance?: JsonValue;
    },
    tx: StudentCreditPlacementTx,
    lockedCreditRecordId: string,
  ): Promise<{ metadata: Record<string, unknown>; provenance: Record<string, unknown> }> {
    const decisionId = requireText(input.studentCreditDecisionId, "studentCreditDecisionId");
    const assignmentId = requireText(input.programAssignmentId, "programAssignmentId");
    const requirementId = requireText(input.requirementId, "requirementId");
    requireText(input.actor, "actor");
    requireText(input.rationale, "rationale");

    const decisionContext = await repository.getDecisionContext(decisionId, tx);
    if (!decisionContext) throw notFoundError("Student credit decision not found", { studentCreditDecisionId: decisionId });
    if (decisionContext.creditRecord.id !== lockedCreditRecordId) {
      throw provenanceMismatchError(
        "Student credit decision changed credit-record identity during placement",
        { studentCreditDecisionId: decisionId },
      );
    }
    const assignmentContext = await repository.getAssignmentContext(assignmentId, tx);
    if (!assignmentContext) throw notFoundError("Program assignment not found", { programAssignmentId: assignmentId });
    if (assignmentContext.assignment.status !== "active") {
      throw invalidStateError("Program assignment must be active for placement", {
        programAssignmentId: assignmentId,
        status: assignmentContext.assignment.status,
      });
    }

    if (decisionContext.decision.programAssignmentId !== assignmentId) {
      throw provenanceMismatchError(
        "Student credit decision does not belong to the program assignment",
        {
          decisionAssignmentId: decisionContext.decision.programAssignmentId,
          programAssignmentId: assignmentId,
        },
      );
    }
    if (decisionContext.creditRecord.studentId !== assignmentContext.assignment.studentId) {
      throw provenanceMismatchError(
        "Credit record and program assignment belong to different students",
        {
          creditRecordStudentId: decisionContext.creditRecord.studentId,
          assignmentStudentId: assignmentContext.assignment.studentId,
        },
      );
    }

    const latestDecision = await repository.getLatestDecision(
      lockedCreditRecordId,
      assignmentId,
      tx,
    );
    if (
      !latestDecision
      || latestDecision.id !== decisionId
      || latestDecision.action !== "accepted"
    ) {
      throw invalidStateError(
        "Placement requires the current accepted credit decision",
        {
          studentCreditDecisionId: decisionId,
          latestDecisionId: latestDecision?.id ?? null,
          latestDecisionAction: latestDecision?.action ?? null,
        },
      );
    }

    const requirementContext = await repository.getRequirementContext(requirementId, tx);
    if (!requirementContext) throw notFoundError("Requirement not found", { requirementId });
    if (requirementContext.requirement.active !== true) {
      throw invalidStateError("Requirement must be active for placement", {
        requirementId,
        active: requirementContext.requirement.active,
      });
    }
    const requirementProgramVersionId =
      requirementContext.requirement.programVersionId
      ?? requirementContext.programVersion?.id;
    if (requirementProgramVersionId !== assignmentContext.assignment.programVersionId) {
      throw provenanceMismatchError(
        "Requirement does not belong to the assigned program version",
        {
          requirementProgramVersionId,
          assignmentProgramVersionId: assignmentContext.assignment.programVersionId,
        },
      );
    }

    if (input.academicRuleId != null) {
      const ruleId = requireText(input.academicRuleId, "academicRuleId");
      const ruleContext = await repository.getAcademicRuleContext(ruleId, tx);
      if (!ruleContext) throw notFoundError("Academic rule not found", { academicRuleId: ruleId });
      const ruleProgramVersionId = ruleContext.rule.programVersionId;
      if (ruleProgramVersionId == null) {
        throw provenanceMismatchError(
          "Academic rule must belong to a program version for a placement",
          { academicRuleId: ruleId },
        );
      }
      if (ruleProgramVersionId !== assignmentContext.assignment.programVersionId) {
        throw provenanceMismatchError(
          "Academic rule does not belong to the assigned program version",
          {
            ruleProgramVersionId,
            assignmentProgramVersionId: assignmentContext.assignment.programVersionId,
          },
        );
      }
    }

    return {
      metadata: safeJson(input.metadata, "metadata"),
      provenance: safeJson(input.provenance, "provenance"),
    };
  }

  async function createPlacement(
    input: CreatePlacementInput,
    options: StudentCreditPlacementMutationOptions = {},
  ): Promise<StudentCreditPlacement> {
    return transactionRunner(async (tx) => {
      const decisionId = requireText(input.studentCreditDecisionId, "studentCreditDecisionId");
      const assignmentId = requireText(input.programAssignmentId, "programAssignmentId");
      const requirementId = requireText(input.requirementId, "requirementId");

      const creditRecordId = await lockPlacementIdentity(
        decisionId,
        assignmentId,
        tx,
      );
      // Lock order: decision -> credit record -> assignment -> requirement.
      await repository.lockRequirementRow(requirementId, tx);
      await options.beforeWrite?.(tx);
      const values = await validateIdentity(input, tx, creditRecordId);
      const existing = await repository.getActiveExactPlacement({
        studentCreditDecisionId: decisionId,
        programAssignmentId: assignmentId,
        requirementId,
        academicRuleId: input.academicRuleId ?? null,
      }, tx);
      if (existing) {
        throw duplicateError("An active placement with this decision identity already exists", {
          placementId: existing.id,
        });
      }

      try {
        return await repository.insertPlacement({
          studentCreditDecisionId: decisionId,
          programAssignmentId: assignmentId,
          requirementId,
          academicRuleId: input.academicRuleId ?? null,
          actor: input.actor,
          rationale: input.rationale,
          metadata: values.metadata,
          provenance: values.provenance,
        }, tx);
      } catch (error) {
        if (isActiveIdentityViolation(error)) {
          throw duplicateError("An active placement with this decision identity already exists", {
            studentCreditDecisionId: decisionId,
            programAssignmentId: assignmentId,
            requirementId: input.requirementId,
            academicRuleId: input.academicRuleId ?? null,
          });
        }
        throw error;
      }
    });
  }

  async function supersedePlacement(
    input: SupersedePlacementInput,
    options: StudentCreditPlacementMutationOptions = {},
  ): Promise<{
    oldPlacement: StudentCreditPlacement;
    newPlacement: StudentCreditPlacement;
  }> {
    return transactionRunner(async (tx) => {
      const oldId = requireText(input.oldPlacementId, "oldPlacementId");
      requireText(input.actor, "actor");
      requireText(input.rationale, "rationale");

      await repository.lockPlacementRow(oldId, tx);
      const oldPlacement = await repository.getPlacement(oldId, tx);
      if (!oldPlacement) throw notFoundError("Student credit placement not found", { placementId: oldId });
      if (oldPlacement.status !== "active") {
        throw invalidStateError("Only an active placement can be superseded", {
          placementId: oldId,
          status: oldPlacement.status,
        });
      }

      const decisionId = input.studentCreditDecisionId ?? oldPlacement.studentCreditDecisionId;
      const assignmentId = input.programAssignmentId ?? oldPlacement.programAssignmentId;
      const requirementId = requireText(input.requirementId, "requirementId");
      if (decisionId !== oldPlacement.studentCreditDecisionId || assignmentId !== oldPlacement.programAssignmentId) {
        throw provenanceMismatchError("A replacement placement must retain the historical decision and assignment", {
          oldDecisionId: oldPlacement.studentCreditDecisionId,
          oldAssignmentId: oldPlacement.programAssignmentId,
        });
      }

      const creditRecordId = await lockPlacementIdentity(
        decisionId,
        assignmentId,
        tx,
      );
      // Lock the replacement requirement before validation or any lifecycle write.
      await repository.lockRequirementRow(requirementId, tx);
      await options.beforeWrite?.(tx);
      const values = await validateIdentity({
        ...input,
        studentCreditDecisionId: decisionId,
        programAssignmentId: assignmentId,
      }, tx, creditRecordId);
      const existing = await repository.getActiveExactPlacement({
        studentCreditDecisionId: decisionId,
        programAssignmentId: assignmentId,
        requirementId,
        academicRuleId: input.academicRuleId ?? null,
      }, tx);
      if (existing && existing.id !== oldId) {
        throw duplicateError("An active placement with this decision identity already exists", {
          placementId: existing.id,
        });
      }

      // Release the old active identity before inserting the replacement. The
      // transaction runner owns rollback, so any later failure restores it.
      const occurredAt = new Date();
      const transitionedOld = await repository.updatePlacementLifecycle(oldId, {
        status: "superseded",
        actor: input.actor,
        rationale: input.rationale,
        at: occurredAt,
      }, tx);
      if (!transitionedOld) throw notFoundError("Student credit placement disappeared during supersede", { placementId: oldId });

      let newPlacement: StudentCreditPlacement;
      try {
        newPlacement = await repository.insertPlacement({
          studentCreditDecisionId: decisionId,
          programAssignmentId: assignmentId,
          requirementId,
          academicRuleId: input.academicRuleId ?? null,
          supersedesPlacementId: oldId,
          actor: input.actor,
          rationale: input.rationale,
          metadata: values.metadata,
          provenance: values.provenance,
        }, tx);
      } catch (error) {
        if (isActiveIdentityViolation(error)) {
          throw duplicateError("An active placement with this decision identity already exists", { oldPlacementId: oldId });
        }
        if (isSupersessionViolation(error)) {
          throw duplicateError("A placement already supersedes this parent placement", { oldPlacementId: oldId });
        }
        throw error;
      }
      const updatedOld = await repository.updatePlacementLifecycle(oldId, {
        status: "superseded",
        actor: input.actor,
        rationale: input.rationale,
        at: occurredAt,
        supersededByPlacementId: newPlacement.id,
      }, tx);
      if (!updatedOld) throw notFoundError("Student credit placement disappeared during supersede", { placementId: oldId });
      return { oldPlacement: updatedOld, newPlacement };
    });
  }

  async function revokePlacement(
    input: RevokePlacementInput,
    options: StudentCreditPlacementMutationOptions = {},
  ): Promise<StudentCreditPlacement> {
    return transactionRunner(async (tx) => {
      const placementId = requireText(input.placementId, "placementId");
      requireText(input.actor, "actor");
      requireText(input.rationale, "rationale");
      await repository.lockPlacementRow(placementId, tx);
      const placement = await repository.getPlacement(placementId, tx);
      if (!placement) throw notFoundError("Student credit placement not found", { placementId });
      if (placement.status !== "active") {
        throw invalidStateError("Only an active placement can be revoked", {
          placementId,
          status: placement.status,
        });
      }
      await repository.lockAssignmentRow(placement.programAssignmentId, tx);
      const assignmentContext = await repository.getAssignmentContext(
        placement.programAssignmentId,
        tx,
      );
      if (!assignmentContext) {
        throw notFoundError("Program assignment not found", {
          programAssignmentId: placement.programAssignmentId,
        });
      }
      if (assignmentContext.assignment.status !== "active") {
        throw invalidStateError(
          "Program assignment must be active to revoke a placement",
          {
            programAssignmentId: placement.programAssignmentId,
            status: assignmentContext.assignment.status,
          },
        );
      }
      await options.beforeWrite?.(tx);
      const occurredAt = new Date();
      const updated = await repository.updatePlacementLifecycle(placementId, {
        status: "revoked",
        actor: input.actor,
        rationale: input.rationale,
        at: occurredAt,
      }, tx);
      if (!updated) throw notFoundError("Student credit placement disappeared during revoke", { placementId });
      return updated;
    });
  }

  return {
    assertPlacementContext,
    createPlacement,
    supersedePlacement,
    revokePlacement,
  };
}

export const createStudentCreditPlacementServiceWithDefaults =
  () => createStudentCreditPlacementService();