/**
 * Graduate Program Repository — data access only (S12).
 *
 * No business rules. Every function takes the Tx last (default: the shared
 * db) so the service can run a whole operation in ONE transaction. Rows are
 * mapped to the records of shared/graduate-program-contract.ts: ISO strings
 * for timestamps, YYYY-MM-DD for dates, numbers for numeric columns.
 *
 * graduate_events is append-only (the database rejects UPDATE/DELETE) and
 * credit entries are never updated.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "../lib/db";
import { studentsTable } from "@shared/schema";
import {
  graduateCohortRuleSets,
  graduateCreditEntries,
  graduateCredentialEvaluations,
  graduateEvents,
  graduateProgramOfferings,
  graduateRecords,
  graduateSubjects,
  studentGraduatePrograms,
  type GraduateCreditRow,
  type GraduateEvaluationRow,
  type GraduateEventRow,
  type GraduateOfferingRow,
  type GraduateProgramRow,
  type GraduateRecordRow,
  type GraduateRuleSetRow,
  type GraduateSubjectRow,
} from "@shared/graduate-program-schema";
import type {
  CohortRule,
  CreditEntryRecord,
  CredentialEvaluationRecord,
  GraduateProgramBundle,
  GraduateProgramRecord,
  GraduateRecord,
  OfferingRecord,
  RecordDetails,
  RuleSetRecord,
  SubjectRecord,
} from "@shared/graduate-program-contract";

export type Tx = PgTransaction<any, any, any> | typeof db;

// ---------------------------------------------------------------------------
// Row -> record mapping
// ---------------------------------------------------------------------------

const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);
const num = (v: string | number | null): number | null => (v === null || v === undefined ? null : Number(v));

export function toOffering(r: GraduateOfferingRow): OfferingRecord {
  return {
    id: r.id,
    key: r.key,
    category: r.category as OfferingRecord["category"],
    route: r.route as OfferingRecord["route"],
    marketingTitle: r.marketingTitle,
    alternativeMarketingTitles: (r.alternativeMarketingTitles as string[] | null) ?? [],
    universityLegalTitle: r.universityLegalTitle,
    universityLegalTitleStatus: r.universityLegalTitleStatus as OfferingRecord["universityLegalTitleStatus"],
    awardingInstitution: r.awardingInstitution as OfferingRecord["awardingInstitution"],
    qualificationClassification: r.qualificationClassification as OfferingRecord["qualificationClassification"],
    classificationStatus: r.classificationStatus as OfferingRecord["classificationStatus"],
    programVersion: r.programVersion,
    publishedDurationMonths: r.publishedDurationMonths,
    publishedEcts: num(r.publishedEcts),
    evidenceNote: r.evidenceNote,
    createdAt: iso(r.createdAt)!,
  };
}

export function toRuleSet(r: GraduateRuleSetRow): RuleSetRecord {
  return {
    id: r.id,
    offeringId: r.offeringId,
    cohortLabel: r.cohortLabel,
    version: r.version,
    effectiveFrom: r.effectiveFrom,
    rules: (r.rules as CohortRule[] | null) ?? [],
    status: r.status as RuleSetRecord["status"],
    supersedesId: r.supersedesId,
    note: r.note,
    createdBy: r.createdBy,
    createdAt: iso(r.createdAt)!,
  };
}

export function toProgram(r: GraduateProgramRow): GraduateProgramRecord {
  return {
    id: r.id,
    studentId: r.studentId,
    offeringId: r.offeringId,
    ruleSetId: r.ruleSetId,
    route: r.route as GraduateProgramRecord["route"],
    cohortLabel: r.cohortLabel,
    enrollmentContractTitle: r.enrollmentContractTitle,
    enrolledAt: r.enrolledAt,
    enebStatus: r.enebStatus as GraduateProgramRecord["enebStatus"],
    priorBachelorSource: r.priorBachelorSource as GraduateProgramRecord["priorBachelorSource"],
    createdBy: r.createdBy,
    createdAt: iso(r.createdAt)!,
    updatedAt: iso(r.updatedAt)!,
  };
}

export function toSubject(r: GraduateSubjectRow): SubjectRecord {
  return {
    id: r.id,
    programId: r.programId,
    authority: r.authority as SubjectRecord["authority"],
    title: r.title,
    moduleCode: r.moduleCode,
    statedCredits: num(r.statedCredits),
    creditUnit: r.creditUnit as SubjectRecord["creditUnit"],
    assessmentType: r.assessmentType as SubjectRecord["assessmentType"],
    sortOrder: r.sortOrder,
    studentProgress: r.studentProgress as SubjectRecord["studentProgress"],
    resultStatus: r.resultStatus as SubjectRecord["resultStatus"],
    gradeValue: num(r.gradeValue),
    gradeScale: num(r.gradeScale),
    gradeDisplay: r.gradeDisplay,
    issuingInstitution: r.issuingInstitution as SubjectRecord["issuingInstitution"],
    verificationStatus: r.verificationStatus as SubjectRecord["verificationStatus"],
    documentId: r.documentId,
    documentReference: r.documentReference,
    reassessmentCount: r.reassessmentCount,
    correctionCount: r.correctionCount,
    recordedBy: r.recordedBy,
    recordedAt: iso(r.recordedAt),
  };
}

export function toRecord(r: GraduateRecordRow): GraduateRecord {
  return {
    id: r.id,
    programId: r.programId,
    studentId: r.studentId,
    kind: r.kind as GraduateRecord["kind"],
    trackingStatus: r.trackingStatus as GraduateRecord["trackingStatus"],
    verificationStatus: r.verificationStatus as GraduateRecord["verificationStatus"],
    outcome: r.outcome,
    issuingInstitution: r.issuingInstitution as GraduateRecord["issuingInstitution"],
    documentTypeLabel: r.documentTypeLabel,
    documentReference: r.documentReference,
    documentId: r.documentId,
    decisionDate: r.decisionDate,
    effectiveDate: r.effectiveDate,
    effectiveCohort: r.effectiveCohort,
    academicConsequence: r.academicConsequence,
    conflictingEvidence: r.conflictingEvidence,
    details: (r.details as RecordDetails | null) ?? {},
    reviewerUserId: r.reviewerUserId,
    reviewedAt: iso(r.reviewedAt),
    note: r.note,
    createdBy: r.createdBy,
    createdAt: iso(r.createdAt)!,
    updatedAt: iso(r.updatedAt)!,
  };
}

export function toCredit(r: GraduateCreditRow): CreditEntryRecord {
  return {
    id: r.id,
    programId: r.programId,
    authority: r.authority as CreditEntryRecord["authority"],
    recordId: r.recordId,
    subjectId: r.subjectId,
    label: r.label,
    amount: Number(r.amount),
    unit: r.unit as CreditEntryRecord["unit"],
    recognitionOutcome: r.recognitionOutcome as CreditEntryRecord["recognitionOutcome"],
    conditions: r.conditions,
    createdBy: r.createdBy,
    createdAt: iso(r.createdAt)!,
  };
}

export function toEvaluation(r: GraduateEvaluationRow): CredentialEvaluationRecord {
  return {
    id: r.id,
    studentId: r.studentId,
    programId: r.programId,
    evaluator: r.evaluator as CredentialEvaluationRecord["evaluator"],
    evaluatorName: r.evaluatorName,
    destinationCountry: r.destinationCountry,
    qualificationEvaluated: r.qualificationEvaluated,
    awardingInstitution: r.awardingInstitution as CredentialEvaluationRecord["awardingInstitution"],
    intendedUse: r.intendedUse as CredentialEvaluationRecord["intendedUse"],
    evaluationType: r.evaluationType as CredentialEvaluationRecord["evaluationType"],
    status: r.status as CredentialEvaluationRecord["status"],
    reportDate: r.reportDate,
    reportReference: r.reportReference,
    documentId: r.documentId,
    conclusion: r.conclusion as CredentialEvaluationRecord["conclusion"],
    conclusionText: r.conclusionText,
    verificationStatus: r.verificationStatus as CredentialEvaluationRecord["verificationStatus"],
    conflictingEvidence: r.conflictingEvidence,
    reviewerUserId: r.reviewerUserId,
    reviewedAt: iso(r.reviewedAt),
    note: r.note,
    createdBy: r.createdBy,
    createdAt: iso(r.createdAt)!,
    updatedAt: iso(r.updatedAt)!,
  };
}

export interface GraduateEventRecord {
  readonly id: string;
  readonly programId: string | null;
  readonly studentId: string | null;
  readonly actorUserId: string | null;
  readonly actorRole: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly createdAt: string;
}

function toEvent(r: GraduateEventRow): GraduateEventRecord {
  return {
    id: r.id,
    programId: r.programId,
    studentId: r.studentId,
    actorUserId: r.actorUserId,
    actorRole: r.actorRole,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    before: r.before ?? null,
    after: r.after ?? null,
    createdAt: iso(r.createdAt)!,
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface NewOffering extends Omit<OfferingRecord, "id" | "createdAt"> {
  readonly createdBy: string | null;
}

export interface NewRuleSet {
  readonly offeringId: string;
  readonly cohortLabel: string;
  readonly version: number;
  readonly effectiveFrom: string;
  readonly rules: readonly CohortRule[];
  readonly supersedesId: string | null;
  readonly note: string | null;
  readonly createdBy: string | null;
}

export interface NewProgram {
  readonly studentId: string;
  readonly offeringId: string;
  readonly ruleSetId: string;
  readonly route: GraduateProgramRecord["route"];
  readonly cohortLabel: string;
  readonly enrollmentContractTitle: string | null;
  readonly enrolledAt: string;
  readonly priorBachelorSource: GraduateProgramRecord["priorBachelorSource"];
  readonly createdBy: string | null;
}

export interface ProgramPatch {
  readonly enebStatus?: GraduateProgramRecord["enebStatus"];
  readonly enrollmentContractTitle?: string | null;
  readonly priorBachelorSource?: GraduateProgramRecord["priorBachelorSource"];
  readonly note?: string | null;
}

export interface NewSubject {
  readonly programId: string;
  readonly authority: SubjectRecord["authority"];
  readonly title: string;
  readonly moduleCode: string | null;
  readonly statedCredits: number | null;
  readonly creditUnit: SubjectRecord["creditUnit"];
  readonly assessmentType: SubjectRecord["assessmentType"];
  readonly sortOrder: number;
}

export type SubjectPatch = Partial<
  Pick<
    SubjectRecord,
    | "studentProgress"
    | "resultStatus"
    | "gradeValue"
    | "gradeScale"
    | "gradeDisplay"
    | "issuingInstitution"
    | "verificationStatus"
    | "documentId"
    | "documentReference"
    | "reassessmentCount"
    | "correctionCount"
    | "recordedBy"
  >
> & { readonly recordedAt?: Date | null };

export interface NewRecord {
  readonly programId: string;
  readonly studentId: string;
  readonly kind: GraduateRecord["kind"];
  readonly trackingStatus: GraduateRecord["trackingStatus"];
  readonly verificationStatus: GraduateRecord["verificationStatus"];
  readonly issuingInstitution: GraduateRecord["issuingInstitution"];
  readonly documentTypeLabel: string | null;
  readonly documentReference: string | null;
  readonly documentId: string | null;
  readonly academicConsequence: string | null;
  readonly conflictingEvidence: string | null;
  readonly details: RecordDetails;
  readonly note: string | null;
  readonly createdBy: string | null;
}

export type RecordPatch = Partial<
  Pick<
    GraduateRecord,
    | "trackingStatus"
    | "verificationStatus"
    | "outcome"
    | "issuingInstitution"
    | "documentTypeLabel"
    | "documentReference"
    | "documentId"
    | "decisionDate"
    | "effectiveDate"
    | "effectiveCohort"
    | "academicConsequence"
    | "conflictingEvidence"
    | "details"
    | "reviewerUserId"
    | "note"
  >
> & { readonly reviewedAt?: Date | null };

export interface NewCredit {
  readonly programId: string;
  readonly authority: CreditEntryRecord["authority"];
  readonly recordId: string;
  readonly subjectId: string | null;
  readonly label: string;
  readonly amount: number;
  readonly unit: CreditEntryRecord["unit"];
  readonly recognitionOutcome: CreditEntryRecord["recognitionOutcome"];
  readonly conditions: string | null;
  readonly note: string | null;
  readonly createdBy: string | null;
}

export interface NewEvaluation {
  readonly studentId: string;
  readonly programId: string | null;
  readonly evaluator: CredentialEvaluationRecord["evaluator"];
  readonly evaluatorName: string | null;
  readonly destinationCountry: string;
  readonly qualificationEvaluated: string;
  readonly awardingInstitution: CredentialEvaluationRecord["awardingInstitution"];
  readonly intendedUse: CredentialEvaluationRecord["intendedUse"];
  readonly evaluationType: CredentialEvaluationRecord["evaluationType"];
  readonly status: CredentialEvaluationRecord["status"];
  readonly reportDate: string | null;
  readonly reportReference: string | null;
  readonly documentId: string | null;
  readonly conclusion: CredentialEvaluationRecord["conclusion"];
  readonly conclusionText: string | null;
  readonly note: string | null;
  readonly createdBy: string | null;
}

export type EvaluationPatch = Partial<
  Pick<
    CredentialEvaluationRecord,
    | "status"
    | "reportDate"
    | "reportReference"
    | "documentId"
    | "conclusion"
    | "conclusionText"
    | "verificationStatus"
    | "conflictingEvidence"
    | "reviewerUserId"
    | "note"
  >
> & { readonly reviewedAt?: Date | null };

export interface NewEvent {
  readonly programId: string | null;
  readonly studentId: string | null;
  readonly actorUserId: string | null;
  readonly actorRole: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly before: unknown;
  readonly after: unknown;
}

/** A student document as the guard needs it (existing student_documents table; read only). */
export interface StudentDocumentRow {
  readonly id: string;
  readonly studentId: string;
  readonly status: string;
  readonly country: string | null;
  readonly fileName: string;
}

