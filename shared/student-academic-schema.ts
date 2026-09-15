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
 *
 * FK type mapping:
 *   students.id   = text      → student_id columns use text
 *   users.id      = varchar   → actor/reviewer columns use text (varchar-compatible)
 *   documents.id  = varchar   → document_id columns use text (varchar-compatible)
 *   Knowledge Core IDs = uuid → all Knowledge FK columns use uuid
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
  check,
} from "drizzle-orm/pg-core";
import { studentsTable, users, documents } from "./schema";
import {
  programVersions,
  institutions,
  creditProviders,
  institutionCourseVersions,
  providerCourseVersions,
  equivalenciesV2,
  claimVersions,
  requirementsV2,
  academicRules,
} from "./knowledge-schema";

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
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    programVersionId: uuid("program_version_id").notNull().references(() => programVersions.id, { onDelete: "restrict" }),
    status: studentProgramAssignmentStatusEnum("status").notNull().default("active"),
    cohortLabel: text("cohort_label"),
    assignedBy: text("assigned_by").references(() => users.id, { onDelete: "set null" }),
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
    activeUnique: uniqueIndex("student_pa_active_unique_idx")
      .on(table.studentId)
      .where(sql`status = 'active'`),
    endedAfterAssigned: check("student_pa_ended_after_assigned", sql`${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.assignedAt}`),
  }),
);

// ── B. Student Academic Sources ───────────────────────────────────────────────

export const studentAcademicSources = pgTable(
  "student_academic_sources",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    documentId: text("document_id").references(() => documents.id, { onDelete: "set null" }),
    sourceType: studentAcademicSourceTypeEnum("source_type").notNull(),
    status: studentAcademicSourceStatusEnum("status").notNull().default("received"),
    title: text("title").notNull(),
    issuingInstitutionId: uuid("issuing_institution_id").references(() => institutions.id, { onDelete: "restrict" }),
    issuingProviderId: uuid("issuing_provider_id").references(() => creditProviders.id, { onDelete: "restrict" }),
    externalFileId: text("external_file_id"),
    sourceDate: date("source_date"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    studentIdx: index("student_as_student_idx").on(table.studentId),
    statusIdx: index("student_as_status_idx").on(table.status),
    institutionIdx: index("student_as_inst_idx").on(table.issuingInstitutionId),
    providerIdx: index("student_as_prov_idx").on(table.issuingProviderId),
    studentDocUnique: uniqueIndex("student_as_student_doc_unique_idx")
      .on(table.studentId, table.documentId)
      .where(sql`document_id IS NOT NULL`),
    instXorProvider: check("student_as_inst_xor_provider", sql`${table.issuingInstitutionId} IS NULL OR ${table.issuingProviderId} IS NULL`),
  }),
);

// ── C. Student Credit Records ─────────────────────────────────────────────────

export const studentCreditRecords = pgTable(
  "student_credit_records",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    sourceId: uuid("source_id").notNull().references(() => studentAcademicSources.id, { onDelete: "restrict" }),
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
    institutionCourseVersionId: uuid("institution_course_version_id").references(() => institutionCourseVersions.id, { onDelete: "restrict" }),
    providerCourseVersionId: uuid("provider_course_version_id").references(() => providerCourseVersions.id, { onDelete: "restrict" }),
    normalizedCredits: numeric("normalized_credits", { precision: 6, scale: 2 }),
    normalizedLevel: text("normalized_level"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
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
    sourceLineUnique: uniqueIndex("student_cr_source_line_unique_idx")
      .on(table.sourceId, table.sourceLineKey)
      .where(sql`source_line_key IS NOT NULL`),
    rawCreditsNonneg: check("student_cr_raw_credits_nonneg", sql`${table.rawCredits} IS NULL OR ${table.rawCredits} >= 0`),
    normCreditsNonneg: check("student_cr_norm_credits_nonneg", sql`${table.normalizedCredits} IS NULL OR ${table.normalizedCredits} >= 0`),
    instXorProvider: check("student_cr_inst_xor_provider", sql`${table.institutionCourseVersionId} IS NULL OR ${table.providerCourseVersionId} IS NULL`),
  }),
);

