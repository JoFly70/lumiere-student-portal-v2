/**
 * S12 — drizzle definitions for the graduate-program tables.
 * Mirrors supabase/migrations/20261029110000_s12_graduate_programs.sql.
 * Not registered in shared/schema.ts (imported directly by the repository).
 *
 * Dates use mode "string" (YYYY-MM-DD); timestamps are Date; numeric columns
 * come back as strings and are converted by the repository.
 */
import { sql } from "drizzle-orm";
import { pgTable, text, integer, numeric, jsonb, date, timestamp, index, unique, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { studentsTable, users } from "./schema";

export const graduateProgramOfferings = pgTable("graduate_program_offerings", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  key: text("key").notNull().unique(),
  category: text("category").notNull(),
  route: text("route").notNull(),
  marketingTitle: text("marketing_title").notNull(),
  alternativeMarketingTitles: jsonb("alternative_marketing_titles").notNull().default(sql`'[]'::jsonb`),
  universityLegalTitle: text("university_legal_title"),
  universityLegalTitleStatus: text("university_legal_title_status").notNull().default("unknown"),
  awardingInstitution: text("awarding_institution").notNull(),
  qualificationClassification: text("qualification_classification").notNull().default("unknown"),
  classificationStatus: text("classification_status").notNull().default("unknown"),
  programVersion: text("program_version").notNull(),
  publishedDurationMonths: integer("published_duration_months"),
  publishedEcts: numeric("published_ects"),
  evidenceNote: text("evidence_note"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const graduateCohortRuleSets = pgTable(
  "graduate_cohort_rule_sets",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    offeringId: text("offering_id").notNull().references(() => graduateProgramOfferings.id, { onDelete: "restrict" }),
    cohortLabel: text("cohort_label").notNull(),
    version: integer("version").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    rules: jsonb("rules").notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("active"),
    supersedesId: text("supersedes_id").references((): AnyPgColumn => graduateCohortRuleSets.id, { onDelete: "restrict" }),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    offeringVersionUnique: unique("graduate_rule_sets_offering_version_unique").on(table.offeringId, table.version),
    offeringIdx: index("graduate_rule_sets_offering_idx").on(table.offeringId, table.cohortLabel),
    oneActive: uniqueIndex("graduate_rule_sets_one_active_idx").on(table.offeringId, table.cohortLabel).where(sql`status = 'active'`),
  }),
);

export const studentGraduatePrograms = pgTable(
  "student_graduate_programs",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
    offeringId: text("offering_id").notNull().references(() => graduateProgramOfferings.id, { onDelete: "restrict" }),
    ruleSetId: text("rule_set_id").notNull().references(() => graduateCohortRuleSets.id, { onDelete: "restrict" }),
    route: text("route").notNull(),
    cohortLabel: text("cohort_label").notNull(),
    enrollmentContractTitle: text("enrollment_contract_title"),
    enrolledAt: date("enrolled_at", { mode: "string" }).notNull(),
    enebStatus: text("eneb_status").notNull().default("enrolled"),
    priorBachelorSource: text("prior_bachelor_source").notNull().default("unknown"),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    studentIdx: index("student_graduate_programs_student_idx").on(table.studentId, table.enrolledAt),
    ruleSetIdx: index("student_graduate_programs_rule_set_idx").on(table.ruleSetId),
  }),
);

export const graduateSubjects = pgTable(
  "graduate_subjects",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    programId: text("program_id").notNull().references(() => studentGraduatePrograms.id, { onDelete: "cascade" }),
    authority: text("authority").notNull(),
    title: text("title").notNull(),
    moduleCode: text("module_code"),
    statedCredits: numeric("stated_credits"),
    creditUnit: text("credit_unit"),
    assessmentType: text("assessment_type").notNull().default("unknown"),
    sortOrder: integer("sort_order").notNull().default(0),
    studentProgress: text("student_progress").notNull().default("not_started"),
    resultStatus: text("result_status").notNull().default("none"),
    gradeValue: numeric("grade_value"),
    gradeScale: numeric("grade_scale"),
    gradeDisplay: text("grade_display"),
    issuingInstitution: text("issuing_institution"),
    verificationStatus: text("verification_status").notNull().default("unknown"),
    documentId: text("document_id"),
    documentReference: text("document_reference"),
    reassessmentCount: integer("reassessment_count").notNull().default(0),
    correctionCount: integer("correction_count").notNull().default(0),
    recordedBy: text("recorded_by"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    programIdx: index("graduate_subjects_program_idx").on(table.programId, table.sortOrder),
  }),
);

