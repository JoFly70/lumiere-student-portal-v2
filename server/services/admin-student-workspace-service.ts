/**
 * Phase 5A.1 — read-only administrator student workspace presentation boundary.
 *
 * This module deliberately treats the Degree Progress Service result as an
 * opaque sidecar.  The only derived values are presentation groupings and
 * canonical display labels; no academic result is evaluated or rewritten.
 */

import {
  getActiveAssignmentForStudent,
  getAcademicRuleWithProgramVersion,
  getRequirementWithProgramVersion,
  getStudent,
  getProgramVersionWithProgram,
} from "../repositories/student-academic-repo";
import type { DegreeEvaluationSnapshotContext } from "@shared/degree-evaluation-snapshot";
import type {
  DegreeProgressReport,
} from "./degree-progress-service";

export type WorkspaceLabelSource = "canonical" | "id-fallback";

export interface WorkspaceLabel {
  readonly label: string;
  readonly source: WorkspaceLabelSource;
}

export interface WorkspaceDisplayLabels {
  readonly programs: Readonly<Record<string, WorkspaceLabel>>;
  readonly programVersions: Readonly<Record<string, WorkspaceLabel>>;
  readonly requirements: Readonly<Record<string, WorkspaceLabel>>;
  readonly academicRules: Readonly<Record<string, WorkspaceLabel>>;
  readonly courses: Readonly<Record<string, WorkspaceLabel>>;
  readonly sources: Readonly<Record<string, WorkspaceLabel>>;
  readonly missingIds: readonly string[];
}

export interface WorkspaceDependencies {
  readonly getStudent?: (studentId: string) => Promise<unknown | null>;
  readonly resolveStudent?: (studentId: string) => Promise<unknown | null>;
  readonly getActiveAssignment?: (studentId: string) => Promise<unknown | null>;
  readonly resolveActiveAssignment?: (studentId: string) => Promise<unknown | null>;
  readonly getProgramContext?: (programVersionId: string) => Promise<unknown | null>;
  readonly resolveProgramContext?: (programVersionId: string) => Promise<unknown | null>;
  readonly getProgress: (
    context: DegreeEvaluationSnapshotContext,
  ) => Promise<DegreeProgressReport>;
  readonly resolveDisplayLabels?: (
    input: WorkspaceLabelInput,
  ) => Promise<Partial<WorkspaceDisplayLabels> | WorkspaceDisplayLabels>;
  readonly resolveLabels?: (
    input: WorkspaceLabelInput,
  ) => Promise<Partial<WorkspaceDisplayLabels> | WorkspaceDisplayLabels>;
}

export interface WorkspaceLabelInput {
  readonly student: unknown;
  readonly assignment: unknown;
  readonly program: unknown;
  readonly programVersion: unknown;
  readonly report: DegreeProgressReport;
}

export interface AdminStudentWorkspace {
  readonly student: unknown;
  readonly activeAssignment: unknown;
  readonly assignment: unknown;
  readonly program: unknown;
  readonly programVersion: unknown;
  readonly context: DegreeEvaluationSnapshotContext;
  readonly report: DegreeProgressReport;
  readonly needsAttention: NeedsAttentionPresentation;
  readonly displayLabels: WorkspaceDisplayLabels;
  readonly snapshot: {
    readonly asOf: string | null;
    readonly fingerprint: string | null;
    readonly integrationDiagnostics: readonly unknown[];
  };
  // These aliases keep the boundary convenient for clients which consume the
  // Phase 4F snapshot envelope directly.
  readonly asOf: string | null;
  readonly snapshotFingerprint: string | null;
  readonly integrationDiagnostics: readonly unknown[];
}

export interface NeedsAttentionPresentation {
  readonly hasAttention: boolean;
  readonly reportStatus: string;
  readonly groups: {
    readonly manualReview: readonly unknown[];
    readonly missing: readonly unknown[];
    readonly partial: readonly unknown[];
    readonly conflict: readonly unknown[];
  };
  readonly reasons: readonly string[];
  readonly diagnostics: readonly unknown[];
  readonly integrationDiagnostics: readonly unknown[];
}