// ---------------------------------------------------------------------------
// Persistence port
// ---------------------------------------------------------------------------

export interface GraduateRepository {
  studentExists(studentId: string, tx: Tx): Promise<boolean>;

  listOfferings(tx: Tx): Promise<OfferingRecord[]>;
  getOffering(id: string, tx: Tx): Promise<OfferingRecord | null>;
  getOfferingByKey(key: string, tx: Tx): Promise<OfferingRecord | null>;
  /** SELECT ... FOR UPDATE: serializes version assignment for one offering. */
  lockOffering(id: string, tx: Tx): Promise<OfferingRecord | null>;
  insertOffering(input: NewOffering, tx: Tx): Promise<OfferingRecord>;

  listRuleSets(tx: Tx): Promise<RuleSetRecord[]>;
  getRuleSet(id: string, tx: Tx): Promise<RuleSetRecord | null>;
  nextRuleSetVersion(offeringId: string, tx: Tx): Promise<number>;
  /** Marks every ACTIVE rule set of (offering, cohort) superseded; returns the one with the highest version (or null). */
  supersedeActiveRuleSets(offeringId: string, cohortLabel: string, tx: Tx): Promise<RuleSetRecord | null>;
  insertRuleSet(input: NewRuleSet, tx: Tx): Promise<RuleSetRecord>;
  getActiveRuleSet(offeringId: string, cohortLabel: string, tx: Tx): Promise<RuleSetRecord | null>;

