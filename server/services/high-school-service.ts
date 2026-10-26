/**
 * High School Pathway service (S11).
 *
 * Lumière coordinates; the awarding school decides. Business rules:
 *   - credit exists only as ACTIVE rows of hs_credit_awards, recorded by staff
 *     against a VERIFIED student_documents row of the same student;
 *   - student reports (progress) never become official;
 *   - retake / pace policies apply only when configured in the published roadmap;
 *   - published roadmap versions are immutable; progress and results survive
 *     rescheduling and replacement of courses;
 *   - university tables are never written.
 *
 * Every mutation runs in ONE transaction and locks the enrollment row first.
 * Each mutation returns the refreshed read model plus audit records for the
 * route layer (identifiers and counts only, never notes or personal data).
 */
import {
  BUILT_IN_TEMPLATES,
  HS_ERROR_CODES,
  HS_EVIDENCE_DOC_TYPES,
  HS_OPEN_ENROLLMENT_STATUSES,
  formatHalfUnits,
  hsRoadmapContentSchema,
  validateTemplate,
  type HsAuditEvent,
  type HsCreditAwardView,
  type HsCurriculumTemplate,
  type HsPlanCourse,
  type HsEnrollmentStatus,
  type HsEnrollmentSummary,
  type HsErrorCode,
  type HsEventView,
  type HsEvidencePurpose,
  type HsGraduationAction,
  type HsOfficialResultView,
  type HsRoadmapContent,
  type HsRoadmapVersionView,
  type HsStudentProgressInput,
  type HsVersionStatus,
  type StaffHighSchoolState,
  type StudentHighSchoolView,
  type StudentProgramsView,
  type TransferClaimStatus,
  type PriorEducationStatus,
  type HsGraduationStatus,
  type HsDeliveryStatus,
  type HsFinancialClearance,
  type HsTaskKind,
} from "@shared/high-school-contract";
import type { z } from "zod";
import type {
  createEnrollmentSchema,
  updateEnrollmentSchema,
  recordPriorEducationSchema,
  transferClaimSchema,
  resolveTransferClaimSchema,
  recordTaskResultSchema,
  recordCourseResultSchema,
  recordTransferAwardSchema,
  historicalGraduateSchema,
} from "@shared/high-school-contract";
import {
  buildCourseViews,
  computeCreditSummary,
  computeReviewQueue,
  contentFromTemplate,
  creditBlockers,
  effectivePolicies,
  projectGraduationView,
  projectStudentView,
  toGuardianView,
  validateRoadmapContent,
  type HsAwardRecord,
  type HsCourseResultRecord,
  type HsGraduationRecordInput,
  type HsProgressRecord,
  type HsProjectionInput,
  type HsTaskResultRecord,
} from "@shared/high-school-projection";
import type {
  HighSchoolRepository,
  HsCreditAwardRow,
  HsEnrollmentRow,
  HsGraduationRow,
  HsOfficialResultRow,
  HsRoadmapVersionRow,
  HsTaskProgressRow,
  Tx,
} from "../repositories/high-school-repo";

// ── Errors ───────────────────────────────────────────────────────────────────

export class HsError extends Error {
  constructor(
    readonly code: HsErrorCode,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HsError";
  }
}

const E = HS_ERROR_CODES;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Types ────────────────────────────────────────────────────────────────────

export type HsAuditMetadata = Record<string, string | number | boolean | null | readonly string[]>;

/** Identifiers and counts only. */
export interface HsAuditRecord {
  readonly event: HsAuditEvent;
  readonly description: string;
  readonly studentId: string;
  readonly metadata: HsAuditMetadata;
}

export interface HsMutation<T> {
  readonly result: T;
  readonly audits: readonly HsAuditRecord[];
}

export interface HighSchoolServiceDeps {
  readonly repo: HighSchoolRepository;
  readonly transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  readonly readTx: Tx;
  readonly now: () => Date;
}

type CreateEnrollmentInput = z.infer<typeof createEnrollmentSchema>;
type UpdateEnrollmentInput = z.infer<typeof updateEnrollmentSchema>;
type PriorEducationInput = z.infer<typeof recordPriorEducationSchema>;
type TransferClaimInput = z.infer<typeof transferClaimSchema>;
type ResolveClaimInput = z.infer<typeof resolveTransferClaimSchema>;
type TaskResultInput = z.infer<typeof recordTaskResultSchema>;
type CourseResultInput = z.infer<typeof recordCourseResultSchema>;
type TransferAwardInput = z.infer<typeof recordTransferAwardSchema>;
type HistoricalInput = z.infer<typeof historicalGraduateSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;
const isoOf = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function isUniqueViolation(error: unknown): boolean {
  let e: any = error;
  for (let i = 0; e && i < 4; i += 1) {
    if (e.code === "23505") return true;
    e = e.cause;
  }
  return false;
}

const DELIVERY_ORDER: readonly HsDeliveryStatus[] = ["not_requested", "requested", "issued", "delivered"];
const isOpen = (status: string): boolean => (HS_OPEN_ENROLLMENT_STATUSES as readonly string[]).includes(status);

