/**
 * Student Roadmap Repository — data access only (S05).
 *
 * No business rules. Every function takes the Tx last (default: the shared
 * db) so the service can run a whole operation in ONE transaction. The plan
 * row is the lock: mutating operations call lockPlan*() first
 * (SELECT ... FOR UPDATE) which serializes publish / import / edit / progress
 * for one student.
 *
 * Progress rows are never deleted. Progress events are append-only.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "../lib/db";
import { studentsTable } from "@shared/schema";
import {
  studentRoadmapImports,
  studentRoadmapPlans,
  studentRoadmapProgress,
  studentRoadmapProgressEvents,
  studentRoadmapVersions,
  type StudentRoadmapImportRow,
  type StudentRoadmapPlanRow,
  type StudentRoadmapProgressRow,
  type StudentRoadmapVersionRow,
} from "@shared/student-roadmap-schema";

export type Tx = PgTransaction<any, any, any> | typeof db;

export type PlanRow = StudentRoadmapPlanRow;
export type VersionRow = StudentRoadmapVersionRow;
export type ImportRow = StudentRoadmapImportRow;
export type ProgressRow = StudentRoadmapProgressRow;

export interface NewVersion {
  readonly planId: string;
  readonly versionNumber: number;
  readonly content: unknown;
  readonly baseVersionId: string | null;
  readonly importId: string | null;
  readonly exceptions: unknown;
  readonly acknowledgements: unknown;
  readonly createdBy: string | null;
}

export interface DraftPatch {
  readonly content?: unknown;
  readonly exceptions?: unknown;
  readonly acknowledgements?: unknown;
  readonly draftRevision?: number;
  readonly status?: "draft" | "published" | "superseded" | "discarded";
  readonly publishedBy?: string | null;
  readonly publishedAt?: Date | null;
  readonly supersededAt?: Date | null;
  readonly discardedAt?: Date | null;
}

export interface NewImport {
  readonly planId: string;
  readonly studentId: string;
  readonly fileSha256: string;
  readonly fileName: string | null;
  readonly templateId: string;
  readonly baseVersionId: string | null;
  readonly summary: unknown;
  readonly exceptions: unknown;
  readonly resultingVersionId: string | null;
  readonly createdBy: string | null;
}

export interface ProgressUpsert {
  readonly studentId: string;
  readonly itemKey: string;
  readonly taskKey: string;
  readonly status: string;
  readonly revision: number;
  readonly updatedBy: string | null;
  readonly updatedAt: Date;
  /** True when a row already exists (update), false to insert. */
  readonly exists: boolean;
}

export interface NewProgressEvent {
  readonly studentId: string;
  readonly itemKey: string;
  readonly taskKey: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly revision: number;
  readonly planVersionId: string | null;
  readonly actorId: string | null;
}

/** The persistence port the service depends on. */
export interface RoadmapRepository {
  studentExists(studentId: string, tx: Tx): Promise<boolean>;
  getPlan(studentId: string, tx: Tx): Promise<PlanRow | null>;
  /** SELECT ... FOR UPDATE; null when the student has no plan yet. */
  lockPlan(studentId: string, tx: Tx): Promise<PlanRow | null>;
  /** Creates the plan lazily (idempotent) and returns it locked. */
  ensureAndLockPlan(studentId: string, tx: Tx): Promise<PlanRow>;
  setPublished(planId: string, versionId: string, now: Date, tx: Tx): Promise<PlanRow>;
  getVersion(versionId: string, tx: Tx): Promise<VersionRow | null>;
  getOpenDraft(planId: string, tx: Tx): Promise<VersionRow | null>;
  listVersions(planId: string, tx: Tx): Promise<VersionRow[]>;
  nextVersionNumber(planId: string, tx: Tx): Promise<number>;
  insertVersion(input: NewVersion, tx: Tx): Promise<VersionRow>;
  updateVersion(versionId: string, patch: DraftPatch, tx: Tx): Promise<VersionRow>;
  findImport(planId: string, fileSha256: string, baseVersionId: string | null, tx: Tx): Promise<ImportRow | null>;
  getImport(importId: string, tx: Tx): Promise<ImportRow | null>;
  insertImport(input: NewImport, tx: Tx): Promise<ImportRow>;
  updateImport(importId: string, patch: Partial<NewImport>, tx: Tx): Promise<ImportRow>;
  listProgress(studentId: string, tx: Tx): Promise<ProgressRow[]>;
  /** Row lock on one progress row (null when absent). */
  getProgressForUpdate(studentId: string, itemKey: string, taskKey: string, tx: Tx): Promise<ProgressRow | null>;
  upsertProgress(input: ProgressUpsert, tx: Tx): Promise<ProgressRow>;
  appendProgressEvent(input: NewProgressEvent, tx: Tx): Promise<void>;
}