export const graduateRecords = pgTable(
  "graduate_records",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    programId: text("program_id").notNull().references(() => studentGraduatePrograms.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    trackingStatus: text("tracking_status").notNull().default("not_started"),
    verificationStatus: text("verification_status").notNull().default("unknown"),
    outcome: text("outcome"),
    issuingInstitution: text("issuing_institution"),
    documentTypeLabel: text("document_type_label"),
    documentReference: text("document_reference"),
    documentId: text("document_id"),
    decisionDate: date("decision_date", { mode: "string" }),
    effectiveDate: date("effective_date", { mode: "string" }),
    effectiveCohort: text("effective_cohort"),
    academicConsequence: text("academic_consequence"),
    conflictingEvidence: text("conflicting_evidence"),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    reviewerUserId: text("reviewer_user_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    programIdx: index("graduate_records_program_idx").on(table.programId, table.kind),
    studentIdx: index("graduate_records_student_idx").on(table.studentId),
  }),
);

export const graduateCreditEntries = pgTable(
  "graduate_credit_entries",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    programId: text("program_id").notNull().references(() => studentGraduatePrograms.id, { onDelete: "cascade" }),
    authority: text("authority").notNull(),
    recordId: text("record_id").notNull().references(() => graduateRecords.id, { onDelete: "cascade" }),
    subjectId: text("subject_id").references(() => graduateSubjects.id),
    label: text("label").notNull(),
    amount: numeric("amount").notNull(),
    unit: text("unit").notNull(),
    recognitionOutcome: text("recognition_outcome"),
    conditions: text("conditions"),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    programIdx: index("graduate_credit_entries_program_idx").on(table.programId, table.authority),
  }),
);

export const graduateEvents = pgTable(
  "graduate_events",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    programId: text("program_id"),
    studentId: text("student_id"),
    actorUserId: text("actor_user_id"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    programIdx: index("graduate_events_program_idx").on(table.programId, table.createdAt),
  }),
);

export type GraduateOfferingRow = typeof graduateProgramOfferings.$inferSelect;
export type GraduateRuleSetRow = typeof graduateCohortRuleSets.$inferSelect;
export type GraduateProgramRow = typeof studentGraduatePrograms.$inferSelect;
export type GraduateSubjectRow = typeof graduateSubjects.$inferSelect;
export type GraduateRecordRow = typeof graduateRecords.$inferSelect;
export type GraduateCreditRow = typeof graduateCreditEntries.$inferSelect;
export type GraduateEventRow = typeof graduateEvents.$inferSelect;

/** Mirrors supabase/migrations/20261029120000_s12_credential_evaluations.sql. */
export const graduateCredentialEvaluations = pgTable(
  "graduate_credential_evaluations",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
    programId: text("program_id").references(() => studentGraduatePrograms.id, { onDelete: "set null" }),
    evaluator: text("evaluator").notNull(),
    evaluatorName: text("evaluator_name"),
    destinationCountry: text("destination_country").notNull(),
    qualificationEvaluated: text("qualification_evaluated").notNull(),
    awardingInstitution: text("awarding_institution").notNull(),
    intendedUse: text("intended_use").notNull(),
    evaluationType: text("evaluation_type").notNull(),
    status: text("status").notNull().default("planned"),
    reportDate: date("report_date", { mode: "string" }),
    reportReference: text("report_reference"),
    documentId: text("document_id"),
    conclusion: text("conclusion").notNull().default("not_yet_known"),
    conclusionText: text("conclusion_text"),
    verificationStatus: text("verification_status").notNull().default("unknown"),
    conflictingEvidence: text("conflicting_evidence"),
    reviewerUserId: text("reviewer_user_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    studentIdx: index("graduate_evaluations_student_idx").on(table.studentId, table.createdAt),
    programIdx: index("graduate_evaluations_program_idx").on(table.programId),
  }),
);

export type GraduateEvaluationRow = typeof graduateCredentialEvaluations.$inferSelect;