// ── D. Student Credit Verification Events (append-only) ───────────────────────

export const studentCreditVerificationEvents = pgTable(
  "student_credit_verification_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    creditRecordId: uuid("credit_record_id").notNull().references(() => studentCreditRecords.id, { onDelete: "restrict" }),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    action: studentCreditVerificationActionEnum("action").notNull(),
    reviewerId: text("reviewer_id").references(() => users.id, { onDelete: "set null" }),
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
    creditRecordId: uuid("credit_record_id").notNull().references(() => studentCreditRecords.id, { onDelete: "restrict" }),
    programAssignmentId: uuid("program_assignment_id").notNull().references(() => studentProgramAssignments.id, { onDelete: "restrict" }),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    action: studentCreditDecisionActionEnum("action").notNull(),
    creditsAwarded: numeric("credits_awarded", { precision: 6, scale: 2 }),
    levelAwarded: text("level_awarded"),
    equivalencyId: uuid("equivalency_id").references(() => equivalenciesV2.id, { onDelete: "restrict" }),
    targetInstitutionCourseVersionId: uuid("target_institution_course_version_id").references(() => institutionCourseVersions.id, { onDelete: "restrict" }),
    basisClaimVersionId: uuid("basis_claim_version_id").references(() => claimVersions.id, { onDelete: "restrict" }),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
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
    creditsNonneg: check("student_cd_credits_nonneg", sql`${table.creditsAwarded} IS NULL OR ${table.creditsAwarded} >= 0`),
    acceptedRequiresCredits: check("student_cd_accepted_requires_credits", sql`${table.action} != 'accepted' OR ${table.creditsAwarded} > 0`),
    nonAcceptedNoCredits: check("student_cd_non_accepted_no_credits", sql`${table.action} IN ('accepted') OR ${table.creditsAwarded} IS NULL OR ${table.creditsAwarded} = 0`),
  }),
);

// ── F. Student Academic Exceptions ───────────────────────────────────────────

export const studentAcademicExceptions = pgTable(
  "student_academic_exceptions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    programAssignmentId: uuid("program_assignment_id").notNull().references(() => studentProgramAssignments.id, { onDelete: "restrict" }),
    exceptionType: studentAcademicExceptionTypeEnum("exception_type").notNull(),
    status: studentAcademicExceptionStatusEnum("status").notNull().default("active"),
    requirementId: uuid("requirement_id").references(() => requirementsV2.id, { onDelete: "restrict" }),
    academicRuleId: uuid("academic_rule_id").references(() => academicRules.id, { onDelete: "restrict" }),
    creditRecordId: uuid("credit_record_id").references(() => studentCreditRecords.id, { onDelete: "restrict" }),
    supersedesExceptionId: uuid("supersedes_exception_id").references((): any => studentAcademicExceptions.id, { onDelete: "restrict" }),
    approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
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
    effectiveToAfterFrom: check("student_ae_effective_to_after_from", sql`${table.effectiveTo} IS NULL OR ${table.effectiveFrom} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`),
  }),
);

// ── Type exports ─────────────────────────────────────────────────────────────

export type StudentProgramAssignment = typeof studentProgramAssignments.$inferSelect;
export type StudentAcademicSource = typeof studentAcademicSources.$inferSelect;
export type StudentCreditRecord = typeof studentCreditRecords.$inferSelect;
export type StudentCreditVerificationEvent = typeof studentCreditVerificationEvents.$inferSelect;
export type StudentCreditDecision = typeof studentCreditDecisions.$inferSelect;
export type StudentAcademicException = typeof studentAcademicExceptions.$inferSelect;
