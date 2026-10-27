/**
 * S11 — drizzle definitions for the high school pathway tables.
 * Mirrors supabase/migrations/20261029100000_s11_high_school_pathway.sql.
 *
 * evidence_document_id columns reference student_documents.id by value only
 * (no FK), see the migration header.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  date,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  unique,
  primaryKey,
  foreignKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { studentsTable, users } from "./schema";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const hsCurriculumTemplates = pgTable(
  "hs_curriculum_templates",
  {
    templateKey: text("template_key").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    jurisdiction: text("jurisdiction"),
    totalRequiredHalfUnits: integer("total_required_half_units").notNull(),
    definition: jsonb("definition").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.templateKey, t.version] }) }),
);

export const hsEnrollments = pgTable(
  "hs_enrollments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    templateKey: text("template_key").notNull(),
    templateVersion: integer("template_version").notNull(),
    status: text("status").notNull().default("planned"),
    totalRequiredHalfUnits: integer("total_required_half_units").notNull(),
    requiredOverrideReason: text("required_override_reason"),
    startedOn: date("started_on"),
    targetCompletionDate: date("target_completion_date"),
    institutionDisclosed: boolean("institution_disclosed").notNull().default(false),
    awardingSchoolName: text("awarding_school_name"),
    schoolStudentRef: text("school_student_ref"),
    isHistorical: boolean("is_historical").notNull().default(false),
    revision: integer("revision").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    studentIdx: index("hs_enrollments_student_idx").on(t.studentId),
    oneOpen: uniqueIndex("hs_enrollments_one_open_idx").on(t.studentId).where(sql`status IN ('planned', 'active', 'on_hold')`),
    templateFk: foreignKey({
      name: "hs_enrollments_template_fk",
      columns: [t.templateKey, t.templateVersion],
      foreignColumns: [hsCurriculumTemplates.templateKey, hsCurriculumTemplates.version],
    }),
  }),
);

export const hsPriorEducation = pgTable(
  "hs_prior_education",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    enrollmentId: uuid("enrollment_id").notNull().references(() => hsEnrollments.id, { onDelete: "restrict" }),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    schoolName: text("school_name").notNull(),
    country: text("country").notNull(),
    gradeLevels: text("grade_levels"),
    status: text("status").notNull().default("reported"),
    evidenceDocumentId: text("evidence_document_id"),
    staffNote: text("staff_note"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ enrollmentIdx: index("hs_prior_education_enrollment_idx").on(t.enrollmentId) }),
);

export const hsTransferClaims = pgTable(
  "hs_transfer_claims",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    enrollmentId: uuid("enrollment_id").notNull().references(() => hsEnrollments.id, { onDelete: "restrict" }),
    priorEducationId: uuid("prior_education_id").notNull().references(() => hsPriorEducation.id, { onDelete: "restrict" }),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    courseTitle: text("course_title").notNull(),
    areaKey: text("area_key").notNull(),
    claimedHalfUnits: integer("claimed_half_units").notNull(),
    acceptedHalfUnits: integer("accepted_half_units"),
    status: text("status").notNull().default("claimed"),
    resolutionNote: text("resolution_note"),
    resolvedBy: text("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: ts("resolved_at"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ enrollmentIdx: index("hs_transfer_claims_enrollment_idx").on(t.enrollmentId) }),
);

export const hsRoadmapVersions = pgTable(
  "hs_roadmap_versions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    enrollmentId: uuid("enrollment_id").notNull().references(() => hsEnrollments.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("draft"),
    content: jsonb("content").notNull(),
    baseVersionId: uuid("base_version_id").references((): AnyPgColumn => hsRoadmapVersions.id, { onDelete: "restrict" }),
    draftRevision: integer("draft_revision").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    publishedBy: text("published_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: ts("published_at"),
    supersededAt: ts("superseded_at"),
    discardedAt: ts("discarded_at"),
  },
  (t) => ({
    enrollmentIdx: index("hs_roadmap_versions_enrollment_idx").on(t.enrollmentId),
    numberUnique: unique("hs_roadmap_versions_number_unique").on(t.enrollmentId, t.versionNumber),
    oneDraft: uniqueIndex("hs_roadmap_versions_one_draft_idx").on(t.enrollmentId).where(sql`status = 'draft'`),
    onePublished: uniqueIndex("hs_roadmap_versions_one_published_idx").on(t.enrollmentId).where(sql`status = 'published'`),
  }),
);

export const hsTaskProgress = pgTable(
  "hs_task_progress",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    enrollmentId: uuid("enrollment_id").notNull().references(() => hsEnrollments.id, { onDelete: "restrict" }),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    courseKey: text("course_key").notNull(),
    taskKey: text("task_key").notNull(),
    status: text("status").notNull(),
    reportedScorePercent: integer("reported_score_percent"),
    note: text("note"),
    revision: integer("revision").notNull(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    studentIdx: index("hs_task_progress_student_idx").on(t.studentId),
    keyUnique: unique("hs_task_progress_key_unique").on(t.enrollmentId, t.courseKey, t.taskKey),
  }),
);

export const hsTaskProgressEvents = pgTable(
  "hs_task_progress_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    enrollmentId: uuid("enrollment_id").notNull().references(() => hsEnrollments.id, { onDelete: "restrict" }),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    courseKey: text("course_key").notNull(),
    taskKey: text("task_key").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reportedScorePercent: integer("reported_score_percent"),
    revision: integer("revision").notNull(),
    planVersionId: uuid("plan_version_id").references(() => hsRoadmapVersions.id, { onDelete: "set null" }),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ idx: index("hs_task_progress_events_idx").on(t.enrollmentId, t.courseKey, t.taskKey) }),
);

export const hsOfficialResults = pgTable(
  "hs_official_results",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    enrollmentId: uuid("enrollment_id").notNull().references(() => hsEnrollments.id, { onDelete: "restrict" }),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    courseKey: text("course_key").notNull(),
    taskKey: text("task_key"),
    outcome: text("outcome").notNull(),
    scorePercent: integer("score_percent"),
    evidenceDocumentId: text("evidence_document_id").notNull(),
    note: text("note"),
    status: text("status").notNull().default("active"),
    planVersionId: uuid("plan_version_id").references(() => hsRoadmapVersions.id, { onDelete: "set null" }),
    recordedBy: text("recorded_by").references(() => users.id, { onDelete: "set null" }),
    recordedAt: ts("recorded_at").notNull().defaultNow(),
    voidedAt: ts("voided_at"),
  },
  (t) => ({
    enrollmentIdx: index("hs_official_results_enrollment_idx").on(t.enrollmentId, t.courseKey),
    oneCourseResult: uniqueIndex("hs_official_results_one_course_result_idx")
      .on(t.enrollmentId, t.courseKey)
      .where(sql`task_key IS NULL AND status = 'active'`),
  }),
);

export const hsCreditAwards = pgTable(
  "hs_credit_awards",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    enrollmentId: uuid("enrollment_id").notNull().references(() => hsEnrollments.id, { onDelete: "restrict" }),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    source: text("source").notNull(),
    courseKey: text("course_key"),
    claimId: uuid("claim_id").references(() => hsTransferClaims.id, { onDelete: "restrict" }),
    resultId: uuid("result_id").references(() => hsOfficialResults.id, { onDelete: "restrict" }),
    areaKey: text("area_key").notNull(),
    halfUnits: integer("half_units").notNull(),
    evidenceDocumentId: text("evidence_document_id").notNull(),
    status: text("status").notNull().default("active"),
    recordedBy: text("recorded_by").references(() => users.id, { onDelete: "set null" }),
    recordedAt: ts("recorded_at").notNull().defaultNow(),
    voidReason: text("void_reason"),
    voidedBy: text("voided_by").references(() => users.id, { onDelete: "set null" }),
    voidedAt: ts("voided_at"),
  },
  (t) => ({
    enrollmentIdx: index("hs_credit_awards_enrollment_idx").on(t.enrollmentId),
    oneCourse: uniqueIndex("hs_credit_awards_one_course_idx")
      .on(t.enrollmentId, t.courseKey)
      .where(sql`source = 'course_completion' AND status = 'active'`),
  }),
);

export const hsGraduationRecords = pgTable("hs_graduation_records", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  enrollmentId: uuid("enrollment_id").notNull().unique().references(() => hsEnrollments.id, { onDelete: "restrict" }),
  studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("in_progress"),
  eligibilityEvidenceDocumentId: text("eligibility_evidence_document_id"),
  eligibilityConfirmedAt: ts("eligibility_confirmed_at"),
  eligibilityConfirmedBy: text("eligibility_confirmed_by").references(() => users.id, { onDelete: "set null" }),
  conferredOn: date("conferred_on"),
  diplomaEvidenceDocumentId: text("diploma_evidence_document_id"),
  transcriptEvidenceDocumentId: text("transcript_evidence_document_id"),
  transcriptStatus: text("transcript_status").notNull().default("not_requested"),
  diplomaDeliveryStatus: text("diploma_delivery_status").notNull().default("not_requested"),
  financialClearance: text("financial_clearance").notNull().default("unknown"),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const hsEvents = pgTable(
  "hs_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    enrollmentId: uuid("enrollment_id").references(() => hsEnrollments.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    summary: text("summary").notNull(),
    detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ studentIdx: index("hs_events_student_idx").on(t.studentId, t.createdAt) }),
);

export type HsTemplateRow = typeof hsCurriculumTemplates.$inferSelect;
export type HsEnrollmentRow = typeof hsEnrollments.$inferSelect;
export type HsPriorEducationRow = typeof hsPriorEducation.$inferSelect;
export type HsTransferClaimRow = typeof hsTransferClaims.$inferSelect;
export type HsRoadmapVersionRow = typeof hsRoadmapVersions.$inferSelect;
export type HsTaskProgressRow = typeof hsTaskProgress.$inferSelect;
export type HsOfficialResultRow = typeof hsOfficialResults.$inferSelect;
export type HsCreditAwardRow = typeof hsCreditAwards.$inferSelect;
export type HsGraduationRow = typeof hsGraduationRecords.$inferSelect;
export type HsEventRow = typeof hsEvents.$inferSelect;