  listProgramsForStudent(studentId: string, tx: Tx): Promise<GraduateProgramRecord[]>;
  getProgram(id: string, tx: Tx): Promise<GraduateProgramRecord | null>;
  /** SELECT ... FOR UPDATE on the program row (serializes writes on one programme). */
  lockProgram(id: string, tx: Tx): Promise<GraduateProgramRecord | null>;
  insertProgram(input: NewProgram, tx: Tx): Promise<GraduateProgramRecord>;
  updateProgram(id: string, patch: ProgramPatch, tx: Tx): Promise<GraduateProgramRecord>;

  listSubjects(programId: string, tx: Tx): Promise<SubjectRecord[]>;
  getSubject(id: string, tx: Tx): Promise<SubjectRecord | null>;
  insertSubject(input: NewSubject, tx: Tx): Promise<SubjectRecord>;
  updateSubject(id: string, patch: SubjectPatch, tx: Tx): Promise<SubjectRecord>;

  listRecords(programId: string, tx: Tx): Promise<GraduateRecord[]>;
  getRecord(id: string, tx: Tx): Promise<GraduateRecord | null>;
  insertRecord(input: NewRecord, tx: Tx): Promise<GraduateRecord>;
  updateRecord(id: string, patch: RecordPatch, tx: Tx): Promise<GraduateRecord>;

