/**
 * Graduate Program Service (S12) — business rules for ENEB programmes and the
 * Unimarconi-linked university route.
 *
 * Every mutation runs in ONE transaction that also appends a graduate_events
 * row (before/after). After the commit, a best-effort audit log entry is
 * written (identifiers and action only: no grades text, no personal data).
 *
 * Hard rules enforced here (see shared/graduate-program-contract.ts):
 *  - ENEB data never creates university registration, credits, recognition or
 *    conferral. Enrollment creates no subjects, records or credits.
 *  - Official statuses only through evaluateOfficialChange(); credits only
 *    through evaluateCreditEntry(); students never write official data.
 *  - An enrollment pins the rule set it accepted; rule sets are immutable.
 */
import {
  UNIVERSITY_RECORD_KINDS,
  buildEvaluationView,
  evaluateEvaluationVerification,
  evaluationConsistency,
  RECORD_OUTCOMES,
  STUDENT_EVIDENCE_KINDS,
  buildStaffGraduateProgramView,
  buildStudentGraduateProgramView,
  evaluateCreditEntry,
  evaluateOfficialChange,
  isOfficialKind,
  type CohortRule,
  type CredentialEvaluationRecord,
  type EvaluationGuardCode,
  type RecordEvaluation,
  type UpdateEvaluation,
  type VerifyEvaluation,
  type CreateCreditEntry,
  type CreateOffering,
  type CreateRuleSet,
  type CreateSubject,
  type EnrollProgram,
  type GraduateErrorCode,
  type GraduateProgramBundle,
  type GraduateRecord,
  type GuardActorRole,
  type GuardCode,
  type OfferingRecord,
  type RecordKind,
  type RecordSubjectResult,
  type RuleSetRecord,
  type StaffGraduateProgramView,
  type StaffGraduateWorkspace,
  type StudentGraduateView,
  type StudentProgress,
  type StudentThesisPlan,
  type TrackRecord,
  type UpdateProgram,
  type VerifyRecord,
} from "@shared/graduate-program-contract";
import { createAuditLog, type AuditEventType, type AuditLogEntry } from "../lib/audit";
import { logger } from "../lib/logger";
import type { EvaluationPatch, GraduateEventRecord, GraduateRepository, RecordPatch, Tx } from "../repositories/graduate-program-repo";

export class GraduateError extends Error {
  constructor(
    readonly status: number,
    readonly code: GraduateErrorCode,
    message: string,
    readonly missing?: readonly (GuardCode | EvaluationGuardCode)[],
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "GraduateError";
  }
}

export interface GraduateActor {
  readonly id: string;
  readonly role: GuardActorRole;
}

export interface GraduateServiceDeps {
  readonly repo: GraduateRepository;
  /** Runs `fn` in one database transaction. */
  readonly transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  /** Handle for reads outside a transaction. */
  readonly readTx: Tx;
  readonly audit?: (entry: AuditLogEntry) => Promise<void> | void;
  readonly now?: () => Date;
}

type GraduateAuditEvent = Extract<AuditEventType, `graduate.${string}`>;

interface AuditSpec {
  readonly eventType: GraduateAuditEvent;
  readonly action: string;
  readonly programId: string | null;
  readonly studentId: string | null;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly severity?: "info" | "warning";
  readonly extra?: Record<string, unknown>;
}

const isUniversityKind = (kind: RecordKind) => (UNIVERSITY_RECORD_KINDS as readonly string[]).includes(kind);

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

const notFound = (what = "Not found") => new GraduateError(404, "GRADUATE_NOT_FOUND", what);

