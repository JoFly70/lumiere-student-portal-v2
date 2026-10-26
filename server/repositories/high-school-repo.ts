/**
 * High School Pathway repository — data access only (S11).
 *
 * No business rules. Every function takes the Tx last so the service can run a
 * whole operation in ONE transaction. The enrollment row is the lock
 * (lockEnrollment = SELECT ... FOR UPDATE), which serializes publish, results,
 * awards, progress and graduation for one enrollment.
 *
 * Progress, results and awards are never deleted (DB triggers also refuse it).
 * student_documents, student_contacts and the university assignment tables are
 * only READ here, through raw SQL / the existing academic repo.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "../lib/db";
import { studentsTable } from "@shared/schema";
import {
  hsCreditAwards,
  hsCurriculumTemplates,
  hsEnrollments,
  hsEvents,
  hsGraduationRecords,
  hsOfficialResults,
  hsPriorEducation,
  hsRoadmapVersions,
  hsTaskProgress,
  hsTaskProgressEvents,
  hsTransferClaims,
  type HsCreditAwardRow,
  type HsEnrollmentRow,
  type HsEventRow,
  type HsGraduationRow,
  type HsOfficialResultRow,
  type HsPriorEducationRow,
  type HsRoadmapVersionRow,
  type HsTaskProgressRow,
  type HsTemplateRow,
  type HsTransferClaimRow,
} from "@shared/high-school-schema";
import { listAssignments, getProgramVersionWithProgram } from "./student-academic-repo";

export type Tx = PgTransaction<any, any, any> | typeof db;

export type {
  HsCreditAwardRow,
  HsEnrollmentRow,
  HsEventRow,
  HsGraduationRow,
  HsOfficialResultRow,
  HsPriorEducationRow,
  HsRoadmapVersionRow,
  HsTaskProgressRow,
  HsTemplateRow,
  HsTransferClaimRow,
};

export interface ContactRow {
  readonly id: string;
  readonly type: string;
  readonly full_name: string;
  readonly relationship: string;
  readonly scopes: string[];
  readonly authority_status: string | null;
}

export interface UniversityProgramRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

const first = <T>(rows: readonly T[]): T | null => rows[0] ?? null;

export const highSchoolRepository = {
  // ── students and foreign (read-only) tables ──────────────────────────────
  async studentExists(studentId: string, tx: Tx = db): Promise<boolean> {
    const rows = await tx.select({ id: studentsTable.id }).from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
    return rows.length > 0;
  },

  /** A student_documents row of THIS student with status 'verified' (and not soft-deleted). */
  async isVerifiedDocument(studentId: string, documentId: string, tx: Tx = db): Promise<boolean> {
    const rows = (await tx.execute(
      sql`SELECT 1 AS ok FROM student_documents
          WHERE id = ${documentId} AND student_id = ${studentId}
            AND status::text = 'verified' AND COALESCE(soft_deleted, false) = false
          LIMIT 1`,
    )) as unknown as unknown[];
    return rows.length > 0;
  },

  async listContacts(studentId: string, tx: Tx = db): Promise<ContactRow[]> {
    const rows = (await tx.execute(
      sql`SELECT id, type::text AS type, full_name, relationship, scopes, authority_status
          FROM student_contacts WHERE student_id = ${studentId} ORDER BY created_at ASC`,
    )) as unknown as ContactRow[];
    return Array.from(rows);
  },

  async getContact(studentId: string, contactId: string, tx: Tx = db): Promise<ContactRow | null> {
    const rows = (await tx.execute(
      sql`SELECT id, type::text AS type, full_name, relationship, scopes, authority_status
          FROM student_contacts WHERE student_id = ${studentId} AND id = ${contactId} LIMIT 1`,
    )) as unknown as ContactRow[];
    return rows[0] ?? null;
  },

  /** Read-only: the student's university degree assignments (never modified by S11). */
  async listUniversityPrograms(studentId: string, tx: Tx = db): Promise<UniversityProgramRow[]> {
    const assignments = await listAssignments(studentId, tx as never);
    const out: UniversityProgramRow[] = [];
    for (const a of assignments) {
      const pv = await getProgramVersionWithProgram(a.programVersionId, tx as never);
      out.push({ id: a.id, title: pv?.program?.name ?? "University degree program", status: String(a.status) });
    }
    return out;
  },

  // ── templates ────────────────────────────────────────────────────────────
  async getTemplate(templateKey: string, version: number, tx: Tx = db): Promise<HsTemplateRow | null> {
    return first(
      await tx
        .select()
        .from(hsCurriculumTemplates)
        .where(and(eq(hsCurriculumTemplates.templateKey, templateKey), eq(hsCurriculumTemplates.version, version)))
        .limit(1),
    );
  },

  async listTemplates(tx: Tx = db): Promise<HsTemplateRow[]> {
    return tx.select().from(hsCurriculumTemplates).orderBy(asc(hsCurriculumTemplates.templateKey), asc(hsCurriculumTemplates.version));
  },

  async insertTemplateIfAbsent(
    row: { templateKey: string; version: number; title: string; jurisdiction: string | null; totalRequiredHalfUnits: number; definition: unknown; createdBy: string | null },
    tx: Tx = db,
  ): Promise<void> {
    await tx.insert(hsCurriculumTemplates).values(row).onConflictDoNothing();
  },

  // ── enrollments ──────────────────────────────────────────────────────────
  async getEnrollment(enrollmentId: string, tx: Tx = db): Promise<HsEnrollmentRow | null> {
    return first(await tx.select().from(hsEnrollments).where(eq(hsEnrollments.id, enrollmentId)).limit(1));
  },

  async lockEnrollment(enrollmentId: string, tx: Tx = db): Promise<HsEnrollmentRow | null> {
    return first(await tx.select().from(hsEnrollments).where(eq(hsEnrollments.id, enrollmentId)).limit(1).for("update"));
  },

  /** Serializes enrollment creation for one student (the student row is the lock). */
  async lockStudent(studentId: string, tx: Tx = db): Promise<void> {
    await tx.execute(sql`SELECT id FROM students WHERE id = ${studentId} FOR UPDATE`);
  },

  async listEnrollments(studentId: string, tx: Tx = db): Promise<HsEnrollmentRow[]> {
    return tx.select().from(hsEnrollments).where(eq(hsEnrollments.studentId, studentId)).orderBy(desc(hsEnrollments.createdAt), desc(hsEnrollments.id));
  },

  async insertEnrollment(row: typeof hsEnrollments.$inferInsert, tx: Tx = db): Promise<HsEnrollmentRow> {
    const [r] = await tx.insert(hsEnrollments).values(row).returning();
    return r;
  },

  async updateEnrollment(id: string, patch: Partial<typeof hsEnrollments.$inferInsert>, tx: Tx = db): Promise<HsEnrollmentRow> {
    const [r] = await tx.update(hsEnrollments).set({ ...patch, updatedAt: new Date() }).where(eq(hsEnrollments.id, id)).returning();
    return r;
  },

  // ── prior education and claims ───────────────────────────────────────────
  async insertPriorEducation(row: typeof hsPriorEducation.$inferInsert, tx: Tx = db): Promise<HsPriorEducationRow> {
    const [r] = await tx.insert(hsPriorEducation).values(row).returning();
    return r;
  },
  async getPriorEducation(id: string, tx: Tx = db): Promise<HsPriorEducationRow | null> {
    return first(await tx.select().from(hsPriorEducation).where(eq(hsPriorEducation.id, id)).limit(1));
  },
  async listPriorEducation(enrollmentId: string, tx: Tx = db): Promise<HsPriorEducationRow[]> {
    return tx.select().from(hsPriorEducation).where(eq(hsPriorEducation.enrollmentId, enrollmentId)).orderBy(asc(hsPriorEducation.createdAt));
  },
  async insertClaim(row: typeof hsTransferClaims.$inferInsert, tx: Tx = db): Promise<HsTransferClaimRow> {
    const [r] = await tx.insert(hsTransferClaims).values(row).returning();
    return r;
  },
  async getClaim(id: string, tx: Tx = db): Promise<HsTransferClaimRow | null> {
    return first(await tx.select().from(hsTransferClaims).where(eq(hsTransferClaims.id, id)).limit(1));
  },
  async lockClaim(id: string, tx: Tx = db): Promise<HsTransferClaimRow | null> {
    return first(await tx.select().from(hsTransferClaims).where(eq(hsTransferClaims.id, id)).limit(1).for("update"));
  },
  async listClaims(enrollmentId: string, tx: Tx = db): Promise<HsTransferClaimRow[]> {
    return tx.select().from(hsTransferClaims).where(eq(hsTransferClaims.enrollmentId, enrollmentId)).orderBy(asc(hsTransferClaims.createdAt));
  },
  async updateClaim(id: string, patch: Partial<typeof hsTransferClaims.$inferInsert>, tx: Tx = db): Promise<HsTransferClaimRow> {
    const [r] = await tx.update(hsTransferClaims).set(patch).where(eq(hsTransferClaims.id, id)).returning();
    return r;
  },

  // ── roadmap versions ─────────────────────────────────────────────────────
  async getVersion(id: string, tx: Tx = db): Promise<HsRoadmapVersionRow | null> {
    return first(await tx.select().from(hsRoadmapVersions).where(eq(hsRoadmapVersions.id, id)).limit(1));
  },
  async getVersionByStatus(enrollmentId: string, status: "draft" | "published", tx: Tx = db): Promise<HsRoadmapVersionRow | null> {
    return first(
      await tx.select().from(hsRoadmapVersions).where(and(eq(hsRoadmapVersions.enrollmentId, enrollmentId), eq(hsRoadmapVersions.status, status))).limit(1),
    );
  },
  async listVersions(enrollmentId: string, tx: Tx = db): Promise<HsRoadmapVersionRow[]> {
    return tx.select().from(hsRoadmapVersions).where(eq(hsRoadmapVersions.enrollmentId, enrollmentId)).orderBy(desc(hsRoadmapVersions.versionNumber));
  },
  async nextVersionNumber(enrollmentId: string, tx: Tx = db): Promise<number> {
    const [r] = await tx
      .select({ n: sql<number>`COALESCE(MAX(${hsRoadmapVersions.versionNumber}), 0)::int` })
      .from(hsRoadmapVersions)
      .where(eq(hsRoadmapVersions.enrollmentId, enrollmentId));
    return Number(r?.n ?? 0) + 1;
  },
  async insertVersion(row: typeof hsRoadmapVersions.$inferInsert, tx: Tx = db): Promise<HsRoadmapVersionRow> {
    const [r] = await tx.insert(hsRoadmapVersions).values(row).returning();
    return r;
  },
  async updateVersion(id: string, patch: Partial<typeof hsRoadmapVersions.$inferInsert>, tx: Tx = db): Promise<HsRoadmapVersionRow> {
    const [r] = await tx.update(hsRoadmapVersions).set(patch).where(eq(hsRoadmapVersions.id, id)).returning();
    return r;
  },

  // ── progress ─────────────────────────────────────────────────────────────
  async listProgress(enrollmentId: string, tx: Tx = db): Promise<HsTaskProgressRow[]> {
    return tx.select().from(hsTaskProgress).where(eq(hsTaskProgress.enrollmentId, enrollmentId));
  },
  async getProgressForUpdate(enrollmentId: string, courseKey: string, taskKey: string, tx: Tx = db): Promise<HsTaskProgressRow | null> {
    return first(
      await tx
        .select()
        .from(hsTaskProgress)
        .where(and(eq(hsTaskProgress.enrollmentId, enrollmentId), eq(hsTaskProgress.courseKey, courseKey), eq(hsTaskProgress.taskKey, taskKey)))
        .limit(1)
        .for("update"),
    );
  },
  async insertProgress(row: typeof hsTaskProgress.$inferInsert, tx: Tx = db): Promise<HsTaskProgressRow> {
    const [r] = await tx.insert(hsTaskProgress).values(row).returning();
    return r;
  },
  async updateProgress(id: string, patch: Partial<typeof hsTaskProgress.$inferInsert>, tx: Tx = db): Promise<HsTaskProgressRow> {
    const [r] = await tx.update(hsTaskProgress).set(patch).where(eq(hsTaskProgress.id, id)).returning();
    return r;
  },
  async appendProgressEvent(row: typeof hsTaskProgressEvents.$inferInsert, tx: Tx = db): Promise<void> {
    await tx.insert(hsTaskProgressEvents).values(row);
  },
  async countProgressEvents(enrollmentId: string, tx: Tx = db): Promise<number> {
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(hsTaskProgressEvents).where(eq(hsTaskProgressEvents.enrollmentId, enrollmentId));
    return Number(r?.n ?? 0);
  },

  // ── official results ─────────────────────────────────────────────────────
  async listResults(enrollmentId: string, tx: Tx = db): Promise<HsOfficialResultRow[]> {
    return tx.select().from(hsOfficialResults).where(eq(hsOfficialResults.enrollmentId, enrollmentId)).orderBy(asc(hsOfficialResults.recordedAt), asc(hsOfficialResults.id));
  },
  async insertResult(row: typeof hsOfficialResults.$inferInsert, tx: Tx = db): Promise<HsOfficialResultRow> {
    const [r] = await tx.insert(hsOfficialResults).values(row).returning();
    return r;
  },
  async voidResult(id: string, now: Date, tx: Tx = db): Promise<void> {
    await tx.update(hsOfficialResults).set({ status: "voided", voidedAt: now }).where(eq(hsOfficialResults.id, id));
  },

  // ── credit awards ────────────────────────────────────────────────────────
  async listAwards(enrollmentId: string, tx: Tx = db): Promise<HsCreditAwardRow[]> {
    return tx.select().from(hsCreditAwards).where(eq(hsCreditAwards.enrollmentId, enrollmentId)).orderBy(asc(hsCreditAwards.recordedAt), asc(hsCreditAwards.id));
  },
  async getAward(id: string, tx: Tx = db): Promise<HsCreditAwardRow | null> {
    return first(await tx.select().from(hsCreditAwards).where(eq(hsCreditAwards.id, id)).limit(1));
  },
  async insertAward(row: typeof hsCreditAwards.$inferInsert, tx: Tx = db): Promise<HsCreditAwardRow> {
    const [r] = await tx.insert(hsCreditAwards).values(row).returning();
    return r;
  },
  async voidAward(id: string, patch: { voidReason: string; voidedBy: string | null; voidedAt: Date }, tx: Tx = db): Promise<HsCreditAwardRow> {
    const [r] = await tx.update(hsCreditAwards).set({ status: "voided", ...patch }).where(eq(hsCreditAwards.id, id)).returning();
    return r;
  },

  // ── graduation ───────────────────────────────────────────────────────────
  async getGraduation(enrollmentId: string, tx: Tx = db): Promise<HsGraduationRow | null> {
    return first(await tx.select().from(hsGraduationRecords).where(eq(hsGraduationRecords.enrollmentId, enrollmentId)).limit(1));
  },
  async insertGraduationIfAbsent(row: typeof hsGraduationRecords.$inferInsert, tx: Tx = db): Promise<void> {
    await tx.insert(hsGraduationRecords).values(row).onConflictDoNothing({ target: hsGraduationRecords.enrollmentId });
  },
  async updateGraduation(enrollmentId: string, patch: Partial<typeof hsGraduationRecords.$inferInsert>, tx: Tx = db): Promise<HsGraduationRow> {
    const [r] = await tx
      .update(hsGraduationRecords)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(hsGraduationRecords.enrollmentId, enrollmentId))
      .returning();
    return r;
  },

  // ── events ───────────────────────────────────────────────────────────────
  async appendEvent(row: typeof hsEvents.$inferInsert, tx: Tx = db): Promise<void> {
    await tx.insert(hsEvents).values(row);
  },
  async listEvents(studentId: string, limit: number, tx: Tx = db): Promise<HsEventRow[]> {
    return tx.select().from(hsEvents).where(eq(hsEvents.studentId, studentId)).orderBy(desc(hsEvents.createdAt), desc(hsEvents.id)).limit(limit);
  },
  async listEventsByType(studentId: string, eventType: string, tx: Tx = db): Promise<HsEventRow[]> {
    return tx
      .select()
      .from(hsEvents)
      .where(and(eq(hsEvents.studentId, studentId), eq(hsEvents.eventType, eventType)))
      .orderBy(asc(hsEvents.createdAt), asc(hsEvents.id));
  },

  /** Course keys / "course|task" keys that carry activity and so may never be deleted from a plan. */
  async activityKeys(enrollmentId: string, tx: Tx = db): Promise<{ courses: Set<string>; tasks: Set<string> }> {
    const progress = await tx
      .select({ c: hsTaskProgress.courseKey, t: hsTaskProgress.taskKey })
      .from(hsTaskProgress)
      .where(eq(hsTaskProgress.enrollmentId, enrollmentId));
    const results = await tx
      .select({ c: hsOfficialResults.courseKey, t: hsOfficialResults.taskKey })
      .from(hsOfficialResults)
      .where(eq(hsOfficialResults.enrollmentId, enrollmentId));
    const awards = await tx
      .select({ c: hsCreditAwards.courseKey })
      .from(hsCreditAwards)
      .where(and(eq(hsCreditAwards.enrollmentId, enrollmentId), inArray(hsCreditAwards.source, ["course_completion"])));
    const courses = new Set<string>();
    const tasks = new Set<string>();
    for (const r of [...progress, ...results]) {
      courses.add(r.c);
      if (r.t) tasks.add(`${r.c}|${r.t}`);
    }
    for (const a of awards) if (a.c) courses.add(a.c);
    return { courses, tasks };
  },
};

export type HighSchoolRepository = typeof highSchoolRepository;