  listCredits(programId: string, tx: Tx): Promise<CreditEntryRecord[]>;
  insertCredit(input: NewCredit, tx: Tx): Promise<CreditEntryRecord>;

  /** The student's evaluations, newest first. */
  listEvaluationsForStudent(studentId: string, tx: Tx): Promise<CredentialEvaluationRecord[]>;
  getEvaluation(id: string, tx: Tx): Promise<CredentialEvaluationRecord | null>;
  /** SELECT ... FOR UPDATE on the evaluation row. */
  lockEvaluation(id: string, tx: Tx): Promise<CredentialEvaluationRecord | null>;
  insertEvaluation(input: NewEvaluation, tx: Tx): Promise<CredentialEvaluationRecord>;
  updateEvaluation(id: string, patch: EvaluationPatch, tx: Tx): Promise<CredentialEvaluationRecord>;

  appendEvent(input: NewEvent, tx: Tx): Promise<void>;
  listEvents(programId: string, tx: Tx): Promise<GraduateEventRecord[]>;

  /** The student's own, not soft-deleted document with this id; null otherwise. */
  getStudentDocument(documentId: string, tx: Tx): Promise<StudentDocumentRow | null>;
  listDocumentSummaries(ids: readonly string[], tx: Tx): Promise<{ id: string; fileName: string; status: string }[]>;
  /** Every non-deleted document of one student (id, file name, status only), newest first. */
  listStudentDocumentSummaries(studentId: string, tx: Tx): Promise<{ id: string; fileName: string; status: string }[]>;

