/**
 * Lumière Student Academic Record — Canonical Schema
 *
 * Phase 2A: Database + type-safe schema foundation only.
 *
 * Conceptual model:
 *   STUDENT → PROGRAM ASSIGNMENT → ACADEMIC SOURCE → CREDIT RECORD
 *           → VERIFICATION → CREDIT DECISION → EXCEPTION
 *
 * All tables are ADDITIVE. No existing tables are modified, renamed, or deleted.
 * Student identity remains in the legacy `students` table (text PK).
 * Knowledge Core references use uuid FKs to Phase 1 tables.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  numeric,
  timestamp,
  date,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  bigserial,
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────────────────────────

export const studentProgramAssignmentStatusEnum = pgEnum(
  "student_program_assignment_status",
  ["active", "completed", "withdrawn", "superseded"],
);

export const studentAcademicSourceTypeEnum = pgEnum(
  "student_academic_source_type",
  [
    "transcript",
    "credential_evaluation",
    "provider_record",
    "exam_score",
    "institution_record",
    "manual",
    "other",
  ],
);

export const studentAcademicSourceStatusEnum = pgEnum(
  "student_academic_source_status",
  ["received", "extracted", "verified", "rejected", "superseded"],
);

export const studentCreditRecordTypeEnum = pgEnum(
  "student_credit_record_type",
  ["course", "exam", "credential_award", "other"],
);

export const studentCreditRecordStatusEnum = pgEnum(
  "student_credit_record_status",
  ["extracted", "verified", "rejected", "needs_review", "superseded"],
);

export const studentCreditVerificationActionEnum = pgEnum(
  "student_credit_verification_action",
  ["submitted", "verified", "rejected", "needs_review", "corrected", "superseded"],
);

export const studentCreditDecisionActionEnum = pgEnum(
  "student_credit_decision_action",
  ["accepted", "rejected", "needs_review", "revoked"],
);

export const studentAcademicExceptionTypeEnum = pgEnum(
  "student_academic_exception_type",
  [
    "requirement_waiver",
    "course_substitution",
    "credit_override",
    "level_override",
    "residency_override",
    "other",
  ],
);

export const studentAcademicExceptionStatusEnum = pgEnum(
  "student_academic_exception_status",
  ["active", "revoked", "superseded"],
);

// ── A. Student Program Assignments ───────────────────────────────────────────

export const studentProgramAssignments = pgTable(
  "student_program_assignments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: text("student_id").notNull(),
    programVersionId: uuid("program_version_id").notNull(),
    status: studentProgramAssignmentStatusEnum("status").notNull().default("active"),
    cohortLabel: text("cohort_label"),
    assignedBy: text("assigned_by"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    reason: text("reason"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    studentIdx: index("student_pa_student_idx").on(table.studentId),
    programVersionIdx: index("student_pa_pv_idx").on(table.programVersionId),
    statusIdx: index("student_pa_status_idx").on(table.status),
    // Partial unique: only one active assignment per student
    activeUnique: uniqueIndex("student_pa_active_unique_idx")
      .on(table.studentId)
      .where(sql`status = 'active'`),
  }),
);

// ── B. Student Academic Sources ───────────────────────────────────────────────

export const studentAcademicSources = pgTable(
  "student_academic_sources",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: text("student_id").notNull(),
    documentId: text("document_id"),
    sourceType: studentAcademicSourceTypeEnum("source_type").notNull(),
    status: studentAcademicSourceStatusEnum("status").notNull().default("received"),
    title: text("title").notNull(),
    issuingInstitutionId: uuid("issuing_institution_id"),
    issuingProviderId: uuid("issuing_provider_id"),
    externalFileId: text("external_file_id"),
    sourceDate: date("source_date"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdBy: text("created_by"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    studentIdx: index("student_as_student_idx").on(table.studentId),
    statusIdx: index("student_as_status_idx").on(table.status),
    institutionIdx: index("student_as_inst_idx").on(table.issuingInstitutionId),
    providerIdx: index("student_as_prov_idx").on(table.issuingProviderId),
    // Partial unique: (student_id, document_id) where document_id IS NOT NULL
    studentDocUnique: uniqueIndex("student_as_student_doc_unique_idx")
      .on(table.studentId, table.documentId)
      .where(sql`document_id IS NOT NULL`),
  }),
);

// ── C. Student Credit Records ─────────────────────────────────────────────────

export const studentCreditRecords = pgTable(
  "student_credit_records",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: text("student_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    recordType: studentCreditRecordTypeEnum("record_type").notNull().default("course"),
    status: studentCreditRecordStatusEnum("status").notNull().default("extracted"),
    sourceLineKey: text("source_line_key"),
    rawCourseCode: text("raw_course_code"),
    rawTitle: text("raw_title").notNull(),
    rawCredits: numeric("raw_credits", { precision: 6, scale: 2 }),
    rawGrade: text("raw_grade"),
    rawLevel: text("raw_level"),
    term: text("term"),
    completedOn: date("completed_on"),
    institutionCourseVersionId: uuid("institution_course_version_id"),
    providerCourseVersionId: uuid("provider_course_version_id"),
    normalizedCredits: numeric("normalized_credits", { precision: 6, scale: 2 }),
    normalizedLevel: text("normalized_level"),
    createdBy: text("created_by"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    studentIdx: index("student_cr_student_idx").on(table.studentId),
    sourceIdx: index("student_cr_source_idx").on(table.sourceId),
    statusIdx: index("student_cr_status_idx").on(table.status),
    instCourseVerIdx: index("student_cr_icv_idx").on(table.institutionCourseVersionId),
    provCourseVerIdx: index("student_cr_pcv_idx").on(table.providerCourseVersionId),
    // Partial unique: (source_id, source_line_key) where source_line_key IS NOT NULL
    sourceLineUnique: uniqueIndex("student_cr_source_line_unique_idx")
      .on(table.sourceId, table.sourceLineKey)
      .where(sql`source_line_key IS NOT NULL`),
  }),
);

// ── D. Student Credit Verification Events (append-only) ───────────────────────

export const studentCreditVerificationEvents = pgTable(
  "student_credit_verification_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    creditRecordId: uuid("credit_record_id").notNull(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    action: studentCreditVerificationActionEnum("action").notNull(),
    reviewerId: text("reviewer_id"),
    rationale: text("rationale"),
    snapshot: jsonb("snapshot").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    creditRecordIdx: index("student_cve_cr_idx").on(table.creditRecordId),
    crSeqIdx: index("student_cve_cr_seq_idx").on(table.creditRecordId, table.seq),
  }),
);

// ── E. Student Credit Decisions (append-only) ─────────────────────────────────

export const studentCreditDecisions = pgTable(
  "student_credit_decisions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    creditRecordId: uuid("credit_record_id").notNull(),
    programAssignmentId: uuid("program_assignment_id").notNull(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    action: studentCreditDecisionActionEnum("action").notNull(),
    creditsAwarded: numeric("credits_awarded", { precision: 6, scale: 2 }),
    levelAwarded: text("level_awarded"),
    equivalencyId: uuid("equivalency_id"),
    targetInstitutionCourseVersionId: uuid("target_institution_course_version_id"),
    basisClaimVersionId: uuid("basis_claim_version_id"),
    decidedBy: text("decided_by"),
    rationale: text("rationale"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    creditRecordIdx: index("student_cd_cr_idx").on(table.creditRecordId),
    paIdx: index("student_cd_pa_idx").on(table.programAssignmentId),
    actionIdx: index("student_cd_action_idx").on(table.action),
    crPaSeqIdx: index("student_cd_cr_pa_seq_idx").on(
      table.creditRecordId,
      table.programAssignmentId,
      table.seq,
    ),
  }),
);

// ── F. Student Academic Exceptions ───────────────────────────────────────────

export const studentAcademicExceptions = pgTable(
  "student_academic_exceptions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: text("student_id").notNull(),
    programAssignmentId: uuid("program_assignment_id").notNull(),
    exceptionType: studentAcademicExceptionTypeEnum("exception_type").notNull(),
    status: studentAcademicExceptionStatusEnum("status").notNull().default("active"),
    requirementId: uuid("requirement_id"),
    academicRuleId: uuid("academic_rule_id"),
    creditRecordId: uuid("credit_record_id"),
    supersedesExceptionId: uuid("supersedes_exception_id"),
    approvedBy: text("approved_by"),
    rationale: text("rationale").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    studentIdx: index("student_ae_student_idx").on(table.studentId),
    paIdx: index("student_ae_pa_idx").on(table.programAssignmentId),
    requirementIdx: index("student_ae_req_idx").on(table.requirementId),
    ruleIdx: index("student_ae_rule_idx").on(table.academicRuleId),
    creditRecordIdx: index("student_ae_cr_idx").on(table.creditRecordId),
    statusIdx: index("student_ae_status_idx").on(table.status),
  }),
);

// ── Type exports ─────────────────────────────────────────────────────────────

export type StudentProgramAssignment = typeof studentProgramAssignments.$inferSelect;
export type StudentAcademicSource = typeof studentAcademicSources.$inferSelect;
export type StudentCreditRecord = typeof studentCreditRecords.$inferSelect;
export type StudentCreditVerificationEvent = typeof studentCreditVerificationEvents.$inferSelect;
export type StudentCreditDecision = typeof studentCreditDecisions.$inferSelect;
export type StudentAcademicException = typeof studentAcademicExceptions.$inferSelect;