export class WorkspaceNotFoundError extends Error {
  constructor(
    readonly code:
      | "ADMIN_STUDENT_NOT_FOUND"
      | "ADMIN_STUDENT_ACTIVE_ASSIGNMENT_NOT_FOUND"
      | "ADMIN_STUDENT_PROGRAM_CONTEXT_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceNotFoundError";
  }
}

function meaningful(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getString(value: unknown, key: string): string | null {
  const row = record(value);
  const result = row?.[key];
  return meaningful(result) ? result.trim() : null;
}

function getFirstString(value: unknown, keys: readonly string[]): string | null {
  for (const key of keys) {
    const result = getString(value, key);
    if (result) return result;
  }
  return null;
}

function studentPresentation(value: unknown): unknown {
  const row = record(value);
  if (!row) return value;
  const allowed = [
    "id",
    "student_code",
    "studentCode",
    "status",
    "first_name",
    "firstName",
    "middle_name",
    "middleName",
    "last_name",
    "lastName",
    "preferred_name",
    "preferredName",
    "email",
    "target_degree",
    "targetDegree",
    "target_major",
    "targetMajor",
    "start_term",
    "startTerm",
    "target_pace",
    "targetPace",
  ];
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(row, key)) result[key] = row[key];
  }
  return result;
}

function fallback(id: string): WorkspaceLabel {
  return { label: id, source: "id-fallback" };
}

function canonical(label: unknown, id: string): WorkspaceLabel {
  return meaningful(label)
    ? { label: label.trim(), source: "canonical" }
    : fallback(id);
}

function addId(target: Map<string, Set<string>>, kind: string, id: unknown): void {
  if (!meaningful(id)) return;
  const ids = target.get(kind) ?? new Set<string>();
  ids.add(id.trim());
  target.set(kind, ids);
}

/**
 * Collect only explicit canonical foreign-key fields.  In particular, this
 * does not turn arbitrary strings, course codes, or titles into IDs.
 */
function collectCanonicalIds(value: unknown, ids: Map<string, Set<string>>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectCanonicalIds(item, ids));
    return;
  }
  const row = record(value);
  if (!row) return;
  for (const [key, item] of Object.entries(row)) {
    if (key === "requirementId") addId(ids, "requirements", item);
    if (key === "academicRuleId") addId(ids, "academicRules", item);
    if (key === "requirementIds" && Array.isArray(item)) {
      item.forEach((id) => addId(ids, "requirements", id));
    }
    if (key === "academicRuleIds" && Array.isArray(item)) {
      item.forEach((id) => addId(ids, "academicRules", id));
    }
    collectCanonicalIds(item, ids);
  }
}

function asMap(
  value: unknown,
): Record<string, WorkspaceLabel> {
  const result: Record<string, WorkspaceLabel> = {};
  const row = record(value);
  if (!row) return result;
  for (const [id, entry] of Object.entries(row)) {
    if (typeof entry === "string") result[id] = canonical(entry, id);
    else {
      const item = record(entry);
      result[id] = canonical(item?.label, id);
    }
  }
  return result;
}

