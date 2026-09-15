/**
 * Lumière Student Credit Placement — Canonical Schema
 *
 * Phase 4B: a placement records where an existing credit decision was placed.
 * It is a historical fact, not an academic calculation or recommendation.
 */

import { sql } from "drizzle-orm";
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import {
  studentCreditDecisions,
  studentProgramAssignments,
} from "./student-academic-schema";
import { requirementsV2, academicRules } from "./knowledge-schema";
import { users } from "./schema";

export const studentCreditPlacementStatusEnum = pgEnum(
  "student_credit_placement_status",
  ["active", "revoked", "superseded"],
);

export const studentCreditPlacements = pgTable(
  "student_credit_placements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentCreditDecisionId: uuid("student_credit_decision_id")
      .notNull()
      .references(() => studentCreditDecisions.id, { onDelete: "restrict" }),
    programAssignmentId: uuid("program_assignment_id")
      .notNull()
      .references(() => studentProgramAssignments.id, { onDelete: "restrict" }),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirementsV2.id, { onDelete: "restrict" }),
    academicRuleId: uuid("academic_rule_id").references(() => academicRules.id, {
      onDelete: "restrict",
    }),
    status: studentCreditPlacementStatusEnum("status")
      .notNull()
      .default("active"),
    supersedesPlacementId: uuid("supersedes_placement_id").references(
      (): any => studentCreditPlacements.id,
      { onDelete: "restrict" },
    ),
    supersededByPlacementId: uuid("superseded_by_placement_id").references(
      (): any => studentCreditPlacements.id,
      { onDelete: "restrict" },
    ),
    actor: text("actor").notNull().references(() => users.id, { onDelete: "restrict" }),
    rationale: text("rationale").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    provenance: jsonb("provenance").notNull().default(sql`'{}'::jsonb`),
    revokedBy: text("revoked_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationRationale: text("revocation_rationale"),
    supersededBy: text("superseded_by").references(() => users.id, { onDelete: "set null" }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    supersedeRationale: text("supersede_rationale"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    decisionIdx: index("student_cp_decision_idx").on(table.studentCreditDecisionId),
    assignmentIdx: index("student_cp_assignment_idx").on(table.programAssignmentId),
    requirementIdx: index("student_cp_requirement_idx").on(table.requirementId),
    ruleIdx: index("student_cp_rule_idx").on(table.academicRuleId),
    statusIdx: index("student_cp_status_idx").on(table.status),
    supersedesIdx: index("student_cp_supersedes_idx").on(table.supersedesPlacementId),
    supersededByIdx: index("student_cp_superseded_by_idx").on(table.supersededByPlacementId),
    noSelfSupersession: check(
      "student_cp_no_self_supersession",
      sql`${table.supersedesPlacementId} IS NULL OR ${table.supersedesPlacementId} <> ${table.id}`,
    ),
    noZeroAcademicRule: check(
      "student_cp_no_zero_academic_rule",
      sql`${table.academicRuleId} IS NULL OR ${table.academicRuleId} <> '00000000-0000-0000-0000-000000000000'::uuid`,
    ),
    // Keep the partial identity expression and reserved sentinel identical to
    // the canonical migration; the collision check below makes it safe.
    activeIdentityUnique: uniqueIndex("student_cp_active_identity_unique_idx")
      .on(
        table.studentCreditDecisionId,
        table.programAssignmentId,
        table.requirementId,
        sql`coalesce(${table.academicRuleId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${table.status} = 'active'`),
    supersedesUnique: uniqueIndex("student_cp_supersedes_unique_idx")
      .on(table.supersedesPlacementId)
      .where(sql`${table.supersedesPlacementId} IS NOT NULL`),
  }),
);

export type StudentCreditPlacement = typeof studentCreditPlacements.$inferSelect;
export type NewStudentCreditPlacement = typeof studentCreditPlacements.$inferInsert;