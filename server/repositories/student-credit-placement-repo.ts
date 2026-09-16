/**
 * Student Credit Placement — narrow data-access contract and production queries.
 *
 * Placement rows preserve the identity and provenance of a recorded decision.
 * This repository intentionally has no academic interpretation logic.
 */

import { db } from "../lib/db";
import {
  studentCreditPlacements,
  type StudentCreditPlacement,
} from "@shared/student-credit-placement-schema";
import {
  studentCreditDecisions,
  studentCreditRecords,
  studentProgramAssignments,
} from "@shared/student-academic-schema";
import {
  academicRules,
  programVersions,
  requirementsV2,
} from "@shared/knowledge-schema";
import { eq, and, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

export type StudentCreditPlacementTx = PgTransaction<any, any, any> | typeof db;

export type PlacementInput = {
  studentCreditDecisionId: string;
  programAssignmentId: string;
  requirementId: string;
  academicRuleId?: string | null;
  supersedesPlacementId?: string | null;
  actor: string;
  rationale: string;
  metadata: Record<string, unknown>;
  provenance: Record<string, unknown>;
};

export type DecisionContext = {
  decision: typeof studentCreditDecisions.$inferSelect;
  creditRecord: typeof studentCreditRecords.$inferSelect;
};

export type AssignmentContext = {
  assignment: typeof studentProgramAssignments.$inferSelect;
  programVersion: typeof programVersions.$inferSelect;
};

export type RequirementContext = {
  requirement: typeof requirementsV2.$inferSelect;
  programVersion: typeof programVersions.$inferSelect;
};

export type AcademicRuleContext = {
  rule: typeof academicRules.$inferSelect;
  programVersion: typeof programVersions.$inferSelect | null;
};

export type PlacementReadModel = {
  placement: StudentCreditPlacement;
  decision: typeof studentCreditDecisions.$inferSelect;
  creditRecord: typeof studentCreditRecords.$inferSelect;
};

/**
 * This interface is deliberately small so service tests can use a fake
 * transaction-aware repository without constructing a Drizzle client.
 */
export interface StudentCreditPlacementRepository {
  lockDecisionRow(decisionId: string, tx?: StudentCreditPlacementTx): Promise<void>;
  lockAssignmentRow(assignmentId: string, tx?: StudentCreditPlacementTx): Promise<void>;
  lockPlacementRow(placementId: string, tx?: StudentCreditPlacementTx): Promise<void>;
  getDecisionContext(decisionId: string, tx?: StudentCreditPlacementTx): Promise<DecisionContext | null>;
  getAssignmentContext(assignmentId: string, tx?: StudentCreditPlacementTx): Promise<AssignmentContext | null>;
  getRequirementContext(requirementId: string, tx?: StudentCreditPlacementTx): Promise<RequirementContext | null>;
  getAcademicRuleContext(ruleId: string, tx?: StudentCreditPlacementTx): Promise<AcademicRuleContext | null>;
  getActiveExactPlacement(
    input: Pick<PlacementInput, "studentCreditDecisionId" | "programAssignmentId" | "requirementId" | "academicRuleId">,
    tx?: StudentCreditPlacementTx,
  ): Promise<StudentCreditPlacement | null>;
  getPlacement(placementId: string, tx?: StudentCreditPlacementTx): Promise<StudentCreditPlacement | null>;
  listPlacementsForAssignment(
    programAssignmentId: string,
    tx?: StudentCreditPlacementTx,
  ): Promise<PlacementReadModel[]>;
  insertPlacement(input: PlacementInput, tx?: StudentCreditPlacementTx): Promise<StudentCreditPlacement>;
  updatePlacementLifecycle(
    placementId: string,
    update: {
      status: "revoked" | "superseded";
      actor: string;
      rationale: string;
      at?: Date;
      supersededByPlacementId?: string | null;
    },
    tx?: StudentCreditPlacementTx,
  ): Promise<StudentCreditPlacement | null>;
}

export async function lockDecisionRow(
  decisionId: string,
  tx: StudentCreditPlacementTx = db,
): Promise<void> {
  await tx.execute(sql`SELECT id FROM student_credit_decisions WHERE id = ${decisionId} FOR UPDATE`);
}

export async function lockAssignmentRow(
  assignmentId: string,
  tx: StudentCreditPlacementTx = db,
): Promise<void> {
  await tx.execute(sql`SELECT id FROM student_program_assignments WHERE id = ${assignmentId} FOR UPDATE`);
}

export async function lockPlacementRow(
  placementId: string,
  tx: StudentCreditPlacementTx = db,
): Promise<void> {
  await tx.execute(sql`SELECT id FROM student_credit_placements WHERE id = ${placementId} FOR UPDATE`);
}

export async function getDecisionContext(
  decisionId: string,
  tx: StudentCreditPlacementTx = db,
): Promise<DecisionContext | null> {
  const rows = await tx
    .select({ decision: studentCreditDecisions, creditRecord: studentCreditRecords })
    .from(studentCreditDecisions)
    .innerJoin(studentCreditRecords, eq(studentCreditDecisions.creditRecordId, studentCreditRecords.id))
    .where(eq(studentCreditDecisions.id, decisionId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAssignmentContext(
  assignmentId: string,
  tx: StudentCreditPlacementTx = db,
): Promise<AssignmentContext | null> {
  const rows = await tx
    .select({ assignment: studentProgramAssignments, programVersion: programVersions })
    .from(studentProgramAssignments)
    .innerJoin(programVersions, eq(studentProgramAssignments.programVersionId, programVersions.id))
    .where(eq(studentProgramAssignments.id, assignmentId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getRequirementContext(
  requirementId: string,
  tx: StudentCreditPlacementTx = db,
): Promise<RequirementContext | null> {
  const rows = await tx
    .select({ requirement: requirementsV2, programVersion: programVersions })
    .from(requirementsV2)
    .innerJoin(programVersions, eq(requirementsV2.programVersionId, programVersions.id))
    .where(eq(requirementsV2.id, requirementId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAcademicRuleContext(
  ruleId: string,
  tx: StudentCreditPlacementTx = db,
): Promise<AcademicRuleContext | null> {
  const rows = await tx
    .select({ rule: academicRules, programVersion: programVersions })
    .from(academicRules)
    .leftJoin(programVersions, eq(academicRules.programVersionId, programVersions.id))
    .where(eq(academicRules.id, ruleId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getActiveExactPlacement(
  input: Pick<PlacementInput, "studentCreditDecisionId" | "programAssignmentId" | "requirementId" | "academicRuleId">,
  tx: StudentCreditPlacementTx = db,
): Promise<StudentCreditPlacement | null> {
  const rows = await tx
    .select()
    .from(studentCreditPlacements)
    .where(and(
      eq(studentCreditPlacements.studentCreditDecisionId, input.studentCreditDecisionId),
      eq(studentCreditPlacements.programAssignmentId, input.programAssignmentId),
      eq(studentCreditPlacements.requirementId, input.requirementId),
      eq(studentCreditPlacements.status, "active"),
      sql`${studentCreditPlacements.academicRuleId} IS NOT DISTINCT FROM ${input.academicRuleId ?? null}`,
    ))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPlacement(
  placementId: string,
  tx: StudentCreditPlacementTx = db,
): Promise<StudentCreditPlacement | null> {
  const [row] = await tx
    .select()
    .from(studentCreditPlacements)
    .where(eq(studentCreditPlacements.id, placementId))
    .limit(1);
  return row ?? null;
}

export async function listPlacementsForAssignment(
  programAssignmentId: string,
  tx: StudentCreditPlacementTx = db,
): Promise<PlacementReadModel[]> {
  return await tx
    .select({
      placement: studentCreditPlacements,
      decision: studentCreditDecisions,
      creditRecord: studentCreditRecords,
    })
    .from(studentCreditPlacements)
    .innerJoin(
      studentCreditDecisions,
      eq(studentCreditDecisions.id, studentCreditPlacements.studentCreditDecisionId),
    )
    .innerJoin(
      studentCreditRecords,
      eq(studentCreditRecords.id, studentCreditDecisions.creditRecordId),
    )
    .where(eq(studentCreditPlacements.programAssignmentId, programAssignmentId))
    .orderBy(studentCreditPlacements.createdAt, studentCreditPlacements.id);
}

export async function insertPlacement(
  input: PlacementInput,
  tx: StudentCreditPlacementTx = db,
): Promise<StudentCreditPlacement> {
  const [row] = await tx
    .insert(studentCreditPlacements)
    .values({
      studentCreditDecisionId: input.studentCreditDecisionId,
      programAssignmentId: input.programAssignmentId,
      requirementId: input.requirementId,
      academicRuleId: input.academicRuleId ?? null,
      supersedesPlacementId: input.supersedesPlacementId ?? null,
      actor: input.actor,
      rationale: input.rationale,
      metadata: input.metadata,
      provenance: input.provenance,
    })
    .returning();
  return row;
}

export async function updatePlacementLifecycle(
  placementId: string,
  update: {
    status: "revoked" | "superseded";
    actor: string;
    rationale: string;
    at?: Date;
    supersededByPlacementId?: string | null;
  },
  tx: StudentCreditPlacementTx = db,
): Promise<StudentCreditPlacement | null> {
  const at = update.at ?? new Date();
  const set: Record<string, unknown> = {
    status: update.status,
    updatedAt: at,
  };
  if (update.status === "revoked") {
    set.revokedBy = update.actor;
    set.revokedAt = at;
    set.revocationRationale = update.rationale;
  } else {
    set.supersededBy = update.actor;
    set.supersededAt = at;
    set.supersedeRationale = update.rationale;
    set.supersededByPlacementId = update.supersededByPlacementId ?? null;
  }
  const [row] = await tx
    .update(studentCreditPlacements)
    .set(set)
    .where(eq(studentCreditPlacements.id, placementId))
    .returning();
  return row ?? null;
}

export const studentCreditPlacementRepository: StudentCreditPlacementRepository = {
  lockDecisionRow,
  lockAssignmentRow,
  lockPlacementRow,
  getDecisionContext,
  getAssignmentContext,
  getRequirementContext,
  getAcademicRuleContext,
  getActiveExactPlacement,
  getPlacement,
  listPlacementsForAssignment,
  insertPlacement,
  updatePlacementLifecycle,
};