function normalizeLabels(
  labels: Partial<WorkspaceDisplayLabels> | undefined,
  requested: Map<string, Set<string>>,
): WorkspaceDisplayLabels {
  const provided = labels ?? {};
  const maps = {
    programs: asMap(provided.programs),
    programVersions: asMap(provided.programVersions),
    requirements: asMap(provided.requirements),
    academicRules: asMap(provided.academicRules),
    // Course and source IDs are provenance, not display-label lookups.  Keep
    // their presentation maps empty until a canonical resolver exists.
    courses: {} as Record<string, WorkspaceLabel>,
    sources: {} as Record<string, WorkspaceLabel>,
  };
  const requestedIds = new Set<string>();
  for (const kindIds of requested.values()) {
    for (const id of kindIds) requestedIds.add(id);
  }
  const missingIds = new Set<string>(
    Array.isArray(provided.missingIds)
      ? provided.missingIds.filter((id): id is string => meaningful(id) && requestedIds.has(id))
      : [],
  );
  for (const [kind, kindIds] of requested) {
    const map = maps[kind as keyof typeof maps];
    for (const id of kindIds) {
      if (!map[id] || map[id].source === "id-fallback") {
        map[id] = fallback(id);
        missingIds.add(id);
      }
    }
  }
  // Program and version IDs are supplied by the context, rather than report
  // foreign keys, and therefore must also have a deterministic fallback.
  return {
    ...maps,
    missingIds: [...missingIds].sort(),
  };
}

async function resolveDefaultLabels(input: WorkspaceLabelInput): Promise<WorkspaceDisplayLabels> {
  const ids = new Map<string, Set<string>>();
  collectCanonicalIds(input.report, ids);
  const program = record(input.program);
  const version = record(input.programVersion);
  const programId = getString(program, "id");
  const versionId = getString(version, "id");
  if (programId) addId(ids, "programs", programId);
  if (versionId) addId(ids, "programVersions", versionId);

  const result = {
    programs: {} as Record<string, WorkspaceLabel>,
    programVersions: {} as Record<string, WorkspaceLabel>,
    requirements: {} as Record<string, WorkspaceLabel>,
    academicRules: {} as Record<string, WorkspaceLabel>,
    courses: {} as Record<string, WorkspaceLabel>,
    sources: {} as Record<string, WorkspaceLabel>,
    missingIds: [],
  };
  if (programId) {
    const label = getString(program, "name") ?? getString(program, "code");
    result.programs[programId] = canonical(label, programId);
  }
  if (versionId) {
    result.programVersions[versionId] = canonical(
      getString(version, "versionLabel"),
      versionId,
    );
  }

  await Promise.all([...((ids.get("requirements") ?? new Set<string>()))].map(async (id) => {
    const row = await getRequirementWithProgramVersion(id);
    const requirement = record(row)?.requirement;
    const canonicalVersion = record(row)?.programVersion;
    const requirementVersionId = getFirstString(requirement, ["programVersionId", "program_version_id"])
      ?? getString(canonicalVersion, "id");
    // A foreign canonical row is not a label for this workspace, even when
    // its ID matches a report occurrence.
    if (!versionId || requirementVersionId !== versionId) {
      result.requirements[id] = fallback(id);
      return;
    }
    const requirementRecord = record(requirement);
    result.requirements[id] = canonical(
      getString(requirementRecord, "title") ?? getString(requirementRecord, "code"),
      id,
    );
  }));
  await Promise.all([...((ids.get("academicRules") ?? new Set<string>()))].map(async (id) => {
    const row = await getAcademicRuleWithProgramVersion(id);
    const rule = record(row)?.rule;
    const canonicalVersion = record(row)?.programVersion;
    const ruleVersionId = getFirstString(rule, ["programVersionId", "program_version_id"])
      ?? getString(canonicalVersion, "id");
    if (!versionId || ruleVersionId !== versionId) {
      result.academicRules[id] = fallback(id);
      return;
    }
    const ruleRecord = record(rule);
    result.academicRules[id] = canonical(
      getString(ruleRecord, "title") ?? getString(ruleRecord, "ruleKey"),
      id,
    );
  }));
  return normalizeLabels(result, ids);
}

type AttentionStatus = "MISSING" | "PARTIAL" | "CONFLICT" | "MANUAL_REVIEW";

function attentionStatus(value: unknown): AttentionStatus | null {
  if (
    value === "MISSING"
    || value === "PARTIAL"
    || value === "CONFLICT"
    || value === "MANUAL_REVIEW"
  ) return value;
  return null;
}

/**
 * DegreeProgressReport has a deliberately small set of canonical result
 * locations.  Do not walk arbitrary report objects here: provenance and
 * metadata are opaque evidence and may contain unrelated status-like strings.
 */
