/**
 * S05 — drizzle definitions for the student roadmap tables.
 * Mirrors supabase/migrations/20261026100000_s05_student_roadmap.sql exactly.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  uuid,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  unique,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { studentsTable, users } from "./schema";

export const studentRoadmapVersionStatusEnum = pgEnum("student_roadmap_version_status", [
  "draft",
  "published",
  "superseded",
  "discarded",
]);

export const studentRoadmapPlans = pgTable("student_roadmap_plans", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  studentId: text("student_id").notNull().unique().references(() => studentsTable.id, { onDelete: "restrict" }),
  publishedVersionId: uuid("published_version_id").references((): AnyPgColumn => studentRoadmapVersions.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const studentRoadmapVersions = pgTable(
  "student_roadmap_versions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    planId: uuid("plan_id").notNull().references(() => studentRoadmapPlans.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    status: studentRoadmapVersionStatusEnum("status").notNull().default("draft"),
    content: jsonb("content").notNull(),
    baseVersionId: uuid("base_version_id").references((): AnyPgColumn => studentRoadmapVersions.id, { onDelete: "restrict" }),
    importId: uuid("import_id").references((): AnyPgColumn => studentRoadmapImports.id, { onDelete: "set null" }),
    draftRevision: integer("draft_revision").notNull().default(0),
    exceptions: jsonb("exceptions").notNull().default(sql`'[]'::jsonb`),
    acknowledgements: jsonb("acknowledgements").notNull().default(sql`'[]'::jsonb`),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedBy: text("published_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
  },
  (table) => ({
    planIdx: index("student_roadmap_versions_plan_idx").on(table.planId),
    planNumberUnique: unique("student_roadmap_versions_plan_number_unique").on(table.planId, table.versionNumber),
    oneDraft: uniqueIndex("student_roadmap_versions_one_draft_idx").on(table.planId).where(sql`status = 'draft'`),
    onePublished: uniqueIndex("student_roadmap_versions_one_published_idx").on(table.planId).where(sql`status = 'published'`),
    numberCheck: check("student_roadmap_versions_version_number_check", sql`${table.versionNumber} >= 1`),
  }),
);

export const studentRoadmapImports = pgTable(
  "student_roadmap_imports",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    planId: uuid("plan_id").notNull().references(() => studentRoadmapPlans.id, { onDelete: "restrict" }),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    fileSha256: text("file_sha256").notNull(),
    fileName: text("file_name"),
    templateId: text("template_id").notNull(),
    baseVersionId: uuid("base_version_id").references((): AnyPgColumn => studentRoadmapVersions.id, { onDelete: "restrict" }),
    summary: jsonb("summary").notNull().default(sql`'{}'::jsonb`),
    exceptions: jsonb("exceptions").notNull().default(sql`'[]'::jsonb`),
    resultingVersionId: uuid("resulting_version_id").references((): AnyPgColumn => studentRoadmapVersions.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    planIdx: index("student_roadmap_imports_plan_idx").on(table.planId),
    idempotency: uniqueIndex("student_roadmap_imports_idempotency_idx").on(
      table.planId,
      table.fileSha256,
      sql`(COALESCE(${table.baseVersionId}::text, ''))`,
    ),
  }),
);

export const studentRoadmapProgress = pgTable(
  "student_roadmap_progress",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    itemKey: text("item_key").notNull(),
    taskKey: text("task_key").notNull(),
    status: text("status").notNull(),
    revision: integer("revision").notNull(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    studentIdx: index("student_roadmap_progress_student_idx").on(table.studentId),
    keyUnique: unique("student_roadmap_progress_key_unique").on(table.studentId, table.itemKey, table.taskKey),
    statusCheck: check(
      "student_roadmap_progress_status_check",
      sql`${table.status} IN ('not_started', 'in_progress', 'submitted', 'graded', 'provider_complete')`,
    ),
    revisionCheck: check("student_roadmap_progress_revision_check", sql`${table.revision} >= 1`),
  }),
);

export const studentRoadmapProgressEvents = pgTable(
  "student_roadmap_progress_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "restrict" }),
    itemKey: text("item_key").notNull(),
    taskKey: text("task_key").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    revision: integer("revision").notNull(),
    planVersionId: uuid("plan_version_id").references(() => studentRoadmapVersions.id, { onDelete: "set null" }),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    studentIdx: index("student_roadmap_progress_events_student_idx").on(table.studentId, table.itemKey, table.taskKey),
  }),
);

export type StudentRoadmapPlanRow = typeof studentRoadmapPlans.$inferSelect;
export type StudentRoadmapVersionRow = typeof studentRoadmapVersions.$inferSelect;
export type StudentRoadmapImportRow = typeof studentRoadmapImports.$inferSelect;
export type StudentRoadmapProgressRow = typeof studentRoadmapProgress.$inferSelect;
export type StudentRoadmapProgressEventRow = typeof studentRoadmapProgressEvents.$inferSelect;