export const roadmapRepository: RoadmapRepository = {
  async studentExists(studentId, tx = db) {
    const rows = await tx.select({ id: studentsTable.id }).from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
    return rows.length > 0;
  },

  async getPlan(studentId, tx = db) {
    const [row] = await tx.select().from(studentRoadmapPlans).where(eq(studentRoadmapPlans.studentId, studentId)).limit(1);
    return row ?? null;
  },

  async lockPlan(studentId, tx = db) {
    const [row] = await tx
      .select()
      .from(studentRoadmapPlans)
      .where(eq(studentRoadmapPlans.studentId, studentId))
      .limit(1)
      .for("update");
    return row ?? null;
  },

  async ensureAndLockPlan(studentId, tx = db) {
    await tx.insert(studentRoadmapPlans).values({ studentId }).onConflictDoNothing({ target: studentRoadmapPlans.studentId });
    const row = await roadmapRepository.lockPlan(studentId, tx);
    if (!row) throw new Error("roadmap plan could not be created");
    return row;
  },

  async setPublished(planId, versionId, now, tx = db) {
    const [row] = await tx
      .update(studentRoadmapPlans)
      .set({
        publishedVersionId: versionId,
        revision: sql`${studentRoadmapPlans.revision} + 1`,
        updatedAt: now,
      })
      .where(eq(studentRoadmapPlans.id, planId))
      .returning();
    return row;
  },

  async getVersion(versionId, tx = db) {
    const [row] = await tx.select().from(studentRoadmapVersions).where(eq(studentRoadmapVersions.id, versionId)).limit(1);
    return row ?? null;
  },

  async getOpenDraft(planId, tx = db) {
    const [row] = await tx
      .select()
      .from(studentRoadmapVersions)
      .where(and(eq(studentRoadmapVersions.planId, planId), eq(studentRoadmapVersions.status, "draft")))
      .limit(1);
    return row ?? null;
  },

  async listVersions(planId, tx = db) {
    return tx
      .select()
      .from(studentRoadmapVersions)
      .where(eq(studentRoadmapVersions.planId, planId))
      .orderBy(desc(studentRoadmapVersions.versionNumber));
  },

  async nextVersionNumber(planId, tx = db) {
    const [row] = await tx
      .select({ max: sql<number | null>`max(${studentRoadmapVersions.versionNumber})` })
      .from(studentRoadmapVersions)
      .where(eq(studentRoadmapVersions.planId, planId));
    return Number(row?.max ?? 0) + 1;
  },

  async insertVersion(input, tx = db) {
    const [row] = await tx
      .insert(studentRoadmapVersions)
      .values({
        planId: input.planId,
        versionNumber: input.versionNumber,
        status: "draft",
        content: input.content,
        baseVersionId: input.baseVersionId,
        importId: input.importId,
        exceptions: input.exceptions,
        acknowledgements: input.acknowledgements,
        createdBy: input.createdBy,
      })
      .returning();
    return row;
  },

  async updateVersion(versionId, patch, tx = db) {
    const [row] = await tx
      .update(studentRoadmapVersions)
      .set(patch as Partial<typeof studentRoadmapVersions.$inferInsert>)
      .where(eq(studentRoadmapVersions.id, versionId))
      .returning();
    return row;
  },

  async findImport(planId, fileSha256, baseVersionId, tx = db) {
    const [row] = await tx
      .select()
      .from(studentRoadmapImports)
      .where(and(
        eq(studentRoadmapImports.planId, planId),
        eq(studentRoadmapImports.fileSha256, fileSha256),
        sql`COALESCE(${studentRoadmapImports.baseVersionId}::text, '') = ${baseVersionId ?? ""}`,
      ))
      .limit(1);
    return row ?? null;
  },

  async getImport(importId, tx = db) {
    const [row] = await tx.select().from(studentRoadmapImports).where(eq(studentRoadmapImports.id, importId)).limit(1);
    return row ?? null;
  },

  async insertImport(input, tx = db) {
    const [row] = await tx.insert(studentRoadmapImports).values(input).returning();
    return row;
  },

  async updateImport(importId, patch, tx = db) {
    const [row] = await tx
      .update(studentRoadmapImports)
      .set(patch as Partial<typeof studentRoadmapImports.$inferInsert>)
      .where(eq(studentRoadmapImports.id, importId))
      .returning();
    return row;
  },

  async listProgress(studentId, tx = db) {
    return tx.select().from(studentRoadmapProgress).where(eq(studentRoadmapProgress.studentId, studentId));
  },

  async getProgressForUpdate(studentId, itemKey, taskKey, tx = db) {
    const [row] = await tx
      .select()
      .from(studentRoadmapProgress)
      .where(and(
        eq(studentRoadmapProgress.studentId, studentId),
        eq(studentRoadmapProgress.itemKey, itemKey),
        eq(studentRoadmapProgress.taskKey, taskKey),
      ))
      .limit(1)
      .for("update");
    return row ?? null;
  },

  async upsertProgress(input, tx = db) {
    if (input.exists) {
      const [row] = await tx
        .update(studentRoadmapProgress)
        .set({ status: input.status, revision: input.revision, updatedBy: input.updatedBy, updatedAt: input.updatedAt })
        .where(and(
          eq(studentRoadmapProgress.studentId, input.studentId),
          eq(studentRoadmapProgress.itemKey, input.itemKey),
          eq(studentRoadmapProgress.taskKey, input.taskKey),
        ))
        .returning();
      return row;
    }
    const [row] = await tx
      .insert(studentRoadmapProgress)
      .values({
        studentId: input.studentId,
        itemKey: input.itemKey,
        taskKey: input.taskKey,
        status: input.status,
        revision: input.revision,
        updatedBy: input.updatedBy,
        updatedAt: input.updatedAt,
      })
      .returning();
    return row;
  },

  async appendProgressEvent(input, tx = db) {
    await tx.insert(studentRoadmapProgressEvents).values(input);
  },
};