function canonicalResultItems(report: DegreeProgressReport): {
  readonly status: AttentionStatus;
  readonly value: unknown;
}[] {
  const phase3 = record(report.phase3Output);
  if (!phase3) return [];
  const credit = record(phase3.recordedCreditProjection);
  const exceptions = record(phase3.recordedExceptionProjection);
  const locations = [
    phase3.results,
    phase3.observations,
    credit?.results,
    exceptions?.results,
    exceptions?.observations,
  ];
  const result: { status: AttentionStatus; value: unknown }[] = [];
  const seen = new Set<unknown>();
  for (const location of locations) {
    if (!Array.isArray(location)) continue;
    for (const value of location) {
      const row = record(value);
      const status = attentionStatus(row?.status);
      if (!row || !status || seen.has(value)) continue;
      seen.add(value);
      result.push({ status, value });
    }
  }
  return result;
}

function stableAttentionKey(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableAttentionKey).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => (
    `${JSON.stringify(key)}:${stableAttentionKey(row[key])}`
  )).join(",")}}`;
}

function canonicalDiagnostics(report: DegreeProgressReport): unknown[] {
  const reportRecord = record(report);
  const phase3 = record(report.phase3Output);
  const credit = record(phase3?.recordedCreditProjection);
  const exceptions = record(phase3?.recordedExceptionProjection);
  const locations = [
    reportRecord?.diagnostics,
    phase3?.diagnostics,
    credit?.diagnostics,
    exceptions?.diagnostics,
  ];
  const diagnostics: unknown[] = [];
  const seen = new Set<string>();
  for (const location of locations) {
    if (!Array.isArray(location)) continue;
    for (const value of location) {
      const row = record(value);
      if (!row || row.status !== "MANUAL_REVIEW") continue;
      const key = stableAttentionKey(value);
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push(value);
    }
  }
  return diagnostics;
}

function canonicalIntegrationDiagnostics(report: DegreeProgressReport): unknown[] {
  const diagnostics: unknown[] = [];
  const seen = new Set<string>();
  for (const value of report.integrationDiagnostics) {
    const key = stableAttentionKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push(value);
  }
  return diagnostics;
}

function attention(report: DegreeProgressReport): NeedsAttentionPresentation {
  const groups = {
    manualReview: [] as unknown[],
    missing: [] as unknown[],
    partial: [] as unknown[],
    conflict: [] as unknown[],
  };
  if (report.status === "MANUAL_REVIEW") groups.manualReview.push({
    status: report.status,
  });
  const reasons = new Set<string>();
  for (const item of canonicalResultItems(report)) {
    const group = item.status === "MANUAL_REVIEW"
      ? groups.manualReview
      : groups[item.status.toLowerCase() as "missing" | "partial" | "conflict"];
    group.push(item.value);
    const reason = getString(item.value, "reason");
    if (reason) reasons.add(reason);
  }
  const diagnostics = canonicalDiagnostics(report);
  for (const diagnostic of diagnostics) {
    const reason = getString(diagnostic, "reason") ?? getString(diagnostic, "code");
    if (reason) reasons.add(reason);
  }
  const integrationDiagnostics = canonicalIntegrationDiagnostics(report);
  integrationDiagnostics.forEach((diagnostic) => {
    const reason = getString(diagnostic, "reason") ?? getString(diagnostic, "code");
    if (reason) reasons.add(reason);
  });
  return {
    hasAttention: groups.manualReview.length > 0
      || groups.missing.length > 0
      || groups.partial.length > 0
      || groups.conflict.length > 0
      || diagnostics.length > 0
      || integrationDiagnostics.length > 0,
    reportStatus: report.status,
    groups,
    reasons: [...reasons].sort(),
    diagnostics,
    integrationDiagnostics,
  };
}

export async function loadAdminStudentWorkspace(
  studentId: string,
  dependencies: WorkspaceDependencies,
): Promise<AdminStudentWorkspace> {
  const getStudentRecord = dependencies.getStudent
    ?? dependencies.resolveStudent
    ?? getStudent;
  const getAssignment = dependencies.getActiveAssignment
    ?? dependencies.resolveActiveAssignment
    ?? getActiveAssignmentForStudent;
  const getProgram = dependencies.getProgramContext
    ?? dependencies.resolveProgramContext
    ?? getProgramVersionWithProgram;

  const student = await getStudentRecord(studentId);
  if (
    student === null
    || student === undefined
    || getFirstString(student, ["id", "studentId", "student_id"]) !== studentId
  ) {
    throw new WorkspaceNotFoundError("ADMIN_STUDENT_NOT_FOUND", "Student not found");
  }
  const assignment = await getAssignment(studentId);
  const assignmentId = getString(assignment, "id");
  const assignmentStudentId = getFirstString(assignment, ["studentId", "student_id"]);
  const programVersionId = getFirstString(assignment, ["programVersionId", "program_version_id"]);
  if (
    !assignment
    || !assignmentId
    || !programVersionId
    || assignmentStudentId !== studentId
    || getString(assignment, "status") !== "active"
  ) {
    throw new WorkspaceNotFoundError(
      "ADMIN_STUDENT_ACTIVE_ASSIGNMENT_NOT_FOUND",
      "No active assignment found for student",
    );
  }
  const programContext = await getProgram(programVersionId);
  const contextRecord = record(programContext);
  const programVersion = contextRecord?.version ?? contextRecord?.programVersion;
  const program = contextRecord?.program;
  const institution = contextRecord?.institution;
  const returnedVersionId = getString(programVersion, "id");
  const returnedProgramId = getString(program, "id");
  const versionProgramId = getFirstString(programVersion, ["programId", "program_id"]);
  const programInstitutionId = getFirstString(program, ["institutionId", "institution_id"]);
  const institutionId = getString(institution, "id");
  if (
    !programContext
    || !programVersion
    || !program
    || returnedVersionId !== programVersionId
    || versionProgramId !== returnedProgramId
    || (
      !institution
      || !institutionId
      || !programInstitutionId
      || programInstitutionId !== institutionId
    )
  ) {
    throw new WorkspaceNotFoundError(
      "ADMIN_STUDENT_PROGRAM_CONTEXT_NOT_FOUND",
      "No canonical program context found for active assignment",
    );
  }
  const context: DegreeEvaluationSnapshotContext = {
    studentId,
    programAssignmentId: assignmentId,
    programVersionId,
  };
  // This is intentionally the sole progress-service invocation on a valid
  // request.  No retry or second composition/re-evaluation is performed.
  const report = await dependencies.getProgress(context);
  const resolveLabels = dependencies.resolveDisplayLabels ?? dependencies.resolveLabels;
  const labels = resolveLabels
    ? await resolveLabels({
      student,
      assignment,
      program,
      programVersion,
      report,
    })
    : await resolveDefaultLabels({
      student,
      assignment,
      program,
      programVersion,
      report,
    });
  const displayLabels = normalizeLabels(labels, (() => {
    const ids = new Map<string, Set<string>>();
    collectCanonicalIds(report, ids);
    addId(ids, "programs", getString(program, "id"));
    addId(ids, "programVersions", getString(programVersion, "id"));
    return ids;
  })());
  const snapshot = {
    asOf: getString(record(report.snapshot), "asOf"),
    fingerprint: getString(record(report.snapshot), "fingerprint"),
    integrationDiagnostics: report.integrationDiagnostics,
  };
  return {
    student: studentPresentation(student),
    activeAssignment: assignment,
    assignment,
    program,
    programVersion,
    context,
    report,
    needsAttention: attention(report),
    displayLabels,
    snapshot,
    asOf: snapshot.asOf,
    snapshotFingerprint: snapshot.fingerprint,
    integrationDiagnostics: snapshot.integrationDiagnostics,
  };
}