  loadBundle(programId: string, tx: Tx): Promise<GraduateProgramBundle | null>;
}

const rowsOf = (result: unknown): Array<Record<string, unknown>> => Array.from(result as unknown as Array<Record<string, unknown>>);

export const graduateRepository: GraduateRepository = {
  async studentExists(studentId, tx = db) {
    const rows = await tx.select({ id: studentsTable.id }).from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
    return rows.length > 0;
  },

  async listOfferings(tx = db) {
    const rows = await tx.select().from(graduateProgramOfferings).orderBy(asc(graduateProgramOfferings.marketingTitle), asc(graduateProgramOfferings.key));
    return rows.map(toOffering);
  },
  async getOffering(id, tx = db) {
    const [row] = await tx.select().from(graduateProgramOfferings).where(eq(graduateProgramOfferings.id, id)).limit(1);
    return row ? toOffering(row) : null;
  },
  async getOfferingByKey(key, tx = db) {
    const [row] = await tx.select().from(graduateProgramOfferings).where(eq(graduateProgramOfferings.key, key)).limit(1);
    return row ? toOffering(row) : null;
  },
  async lockOffering(id, tx = db) {
    const [row] = await tx.select().from(graduateProgramOfferings).where(eq(graduateProgramOfferings.id, id)).limit(1).for("update");
    return row ? toOffering(row) : null;
  },
  async insertOffering(input, tx = db) {
    const [row] = await tx
      .insert(graduateProgramOfferings)
      .values({
        key: input.key,
        category: input.category,
        route: input.route,
        marketingTitle: input.marketingTitle,
        alternativeMarketingTitles: [...input.alternativeMarketingTitles],
        universityLegalTitle: input.universityLegalTitle,
        universityLegalTitleStatus: input.universityLegalTitleStatus,
        awardingInstitution: input.awardingInstitution,
        qualificationClassification: input.qualificationClassification,
        classificationStatus: input.classificationStatus,
        programVersion: input.programVersion,
        publishedDurationMonths: input.publishedDurationMonths,
        publishedEcts: input.publishedEcts === null ? null : String(input.publishedEcts),
        evidenceNote: input.evidenceNote,
        createdBy: input.createdBy,
      })
      .returning();
    return toOffering(row);
  },

  async listRuleSets(tx = db) {
    const rows = await tx.select().from(graduateCohortRuleSets).orderBy(asc(graduateCohortRuleSets.offeringId), asc(graduateCohortRuleSets.version));
    return rows.map(toRuleSet);
  },
  async getRuleSet(id, tx = db) {
    const [row] = await tx.select().from(graduateCohortRuleSets).where(eq(graduateCohortRuleSets.id, id)).limit(1);
    return row ? toRuleSet(row) : null;
  },
  async nextRuleSetVersion(offeringId, tx = db) {
    const [row] = await tx
      .select({ max: sql<number | null>`max(${graduateCohortRuleSets.version})` })
      .from(graduateCohortRuleSets)
      .where(eq(graduateCohortRuleSets.offeringId, offeringId));
    return Number(row?.max ?? 0) + 1;
  },
  async supersedeActiveRuleSets(offeringId, cohortLabel, tx = db) {
    const rows = await tx
      .update(graduateCohortRuleSets)
      .set({ status: "superseded" })
      .where(
        and(
          eq(graduateCohortRuleSets.offeringId, offeringId),
          eq(graduateCohortRuleSets.cohortLabel, cohortLabel),
          eq(graduateCohortRuleSets.status, "active"),
        ),
      )
      .returning();
    if (!rows.length) return null;
    return toRuleSet([...rows].sort((a, b) => b.version - a.version)[0]);
  },
  async insertRuleSet(input, tx = db) {
    const [row] = await tx
      .insert(graduateCohortRuleSets)
      .values({
        offeringId: input.offeringId,
        cohortLabel: input.cohortLabel,
        version: input.version,
        effectiveFrom: input.effectiveFrom,
        rules: [...input.rules],
        status: "active",
        supersedesId: input.supersedesId,
        note: input.note,
        createdBy: input.createdBy,
      })
      .returning();
    return toRuleSet(row);
  },
  async getActiveRuleSet(offeringId, cohortLabel, tx = db) {
    const [row] = await tx
      .select()
      .from(graduateCohortRuleSets)
      .where(
        and(
          eq(graduateCohortRuleSets.offeringId, offeringId),
          eq(graduateCohortRuleSets.cohortLabel, cohortLabel),
          eq(graduateCohortRuleSets.status, "active"),
        ),
      )
      .limit(1);
    return row ? toRuleSet(row) : null;
  },

  async listProgramsForStudent(studentId, tx = db) {
    const rows = await tx
      .select()
      .from(studentGraduatePrograms)
      .where(eq(studentGraduatePrograms.studentId, studentId))
      .orderBy(desc(studentGraduatePrograms.enrolledAt), desc(studentGraduatePrograms.createdAt));
    return rows.map(toProgram);
  },
  async getProgram(id, tx = db) {
    const [row] = await tx.select().from(studentGraduatePrograms).where(eq(studentGraduatePrograms.id, id)).limit(1);
    return row ? toProgram(row) : null;
  },
  async lockProgram(id, tx = db) {
    const [row] = await tx.select().from(studentGraduatePrograms).where(eq(studentGraduatePrograms.id, id)).limit(1).for("update");
    return row ? toProgram(row) : null;
  },
  async insertProgram(input, tx = db) {
    const [row] = await tx
      .insert(studentGraduatePrograms)
      .values({
        studentId: input.studentId,
        offeringId: input.offeringId,
        ruleSetId: input.ruleSetId,
        route: input.route,
        cohortLabel: input.cohortLabel,
        enrollmentContractTitle: input.enrollmentContractTitle,
        enrolledAt: input.enrolledAt,
        priorBachelorSource: input.priorBachelorSource,
        createdBy: input.createdBy,
      })
      .returning();
    return toProgram(row);
  },
  async updateProgram(id, patch, tx = db) {
    const [row] = await tx
      .update(studentGraduatePrograms)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(studentGraduatePrograms.id, id))
      .returning();
    return toProgram(row);
  },

  async listSubjects(programId, tx = db) {
    const rows = await tx
      .select()
      .from(graduateSubjects)
      .where(eq(graduateSubjects.programId, programId))
      .orderBy(asc(graduateSubjects.sortOrder), asc(graduateSubjects.title), asc(graduateSubjects.id));
    return rows.map(toSubject);
  },
  async getSubject(id, tx = db) {
    const [row] = await tx.select().from(graduateSubjects).where(eq(graduateSubjects.id, id)).limit(1);
    return row ? toSubject(row) : null;
  },
  async insertSubject(input, tx = db) {
    const [row] = await tx
      .insert(graduateSubjects)
      .values({
        programId: input.programId,
        authority: input.authority,
        title: input.title,
        moduleCode: input.moduleCode,
        statedCredits: input.statedCredits === null ? null : String(input.statedCredits),
        creditUnit: input.creditUnit,
        assessmentType: input.assessmentType,
        sortOrder: input.sortOrder,
      })
      .returning();
    return toSubject(row);
  },
  async updateSubject(id, patch, tx = db) {
    const { gradeValue, gradeScale, ...rest } = patch;
    const [row] = await tx
      .update(graduateSubjects)
      .set({
        ...rest,
        ...(gradeValue !== undefined ? { gradeValue: gradeValue === null ? null : String(gradeValue) } : {}),
        ...(gradeScale !== undefined ? { gradeScale: gradeScale === null ? null : String(gradeScale) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(graduateSubjects.id, id))
      .returning();
    return toSubject(row);
  },

  async listRecords(programId, tx = db) {
    const rows = await tx
      .select()
      .from(graduateRecords)
      .where(eq(graduateRecords.programId, programId))
      .orderBy(asc(graduateRecords.createdAt), asc(graduateRecords.id));
    return rows.map(toRecord);
  },
  async getRecord(id, tx = db) {
    const [row] = await tx.select().from(graduateRecords).where(eq(graduateRecords.id, id)).limit(1);
    return row ? toRecord(row) : null;
  },
  async insertRecord(input, tx = db) {
    const [row] = await tx
      .insert(graduateRecords)
      .values({
        programId: input.programId,
        studentId: input.studentId,
        kind: input.kind,
        trackingStatus: input.trackingStatus,
        verificationStatus: input.verificationStatus,
        issuingInstitution: input.issuingInstitution,
        documentTypeLabel: input.documentTypeLabel,
        documentReference: input.documentReference,
        documentId: input.documentId,
        academicConsequence: input.academicConsequence,
        conflictingEvidence: input.conflictingEvidence,
        details: input.details,
        note: input.note,
        createdBy: input.createdBy,
      })
      .returning();
    return toRecord(row);
  },
  async updateRecord(id, patch, tx = db) {
    const [row] = await tx
      .update(graduateRecords)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(graduateRecords.id, id))
      .returning();
    return toRecord(row);
  },

  async listCredits(programId, tx = db) {
    const rows = await tx
      .select()
      .from(graduateCreditEntries)
      .where(eq(graduateCreditEntries.programId, programId))
      .orderBy(asc(graduateCreditEntries.createdAt), asc(graduateCreditEntries.id));
    return rows.map(toCredit);
  },
  async insertCredit(input, tx = db) {
    const [row] = await tx
      .insert(graduateCreditEntries)
      .values({
        programId: input.programId,
        authority: input.authority,
        recordId: input.recordId,
        subjectId: input.subjectId,
        label: input.label,
        amount: String(input.amount),
        unit: input.unit,
        recognitionOutcome: input.recognitionOutcome,
        conditions: input.conditions,
        note: input.note,
        createdBy: input.createdBy,
      })
      .returning();
    return toCredit(row);
  },

  async listEvaluationsForStudent(studentId, tx = db) {
    const rows = await tx
      .select()
      .from(graduateCredentialEvaluations)
      .where(eq(graduateCredentialEvaluations.studentId, studentId))
      .orderBy(desc(graduateCredentialEvaluations.createdAt), desc(graduateCredentialEvaluations.id));
    return rows.map(toEvaluation);
  },
  async getEvaluation(id, tx = db) {
    const [row] = await tx.select().from(graduateCredentialEvaluations).where(eq(graduateCredentialEvaluations.id, id)).limit(1);
    return row ? toEvaluation(row) : null;
  },
  async lockEvaluation(id, tx = db) {
    const [row] = await tx.select().from(graduateCredentialEvaluations).where(eq(graduateCredentialEvaluations.id, id)).limit(1).for("update");
    return row ? toEvaluation(row) : null;
  },
  async insertEvaluation(input, tx = db) {
    const [row] = await tx.insert(graduateCredentialEvaluations).values({ ...input }).returning();
    return toEvaluation(row);
  },
  async updateEvaluation(id, patch, tx = db) {
    const [row] = await tx
      .update(graduateCredentialEvaluations)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(graduateCredentialEvaluations.id, id))
      .returning();
    return toEvaluation(row);
  },

  async appendEvent(input, tx = db) {
    await tx.insert(graduateEvents).values({
      programId: input.programId,
      studentId: input.studentId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before ?? null,
      after: input.after ?? null,
    });
  },
  async listEvents(programId, tx = db) {
    const rows = await tx
      .select()
      .from(graduateEvents)
      .where(eq(graduateEvents.programId, programId))
      .orderBy(asc(graduateEvents.createdAt), asc(graduateEvents.id));
    return rows.map(toEvent);
  },

  async getStudentDocument(documentId, tx = db) {
    const rows = rowsOf(
      await tx.execute(sql`
        SELECT id::text AS id, student_id::text AS student_id, status::text AS status, country, file_name
        FROM student_documents
        WHERE id = ${documentId} AND soft_deleted = false
        LIMIT 1`),
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: String(r.id),
      studentId: String(r.student_id),
      status: String(r.status),
      country: r.country === null || r.country === undefined ? null : String(r.country),
      fileName: String(r.file_name),
    };
  },
  async listDocumentSummaries(ids, tx = db) {
    if (!ids.length) return [];
    const rows = rowsOf(
      await tx.execute(sql`
        SELECT id::text AS id, file_name, status::text AS status
        FROM student_documents
        WHERE soft_deleted = false AND id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`),
    );
    return rows.map((r) => ({ id: String(r.id), fileName: String(r.file_name), status: String(r.status) }));
  },

  async listStudentDocumentSummaries(studentId, tx = db) {
    const rows = rowsOf(
      await tx.execute(sql`
        SELECT id::text AS id, file_name, status::text AS status
        FROM student_documents
        WHERE soft_deleted = false AND student_id = ${studentId}
        ORDER BY uploaded_at DESC`),
    );
    return rows.map((r) => ({ id: String(r.id), fileName: String(r.file_name), status: String(r.status) }));
  },

  async loadBundle(programId, tx = db) {
    const program = await graduateRepository.getProgram(programId, tx);
    if (!program) return null;
    const [offering, ruleSet, subjects, records, credits] = await Promise.all([
      graduateRepository.getOffering(program.offeringId, tx),
      graduateRepository.getRuleSet(program.ruleSetId, tx),
      graduateRepository.listSubjects(programId, tx),
      graduateRepository.listRecords(programId, tx),
      graduateRepository.listCredits(programId, tx),
    ]);
    if (!offering || !ruleSet) return null;
    const docIds = Array.from(
      new Set([...records.map((r) => r.documentId), ...subjects.map((s) => s.documentId)].filter((id): id is string => !!id)),
    );
    const documents = await graduateRepository.listDocumentSummaries(docIds, tx);
    return { program, offering, ruleSet, subjects, records, credits, documents };
  },
};