export function createGraduateProgramService(deps: GraduateServiceDeps) {
  const { repo } = deps;
  const now = deps.now ?? (() => new Date());
  const sendAudit = deps.audit ?? createAuditLog;

  /** Best effort: never throws, never fails the request. */
  function emitAudit(actor: GraduateActor, spec: AuditSpec): void {
    try {
      void Promise.resolve(
        sendAudit({
          eventType: spec.eventType,
          severity: spec.severity ?? "info",
          actorUserId: actor.id,
          actorRole: actor.role,
          targetResourceType: "graduate_program",
          targetResourceId: spec.programId ?? spec.entityId ?? undefined,
          actionDescription: `Graduate programme: ${spec.action}`,
          metadata: {
            action: spec.action,
            programId: spec.programId,
            studentId: spec.studentId,
            entityType: spec.entityType,
            entityId: spec.entityId,
            ...(spec.extra ?? {}),
          },
          isEducationalRecord: true,
        }),
      ).catch((error: unknown) => {
        logger.warn("Graduate audit emit failed", { eventType: spec.eventType, error: error instanceof Error ? error.message : String(error) });
      });
    } catch (error) {
      logger.warn("Graduate audit emit failed", { eventType: spec.eventType, error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Runs a mutation in one transaction; audits after the commit. Maps unique violations to 409. */
  async function mutate<T>(actor: GraduateActor, fn: (tx: Tx) => Promise<{ result: T; audit: AuditSpec | null }>): Promise<T> {
    let out: { result: T; audit: AuditSpec | null };
    try {
      out = await deps.transaction(fn);
    } catch (error) {
      if (!(error instanceof GraduateError) && pgCode(error) === "23505") {
        throw new GraduateError(409, "GRADUATE_CONFLICT", "That change conflicts with an existing record");
      }
      throw error;
    }
    if (out.audit) emitAudit(actor, out.audit);
    return out.result;
  }

  async function history(
    tx: Tx,
    actor: GraduateActor,
    e: { programId: string | null; studentId: string | null; action: string; entityType: string; entityId: string | null; before: unknown; after: unknown },
  ) {
    await repo.appendEvent({ ...e, actorUserId: actor.id, actorRole: actor.role }, tx);
  }

  // -------------------------------------------------------------------------
  // Read models
  // -------------------------------------------------------------------------

  async function staffView(programId: string, role: GuardActorRole, tx: Tx): Promise<StaffGraduateProgramView> {
    const bundle = await repo.loadBundle(programId, tx);
    if (!bundle) throw notFound("Programme not found");
    const current = await repo.getActiveRuleSet(bundle.offering.id, bundle.program.cohortLabel, tx);
    return buildStaffGraduateProgramView(bundle, current?.id ?? null, role);
  }

  async function loadBundles(studentId: string, tx: Tx): Promise<GraduateProgramBundle[]> {
    const programs = await repo.listProgramsForStudent(studentId, tx);
    const bundles: GraduateProgramBundle[] = [];
    for (const p of programs) {
      const b = await repo.loadBundle(p.id, tx);
      if (b) bundles.push(b);
    }
    return bundles;
  }

  async function studentView(studentId: string, tx: Tx = deps.readTx): Promise<StudentGraduateView> {
    const bundles = await loadBundles(studentId, tx);
    const evaluations = await repo.listEvaluationsForStudent(studentId, tx);
    return { programs: bundles.map(buildStudentGraduateProgramView), evaluations: evaluations.map(buildEvaluationView) };
  }

  /** Staff projection of the student's evaluations: the view plus what still blocks verification. */
  async function staffEvaluations(studentId: string, role: GuardActorRole, tx: Tx): Promise<StaffGraduateWorkspace["evaluations"]> {
    const rows = await repo.listEvaluationsForStudent(studentId, tx);
    return rows.map((e) => ({
      ...e,
      view: buildEvaluationView(e),
      blockers:
        e.verificationStatus === "verified"
          ? []
          : evaluateEvaluationVerification(e, { decision: "verified", conflictingEvidence: null, note: "guidance" }, role).missing,
    }));
  }

  async function workspaceFor(actorRole: GuardActorRole, studentId: string, tx: Tx): Promise<StaffGraduateWorkspace> {
    if (!(await repo.studentExists(studentId, tx))) throw notFound("Student not found");
    const [offerings, ruleSets, programs] = await Promise.all([repo.listOfferings(tx), repo.listRuleSets(tx), repo.listProgramsForStudent(studentId, tx)]);
    const views: StaffGraduateProgramView[] = [];
    for (const p of programs) views.push(await staffView(p.id, actorRole, tx));
    const evaluations = await staffEvaluations(studentId, actorRole, tx);
    const documents = await repo.listStudentDocumentSummaries(studentId, tx);
    return { studentId, viewerRole: actorRole === "admin" ? "admin" : "staff", programs: views, offerings, ruleSets, evaluations, documents };
  }

  /** The student's own programme, locked. Another student's programme reads as not found. */
  async function ownedProgramLocked(studentId: string, programId: string, tx: Tx) {
    const program = await repo.lockProgram(programId, tx);
    if (!program || program.studentId !== studentId) throw notFound("Programme not found");
    return program;
  }

  /** A document the student owns (existing, not soft-deleted). Anything else is a denial. */
  async function requireOwnDocument(actor: GraduateActor, studentId: string, programId: string | null, documentId: string, tx: Tx) {
    const doc = await repo.getStudentDocument(documentId, tx);
    if (!doc || doc.studentId !== studentId) {
      emitAudit(actor, {
        eventType: "graduate.access_denied",
        action: "document_not_owned",
        programId,
        studentId,
        entityType: "document",
        entityId: documentId,
        severity: "warning",
      });
      throw new GraduateError(403, "GRADUATE_FORBIDDEN", "That document is not available for this student");
    }
    return doc;
  }

  const merge = (a: object, b: object | undefined) => ({ ...a, ...(b ?? {}) });

  return {
    // =======================================================================
    // Student
    // =======================================================================

    getStudentView(studentId: string): Promise<StudentGraduateView> {
      return studentView(studentId);
    },

    async reportSubjectProgress(actor: GraduateActor, studentId: string, programId: string, subjectId: string, progress: StudentProgress): Promise<StudentGraduateView> {
      await mutate(actor, async (tx) => {
        const program = await ownedProgramLocked(studentId, programId, tx);
        const subject = await repo.getSubject(subjectId, tx);
        if (!subject || subject.programId !== programId) throw notFound("Subject not found");
        if (program.enebStatus === "withdrawn") throw new GraduateError(409, "GRADUATE_CONFLICT", "This programme is closed");
        if (subject.resultStatus === "passed") throw new GraduateError(409, "GRADUATE_CONFLICT", "This subject already has a recorded pass");
        const after = await repo.updateSubject(subjectId, { studentProgress: progress }, tx);
        await history(tx, actor, {
          programId, studentId, action: "student_progress_reported", entityType: "subject", entityId: subjectId,
          before: { studentProgress: subject.studentProgress }, after: { studentProgress: after.studentProgress },
        });
        return {
          result: null,
          audit: { eventType: "graduate.student_progress_reported", action: "student_progress_reported", programId, studentId, entityType: "subject", entityId: subjectId },
        };
      });
      return studentView(studentId);
    },

    async saveThesisPlan(actor: GraduateActor, studentId: string, programId: string, plan: StudentThesisPlan): Promise<StudentGraduateView> {
      await mutate(actor, async (tx) => {
        const program = await ownedProgramLocked(studentId, programId, tx);
        // The thesis is part of the university route; an ENEB-only programme has no university records.
        if (program.route === "eneb_only") {
          throw new GraduateError(409, "GRADUATE_CONFLICT", "The thesis plan belongs to the university route; this is an ENEB-only programme");
        }
        const existing = (await repo.listRecords(programId, tx))
          .filter((r) => r.kind === "thesis_topic")
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))[0] ?? null;

        if (existing && existing.outcome === "approved" && plan.topic !== undefined && plan.topic !== existing.details.topic) {
          throw new GraduateError(409, "GRADUATE_THESIS_TOPIC_LOCKED", "The thesis topic is approved and can no longer be changed here");
        }
        const planned = {
          ...(plan.topic !== undefined ? { topic: plan.topic } : {}),
          ...(plan.milestones !== undefined ? { milestones: plan.milestones } : {}),
        };
        if (!existing) {
          const created = await repo.insertRecord(
            {
              programId, studentId, kind: "thesis_topic", trackingStatus: "in_progress", verificationStatus: "student_reported",
              issuingInstitution: null, documentTypeLabel: null, documentReference: null, documentId: null,
              academicConsequence: null, conflictingEvidence: null, details: planned, note: null, createdBy: actor.id,
            },
            tx,
          );
          await history(tx, actor, { programId, studentId, action: "thesis_plan_saved", entityType: "record", entityId: created.id, before: null, after: created });
          return {
            result: null,
            audit: { eventType: "graduate.record_created", action: "thesis_plan_saved", programId, studentId, entityType: "record", entityId: created.id },
          };
        }
        const patch: RecordPatch = {
          details: merge(existing.details, planned),
          ...(existing.trackingStatus === "not_started" ? { trackingStatus: "in_progress" as const } : {}),
          ...(existing.verificationStatus === "unknown" ? { verificationStatus: "student_reported" as const } : {}),
        };
        const updated = await repo.updateRecord(existing.id, patch, tx);
        await history(tx, actor, { programId, studentId, action: "thesis_plan_saved", entityType: "record", entityId: existing.id, before: existing, after: updated });
        return {
          result: null,
          audit: { eventType: "graduate.record_updated", action: "thesis_plan_saved", programId, studentId, entityType: "record", entityId: existing.id },
        };
      });
      return studentView(studentId);
    },

    async attachEvidence(actor: GraduateActor, studentId: string, programId: string, recordId: string, documentId: string): Promise<StudentGraduateView> {
      await mutate(actor, async (tx) => {
        await ownedProgramLocked(studentId, programId, tx);
        const record = await repo.getRecord(recordId, tx);
        if (!record || record.programId !== programId) throw notFound("Record not found");
        if (!(STUDENT_EVIDENCE_KINDS as readonly string[]).includes(record.kind)) {
          emitAudit(actor, { eventType: "graduate.access_denied", action: "evidence_kind_not_allowed", programId, studentId, entityType: "record", entityId: recordId, severity: "warning" });
          throw new GraduateError(403, "GRADUATE_FORBIDDEN", "Evidence cannot be attached to this kind of record");
        }
        await requireOwnDocument(actor, studentId, programId, documentId, tx);
        if (record.verificationStatus === "verified") {
          throw new GraduateError(409, "GRADUATE_CONFLICT", "This record is already verified");
        }
        // Never `verified`: only staff can verify.
        const updated = await repo.updateRecord(recordId, { documentId, trackingStatus: "submitted", verificationStatus: "evidence_received" }, tx);
        await history(tx, actor, { programId, studentId, action: "evidence_attached", entityType: "record", entityId: recordId, before: record, after: updated });
        return {
          result: null,
          audit: { eventType: "graduate.record_updated", action: "evidence_attached", programId, studentId, entityType: "record", entityId: recordId },
        };
      });
      return studentView(studentId);
    },

    // =======================================================================
    // Staff: catalogue
    // =======================================================================

    async listOfferings(): Promise<{ offerings: OfferingRecord[]; ruleSets: RuleSetRecord[] }> {
      const [offerings, ruleSets] = await Promise.all([repo.listOfferings(deps.readTx), repo.listRuleSets(deps.readTx)]);
      return { offerings, ruleSets };
    },

    async createOffering(actor: GraduateActor, input: CreateOffering): Promise<OfferingRecord> {
      return mutate(actor, async (tx) => {
        if (await repo.getOfferingByKey(input.key, tx)) {
          throw new GraduateError(409, "GRADUATE_CONFLICT", "An offering with this key already exists");
        }
        const offering = await repo.insertOffering({ ...input, createdBy: actor.id }, tx);
        await history(tx, actor, { programId: null, studentId: null, action: "offering_created", entityType: "offering", entityId: offering.id, before: null, after: offering });
        return {
          result: offering,
          audit: { eventType: "graduate.offering_created", action: "offering_created", programId: null, studentId: null, entityType: "offering", entityId: offering.id },
        };
      });
    },

    async createRuleSet(actor: GraduateActor, offeringId: string, input: CreateRuleSet): Promise<RuleSetRecord> {
      return mutate(actor, async (tx) => {
        const offering = await repo.lockOffering(offeringId, tx);
        if (!offering) throw notFound("Offering not found");
        const version = await repo.nextRuleSetVersion(offeringId, tx);
        // The previous active rule set of the same cohort becomes superseded. Enrollments keep their pinned rule_set_id.
        const superseded = await repo.supersedeActiveRuleSets(offeringId, input.cohortLabel, tx);
        const ruleSet = await repo.insertRuleSet(
          {
            offeringId, cohortLabel: input.cohortLabel, version, effectiveFrom: input.effectiveFrom,
            // Rule values were validated against ruleValueSchemas by createRuleSetSchema.
            rules: input.rules as unknown as readonly CohortRule[],
            supersedesId: superseded?.id ?? null, note: input.note ?? null, createdBy: actor.id,
          },
          tx,
        );
        await history(tx, actor, {
          programId: null, studentId: null, action: "rule_set_created", entityType: "rule_set", entityId: ruleSet.id,
          before: superseded ? { id: superseded.id, version: superseded.version, status: "active" } : null,
          after: { id: ruleSet.id, offeringId, cohortLabel: ruleSet.cohortLabel, version, supersedesId: ruleSet.supersedesId },
        });
        return {
          result: ruleSet,
          audit: {
            eventType: "graduate.rule_set_created", action: "rule_set_created", programId: null, studentId: null, entityType: "rule_set", entityId: ruleSet.id,
            extra: { offeringId, version },
          },
        };
      });
    },

    // =======================================================================
    // Staff: workspace and programme data
    // =======================================================================

    async getWorkspace(actorRole: GuardActorRole, studentId: string): Promise<StaffGraduateWorkspace> {
      return workspaceFor(actorRole, studentId, deps.readTx);
    },

    async enroll(actor: GraduateActor, studentId: string, input: EnrollProgram): Promise<{ program: StaffGraduateProgramView; id: string }> {
      return mutate(actor, async (tx) => {
        if (!(await repo.studentExists(studentId, tx))) throw notFound("Student not found");
        const offering = await repo.getOffering(input.offeringId, tx);
        if (!offering) throw notFound("Offering not found");
        const ruleSet = await repo.getRuleSet(input.ruleSetId, tx);
        if (!ruleSet) throw notFound("Rule set not found");
        if (ruleSet.offeringId !== offering.id) {
          throw new GraduateError(409, "GRADUATE_RULE_SET_MISMATCH", "The rule set does not belong to this offering");
        }
        // Creates NO subjects, records or credits: ENEB enrollment never implies university registration.
        const program = await repo.insertProgram(
          {
            studentId, offeringId: offering.id, ruleSetId: ruleSet.id, route: offering.route, cohortLabel: input.cohortLabel,
            enrollmentContractTitle: input.enrollmentContractTitle, enrolledAt: input.enrolledAt,
            priorBachelorSource: input.priorBachelorSource, createdBy: actor.id,
          },
          tx,
        );
        await history(tx, actor, { programId: program.id, studentId, action: "program_enrolled", entityType: "program", entityId: program.id, before: null, after: program });
        const view = await staffView(program.id, actor.role, tx);
        return {
          result: { program: view, id: program.id },
          audit: { eventType: "graduate.program_enrolled", action: "program_enrolled", programId: program.id, studentId, entityType: "program", entityId: program.id, extra: { offeringId: offering.id, ruleSetId: ruleSet.id } },
        };
      });
    },

    async updateProgram(actor: GraduateActor, programId: string, patch: UpdateProgram): Promise<StaffGraduateProgramView> {
      return mutate(actor, async (tx) => {
        const before = await repo.lockProgram(programId, tx);
        if (!before) throw notFound("Programme not found");
        const after = await repo.updateProgram(programId, patch, tx);
        await history(tx, actor, {
          programId, studentId: before.studentId, action: "program_updated", entityType: "program", entityId: programId,
          before, after: { ...after, ...(patch.note !== undefined ? { note: patch.note } : {}) },
        });
        return {
          result: await staffView(programId, actor.role, tx),
          audit: { eventType: "graduate.program_updated", action: "program_updated", programId, studentId: before.studentId, entityType: "program", entityId: programId },
        };
      });
    },

    async createSubject(actor: GraduateActor, programId: string, input: CreateSubject): Promise<{ program: StaffGraduateProgramView; id: string }> {
      return mutate(actor, async (tx) => {
        const program = await repo.lockProgram(programId, tx);
        if (!program) throw notFound("Programme not found");
        if (input.authority === "unimarconi" && program.route === "eneb_only") {
          throw new GraduateError(422, "GRADUATE_EVIDENCE_REQUIRED", "This is an ENEB-only programme; it has no university subjects", ["ROUTE_HAS_NO_UNIVERSITY"]);
        }
        const subject = await repo.insertSubject({ programId, ...input }, tx);
        await history(tx, actor, { programId, studentId: program.studentId, action: "subject_created", entityType: "subject", entityId: subject.id, before: null, after: subject });
        return {
          result: { program: await staffView(programId, actor.role, tx), id: subject.id },
          audit: { eventType: "graduate.subject_created", action: "subject_created", programId, studentId: program.studentId, entityType: "subject", entityId: subject.id, extra: { authority: subject.authority } },
        };
      });
    },

    /** Records a subject result. Never creates credit entries. */
    async recordSubjectResult(actor: GraduateActor, subjectId: string, input: RecordSubjectResult): Promise<StaffGraduateProgramView> {
      return mutate(actor, async (tx) => {
        const found = await repo.getSubject(subjectId, tx);
        if (!found) throw notFound("Subject not found");
        const program = await repo.lockProgram(found.programId, tx);
        if (!program) throw notFound("Programme not found");
        const subject = (await repo.getSubject(subjectId, tx))!;

        if (input.kind === "correction" && subject.resultStatus === "none") {
          throw new GraduateError(409, "GRADUATE_CONFLICT", "There is no recorded result to correct");
        }
        if (input.verificationStatus === "verified") {
          const missing: GuardCode[] = [];
          if (input.issuingInstitution !== subject.authority) missing.push("WRONG_ISSUER");
          if (!input.documentId && !input.documentReference) missing.push("DOCUMENT_REFERENCE_REQUIRED");
          if (missing.length) {
            throw new GraduateError(422, "GRADUATE_EVIDENCE_REQUIRED", "A verified result needs a document from the institution that graded it", missing);
          }
        }
        if (input.documentId) await requireOwnDocument(actor, program.studentId, program.id, input.documentId, tx);

        const updated = await repo.updateSubject(
          subjectId,
          {
            resultStatus: input.resultStatus,
            gradeValue: input.gradeValue,
            gradeScale: input.gradeScale,
            gradeDisplay: input.gradeDisplay,
            issuingInstitution: input.issuingInstitution,
            verificationStatus: input.verificationStatus,
            documentId: input.documentId,
            documentReference: input.documentReference,
            reassessmentCount: subject.reassessmentCount + (input.kind === "reassessment" ? 1 : 0),
            correctionCount: subject.correctionCount + (input.kind === "correction" ? 1 : 0),
            recordedBy: actor.id,
            recordedAt: now(),
          },
          tx,
        );
        await history(tx, actor, {
          programId: program.id, studentId: program.studentId, action: `result_${input.kind}`, entityType: "subject", entityId: subjectId,
          before: subject, after: { ...updated, resultNote: input.note },
        });
        return {
          result: await staffView(program.id, actor.role, tx),
          audit: {
            eventType: "graduate.result_recorded", action: `result_${input.kind}`, programId: program.id, studentId: program.studentId,
            entityType: "subject", entityId: subjectId, extra: { kind: input.kind, verificationStatus: input.verificationStatus },
          },
        };
      });
    },

    // =======================================================================
    // Staff: records
    // =======================================================================

    async createRecord(actor: GraduateActor, programId: string, input: TrackRecord): Promise<{ program: StaffGraduateProgramView; id: string }> {
      const kind = input.kind;
      if (!kind) throw new GraduateError(400, "GRADUATE_VALIDATION_ERROR", "kind is required");
      return mutate(actor, async (tx) => {
        const program = await repo.lockProgram(programId, tx);
        if (!program) throw notFound("Programme not found");
        if (isUniversityKind(kind) && program.route === "eneb_only") {
          throw new GraduateError(422, "GRADUATE_EVIDENCE_REQUIRED", "This is an ENEB-only programme; it has no university record to track", ["ROUTE_HAS_NO_UNIVERSITY"]);
        }
        if (input.documentId) await requireOwnDocument(actor, program.studentId, programId, input.documentId, tx);
        // Verification and outcome can never be set here: the record starts `unknown`.
        if (input.outcome !== undefined && input.outcome !== null) {
          throw new GraduateError(400, "GRADUATE_VALIDATION_ERROR", "Set an outcome by updating or verifying the record, not on creation");
        }
        const created = await repo.insertRecord(
          {
            programId, studentId: program.studentId, kind,
            trackingStatus: input.trackingStatus ?? "not_started",
            verificationStatus: "unknown",
            issuingInstitution: input.issuingInstitution ?? null,
            documentTypeLabel: input.documentTypeLabel ?? null,
            documentReference: input.documentReference ?? null,
            documentId: input.documentId ?? null,
            academicConsequence: input.academicConsequence ?? null,
            conflictingEvidence: input.conflictingEvidence ?? null,
            details: input.details ?? {},
            note: input.note ?? null,
            createdBy: actor.id,
          },
          tx,
        );
        await history(tx, actor, { programId, studentId: program.studentId, action: "record_created", entityType: "record", entityId: created.id, before: null, after: created });
        return {
          result: { program: await staffView(programId, actor.role, tx), id: created.id },
          audit: { eventType: "graduate.record_created", action: "record_created", programId, studentId: program.studentId, entityType: "record", entityId: created.id, extra: { kind } },
        };
      });
    },

    /** Tracking updates are never blocked by missing evidence; a verified record only takes note / tracking / conflicting evidence. */
    async trackRecord(actor: GraduateActor, recordId: string, input: TrackRecord): Promise<StaffGraduateProgramView> {
      if (input.kind !== undefined) throw new GraduateError(400, "GRADUATE_VALIDATION_ERROR", "A record's kind cannot be changed");
      return mutate(actor, async (tx) => {
        const found = await repo.getRecord(recordId, tx);
        if (!found) throw notFound("Record not found");
        const program = await repo.lockProgram(found.programId, tx);
        if (!program) throw notFound("Programme not found");
        const record = (await repo.getRecord(recordId, tx))!;

        const given = (Object.keys(input) as (keyof TrackRecord)[]).filter((k) => input[k] !== undefined);
        if (record.verificationStatus === "verified") {
          const allowed: (keyof TrackRecord)[] = ["note", "trackingStatus", "conflictingEvidence"];
          const blocked = given.filter((k) => !allowed.includes(k));
          if (blocked.length) {
            throw new GraduateError(409, "GRADUATE_CONFLICT", "This record is verified; re-verify instead of editing its evidence", undefined, { fields: blocked });
          }
        }
        if (input.documentId) await requireOwnDocument(actor, record.studentId, record.programId, input.documentId, tx);
        if (input.outcome !== undefined && input.outcome !== null) {
          if (isOfficialKind(record.kind)) {
            throw new GraduateError(409, "GRADUATE_CONFLICT", "An official record's outcome is set only by verifying it with evidence");
          }
          const vocabulary = RECORD_OUTCOMES[record.kind];
          if (!vocabulary || !vocabulary.includes(input.outcome)) {
            throw new GraduateError(422, "GRADUATE_EVIDENCE_REQUIRED", "That outcome does not apply to this kind of record", ["OUTCOME_INVALID"]);
          }
        }

        const patch: RecordPatch = {
          ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
          ...(input.trackingStatus !== undefined ? { trackingStatus: input.trackingStatus } : {}),
          ...(input.issuingInstitution !== undefined ? { issuingInstitution: input.issuingInstitution } : {}),
          ...(input.documentTypeLabel !== undefined ? { documentTypeLabel: input.documentTypeLabel } : {}),
          ...(input.documentReference !== undefined ? { documentReference: input.documentReference } : {}),
          ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
          ...(input.academicConsequence !== undefined ? { academicConsequence: input.academicConsequence } : {}),
          ...(input.conflictingEvidence !== undefined ? { conflictingEvidence: input.conflictingEvidence } : {}),
          ...(input.details !== undefined ? { details: merge(record.details, input.details) } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        };
        const updated = await repo.updateRecord(recordId, patch, tx);
        await history(tx, actor, { programId: record.programId, studentId: record.studentId, action: "record_updated", entityType: "record", entityId: recordId, before: record, after: updated });
        return {
          result: await staffView(record.programId, actor.role, tx),
          audit: { eventType: "graduate.record_updated", action: "record_updated", programId: record.programId, studentId: record.studentId, entityType: "record", entityId: recordId, extra: { kind: record.kind } },
        };
      });
    },

    /** The only way to set an official status; gated by evaluateOfficialChange(). */
    async verifyRecord(actor: GraduateActor, recordId: string, input: VerifyRecord): Promise<StaffGraduateProgramView> {
      type Outcome = { blocked: readonly GuardCode[]; program: StaffGraduateProgramView | null; record: GraduateRecord };
      const outcome = await deps.transaction<Outcome>(async (tx) => {
        const found = await repo.getRecord(recordId, tx);
        if (!found) throw notFound("Record not found");
        const program = await repo.lockProgram(found.programId, tx);
        if (!program) throw notFound("Programme not found");
        const record = (await repo.getRecord(recordId, tx))!;
        const siblings = await repo.listRecords(program.id, tx);
        const doc = input.documentId ? await repo.getStudentDocument(input.documentId, tx) : null;

        const guard = evaluateOfficialChange(record.kind, input, {
          actorRole: actor.role,
          program,
          existing: record,
          siblings,
          document: doc ? { studentId: doc.studentId, status: doc.status, country: doc.country } : null,
        });
        const missing: GuardCode[] = [...guard.missing];
        // Non-verified decisions are not outcome-checked by the guard; keep outcomes inside the kind's vocabulary.
        if (guard.allowed && input.decision !== "verified" && input.outcome) {
          const vocabulary = RECORD_OUTCOMES[record.kind];
          if (!vocabulary || !vocabulary.includes(input.outcome)) missing.push("OUTCOME_INVALID");
        }
        if (missing.length) return { blocked: missing, program: null, record };

        const verified = input.decision === "verified";
        const patch: RecordPatch = {
          verificationStatus: input.decision,
          outcome: input.outcome,
          issuingInstitution: input.issuingInstitution ?? record.issuingInstitution,
          documentTypeLabel: input.documentTypeLabel ?? record.documentTypeLabel,
          documentReference: input.documentReference ?? record.documentReference,
          documentId: input.documentId ?? record.documentId,
          decisionDate: input.decisionDate ?? record.decisionDate,
          // Conferral date: only the value supplied in THIS call. Never copied from a ceremony or procedure record.
          effectiveDate: input.effectiveDate ?? (verified ? null : record.effectiveDate),
          effectiveCohort: input.effectiveCohort ?? record.effectiveCohort,
          academicConsequence: input.academicConsequence ?? record.academicConsequence,
          conflictingEvidence: input.conflictingEvidence ?? record.conflictingEvidence,
          details: merge(record.details, input.details),
          reviewerUserId: actor.id,
          reviewedAt: now(),
          note: input.note,
          ...(verified ? { trackingStatus: "completed" as const } : {}),
        };
        const updated = await repo.updateRecord(recordId, patch, tx);
        await history(tx, actor, { programId: program.id, studentId: program.studentId, action: `record_${input.decision}`, entityType: "record", entityId: recordId, before: record, after: updated });
        return { blocked: [], program: await staffView(program.id, actor.role, tx), record };
      });

      if (outcome.blocked.length || !outcome.program) {
        emitAudit(actor, {
          eventType: "graduate.official_change_blocked", action: "official_change_blocked", programId: outcome.record.programId, studentId: outcome.record.studentId,
          entityType: "record", entityId: recordId, severity: "warning", extra: { kind: outcome.record.kind, decision: input.decision, missing: outcome.blocked },
        });
        throw new GraduateError(422, "GRADUATE_EVIDENCE_REQUIRED", "The evidence required for this official change is incomplete", outcome.blocked);
      }
      const eventType: GraduateAuditEvent =
        input.decision === "verified" ? "graduate.record_verified" : input.decision === "rejected" ? "graduate.record_rejected" : "graduate.record_updated";
      emitAudit(actor, {
        eventType, action: `record_${input.decision}`, programId: outcome.record.programId, studentId: outcome.record.studentId,
        entityType: "record", entityId: recordId, extra: { kind: outcome.record.kind, decision: input.decision },
      });
      return outcome.program;
    },

    // =======================================================================
    // Staff: foreign credential evaluations (separate from the Italian award)
    // =======================================================================

    /** Records a foreign evaluator's opinion. Never touches offerings, rules, records, credits or subjects. Starts `unknown`. */
    async recordEvaluation(actor: GraduateActor, studentId: string, input: RecordEvaluation): Promise<{ workspace: StaffGraduateWorkspace; id: string }> {
      return mutate(actor, async (tx) => {
        if (!(await repo.studentExists(studentId, tx))) throw notFound("Student not found");
        const mismatch = evaluationConsistency({ evaluator: input.evaluator, destinationCountry: input.destinationCountry });
        if (mismatch.length) {
          throw new GraduateError(422, "GRADUATE_EVIDENCE_REQUIRED", "This evaluator does not report for that country", mismatch);
        }
        if (input.programId) {
          const program = await repo.getProgram(input.programId, tx);
          if (!program || program.studentId !== studentId) throw notFound("Programme not found");
        }
        if (input.documentId) await requireOwnDocument(actor, studentId, input.programId, input.documentId, tx);
        const created = await repo.insertEvaluation({ ...input, studentId, createdBy: actor.id }, tx);
        await history(tx, actor, {
          programId: created.programId, studentId, action: "evaluation_recorded", entityType: "evaluation", entityId: created.id, before: null, after: created,
        });
        return {
          result: { workspace: await workspaceFor(actor.role, studentId, tx), id: created.id },
          audit: {
            eventType: "graduate.evaluation_recorded", action: "evaluation_recorded", programId: created.programId, studentId, entityType: "evaluation", entityId: created.id,
            extra: { evaluator: created.evaluator, destinationCountry: created.destinationCountry, evaluationType: created.evaluationType },
          },
        };
      });
    },

    /** A verified evaluation only takes a note or a status change; anything else must be re-verified. */
    async updateEvaluation(actor: GraduateActor, evaluationId: string, input: UpdateEvaluation): Promise<StaffGraduateWorkspace> {
      return mutate(actor, async (tx) => {
        const before = await repo.lockEvaluation(evaluationId, tx);
        if (!before) throw notFound("Evaluation not found");
        const given = (Object.keys(input) as (keyof UpdateEvaluation)[]).filter((k) => input[k] !== undefined);
        if (before.verificationStatus === "verified") {
          const allowed: (keyof UpdateEvaluation)[] = ["note", "status"];
          const blocked = given.filter((k) => !allowed.includes(k));
          if (blocked.length) {
            throw new GraduateError(409, "GRADUATE_CONFLICT", "This evaluation is verified; re-verify instead of editing its evidence", undefined, { fields: blocked });
          }
        }
        if (input.documentId) await requireOwnDocument(actor, before.studentId, before.programId, input.documentId, tx);
        // A verified evaluation that is no longer completed can no longer stand as verified.
        const demote = before.verificationStatus === "verified" && input.status !== undefined && input.status !== "completed";
        const patch: EvaluationPatch = {
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.reportDate !== undefined ? { reportDate: input.reportDate } : {}),
          ...(input.reportReference !== undefined ? { reportReference: input.reportReference } : {}),
          ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
          ...(input.conclusion !== undefined ? { conclusion: input.conclusion } : {}),
          ...(input.conclusionText !== undefined ? { conclusionText: input.conclusionText } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(demote ? { verificationStatus: "unknown" as const, reviewerUserId: null, reviewedAt: null } : {}),
        };
        const after = await repo.updateEvaluation(evaluationId, patch, tx);
        await history(tx, actor, {
          programId: before.programId, studentId: before.studentId, action: "evaluation_updated", entityType: "evaluation", entityId: evaluationId, before, after,
        });
        return {
          result: await workspaceFor(actor.role, before.studentId, tx),
          audit: {
            eventType: "graduate.evaluation_updated", action: "evaluation_updated", programId: before.programId, studentId: before.studentId, entityType: "evaluation", entityId: evaluationId,
            extra: { fields: given },
          },
        };
      });
    },

    /** The only way to set an evaluation's verification status; gated by evaluateEvaluationVerification(). */
    async verifyEvaluation(actor: GraduateActor, evaluationId: string, input: VerifyEvaluation): Promise<StaffGraduateWorkspace> {
      type Outcome = { blocked: readonly EvaluationGuardCode[]; workspace: StaffGraduateWorkspace | null; evaluation: CredentialEvaluationRecord };
      const outcome = await deps.transaction<Outcome>(async (tx) => {
        const evaluation = await repo.lockEvaluation(evaluationId, tx);
        if (!evaluation) throw notFound("Evaluation not found");
        const guard = evaluateEvaluationVerification(evaluation, input, actor.role);
        if (!guard.allowed) return { blocked: guard.missing, workspace: null, evaluation };
        const updated = await repo.updateEvaluation(
          evaluationId,
          {
            verificationStatus: input.decision,
            conflictingEvidence: input.decision === "verified" ? null : input.conflictingEvidence ?? evaluation.conflictingEvidence,
            reviewerUserId: actor.id,
            reviewedAt: now(),
            note: input.note,
          },
          tx,
        );
        await history(tx, actor, {
          programId: evaluation.programId, studentId: evaluation.studentId, action: `evaluation_${input.decision}`, entityType: "evaluation", entityId: evaluationId,
          before: evaluation, after: updated,
        });
        return { blocked: [], workspace: await workspaceFor(actor.role, evaluation.studentId, tx), evaluation };
      });

      if (outcome.blocked.length || !outcome.workspace) {
        emitAudit(actor, {
          eventType: "graduate.official_change_blocked", action: "evaluation_verification_blocked", programId: outcome.evaluation.programId, studentId: outcome.evaluation.studentId,
          entityType: "evaluation", entityId: evaluationId, severity: "warning", extra: { decision: input.decision, missing: outcome.blocked },
        });
        throw new GraduateError(422, "GRADUATE_EVIDENCE_REQUIRED", "The evidence required to verify this evaluation is incomplete", outcome.blocked);
      }
      emitAudit(actor, {
        eventType: input.decision === "verified" ? "graduate.evaluation_verified" : "graduate.evaluation_updated",
        action: `evaluation_${input.decision}`, programId: outcome.evaluation.programId, studentId: outcome.evaluation.studentId,
        entityType: "evaluation", entityId: evaluationId, extra: { decision: input.decision },
      });
      return outcome.workspace;
    },

    // =======================================================================
    // Staff: credits and history
    // =======================================================================

    async createCreditEntry(actor: GraduateActor, programId: string, input: CreateCreditEntry): Promise<{ program: StaffGraduateProgramView; id: string }> {
      return mutate(actor, async (tx) => {
        const program = await repo.lockProgram(programId, tx);
        if (!program) throw notFound("Programme not found");
        const candidate = await repo.getRecord(input.recordId, tx);
        // A record of another programme is no backing at all.
        const backing = candidate && candidate.programId === programId ? candidate : null;
        const guard = evaluateCreditEntry(input, { actorRole: actor.role, route: program.route, backing });
        if (!guard.allowed) {
          throw new GraduateError(422, "GRADUATE_EVIDENCE_REQUIRED", "These credits cannot be recorded yet", guard.missing);
        }
        if (input.subjectId) {
          const subject = await repo.getSubject(input.subjectId, tx);
          if (!subject || subject.programId !== programId) throw notFound("Subject not found");
        }
        const credit = await repo.insertCredit({ programId, ...input, createdBy: actor.id }, tx);
        await history(tx, actor, { programId, studentId: program.studentId, action: "credit_recorded", entityType: "credit", entityId: credit.id, before: null, after: credit });
        return {
          result: { program: await staffView(programId, actor.role, tx), id: credit.id },
          audit: { eventType: "graduate.credit_recorded", action: "credit_recorded", programId, studentId: program.studentId, entityType: "credit", entityId: credit.id, extra: { authority: credit.authority } },
        };
      });
    },

    async listEvents(programId: string): Promise<GraduateEventRecord[]> {
      if (!(await repo.getProgram(programId, deps.readTx))) throw notFound("Programme not found");
      return repo.listEvents(programId, deps.readTx);
    },
  };
}

export type GraduateProgramService = ReturnType<typeof createGraduateProgramService>;

let defaultService: GraduateProgramService | null = null;

/** Production wiring: real Postgres via server/lib/db.ts. Loaded lazily so importing the router never opens a connection. */
export async function getDefaultGraduateProgramService(): Promise<GraduateProgramService> {
  if (!defaultService) {
    const [{ db }, { graduateRepository }] = await Promise.all([import("../lib/db"), import("../repositories/graduate-program-repo")]);
    defaultService = createGraduateProgramService({
      repo: graduateRepository,
      transaction: (fn) => db.transaction((tx) => fn(tx as unknown as Tx)),
      readTx: db,
    });
  }
  return defaultService;
}