export function createHighSchoolService(deps: HighSchoolServiceDeps) {
  const { repo } = deps;
  let templatesEnsured: Promise<void> | null = null;

  // ── templates ──────────────────────────────────────────────────────────────

  /** Inserts the built-in templates (idempotent). Runs outside any mutation transaction. */
  function ensureBuiltInTemplates(): Promise<void> {
    if (!templatesEnsured) {
      templatesEnsured = (async () => {
        for (const t of BUILT_IN_TEMPLATES) {
          await repo.insertTemplateIfAbsent(
            {
              templateKey: t.templateKey,
              version: t.version,
              title: t.title,
              jurisdiction: t.jurisdiction,
              totalRequiredHalfUnits: t.totalRequiredHalfUnits,
              definition: t,
              createdBy: null,
            },
            deps.readTx,
          );
        }
      })().catch((error) => {
        templatesEnsured = null;
        throw error;
      });
    }
    return templatesEnsured;
  }

  async function loadTemplate(key: string, version: number, tx: Tx): Promise<HsCurriculumTemplate> {
    const row = await repo.getTemplate(key, version, tx);
    if (!row) throw new HsError(E.TEMPLATE_NOT_FOUND, 404, "Curriculum template not found");
    return row.definition as HsCurriculumTemplate;
  }

  async function listTemplates(): Promise<HsCurriculumTemplate[]> {
    await ensureBuiltInTemplates();
    const rows = await repo.listTemplates(deps.readTx);
    return rows.map((r) => r.definition as HsCurriculumTemplate);
  }

  async function createTemplate(actorId: string, template: HsCurriculumTemplate): Promise<HsMutation<HsCurriculumTemplate>> {
    await ensureBuiltInTemplates();
    const errors = validateTemplate(template);
    if (errors.length > 0) throw new HsError(E.TEMPLATE_INVALID, 422, "Template is not valid", { errors });
    return deps.transaction(async (tx) => {
      if (await repo.getTemplate(template.templateKey, template.version, tx)) {
        throw new HsError(E.ALREADY_RECORDED, 409, "This template version already exists; published templates are immutable");
      }
      await repo.insertTemplateIfAbsent(
        {
          templateKey: template.templateKey,
          version: template.version,
          title: template.title,
          jurisdiction: template.jurisdiction,
          totalRequiredHalfUnits: template.totalRequiredHalfUnits,
          definition: template,
          createdBy: actorId,
        },
        tx,
      );
      return { result: template, audits: [] };
    });
  }

  // ── shared loading ─────────────────────────────────────────────────────────

  async function requireStudent(studentId: string, tx: Tx): Promise<void> {
    if (!(await repo.studentExists(studentId, tx))) throw new HsError(E.STUDENT_NOT_FOUND, 404, "Student not found");
  }

  /** The enrollment must exist AND belong to this student (cross-student ids are 404). */
  async function requireEnrollment(studentId: string, enrollmentId: string, tx: Tx, lock = false): Promise<HsEnrollmentRow> {
    if (!UUID_RE.test(enrollmentId)) throw new HsError(E.NO_ENROLLMENT, 404, "Enrollment not found");
    const row = lock ? await repo.lockEnrollment(enrollmentId, tx) : await repo.getEnrollment(enrollmentId, tx);
    if (!row || row.studentId !== studentId) throw new HsError(E.NO_ENROLLMENT, 404, "Enrollment not found");
    return row;
  }

  function assertOpen(e: HsEnrollmentRow): void {
    if (!isOpen(e.status)) {
      throw new HsError(E.OFFICIAL_RECORD_LOCKED, 409, `This enrollment is ${e.status.replace(/_/g, " ")} and its records are locked`);
    }
  }

  /**
   * Evidence must be a verified document of THIS student. With a `purpose` its
   * doc_type must also be in HS_EVIDENCE_DOC_TYPES[purpose] (e.g. diploma evidence
   * must be an hs_diploma document).
   */
  async function assertEvidence(studentId: string, documentId: string, field: string, tx: Tx, purpose?: HsEvidencePurpose): Promise<void> {
    const docType = await repo.getVerifiedDocumentType(studentId, documentId, tx);
    if (docType === null) {
      throw new HsError(E.EVIDENCE_INVALID, 422, "Evidence must be a verified document of this student", { field });
    }
    if (purpose) {
      const allowed: readonly string[] = HS_EVIDENCE_DOC_TYPES[purpose];
      if (!allowed.includes(docType)) {
        throw new HsError(
          E.EVIDENCE_INVALID,
          422,
          `This evidence must be a document of type ${allowed.join(" or ")}, but the document is of type ${docType}`,
          { field, allowedDocTypes: [...allowed], docType },
        );
      }
    }
  }

  const todayIso = (now: Date): string => now.toISOString().slice(0, 10);

  function currentOf<T extends { status: string }>(rows: readonly T[]): T | null {
    return rows.find((r) => isOpen(r.status)) ?? rows[0] ?? null;
  }

  interface Bundle {
    enrollment: HsEnrollmentRow;
    template: HsCurriculumTemplate;
    draft: HsRoadmapVersionRow | null;
    published: HsRoadmapVersionRow | null;
    versions: HsRoadmapVersionRow[];
    progress: HsTaskProgressRow[];
    results: HsOfficialResultRow[];
    awards: HsCreditAwardRow[];
    priorEducation: Awaited<ReturnType<HighSchoolRepository["listPriorEducation"]>>;
    claims: Awaited<ReturnType<HighSchoolRepository["listClaims"]>>;
    graduation: HsGraduationRow | null;
  }

  async function loadBundle(enrollment: HsEnrollmentRow, tx: Tx): Promise<Bundle> {
    const [template, versions, progress, results, awards, priorEducation, claims, graduation] = await Promise.all([
      loadTemplate(enrollment.templateKey, enrollment.templateVersion, tx),
      repo.listVersions(enrollment.id, tx),
      repo.listProgress(enrollment.id, tx),
      repo.listResults(enrollment.id, tx),
      repo.listAwards(enrollment.id, tx),
      repo.listPriorEducation(enrollment.id, tx),
      repo.listClaims(enrollment.id, tx),
      repo.getGraduation(enrollment.id, tx),
    ]);
    return {
      enrollment,
      template,
      draft: versions.find((v) => v.status === "draft") ?? null,
      published: versions.find((v) => v.status === "published") ?? null,
      versions,
      progress,
      results,
      awards,
      priorEducation,
      claims,
      graduation,
    };
  }

  const contentOf = (v: HsRoadmapVersionRow | null): HsRoadmapContent | null => (v ? (v.content as HsRoadmapContent) : null);

  const toProgressRecords = (rows: readonly HsTaskProgressRow[]): HsProgressRecord[] =>
    rows.map((p) => ({
      courseKey: p.courseKey,
      taskKey: p.taskKey,
      status: p.status as HsProgressRecord["status"],
      reportedScorePercent: p.reportedScorePercent,
      note: p.note,
      revision: p.revision,
      updatedAt: p.updatedAt.toISOString(),
    }));

  const toTaskResults = (rows: readonly HsOfficialResultRow[]): HsTaskResultRecord[] =>
    rows
      .filter((r) => r.status === "active" && r.taskKey !== null)
      .map((r) => ({
        courseKey: r.courseKey,
        taskKey: r.taskKey as string,
        outcome: r.outcome as HsTaskResultRecord["outcome"],
        scorePercent: r.scorePercent,
        recordedAt: r.recordedAt.toISOString(),
      }));

  const toCourseResults = (rows: readonly HsOfficialResultRow[]): HsCourseResultRecord[] =>
    rows
      .filter((r) => r.status === "active" && r.taskKey === null)
      .map((r) => ({ courseKey: r.courseKey, outcome: r.outcome as HsCourseResultRecord["outcome"], recordedAt: r.recordedAt.toISOString() }));

  const toAwardRecords = (rows: readonly HsCreditAwardRow[]): HsAwardRecord[] =>
    rows.map((a) => ({
      id: a.id,
      source: a.source as HsAwardRecord["source"],
      courseKey: a.courseKey,
      areaKey: a.areaKey,
      halfUnits: a.halfUnits,
      status: a.status as HsAwardRecord["status"],
    }));

  const toGraduationInput = (g: HsGraduationRow | null): HsGraduationRecordInput | null =>
    g
      ? {
          status: g.status as HsGraduationStatus,
          eligibilityConfirmedAt: isoOf(g.eligibilityConfirmedAt),
          eligibilityEvidenceDocumentId: g.eligibilityEvidenceDocumentId,
          conferredOn: g.conferredOn,
          diplomaEvidenceDocumentId: g.diplomaEvidenceDocumentId,
          transcriptEvidenceDocumentId: g.transcriptEvidenceDocumentId,
          transcriptStatus: g.transcriptStatus as HsDeliveryStatus,
          diplomaDeliveryStatus: g.diplomaDeliveryStatus as HsDeliveryStatus,
          financialClearance: g.financialClearance as HsFinancialClearance,
        }
      : null;

  /** Areas used before any roadmap is published: the template's, adjusted to the configured total. */
  function fallbackAreasOf(b: Bundle) {
    const { content, error } = contentFromTemplate(b.template, b.enrollment.totalRequiredHalfUnits, null);
    return error ? b.template.areas : content.areas;
  }

  async function projectionInput(studentId: string, b: Bundle, tx: Tx): Promise<HsProjectionInput> {
    const contacts = await repo.listContacts(studentId, tx);
    const guardians = contacts.map((c) => toGuardianView(c)).filter((g): g is NonNullable<typeof g> => g !== null);
    const published = b.published;
    return {
      enrollment: {
        id: b.enrollment.id,
        status: b.enrollment.status as HsEnrollmentStatus,
        programTitle: b.template.title,
        startedOn: b.enrollment.startedOn,
        targetCompletionDate: b.enrollment.targetCompletionDate,
        institutionDisclosed: b.enrollment.institutionDisclosed,
        awardingSchoolName: b.enrollment.awardingSchoolName,
        totalRequiredHalfUnits: b.enrollment.totalRequiredHalfUnits,
      },
      fallbackAreas: fallbackAreasOf(b),
      roadmap: published
        ? { versionNumber: published.versionNumber, publishedAt: isoOf(published.publishedAt) ?? "", content: published.content as HsRoadmapContent }
        : null,
      progress: toProgressRecords(b.progress),
      taskResults: toTaskResults(b.results),
      courseResults: toCourseResults(b.results),
      awards: toAwardRecords(b.awards),
      priorEducation: b.priorEducation.map((p) => ({
        id: p.id,
        schoolName: p.schoolName,
        status: p.status as PriorEducationStatus,
        claims: b.claims
          .filter((c) => c.priorEducationId === p.id)
          .map((c) => ({
            id: c.id,
            courseTitle: c.courseTitle,
            claimedHalfUnits: c.claimedHalfUnits,
            acceptedHalfUnits: c.acceptedHalfUnits,
            status: c.status as TransferClaimStatus,
          })),
      })),
      graduation: toGraduationInput(b.graduation),
      guardians,
      nowIso: deps.now().toISOString(),
    };
  }

  async function buildStudentView(studentId: string, enrollment: HsEnrollmentRow, tx: Tx): Promise<StudentHighSchoolView> {
    const b = await loadBundle(enrollment, tx);
    return projectStudentView(await projectionInput(studentId, b, tx));
  }

  // ── student operations ─────────────────────────────────────────────────────

  async function getStudentView(studentId: string): Promise<StudentHighSchoolView> {
    const tx = deps.readTx;
    const enrollment = currentOf(await repo.listEnrollments(studentId, tx));
    if (!enrollment) throw new HsError(E.NO_ENROLLMENT, 404, "No high school enrollment yet");
    return buildStudentView(studentId, enrollment, tx);
  }

  async function getStudentPrograms(studentId: string): Promise<StudentProgramsView> {
    const tx = deps.readTx;
    await ensureBuiltInTemplates();
    const enrollments = await repo.listEnrollments(studentId, tx);
    const titles = new Map<string, string>();
    for (const e of enrollments) {
      const key = `${e.templateKey}@${e.templateVersion}`;
      if (!titles.has(key)) titles.set(key, (await loadTemplate(e.templateKey, e.templateVersion, tx)).title);
    }
    const university = await repo.listUniversityPrograms(studentId, tx);
    return {
      programs: [
        ...enrollments.map((e) => ({
          kind: "high_school" as const,
          id: e.id,
          title: titles.get(`${e.templateKey}@${e.templateVersion}`) ?? "High school diploma",
          status: e.status,
          current: isOpen(e.status),
        })),
        ...university.map((u) => ({ kind: "university_degree" as const, id: u.id, title: u.title, status: u.status, current: u.status === "active" })),
      ],
    };
  }

  async function reportProgress(
    studentId: string,
    actorId: string,
    input: HsStudentProgressInput,
  ): Promise<HsMutation<StudentHighSchoolView>> {
    return deps.transaction(async (tx) => {
      const current = currentOf(await repo.listEnrollments(studentId, tx));
      if (!current) throw new HsError(E.NO_ENROLLMENT, 404, "No high school enrollment yet");
      const enrollment = await requireEnrollment(studentId, current.id, tx, true);
      assertOpen(enrollment);
      const published = await repo.getVersionByStatus(enrollment.id, "published", tx);
      if (!published) throw new HsError(E.NO_PUBLISHED_ROADMAP, 409, "Your roadmap has not been published yet");
      const content = published.content as HsRoadmapContent;
      const course = content.courses.find((c) => c.key === input.courseKey);
      const task = course?.tasks.find((t) => t.key === input.taskKey);
      if (!course || !task || course.status !== "planned") {
        throw new HsError(E.UNKNOWN_COURSE_OR_TASK, 422, "That course or task is not part of your current roadmap");
      }
      const results = await repo.listResults(enrollment.id, tx);
      if (results.some((r) => r.status === "active" && r.courseKey === course.key && r.taskKey === task.key && r.outcome === "passed")) {
        throw new HsError(E.OFFICIAL_RECORD_LOCKED, 409, "This task already has an official result");
      }
      if (results.some((r) => r.status === "active" && r.courseKey === course.key && r.taskKey === null && r.outcome === "completed")) {
        throw new HsError(E.OFFICIAL_RECORD_LOCKED, 409, "This course already has an official result");
      }

      const existing = await repo.getProgressForUpdate(enrollment.id, course.key, task.key, tx);
      const currentRevision = existing?.revision ?? 0;
      if (input.expectedRevision !== currentRevision) {
        throw new HsError(E.REVISION_CONFLICT, 409, "This task changed since you loaded it; refresh and try again", {
          currentRevision,
        });
      }
      const now = deps.now();
      const score = input.reportedScorePercent === undefined ? (existing?.reportedScorePercent ?? null) : input.reportedScorePercent;
      const revision = currentRevision + 1;
      if (existing) {
        await repo.updateProgress(existing.id, { status: input.status, reportedScorePercent: score, note: input.note ?? null, revision, updatedBy: actorId, updatedAt: now }, tx);
      } else {
        await repo.insertProgress(
          { enrollmentId: enrollment.id, studentId, courseKey: course.key, taskKey: task.key, status: input.status, reportedScorePercent: score, note: input.note ?? null, revision, updatedBy: actorId, updatedAt: now },
          tx,
        );
      }
      await repo.appendProgressEvent(
        {
          enrollmentId: enrollment.id,
          studentId,
          courseKey: course.key,
          taskKey: task.key,
          fromStatus: existing?.status ?? null,
          toStatus: input.status,
          reportedScorePercent: score,
          revision,
          planVersionId: published.id,
          actorId,
          createdAt: now,
        },
        tx,
      );
      await repo.appendEvent(
        {
          studentId,
          enrollmentId: enrollment.id,
          eventType: "progress_reported",
          actorId,
          summary: `Student reported ${course.key}/${task.key} as ${input.status}`,
          detail: { courseKey: course.key, taskKey: task.key, status: input.status, revision },
          createdAt: now,
        },
        tx,
      );
      return {
        result: await buildStudentView(studentId, enrollment, tx),
        audits: [
          {
            event: "high_school.progress_reported",
            description: "Student reported high school coursework activity",
            studentId,
            metadata: { enrollmentId: enrollment.id, courseKey: course.key, taskKey: task.key, status: input.status, revision },
          },
        ],
      };
    });
  }

  async function requestTranscript(studentId: string, actorId: string, note: string | undefined): Promise<HsMutation<StudentHighSchoolView>> {
    return deps.transaction(async (tx) => {
      const current = currentOf(await repo.listEnrollments(studentId, tx));
      if (!current) throw new HsError(E.NO_ENROLLMENT, 404, "No high school enrollment yet");
      // Always the student's CURRENT enrollment (open, else the most recent one).
      const enrollment = await requireEnrollment(studentId, current.id, tx, true);
      const graduation = await repo.getGraduation(enrollment.id, tx);
      if (!graduation || (graduation.status !== "eligibility_confirmed" && graduation.status !== "diploma_conferred")) {
        throw new HsError(E.NOT_ELIGIBLE, 409, "A transcript can be requested once the school has confirmed graduation eligibility", {
          blockers: ["Graduation eligibility has not been confirmed"],
        });
      }
      const changed = graduation.transcriptStatus === "not_requested";
      const now = deps.now();
      if (changed) {
        await repo.insertGraduationIfAbsent({ enrollmentId: enrollment.id, studentId }, tx);
        await repo.updateGraduation(enrollment.id, { transcriptStatus: "requested", updatedBy: actorId }, tx);
      }
      await repo.appendEvent(
        {
          studentId,
          enrollmentId: enrollment.id,
          eventType: "transcript_requested",
          actorId,
          summary: changed ? "Student requested their transcript" : "Student asked again about their transcript",
          detail: note ? { note } : {},
          createdAt: now,
        },
        tx,
      );
      return {
        result: await buildStudentView(studentId, enrollment, tx),
        audits: [
          {
            event: "high_school.graduation_updated",
            description: "Student requested a transcript",
            studentId,
            metadata: { enrollmentId: enrollment.id, action: "transcript_request", changed },
          },
        ],
      };
    });
  }

  // ── staff read model ───────────────────────────────────────────────────────

  function summaryOf(e: HsEnrollmentRow, template: HsCurriculumTemplate): HsEnrollmentSummary {
    return {
      id: e.id,
      status: e.status as HsEnrollmentStatus,
      templateKey: e.templateKey,
      templateVersion: e.templateVersion,
      programTitle: template.title,
      jurisdiction: template.jurisdiction,
      totalRequiredHalfUnits: e.totalRequiredHalfUnits,
      requiredOverrideReason: e.requiredOverrideReason,
      startedOn: e.startedOn,
      targetCompletionDate: e.targetCompletionDate,
      institutionDisclosed: e.institutionDisclosed,
      awardingSchoolName: e.awardingSchoolName,
      schoolStudentRef: e.schoolStudentRef,
      isHistorical: e.isHistorical,
      revision: e.revision,
      createdAt: e.createdAt.toISOString(),
    };
  }

  async function versionView(
    v: HsRoadmapVersionRow,
    b: Bundle,
    activity: { courses: Set<string>; tasks: Set<string> },
  ): Promise<HsRoadmapVersionView> {
    const content = v.content as HsRoadmapContent;
    return {
      versionId: v.id,
      versionNumber: v.versionNumber,
      status: v.status as HsVersionStatus,
      draftRevision: v.draftRevision,
      content,
      validationErrors:
        v.status === "draft"
          ? validateRoadmapContent(content, b.template, {
              expectedTotalHalfUnits: b.enrollment.totalRequiredHalfUnits,
              protectedCourseKeys: activity.courses,
              protectedTaskKeys: activity.tasks,
            })
          : [],
      createdBy: v.createdBy,
      createdAt: v.createdAt.toISOString(),
      publishedBy: v.publishedBy,
      publishedAt: isoOf(v.publishedAt),
    };
  }

  async function buildStaffState(studentId: string, tx: Tx): Promise<StaffHighSchoolState> {
    const enrollments = await repo.listEnrollments(studentId, tx);
    const templateCache = new Map<string, HsCurriculumTemplate>();
    const templateFor = async (e: HsEnrollmentRow) => {
      const k = `${e.templateKey}@${e.templateVersion}`;
      if (!templateCache.has(k)) templateCache.set(k, await loadTemplate(e.templateKey, e.templateVersion, tx));
      return templateCache.get(k) as HsCurriculumTemplate;
    };
    const summaries: HsEnrollmentSummary[] = [];
    for (const e of enrollments) summaries.push(summaryOf(e, await templateFor(e)));

    const universityPrograms = await repo.listUniversityPrograms(studentId, tx);
    const contacts = await repo.listContacts(studentId, tx);
    const noteEvents = await repo.listEventsByType(studentId, "guardian_note", tx);
    const events = await repo.listEvents(studentId, 200, tx);
    const guardians = contacts
      .map((c) => toGuardianView(c))
      .filter((g): g is NonNullable<typeof g> => g !== null)
      .map((g) => ({
        ...g,
        notes: noteEvents
          .filter((ev) => (ev.detail as { contactId?: string } | null)?.contactId === g.contactId)
          .map((ev) => ({ note: String((ev.detail as { note?: string }).note ?? ""), actorId: ev.actorId, createdAt: ev.createdAt.toISOString() })),
      }));
    const eventViews: HsEventView[] = events.map((ev) => ({
      id: ev.id,
      type: ev.eventType,
      actorId: ev.actorId,
      summary: ev.summary,
      createdAt: ev.createdAt.toISOString(),
    }));

    const currentRow = currentOf(enrollments);
    let current: StaffHighSchoolState["current"] = null;
    if (currentRow) {
      const b = await loadBundle(currentRow, tx);
      const activity = await repo.activityKeys(currentRow.id, tx);
      const input = await projectionInput(studentId, b, tx);
      const studentPreview = projectStudentView(input);
      const published = contentOf(b.published);
      const progress = toProgressRecords(b.progress);
      const taskResults = toTaskResults(b.results);
      const credits = studentPreview.credits;
      const graduationView = projectGraduationView(
        toGraduationInput(b.graduation),
        credits,
        published ? buildCourseViews(published, progress, taskResults, toCourseResults(b.results), input.nowIso) : [],
      );
      const conferred = b.graduation?.status === "diploma_conferred";
      const stillVerified = await repo.verifiedDocumentIds(
        studentId,
        [...new Set([...b.results.filter((r) => r.status === "active").map((r) => r.evidenceDocumentId), ...b.awards.map((a) => a.evidenceDocumentId)])],
        tx,
      );
      current = {
        enrollment: summaryOf(currentRow, b.template),
        template: b.template,
        draft: b.draft ? await versionView(b.draft, b, activity) : null,
        published: b.published ? await versionView(b.published, b, activity) : null,
        versionHistory: b.versions
          .filter((v) => v.status !== "discarded")
          .map((v) => ({ versionId: v.id, versionNumber: v.versionNumber, status: v.status as HsVersionStatus, publishedAt: isoOf(v.publishedAt) })),
        credits,
        reviewQueue: computeReviewQueue(published, progress, taskResults),
        results: b.results
          .filter((r) => r.status === "active")
          .map(
            (r): HsOfficialResultView => ({
              id: r.id,
              courseKey: r.courseKey,
              taskKey: r.taskKey,
              outcome: r.outcome as HsOfficialResultView["outcome"],
              scorePercent: r.scorePercent,
              evidenceDocumentId: r.evidenceDocumentId,
              evidenceStillVerified: stillVerified.has(r.evidenceDocumentId),
              recordedBy: r.recordedBy,
              recordedAt: r.recordedAt.toISOString(),
              note: r.note,
            }),
          ),
        awards: b.awards.map(
          (a): HsCreditAwardView => ({
            id: a.id,
            source: a.source as HsCreditAwardView["source"],
            courseKey: a.courseKey,
            claimId: a.claimId,
            areaKey: a.areaKey,
            halfUnits: a.halfUnits,
            evidenceDocumentId: a.evidenceDocumentId,
            evidenceStillVerified: stillVerified.has(a.evidenceDocumentId),
            status: a.status as HsCreditAwardView["status"],
            recordedBy: a.recordedBy,
            recordedAt: a.recordedAt.toISOString(),
            voidReason: a.voidReason,
          }),
        ),
        priorEducation: b.priorEducation.map((p) => ({
          id: p.id,
          schoolName: p.schoolName,
          country: p.country,
          gradeLevels: p.gradeLevels,
          status: p.status as PriorEducationStatus,
          evidenceDocumentId: p.evidenceDocumentId,
          staffNote: p.staffNote,
          claims: b.claims
            .filter((c) => c.priorEducationId === p.id)
            .map((c) => ({
              id: c.id,
              courseTitle: c.courseTitle,
              areaKey: c.areaKey,
              claimedHalfUnits: c.claimedHalfUnits,
              acceptedHalfUnits: c.acceptedHalfUnits,
              status: c.status as TransferClaimStatus,
              note: c.resolutionNote,
            })),
        })),
        graduation: {
          ...graduationView,
          eligibilityEvidenceDocumentId: b.graduation?.eligibilityEvidenceDocumentId ?? null,
          blockers: conferred ? [] : creditBlockers(credits),
        },
        studentPreview,
      };
    }
    return {
      studentId,
      enrollments: summaries,
      hasUniversityProgram: universityPrograms.some((u) => u.status === "active"),
      current,
      guardians,
      events: eventViews,
    };
  }

  async function getStaffState(studentId: string): Promise<StaffHighSchoolState> {
    await ensureBuiltInTemplates();
    await requireStudent(studentId, deps.readTx);
    return buildStaffState(studentId, deps.readTx);
  }

  /** Runs a staff mutation: lock the enrollment, apply, then return the refreshed state + audits. */
  async function mutateEnrollment(
    studentId: string,
    enrollmentId: string,
    fn: (ctx: { tx: Tx; enrollment: HsEnrollmentRow; now: Date }) => Promise<HsAuditRecord[]>,
  ): Promise<HsMutation<StaffHighSchoolState>> {
    await ensureBuiltInTemplates();
    return deps.transaction(async (tx) => {
      await requireStudent(studentId, tx);
      const enrollment = await requireEnrollment(studentId, enrollmentId, tx, true);
      const audits = await fn({ tx, enrollment, now: deps.now() });
      return { result: await buildStaffState(studentId, tx), audits };
    });
  }

  const event = (
    studentId: string,
    enrollmentId: string | null,
    eventType: string,
    actorId: string | null,
    summary: string,
    detail: Record<string, unknown>,
    now: Date,
  ) => ({ studentId, enrollmentId, eventType, actorId, summary, detail, createdAt: now });

  // ── enrollments ────────────────────────────────────────────────────────────

  async function createEnrollment(studentId: string, actorId: string, input: CreateEnrollmentInput): Promise<HsMutation<StaffHighSchoolState>> {
    await ensureBuiltInTemplates();
    return deps.transaction(async (tx) => {
      await requireStudent(studentId, tx);
      const template = await loadTemplate(input.templateKey, input.templateVersion, tx);
      const total = input.totalRequiredHalfUnitsOverride ?? template.totalRequiredHalfUnits;
      if (input.totalRequiredHalfUnitsOverride !== null && input.totalRequiredHalfUnitsOverride !== template.totalRequiredHalfUnits && !input.overrideReason) {
        throw new HsError(E.VALIDATION, 422, "An override of the required credits needs a reason", { field: "overrideReason" });
      }
      const adjusted = contentFromTemplate(template, total, input.targetCompletionDate);
      if (adjusted.error) throw new HsError(E.TEMPLATE_INVALID, 422, adjusted.error);

      await repo.lockStudent(studentId, tx);
      const existing = await repo.listEnrollments(studentId, tx);
      if (existing.some((e) => isOpen(e.status))) {
        throw new HsError(E.ENROLLMENT_ALREADY_OPEN, 409, "This student already has an open high school enrollment");
      }
      const now = deps.now();
      let enrollment: HsEnrollmentRow;
      try {
        enrollment = await repo.insertEnrollment(
          {
            studentId,
            templateKey: template.templateKey,
            templateVersion: template.version,
            status: input.status,
            totalRequiredHalfUnits: total,
            requiredOverrideReason: total !== template.totalRequiredHalfUnits ? input.overrideReason : null,
            startedOn: input.startedOn,
            targetCompletionDate: input.targetCompletionDate,
            createdBy: actorId,
            createdAt: now,
            updatedAt: now,
          },
          tx,
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new HsError(E.ENROLLMENT_ALREADY_OPEN, 409, "This student already has an open high school enrollment");
        throw error;
      }
      await repo.insertGraduationIfAbsent({ enrollmentId: enrollment.id, studentId }, tx);
      await repo.appendEvent(
        event(studentId, enrollment.id, "enrollment_created", actorId, `High school enrollment created (${formatHalfUnits(total)} credits required)`, { templateKey: template.templateKey, templateVersion: template.version, overridden: total !== template.totalRequiredHalfUnits }, now),
        tx,
      );
      return {
        result: await buildStaffState(studentId, tx),
        audits: [
          {
            event: "high_school.enrollment_created",
            description: "High school enrollment created",
            studentId,
            metadata: { enrollmentId: enrollment.id, templateKey: template.templateKey, templateVersion: template.version, totalRequiredHalfUnits: total, status: input.status },
          },
        ],
      };
    });
  }

  async function updateEnrollment(
    studentId: string,
    enrollmentId: string,
    actorId: string,
    input: UpdateEnrollmentInput,
  ): Promise<HsMutation<StaffHighSchoolState>> {
    return mutateEnrollment(studentId, enrollmentId, async ({ tx, enrollment, now }) => {
      if (input.expectedRevision !== enrollment.revision) {
        throw new HsError(E.REVISION_CONFLICT, 409, "This enrollment changed since you loaded it", { currentRevision: enrollment.revision });
      }
      const patch: Parameters<HighSchoolRepository["updateEnrollment"]>[1] = { revision: enrollment.revision + 1 };
      const changed: string[] = [];
      if (input.status !== undefined && input.status !== enrollment.status) {
        if (input.status === "completed") {
          throw new HsError(E.VALIDATION, 422, "An enrollment is completed by conferring the diploma", { field: "status" });
        }
        if (!isOpen(enrollment.status)) {
          throw new HsError(E.INVALID_TRANSITION, 409, `A ${enrollment.status.replace(/_/g, " ")} enrollment cannot change status`);
        }
        patch.status = input.status;
        changed.push("status");
      }
      if (input.startedOn !== undefined) {
        patch.startedOn = input.startedOn;
        changed.push("startedOn");
      }
      if (input.targetCompletionDate !== undefined) {
        patch.targetCompletionDate = input.targetCompletionDate;
        changed.push("targetCompletionDate");
      }
      if (input.awardingSchoolName !== undefined) {
        patch.awardingSchoolName = input.awardingSchoolName;
        changed.push("awardingSchoolName");
      }
      if (input.schoolStudentRef !== undefined) {
        patch.schoolStudentRef = input.schoolStudentRef;
        changed.push("schoolStudentRef");
      }
      if (input.institutionDisclosed !== undefined) {
        patch.institutionDisclosed = input.institutionDisclosed;
        changed.push("institutionDisclosed");
      }
      const nextDisclosed = patch.institutionDisclosed ?? enrollment.institutionDisclosed;
      const nextName = patch.awardingSchoolName === undefined ? enrollment.awardingSchoolName : patch.awardingSchoolName;
      if (nextDisclosed && !nextName) {
        throw new HsError(E.VALIDATION, 422, "Set the awarding school name before disclosing it", { field: "awardingSchoolName" });
      }
      await repo.updateEnrollment(enrollment.id, patch, tx);
      await repo.appendEvent(
        event(studentId, enrollment.id, "enrollment_updated", actorId, `Enrollment updated (${changed.join(", ") || "note only"})`, { changed, note: input.note, ...(patch.status ? { from: enrollment.status, to: patch.status } : {}) }, now),
        tx,
      );
      return [
        {
          event: "high_school.enrollment_updated",
          description: "High school enrollment updated",
          studentId,
          metadata: { enrollmentId: enrollment.id, changed, ...(patch.status ? { status: patch.status } : {}) },
        },
      ];
    });
  }

  // ── prior education and transfer claims ────────────────────────────────────

  async function recordPriorEducation(studentId: string, enrollmentId: string, actorId: string, input: PriorEducationInput) {
    return mutateEnrollment(studentId, enrollmentId, async ({ tx, enrollment, now }) => {
      assertOpen(enrollment);
      if (input.evidenceDocumentId) await assertEvidence(studentId, input.evidenceDocumentId, "evidenceDocumentId", tx);
      const row = await repo.insertPriorEducation(
        {
          enrollmentId: enrollment.id,
          studentId,
          schoolName: input.schoolName,
          country: input.country,
          gradeLevels: input.gradeLevels,
          status: input.status,
          evidenceDocumentId: input.evidenceDocumentId,
          staffNote: input.staffNote,
          createdBy: actorId,
          createdAt: now,
        },
        tx,
      );
      await repo.appendEvent(event(studentId, enrollment.id, "prior_education_recorded", actorId, "Prior education recorded (no credit awarded)", { priorEducationId: row.id }, now), tx);
      return [{ event: "high_school.prior_education_recorded", description: "Prior education recorded", studentId, metadata: { enrollmentId: enrollment.id, priorEducationId: row.id } }];
    });
  }

  async function createTransferClaim(studentId: string, enrollmentId: string, actorId: string, input: TransferClaimInput) {
    return mutateEnrollment(studentId, enrollmentId, async ({ tx, enrollment, now }) => {
      assertOpen(enrollment);
      const prior = await repo.getPriorEducation(input.priorEducationId, tx);
      if (!prior || prior.enrollmentId !== enrollment.id) {
        throw new HsError(E.VALIDATION, 422, "Prior education record not found for this enrollment", { field: "priorEducationId" });
      }
      const template = await loadTemplate(enrollment.templateKey, enrollment.templateVersion, tx);
      if (!template.areas.some((a) => a.key === input.areaKey)) {
        throw new HsError(E.VALIDATION, 422, "Unknown requirement area", { field: "areaKey" });
      }
      const claim = await repo.insertClaim(
        {
          enrollmentId: enrollment.id,
          priorEducationId: prior.id,
          studentId,
          courseTitle: input.courseTitle,
          areaKey: input.areaKey,
          claimedHalfUnits: input.claimedHalfUnits,
          createdBy: actorId,
          createdAt: now,
        },
        tx,
      );
      await repo.appendEvent(event(studentId, enrollment.id, "transfer_claim_created", actorId, "Transfer claim recorded (a claim is not credit)", { claimId: claim.id }, now), tx);
      return [{ event: "high_school.transfer_claim_changed", description: "Transfer claim recorded", studentId, metadata: { enrollmentId: enrollment.id, claimId: claim.id, status: "claimed" } }];
    });
  }

  async function resolveTransferClaim(studentId: string, enrollmentId: string, claimId: string, actorId: string, input: ResolveClaimInput) {
    return mutateEnrollment(studentId, enrollmentId, async ({ tx, enrollment, now }) => {
      assertOpen(enrollment);
      if (!UUID_RE.test(claimId)) throw new HsError(E.CLAIM_NOT_FOUND, 404, "Transfer claim not found");
      const claim = await repo.lockClaim(claimId, tx);
      if (!claim || claim.enrollmentId !== enrollment.id) throw new HsError(E.CLAIM_NOT_FOUND, 404, "Transfer claim not found");
      if (input.status === "partially_accepted") {
        if (input.acceptedHalfUnits === undefined) {
          throw new HsError(E.VALIDATION, 422, "acceptedHalfUnits is required when a claim is partially accepted", { field: "acceptedHalfUnits" });
        }
        if (input.acceptedHalfUnits > claim.claimedHalfUnits) {
          throw new HsError(E.VALIDATION, 422, "acceptedHalfUnits cannot exceed the credit claimed", { field: "acceptedHalfUnits", claimedHalfUnits: claim.claimedHalfUnits });
        }
      }
      const acceptedHalfUnits = input.status === "partially_accepted" ? (input.acceptedHalfUnits as number) : null;
      const activeAwarded = (await repo.listAwards(enrollment.id, tx))
        .filter((a) => a.claimId === claim.id && a.status === "active")
        .reduce((n, a) => n + a.halfUnits, 0);
      if (input.status === "declined" || input.status === "submitted_to_school") {
        if (activeAwarded > 0) throw new HsError(E.OFFICIAL_RECORD_LOCKED, 409, "Void the transfer credit award before changing this claim");
      } else {
        const cap = input.status === "accepted" ? claim.claimedHalfUnits : (acceptedHalfUnits as number);
        if (activeAwarded > cap) throw new HsError(E.OFFICIAL_RECORD_LOCKED, 409, "Void the transfer credit award that exceeds the accepted credit before changing this claim");
      }
      await repo.updateClaim(claim.id, { status: input.status, acceptedHalfUnits, resolutionNote: input.note, resolvedBy: actorId, resolvedAt: now }, tx);
      await repo.appendEvent(event(studentId, enrollment.id, "transfer_claim_resolved", actorId, `Transfer claim marked ${input.status.replace(/_/g, " ")}`, { claimId: claim.id, status: input.status, acceptedHalfUnits }, now), tx);
      return [{ event: "high_school.transfer_claim_changed", description: "Transfer claim updated", studentId, metadata: { enrollmentId: enrollment.id, claimId: claim.id, status: input.status } }];
    });
  }

  // ── roadmap ────────────────────────────────────────────────────────────────

  async function draftFromTemplate(studentId: string, enrollmentId: string, actorId: string, expectedDraftRevision: number | undefined) {
    return mutateEnrollment(studentId, enrollmentId, async ({ tx, enrollment }) => {
      assertOpen(enrollment);
      const existing = await repo.getVersionByStatus(enrollment.id, "draft", tx);
      if (existing) {
        if (expectedDraftRevision !== undefined && expectedDraftRevision !== existing.draftRevision) {
          throw new HsError(E.REVISION_CONFLICT, 409, "The draft changed since you loaded it", { currentRevision: existing.draftRevision });
        }
        return []; // idempotent: a draft is already open; never discard staff edits
      }
      const published = await repo.getVersionByStatus(enrollment.id, "published", tx);
      let content: HsRoadmapContent;
      if (published) {
        content = published.content as HsRoadmapContent;
      } else {
        const template = await loadTemplate(enrollment.templateKey, enrollment.templateVersion, tx);
        const built = contentFromTemplate(template, enrollment.totalRequiredHalfUnits, enrollment.targetCompletionDate);
        if (built.error) throw new HsError(E.TEMPLATE_INVALID, 422, built.error);
        content = built.content;
      }
      const draft = await repo.insertVersion(
        {
          enrollmentId: enrollment.id,
          versionNumber: await repo.nextVersionNumber(enrollment.id, tx),
          status: "draft",
          content,
          baseVersionId: published?.id ?? null,
          draftRevision: 0,
          createdBy: actorId,
        },
        tx,
      );
      await repo.appendEvent(event(studentId, enrollment.id, "roadmap_draft_opened", actorId, published ? "Draft opened from the published roadmap" : "Draft opened from the template", { versionId: draft.id }, deps.now()), tx);
      return [
        {
          event: "high_school.roadmap_draft_saved",
          description: "Roadmap draft opened",
          studentId,
          metadata: { enrollmentId: enrollment.id, versionId: draft.id, versionNumber: draft.versionNumber, fromPublished: !!published },
        },
      ];
    });
  }

  async function saveDraft(studentId: string, enrollmentId: string, actorId: string, input: { expectedDraftRevision: number; content: HsRoadmapContent }) {
    return mutateEnrollment(studentId, enrollmentId, async ({ tx, enrollment, now }) => {
      assertOpen(enrollment);
      const draft = await repo.getVersionByStatus(enrollment.id, "draft", tx);
      if (!draft) throw new HsError(E.NO_DRAFT, 409, "There is no open draft; start one from the template or the published roadmap");
      if (input.expectedDraftRevision !== draft.draftRevision) {
        throw new HsError(E.REVISION_CONFLICT, 409, "The draft changed since you loaded it", { currentRevision: draft.draftRevision });
      }
      const parsed = hsRoadmapContentSchema.parse(input.content);
      await repo.updateVersion(draft.id, { content: parsed, draftRevision: draft.draftRevision + 1 }, tx);
      await repo.appendEvent(event(studentId, enrollment.id, "roadmap_draft_saved", actorId, "Roadmap draft saved", { versionId: draft.id, draftRevision: draft.draftRevision + 1 }, now), tx);
      return [
        {
          event: "high_school.roadmap_draft_saved",
          description: "Roadmap draft saved",
          studentId,
          metadata: { enrollmentId: enrollment.id, versionId: draft.id, versionNumber: draft.versionNumber, draftRevision: draft.draftRevision + 1, courseCount: parsed.courses.length },
        },
      ];
    });
  }

  async function publish(studentId: string, enrollmentId: string, actorId: string, input: { expectedDraftRevision: number; expectedPublishedVersionId: string | null }) {
    return mutateEnrollment(studentId, enrollmentId, async ({ tx, enrollment, now }) => {
      assertOpen(enrollment);
      const draft = await repo.getVersionByStatus(enrollment.id, "draft", tx);
      if (!draft) throw new HsError(E.NO_DRAFT, 409, "There is no open draft to publish");
      const published = await repo.getVersionByStatus(enrollment.id, "published", tx);
      if (input.expectedDraftRevision !== draft.draftRevision || (published?.id ?? null) !== input.expectedPublishedVersionId) {
        throw new HsError(E.REVISION_CONFLICT, 409, "The roadmap changed since you loaded it", {
          currentRevision: draft.draftRevision,
          currentPublishedVersionId: published?.id ?? null,
        });
      }
      const template = await loadTemplate(enrollment.templateKey, enrollment.templateVersion, tx);
      const activity = await repo.activityKeys(enrollment.id, tx);
      const content = draft.content as HsRoadmapContent;
      const errors = validateRoadmapContent(content, template, {
        expectedTotalHalfUnits: enrollment.totalRequiredHalfUnits,
        protectedCourseKeys: activity.courses,
        protectedTaskKeys: activity.tasks,
      });
      if (errors.length > 0) throw new HsError(E.ROADMAP_INVALID, 422, "The roadmap cannot be published yet", { errors });
      if (published) await repo.updateVersion(published.id, { status: "superseded", supersededAt: now }, tx);
      await repo.updateVersion(draft.id, { status: "published", publishedBy: actorId, publishedAt: now }, tx);
      await repo.appendEvent(event(studentId, enrollment.id, "roadmap_published", actorId, `Roadmap version ${draft.versionNumber} published`, { versionId: draft.id, versionNumber: draft.versionNumber, supersededVersionId: published?.id ?? null }, now), tx);
      return [
        {
          event: "high_school.roadmap_published",
          description: "Roadmap version published",
          studentId,
          metadata: { enrollmentId: enrollment.id, versionId: draft.id, versionNumber: draft.versionNumber, supersededVersionId: published?.id ?? null, courseCount: content.courses.length },
        },
      ];
    });
  }

  // ── official results and credit ────────────────────────────────────────────

  async function requirePublished(enrollmentId: string, tx: Tx): Promise<{ row: HsRoadmapVersionRow; content: HsRoadmapContent }> {
    const row = await repo.getVersionByStatus(enrollmentId, "published", tx);
    if (!row) throw new HsError(E.NO_PUBLISHED_ROADMAP, 409, "Publish a roadmap before recording results");
    return { row, content: row.content as HsRoadmapContent };
  }

  /**
   * Official results and credit are recorded only for courses that are "planned"
   * in the PUBLISHED roadmap. A replaced/removed course is refused with
   * 409 HS_INVALID_TRANSITION (the course exists, but its plan status does not allow it).
   */
  function assertPlanned(course: HsPlanCourse): void {
    if (course.status !== "planned") {
      throw new HsError(E.INVALID_TRANSITION, 409, `Course ${course.key} is ${course.status} in the published roadmap; results and credit can only be recorded for planned courses`, {
        courseKey: course.key,
        planStatus: course.status,
      });
    }
  }

  /**
   * Course keys linked to `courseKey` through replacesCourseKey (either direction,
   * transitively). Returns the key of a linked course that already holds an ACTIVE
   * course-completion award, so credit cannot be earned twice across a replacement chain.
   */
  function replacementChainAward(content: HsRoadmapContent, courseKey: string, awards: readonly HsCreditAwardRow[]): string | null {
    const neighbours = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      if (!neighbours.has(a)) neighbours.set(a, new Set());
      neighbours.get(a)!.add(b);
    };
    for (const c of content.courses) {
      if (c.replacesCourseKey) {
        link(c.key, c.replacesCourseKey);
        link(c.replacesCourseKey, c.key);
      }
    }
    const seen = new Set<string>([courseKey]);
    const queue = [courseKey];
    while (queue.length > 0) {
      const k = queue.shift() as string;
      for (const n of neighbours.get(k) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    seen.delete(courseKey);
    const held = awards.find((a) => a.status === "active" && a.source === "course_completion" && a.courseKey !== null && seen.has(a.courseKey));
    return held?.courseKey ?? null;
  }

  async function recordTaskResult(studentId: string, enrollmentId: string, actorId: string, input: TaskResultInput) {
    return mutateEnrollment(studentId, enrollmentId, async ({ tx, enrollment, now }) => {
      assertOpen(enrollment);
      await assertEvidence(studentId, input.evidenceDocumentId, "evidenceDocumentId", tx, "result");
      const { row: published, content } = await requirePublished(enrollment.id, tx);
      const course = content.courses.find((c) => c.key === input.courseKey);
      const task = course?.tasks.find((t) => t.key === input.taskKey);
      if (!course || !task) throw new HsError(E.UNKNOWN_COURSE_OR_TASK, 422, "That course or task is not in the published roadmap");
      assertPlanned(course);

      const previous = (await repo.listResults(enrollment.id, tx)).filter(
        (r) => r.status === "active" && r.courseKey === course.key && r.taskKey === task.key,
      );
      const policies = effectivePolicies(content);
      if ((task.kind as HsTaskKind) === "exam") {
        const failedAttempts = previous.filter((r) => r.outcome === "failed").length;
        if (
          policies.maxExamAttempts !== null &&
          (input.outcome === "failed" || input.outcome === "retake_required") &&
          failedAttempts >= policies.maxExamAttempts
        ) {
          throw new HsError(E.POLICY_VIOLATION, 409, `This exam allows ${policies.maxExamAttempts} attempts; another failed attempt cannot be recorded`, {
            policy: "maxExamAttempts",
            limit: policies.maxExamAttempts,
          });
        }
        if (policies.minDaysBetweenExams !== null && previous.length > 0) {
          const last = previous[previous.length - 1];
          const elapsedDays = (now.getTime() - last.recordedAt.getTime()) / DAY_MS;
          if (elapsedDays < policies.minDaysBetweenExams) {
            throw new HsError(E.POLICY_VIOLATION, 409, `At least ${policies.minDaysBetweenExams} days are required between exam results`, {
              policy: "minDaysBetweenExams",
              limit: policies.minDaysBetweenExams,
            });
          }
        }
      }
      const result = await repo.insertResult(
        {
          enrollmentId: enrollment.id,
          studentId,
          courseKey: course.key,
          taskKey: task.key,
          outcome: input.outcome,
          scorePercent: input.scorePercent,
          evidenceDocumentId: input.evidenceDocumentId,
          note: input.note,
          planVersionId: published.id,
          recordedBy: actorId,
          recordedAt: now,
        },
        tx,
      );
      await repo.appendEvent(event(studentId, enrollment.id, "official_task_result", actorId, `Official result recorded for ${course.key}/${task.key}: ${input.outcome}`, { resultId: result.id, courseKey: course.key, taskKey: task.key, outcome: input.outcome }, now), tx);
      return [
        {
          event: "high_school.official_result_recorded",
          description: "Official task result recorded",
          studentId,
          metadata: { enrollmentId: enrollment.id, resultId: result.id, courseKey: course.key, taskKey: task.key, outcome: input.outcome },
        },
      ];
    });
  }

  async function recordCourseResult(studentId: string, enrollmentId: string, actorId: string, input: CourseResultInput) {
    return mutateEnrollment(studentId, enrollmentId, async ({ tx, enrollment, now }) => {
      assertOpen(enrollment);
      await assertEvidence(studentId, input.evidenceDocumentId, "evidenceDocumentId", tx, "result");
      const { row: published, content } = await requirePublished(enrollment.id, tx);
      const course = content.courses.find((c) => c.key === input.courseKey);
      if (!course) throw new HsError(E.UNKNOWN_COURSE_OR_TASK, 422, "That course is not in the published roadmap");
      assertPlanned(course);
      const existing = (await repo.listResults(enrollment.id, tx)).find((r) => r.status === "active" && r.courseKey === course.key && r.taskKey === null);
      if (existing) throw new HsError(E.ALREADY_RECORDED, 409, "An official result is already recorded for this course");
      if (input.outcome === "completed") {
        const heldBy = replacementChainAward(content, course.key, await repo.listAwards(enrollment.id, tx));
        if (heldBy) {
          throw new HsError(E.ALREADY_RECORDED, 409, `Credit is already awarded for ${heldBy}, which this course replaces or is replaced by; void that award first`, { courseKey: heldBy });
        }
      }
      if (input.outcome === "completed" && !content.areas.some((a) => a.key === course.areaKey)) {
        throw new HsError(E.ROADMAP_INVALID, 422, "The course area is not part of the roadmap");
      }
      let result: HsOfficialResultRow;
      try {
        result = await repo.insertResult(
          {
            enrollmentId: enrollment.id,
            studentId,
            courseKey: course.key,
            taskKey: null,
            outcome: input.outcome,
            scorePercent: null,
            evidenceDocumentId: input.evidenceDocumentId,
            note: input.note,
            planVersionId: published.id,
            recordedBy: actorId,
            recordedAt: now,
          },
          tx,
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new HsError(E.ALREADY_RECORDED, 409, "An official result is already recorded for this course");
        throw error;
      }
      const audits: HsAuditRecord[] = [
        {
          event: "high_school.official_result_recorded",
          description: "Official course result recorded",
          studentId,
          metadata: { enrollmentId: enrollment.id, resultId: result.id, courseKey: course.key, outcome: input.outcome },
        },
      ];
      await repo.appendEvent(event(studentId, enrollment.id, "official_course_result", actorId, `Official result recorded for course ${course.key}: ${input.outcome.replace(/_/g, " ")}`, { resultId: result.id, courseKey: course.key, outcome: input.outcome }, now), tx);
      if (input.outcome === "completed") {
        const award = await repo.insertAward(
          {
            enrollmentId: enrollment.id,
            studentId,
            source: "course_completion",
            courseKey: course.key,
            resultId: result.id,
            areaKey: course.areaKey,
            halfUnits: course.halfUnits,
            evidenceDocumentId: input.evidenceDocumentId,
            recordedBy: actorId,
            recordedAt: now,
          },
          tx,
        );
        await repo.appendEvent(event(studentId, enrollment.id, "credit_awarded", actorId, `${formatHalfUnits(course.halfUnits)} credit awarded for course ${course.key}`, { awardId: award.id, courseKey: course.key, halfUnits: course.halfUnits }, now), tx);
        audits.push({
          event: "high_school.credit_awarded",
          description: "Credit awarded for a completed course",
          studentId,
          metadata: { enrollmentId: enrollment.id, awardId: award.id, courseKey: course.key, areaKey: course.areaKey, halfUnits: course.halfUnits },
        });
      }
      return audits;
    });
  }

  async function recordTransferAward(studentId: string, enrollmentId: string, actorId: string, input: TransferAwardInput) {
    return mutateEnrollment(studentId, enrollmentId, async ({ tx, enrollment, now }) => {
      assertOpen(enrollment);
      if (!UUID_RE.test(input.claimId)) throw new HsError(E.CLAIM_NOT_FOUND, 404, "Transfer claim not found");
      const claim = await repo.lockClaim(input.claimId, tx);
      if (!claim || claim.enrollmentId !== enrollment.id) throw new HsError(E.CLAIM_NOT_FOUND, 404, "Transfer claim not found");
      if (claim.status !== "accepted" && claim.status !== "partially_accepted") {
        throw new HsError(E.CLAIM_NOT_ACCEPTED, 409, "The awarding school has not accepted this transfer claim");
      }
      await assertEvidence(studentId, input.evidenceDocumentId, "evidenceDocumentId", tx, "transferAward");
      const template = await loadTemplate(enrollment.templateKey, enrollment.templateVersion, tx);
      if (!template.areas.some((a) => a.key === input.areaKey)) throw new HsError(E.VALIDATION, 422, "Unknown requirement area", { field: "areaKey" });
      if (input.areaKey !== claim.areaKey) {
        throw new HsError(E.VALIDATION, 422, "The award area must match the requirement area of the claim", { field: "areaKey", claimAreaKey: claim.areaKey });
      }
      const awards = await repo.listAwards(enrollment.id, tx);
      const activeForClaim = awards.filter((a) => a.status === "active" && a.claimId === claim.id).reduce((n, a) => n + a.halfUnits, 0);
      // accepted -> up to the credit claimed; partially_accepted -> up to what the school accepted
      const cap = claim.status === "accepted" ? claim.claimedHalfUnits : Math.min(claim.claimedHalfUnits, claim.acceptedHalfUnits ?? 0);
      if (activeForClaim + input.halfUnits > cap) {
        throw new HsError(E.VALIDATION, 422, claim.status === "accepted" ? "The award exceeds the credit claimed" : "The award exceeds the credit the school accepted", {
          field: "halfUnits",
          remainingHalfUnits: Math.max(0, cap - activeForClaim),
        });
      }
      const published = await repo.getVersionByStatus(enrollment.id, "published", tx);
      const policies = effectivePolicies(published ? (published.content as HsRoadmapContent) : null);
      if (policies.maxTransferHalfUnits !== null) {
        const transferTotal = awards.filter((a) => a.status === "active" && a.source === "transfer").reduce((n, a) => n + a.halfUnits, 0);
        if (transferTotal + input.halfUnits > policies.maxTransferHalfUnits) {
          throw new HsError(E.POLICY_VIOLATION, 409, "This would exceed the configured transfer credit maximum", {
            policy: "maxTransferHalfUnits",
            limit: policies.maxTransferHalfUnits,
          });
        }
      }
      const award = await repo.insertAward(
        {
          enrollmentId: enrollment.id,
          studentId,
          source: "transfer",
          claimId: claim.id,
          areaKey: input.areaKey,
          halfUnits: input.halfUnits,
          evidenceDocumentId: input.evidenceDocumentId,
          recordedBy: actorId,
          recordedAt: now,
        },
        tx,
      );
      await repo.appendEvent(event(studentId, enrollment.id, "credit_awarded", actorId, `${formatHalfUnits(input.halfUnits)} transfer credit awarded`, { awardId: award.id, claimId: claim.id, halfUnits: input.halfUnits }, now), tx);
      return [
        {
          event: "high_school.credit_awarded",
          description: "Transfer credit awarded",
          studentId,
          metadata: { enrollmentId: enrollment.id, awardId: award.id, claimId: claim.id, areaKey: input.areaKey, halfUnits: input.halfUnits },
        },
      ];
    });
  }

  async function voidAward(studentId: string, enrollmentId: string, awardId: string, actorId: string, reason: string) {
    return mutateEnrollment(studentId, enrollmentId, async ({ tx, enrollment, now }) => {
      assertOpen(enrollment);
      const award = UUID_RE.test(awardId) ? await repo.getAward(awardId, tx) : null;
      if (!award || award.enrollmentId !== enrollment.id) throw new HsError(E.NO_ENROLLMENT, 404, "Credit award not found");
      if (award.status !== "active") throw new HsError(E.ALREADY_RECORDED, 409, "This award is already voided");
      await repo.voidAward(award.id, { voidReason: reason, voidedBy: actorId, voidedAt: now }, tx);
      if (award.resultId) await repo.voidResult(award.resultId, now, tx);
      const graduation = await repo.getGraduation(enrollment.id, tx);
      if (graduation && graduation.status === "eligibility_confirmed") {
        await repo.updateGraduation(enrollment.id, { status: "in_progress", eligibilityConfirmedAt: null, eligibilityConfirmedBy: null, eligibilityEvidenceDocumentId: null, updatedBy: actorId }, tx);
        await repo.appendEvent(event(studentId, enrollment.id, "eligibility_withdrawn", actorId, "Eligibility confirmation withdrawn because credit was voided", { awardId: award.id }, now), tx);
      }
      await repo.appendEvent(event(studentId, enrollment.id, "credit_voided", actorId, `${formatHalfUnits(award.halfUnits)} credit voided`, { awardId: award.id, halfUnits: award.halfUnits, reason }, now), tx);
      return [
        {
          event: "high_school.credit_voided",
          description: "Credit award voided",
          studentId,
          metadata: { enrollmentId: enrollment.id, awardId: award.id, halfUnits: award.halfUnits, source: award.source },
        },
      ];
    });
  }

  // ── graduation ─────────────────────────────────────────────────────────────

  async function creditsOf(enrollment: HsEnrollmentRow, tx: Tx) {
    const b = await loadBundle(enrollment, tx);
    const areas = contentOf(b.published)?.areas ?? fallbackAreasOf(b);
    return computeCreditSummary(areas, enrollment.totalRequiredHalfUnits, toAwardRecords(b.awards));
  }

  async function graduationAction(studentId: string, enrollmentId: string, actorId: string, input: HsGraduationAction) {
    return mutateEnrollment(studentId, enrollmentId, async ({ tx, enrollment, now }) => {
      await repo.insertGraduationIfAbsent({ enrollmentId: enrollment.id, studentId }, tx);
      const graduation = (await repo.getGraduation(enrollment.id, tx)) as HsGraduationRow;
      const meta = (extra: HsAuditMetadata): HsAuditRecord => ({
        event: "high_school.graduation_updated",
        description: "High school graduation record updated",
        studentId,
        metadata: { enrollmentId: enrollment.id, action: input.action, ...extra },
      });

      switch (input.action) {
        case "confirm_eligibility": {
          assertOpen(enrollment);
          if (graduation.status !== "in_progress") throw new HsError(E.ALREADY_RECORDED, 409, "Eligibility is already confirmed");
          await assertEvidence(studentId, input.evidenceDocumentId, "evidenceDocumentId", tx, "eligibility");
          const blockers = creditBlockers(await creditsOf(enrollment, tx));
          if (blockers.length > 0) throw new HsError(E.NOT_ELIGIBLE, 409, "The student does not meet the graduation requirements yet", { blockers });
          await repo.updateGraduation(
            enrollment.id,
            { status: "eligibility_confirmed", eligibilityEvidenceDocumentId: input.evidenceDocumentId, eligibilityConfirmedAt: now, eligibilityConfirmedBy: actorId, updatedBy: actorId },
            tx,
          );
          await repo.appendEvent(event(studentId, enrollment.id, "eligibility_confirmed", actorId, "Graduation eligibility confirmed", { note: input.note }, now), tx);
          return [meta({ status: "eligibility_confirmed" })];
        }
        case "confer_diploma": {
          assertOpen(enrollment);
          if (graduation.status !== "eligibility_confirmed") {
            throw new HsError(E.NOT_ELIGIBLE, 409, "Graduation eligibility must be confirmed before conferring a diploma", { blockers: ["Eligibility has not been confirmed"] });
          }
          const blockers = creditBlockers(await creditsOf(enrollment, tx));
          if (blockers.length > 0) throw new HsError(E.NOT_ELIGIBLE, 409, "The student does not meet the graduation requirements", { blockers });
          // The conferral date is a fact about the past: never in the future, never before eligibility was confirmed.
          if (input.conferredOn > todayIso(now)) {
            throw new HsError(E.VALIDATION, 422, "The conferral date cannot be in the future", { field: "conferredOn" });
          }
          const confirmedOn = graduation.eligibilityConfirmedAt ? isoOf(graduation.eligibilityConfirmedAt)!.slice(0, 10) : null;
          if (confirmedOn && input.conferredOn < confirmedOn) {
            throw new HsError(E.VALIDATION, 422, "The conferral date cannot be before eligibility was confirmed", { field: "conferredOn", eligibilityConfirmedOn: confirmedOn });
          }
          await assertEvidence(studentId, input.diplomaEvidenceDocumentId, "diplomaEvidenceDocumentId", tx, "diploma");
          await assertEvidence(studentId, input.transcriptEvidenceDocumentId, "transcriptEvidenceDocumentId", tx, "transcript");
          await repo.updateGraduation(
            enrollment.id,
            {
              status: "diploma_conferred",
              conferredOn: input.conferredOn,
              diplomaEvidenceDocumentId: input.diplomaEvidenceDocumentId,
              transcriptEvidenceDocumentId: input.transcriptEvidenceDocumentId,
              transcriptStatus: "issued",
              diplomaDeliveryStatus: "issued",
              updatedBy: actorId,
            },
            tx,
          );
          await repo.updateEnrollment(enrollment.id, { status: "completed", revision: enrollment.revision + 1 }, tx);
          await repo.appendEvent(event(studentId, enrollment.id, "diploma_conferred", actorId, `Diploma conferred on ${input.conferredOn}`, { conferredOn: input.conferredOn }, now), tx);
          return [meta({ status: "diploma_conferred" })];
        }
        case "set_financial_clearance": {
          if (graduation.status === "diploma_conferred") {
            throw new HsError(E.OFFICIAL_RECORD_LOCKED, 409, "Financial clearance can no longer change after the diploma was conferred");
          }
          await repo.updateGraduation(enrollment.id, { financialClearance: input.value, updatedBy: actorId }, tx);
          await repo.appendEvent(event(studentId, enrollment.id, "financial_clearance_set", actorId, `Financial clearance set to ${input.value}`, { value: input.value, note: input.note }, now), tx);
          return [meta({ value: input.value })];
        }
        case "set_transcript_status":
        case "set_diploma_delivery": {
          const isTranscript = input.action === "set_transcript_status";
          const evidence = isTranscript ? graduation.transcriptEvidenceDocumentId : graduation.diplomaEvidenceDocumentId;
          const from = (isTranscript ? graduation.transcriptStatus : graduation.diplomaDeliveryStatus) as HsDeliveryStatus;
          const rank = (v: HsDeliveryStatus) => DELIVERY_ORDER.indexOf(v);
          if (input.value === from) return []; // idempotent: nothing changes, nothing is logged
          // Delivery only moves forward (not_requested < requested < issued < delivered). While the
          // enrollment is open, staff may additionally withdraw a request (requested -> not_requested).
          const forward = rank(input.value) > rank(from);
          const withdrawRequest = isOpen(enrollment.status) && from === "requested" && input.value === "not_requested";
          if (!forward && !withdrawRequest) {
            throw new HsError(E.INVALID_TRANSITION, 409, `${isTranscript ? "Transcript" : "Diploma"} status cannot move from ${from.replace(/_/g, " ")} back to ${input.value.replace(/_/g, " ")}`, { from, to: input.value });
          }
          if ((input.value === "issued" || input.value === "delivered") && !evidence) {
            throw new HsError(E.EVIDENCE_REQUIRED, 400, "Issued or delivered needs the school's document, recorded when the diploma is conferred");
          }
          await repo.updateGraduation(enrollment.id, isTranscript ? { transcriptStatus: input.value, updatedBy: actorId } : { diplomaDeliveryStatus: input.value, updatedBy: actorId }, tx);
          await repo.appendEvent(event(studentId, enrollment.id, isTranscript ? "transcript_status_set" : "diploma_delivery_set", actorId, `${isTranscript ? "Transcript" : "Diploma delivery"} set to ${input.value.replace(/_/g, " ")}`, { value: input.value }, now), tx);
          return [meta({ value: input.value })];
        }
      }
    });
  }

  async function historicalGraduate(studentId: string, actorId: string, input: HistoricalInput): Promise<HsMutation<StaffHighSchoolState>> {
    await ensureBuiltInTemplates();
    return deps.transaction(async (tx) => {
      await requireStudent(studentId, tx);
      const template = await loadTemplate(input.templateKey, input.templateVersion, tx);
      const now = deps.now();
      if (input.conferredOn > todayIso(now)) {
        throw new HsError(E.VALIDATION, 422, "The conferral date cannot be in the future", { field: "conferredOn" });
      }
      await assertEvidence(studentId, input.diplomaEvidenceDocumentId, "diplomaEvidenceDocumentId", tx, "diploma");
      await assertEvidence(studentId, input.transcriptEvidenceDocumentId, "transcriptEvidenceDocumentId", tx, "transcript");
      await repo.lockStudent(studentId, tx);
      const existing = await repo.listEnrollments(studentId, tx);
      if (existing.some((e) => isOpen(e.status))) {
        throw new HsError(E.ENROLLMENT_ALREADY_OPEN, 409, "This student has an open high school enrollment; close it before recording a historical graduate");
      }
      for (const e of existing) {
        const g = await repo.getGraduation(e.id, tx);
        if (g?.status === "diploma_conferred") throw new HsError(E.ALREADY_RECORDED, 409, "A high school diploma is already recorded for this student");
      }
      const enrollment = await repo.insertEnrollment(
        {
          studentId,
          templateKey: template.templateKey,
          templateVersion: template.version,
          status: "completed",
          totalRequiredHalfUnits: template.totalRequiredHalfUnits,
          awardingSchoolName: input.awardingSchoolName,
          isHistorical: true,
          createdBy: actorId,
          createdAt: now,
          updatedAt: now,
        },
        tx,
      );
      await repo.insertGraduationIfAbsent(
        {
          enrollmentId: enrollment.id,
          studentId,
          status: "diploma_conferred",
          conferredOn: input.conferredOn,
          diplomaEvidenceDocumentId: input.diplomaEvidenceDocumentId,
          transcriptEvidenceDocumentId: input.transcriptEvidenceDocumentId,
          transcriptStatus: "issued",
          diplomaDeliveryStatus: "issued",
          eligibilityConfirmedAt: now,
          eligibilityConfirmedBy: actorId,
          // The diploma is NOT silently reused as eligibility evidence. A historical graduate's
          // eligibility basis is the school's official transcript (the record of credits earned),
          // so the transcript document is stored here. eligibilityConfirmedAt is the time the
          // import was recorded (not the school's date); conferredOn carries the school's date.
          eligibilityEvidenceDocumentId: input.transcriptEvidenceDocumentId,
          updatedBy: actorId,
        },
        tx,
      );
      await repo.appendEvent(event(studentId, enrollment.id, "historical_graduate_recorded", actorId, `Historical graduate recorded (diploma conferred ${input.conferredOn})`, { note: input.note }, now), tx);
      return {
        result: await buildStaffState(studentId, tx),
        audits: <HsAuditRecord[]>[
          {
            event: "high_school.enrollment_created",
            description: "Historical high school graduate recorded",
            studentId,
            metadata: { enrollmentId: enrollment.id, historical: true, templateKey: template.templateKey, templateVersion: template.version },
          },
          {
            event: "high_school.graduation_updated",
            description: "Historical diploma recorded",
            studentId,
            metadata: { enrollmentId: enrollment.id, action: "historical_graduate", status: "diploma_conferred" },
          },
        ],
      };
    });
  }

  // ── guardians ──────────────────────────────────────────────────────────────

  async function addGuardianNote(studentId: string, enrollmentId: string, actorId: string, input: { contactId: string; note: string }) {
    return mutateEnrollment(studentId, enrollmentId, async ({ tx, enrollment, now }) => {
      const contact = await repo.getContact(studentId, input.contactId, tx);
      if (!contact) throw new HsError(E.CONTACT_NOT_FOUND, 404, "Contact not found for this student");
      await repo.appendEvent(
        event(studentId, enrollment.id, "guardian_note", actorId, "Guardian coordination note added", { contactId: contact.id, note: input.note }, now),
        tx,
      );
      return [{ event: "high_school.guardian_note_added", description: "Guardian coordination note added", studentId, metadata: { enrollmentId: enrollment.id, contactId: contact.id } }];
    });
  }

  return {
    ensureBuiltInTemplates,
    listTemplates,
    createTemplate,
    getStudentView,
    getStudentPrograms,
    reportProgress,
    requestTranscript,
    getStaffState,
    createEnrollment,
    updateEnrollment,
    recordPriorEducation,
    createTransferClaim,
    resolveTransferClaim,
    draftFromTemplate,
    saveDraft,
    publish,
    recordTaskResult,
    recordCourseResult,
    recordTransferAward,
    voidAward,
    graduationAction,
    historicalGraduate,
    addGuardianNote,
  };
}

export type HighSchoolService = ReturnType<typeof createHighSchoolService>;
