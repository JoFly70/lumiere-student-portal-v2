/**
 * S11 — pure logic for the staff High School Pathway workspace (no React, no I/O).
 *
 * Credits are integer half-units end to end; they are converted only for
 * display (formatHalfUnits) or when parsing what staff type (parseCreditInput).
 * Server responses are authoritative: callers replace their state with the
 * refreshed StaffHighSchoolState every mutation returns.
 */
import {
  HS_API,
  HS_EVIDENCE_DOC_TYPES,
  type HsEvidencePurpose,
  creditsToHalfUnits,
  formatHalfUnits,
  sumHalfUnits,
  hsRoadmapContentSchema,
  type HsCreditSummary,
  type HsCurriculumTemplate,
  type HsEnrollmentSummary,
  type HsGuardianView,
  type HsPlanCourse,
  type HsPlanTask,
  type HsPolicies,
  type HsRoadmapContent,
  type HsTaskKind,
  type StaffHighSchoolState,
  type TransferClaimStatus,
} from "@shared/high-school-contract";

export const HS_STAFF_QUERY_KEY = (studentId: string) => ["admin-high-school", studentId] as const;

// ── endpoints ────────────────────────────────────────────────────────────────

export const hsStaffPaths = {
  state: (studentId: string) => HS_API.staff(studentId),
  templates: () => HS_API.templates,
  createEnrollment: (studentId: string) => `${HS_API.staff(studentId)}/enrollments`,
  enrollment: (studentId: string, eid: string) => HS_API.enrollment(studentId, eid),
  sub: (studentId: string, eid: string, tail: string) => `${HS_API.enrollment(studentId, eid)}/${tail}`,
  historicalGraduate: (studentId: string) => `${HS_API.staff(studentId)}/historical-graduate`,
} as const;

// ── failures ─────────────────────────────────────────────────────────────────

export type HsFailureKind = "conflict" | "evidence" | "policy" | "forbidden" | "validation" | "not_eligible" | "locked" | "other";

export interface HsFailure {
  readonly kind: HsFailureKind;
  readonly status: number;
  readonly code: string | null;
  readonly message: string;
}

/** Classify a failed response from the contract error shape { error: { code, message } }. */
export function classifyHsFailure(status: number, body: unknown): HsFailure {
  const err = (body as { error?: { code?: unknown; message?: unknown } | string } | null)?.error;
  const code = err && typeof err === "object" && typeof err.code === "string" ? err.code : null;
  const serverMessage = err && typeof err === "object" && typeof err.message === "string" ? err.message : typeof err === "string" ? err : null;
  if (code === "HS_REVISION_CONFLICT") {
    return { kind: "conflict", status, code, message: "This pathway changed since you loaded it. It has been reloaded; review the latest version and try again." };
  }
  if (code === "HS_EVIDENCE_REQUIRED" || code === "HS_EVIDENCE_INVALID") {
    return { kind: "evidence", status, code, message: serverMessage ?? "Select a verified document of this student as evidence." };
  }
  if (code === "HS_POLICY_VIOLATION") return { kind: "policy", status, code, message: serverMessage ?? "A configured school policy does not allow this." };
  if (code === "HS_INVALID_TRANSITION") return { kind: "policy", status, code, message: serverMessage ?? "That change is not allowed from the current state (for example a replaced course, or moving a delivery status backward)." };
  if (code === "HS_NOT_ELIGIBLE") return { kind: "not_eligible", status, code, message: serverMessage ?? "Graduation requirements are not met yet." };
  if (code === "HS_OFFICIAL_RECORD_LOCKED") return { kind: "locked", status, code, message: serverMessage ?? "This official record is locked." };
  if (status === 403) return { kind: "forbidden", status, code, message: "Only an administrator can do this." };
  if (status === 409) return { kind: "conflict", status, code, message: serverMessage ?? "This conflicts with the current pathway state. It has been reloaded." };
  if (status === 400 || status === 422) return { kind: "validation", status, code, message: serverMessage ?? "Check the highlighted values and try again." };
  return { kind: "other", status, code, message: serverMessage ?? `Request failed (${status}).` };
}

// ── credits (half-units) ─────────────────────────────────────────────────────

/** "0.5" -> 1, "1" -> 2, "2.5" -> 5. Null when blank, not a number, or not a multiple of 0.5. */
export function parseCreditInput(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  try {
    const half = creditsToHalfUnits(Number(t));
    return half >= 1 && half <= 200 ? half : null;
  } catch {
    return null;
  }
}

export const creditsLabel = (half: number): string => `${formatHalfUnits(half)} ${half === 2 ? "credit" : "credits"}`;

/** Planned credit of courses that still count (replaced/removed courses do not). */
export function plannedHalfUnits(content: HsRoadmapContent): number {
  return sumHalfUnits(content.courses.filter((c) => c.status === "planned").map((c) => c.halfUnits));
}

export function plannedByArea(content: HsRoadmapContent): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of content.areas) out[a.key] = 0;
  for (const c of content.courses) if (c.status === "planned") out[c.areaKey] = (out[c.areaKey] ?? 0) + c.halfUnits;
  return out;
}

export interface AreaPlanRow {
  readonly key: string;
  readonly label: string;
  readonly kind: "core" | "elective";
  readonly requiredHalfUnits: number;
  readonly plannedHalfUnits: number;
  /** Positive = still unplanned, negative = over-planned. */
  readonly gapHalfUnits: number;
}

export function areaPlanRows(content: HsRoadmapContent): AreaPlanRow[] {
  const planned = plannedByArea(content);
  return content.areas.map((a) => ({
    key: a.key,
    label: a.label,
    kind: a.kind,
    requiredHalfUnits: a.requiredHalfUnits,
    plannedHalfUnits: planned[a.key] ?? 0,
    gapHalfUnits: a.requiredHalfUnits - (planned[a.key] ?? 0),
  }));
}

/** Human-readable validation messages for a draft (advisory; the server is authoritative). */
export function validateDraftContent(content: HsRoadmapContent): string[] {
  const out: string[] = [];
  const areaSum = sumHalfUnits(content.areas.map((a) => a.requiredHalfUnits));
  if (areaSum !== content.totalRequiredHalfUnits) {
    out.push(`Area requirements add up to ${formatHalfUnits(areaSum)} credits, but the total required is ${formatHalfUnits(content.totalRequiredHalfUnits)}.`);
  }
  const areaKeys = new Set(content.areas.map((a) => a.key));
  const seen = new Set<string>();
  for (const c of content.courses) {
    if (seen.has(c.key)) out.push(`Course key “${c.key}” is used twice.`);
    seen.add(c.key);
    if (!areaKeys.has(c.areaKey)) out.push(`“${c.title}” is in an area that does not exist.`);
    if (c.plannedStart && c.plannedEnd && c.plannedEnd < c.plannedStart) out.push(`“${c.title}” ends before it starts.`);
    const taskKeys = new Set<string>();
    for (const t of c.tasks) {
      if (taskKeys.has(t.key)) out.push(`“${c.title}” repeats the task key “${t.key}”.`);
      taskKeys.add(t.key);
    }
    if (c.status === "replaced" && !content.courses.some((o) => o.replacesCourseKey === c.key)) {
      out.push(`“${c.title}” is marked replaced but no course takes over from it.`);
    }
  }
  for (const row of areaPlanRows(content)) {
    if (row.gapHalfUnits > 0) out.push(`${row.label}: ${creditsLabel(row.gapHalfUnits)} still to plan.`);
    if (row.gapHalfUnits < 0) out.push(`${row.label}: planned ${creditsLabel(-row.gapHalfUnits)} more than required.`);
  }
  const months = content.pacing.milestones.map((m) => m.month);
  if (new Set(months).size !== months.length) out.push("Each month can have only one milestone.");
  let prev = -1;
  for (const m of [...content.pacing.milestones].sort((a, b) => a.month.localeCompare(b.month))) {
    if (m.cumulativeHalfUnits < prev) out.push("Monthly milestones must not decrease (they are cumulative).");
    prev = m.cumulativeHalfUnits;
  }
  const parsed = hsRoadmapContentSchema.safeParse(content);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 3)) out.push(`${issue.path.join(".") || "draft"}: ${issue.message}`);
  }
  return out;
}

/** Advice-only subset: gaps are normal while drafting, so they are not blocking. */
export function blockingDraftIssues(content: HsRoadmapContent): string[] {
  return validateDraftContent(content).filter((m) => !/still to plan|more than required/.test(m));
}

// ── draft editing helpers (immutable) ────────────────────────────────────────

export const slugKey = (title: string): string => {
  const s = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return s || "item";
};

export function uniqueKey(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; i < 500; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

export interface NewCourseForm {
  title: string;
  areaKey: string;
  credits: string;
  plannedStart: string;
  plannedEnd: string;
}

export function validateNewCourse(content: HsRoadmapContent, f: NewCourseForm): string | null {
  if (f.title.trim().length < 1) return "Enter a course title.";
  if (!content.areas.some((a) => a.key === f.areaKey)) return "Choose a requirement area.";
  if (parseCreditInput(f.credits) === null) return "Credit must be 0.5, 1, 1.5 … (multiples of 0.5).";
  if (f.plannedStart && f.plannedEnd && f.plannedEnd < f.plannedStart) return "The planned end date is before the start date.";
  return null;
}

export function addCourse(content: HsRoadmapContent, f: NewCourseForm, replacesCourseKey: string | null = null): HsRoadmapContent {
  const half = parseCreditInput(f.credits);
  if (half === null) throw new RangeError("Invalid credit");
  const key = uniqueKey(slugKey(f.title), content.courses.map((c) => c.key));
  const course: HsPlanCourse = {
    key,
    title: f.title.trim(),
    areaKey: f.areaKey,
    halfUnits: half,
    status: "planned",
    replacesCourseKey,
    plannedStart: f.plannedStart || null,
    plannedEnd: f.plannedEnd || null,
    tasks: [],
  };
  return { ...content, courses: [...content.courses, course] };
}

/** Replace a course: the old one stays (status "replaced", history kept) and a new one takes over. */
export function replaceCourse(content: HsRoadmapContent, oldKey: string, f: NewCourseForm): HsRoadmapContent {
  const withNew = addCourse(content, f, oldKey);
  return { ...withNew, courses: withNew.courses.map((c) => (c.key === oldKey ? { ...c, status: "replaced" as const } : c)) };
}

/** Remove from the plan; the course keeps its key so history and results stay attached. */
export function removeCourse(content: HsRoadmapContent, key: string): HsRoadmapContent {
  return { ...content, courses: content.courses.map((c) => (c.key === key ? { ...c, status: "removed" as const } : c)) };
}

export function restoreCourse(content: HsRoadmapContent, key: string): HsRoadmapContent {
  return { ...content, courses: content.courses.map((c) => (c.key === key && c.status === "removed" ? { ...c, status: "planned" as const } : c)) };
}

export function updateCourse(content: HsRoadmapContent, key: string, patch: Partial<Pick<HsPlanCourse, "title" | "areaKey" | "halfUnits" | "plannedStart" | "plannedEnd">>): HsRoadmapContent {
  return { ...content, courses: content.courses.map((c) => (c.key === key ? { ...c, ...patch } : c)) };
}

export interface NewTaskForm {
  kind: HsTaskKind;
  title: string;
  dueDate: string;
}

export function validateNewTask(f: NewTaskForm): string | null {
  if (!f.title.trim()) return "Enter a task title.";
  if (f.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.dueDate)) return "Use a valid due date.";
  return null;
}

export function addTask(content: HsRoadmapContent, courseKey: string, f: NewTaskForm): HsRoadmapContent {
  return {
    ...content,
    courses: content.courses.map((c) => {
      if (c.key !== courseKey) return c;
      const key = uniqueKey(slugKey(`${f.kind}-${f.title}`), c.tasks.map((t) => t.key));
      const task: HsPlanTask = { key, kind: f.kind, title: f.title.trim(), dueDate: f.dueDate || null };
      return { ...c, tasks: [...c.tasks, task] };
    }),
  };
}

export function setTaskDueDate(content: HsRoadmapContent, courseKey: string, taskKey: string, dueDate: string | null): HsRoadmapContent {
  return { ...content, courses: content.courses.map((c) => (c.key !== courseKey ? c : { ...c, tasks: c.tasks.map((t) => (t.key === taskKey ? { ...t, dueDate: dueDate || null } : t)) })) };
}

export function removeTask(content: HsRoadmapContent, courseKey: string, taskKey: string): HsRoadmapContent {
  return { ...content, courses: content.courses.map((c) => (c.key !== courseKey ? c : { ...c, tasks: c.tasks.filter((t) => t.key !== taskKey) })) };
}

export function setPacing(content: HsRoadmapContent, patch: Partial<HsRoadmapContent["pacing"]>): HsRoadmapContent {
  return { ...content, pacing: { ...content.pacing, ...patch } };
}

export function addMilestone(content: HsRoadmapContent, month: string, credits: string): HsRoadmapContent | string {
  if (!/^\d{4}-\d{2}$/.test(month)) return "Choose a month.";
  const half = parseCreditInput(credits);
  if (half === null) return "Cumulative credit must be a multiple of 0.5.";
  if (content.pacing.milestones.some((m) => m.month === month)) return "That month already has a milestone.";
  const next = [...content.pacing.milestones, { month, cumulativeHalfUnits: half }].sort((a, b) => a.month.localeCompare(b.month));
  return setPacing(content, { milestones: next });
}

export function removeMilestone(content: HsRoadmapContent, month: string): HsRoadmapContent {
  return setPacing(content, { milestones: content.pacing.milestones.filter((m) => m.month !== month) });
}

export const POLICY_LABELS: Record<keyof HsPolicies, { label: string; hint: string; unit: string }> = {
  maxExamAttempts: { label: "Maximum attempts per exam", hint: "Failed attempts beyond this are refused when staff record them.", unit: "attempts" },
  minDaysBetweenExams: { label: "Minimum days between exams", hint: "Informational pacing rule for this student.", unit: "days" },
  maxTransferHalfUnits: { label: "Maximum transfer credit", hint: "Cap on transfer awards; the school decides acceptance.", unit: "credits" },
  passingPercent: { label: "Passing percentage (staff view only)", hint: "Never shown to the student as a rule.", unit: "%" },
};

/** Areas to open by default: the first one that still needs planning, else the first with changed courses, else the first. */
export function defaultOpenAreas(content: HsRoadmapContent): string[] {
  const rows = areaPlanRows(content);
  const withCourses = rows.filter((r) => content.courses.some((c) => c.areaKey === r.key));
  const gap = withCourses.find((r) => r.gapHalfUnits !== 0) ?? rows.find((r) => r.gapHalfUnits !== 0);
  const changed = withCourses.find((r) => content.courses.some((c) => c.areaKey === r.key && c.status !== "planned"));
  const pick = gap ?? changed ?? withCourses[0] ?? rows[0];
  return pick ? [pick.key] : [];
}

export const NOT_CONFIGURED_TEXT = "Not configured — the school's rules apply";

/** Policy fields are stored as numbers (maxTransfer in half-units) or null; blank = null. */
export function setPolicy(content: HsRoadmapContent, key: keyof HsPolicies, raw: string): HsRoadmapContent {
  const t = raw.trim();
  let value: number | null = null;
  if (t !== "") {
    if (key === "maxTransferHalfUnits") value = parseCreditInput(t);
    else value = /^\d{1,3}$/.test(t) ? Number(t) : null;
  }
  return { ...content, policies: { ...content.policies, [key]: value } };
}

export function policyDisplay(key: keyof HsPolicies, value: number | null): string {
  if (value === null) return "";
  return key === "maxTransferHalfUnits" ? formatHalfUnits(value) : String(value);
}

export const configuredPolicyCount = (p: HsPolicies): number => Object.values(p).filter((v) => v !== null).length;

// ── draft save / publish ─────────────────────────────────────────────────────

export const saveDraftBody = (expectedDraftRevision: number, content: HsRoadmapContent) => ({ expectedDraftRevision, content });
export const publishBody = (expectedDraftRevision: number, expectedPublishedVersionId: string | null) => ({ expectedDraftRevision, expectedPublishedVersionId });
export const fromTemplateBody = (expectedDraftRevision?: number) => (expectedDraftRevision === undefined ? {} : { expectedDraftRevision });

export interface Gate {
  readonly enabled: boolean;
  readonly reason: string | null;
}

export function publishGate(state: StaffHighSchoolState | null, isAdmin: boolean, dirty: boolean, busy = false): Gate {
  const draft = state?.current?.draft ?? null;
  if (!draft) return { enabled: false, reason: "There is no draft to publish. Create a draft first." };
  if (!isAdmin) return { enabled: false, reason: "Only an administrator can publish the approved roadmap." };
  if (dirty) return { enabled: false, reason: "Save your draft changes before publishing." };
  if (draft.validationErrors.length > 0) return { enabled: false, reason: `Fix ${draft.validationErrors.length} validation ${draft.validationErrors.length === 1 ? "problem" : "problems"} before publishing.` };
  if (busy) return { enabled: false, reason: "Working…" };
  return { enabled: true, reason: null };
}

// ── enrollments ──────────────────────────────────────────────────────────────

export interface EnrollmentForm {
  templateKey: string;
  templateVersion: number;
  status: "planned" | "active";
  startedOn: string;
  targetCompletionDate: string;
  overrideCredits: string;
  overrideReason: string;
}

export function templateOptionLabel(t: Pick<HsCurriculumTemplate, "title" | "version" | "totalRequiredHalfUnits">): string {
  return `${t.title} · v${t.version} · ${formatHalfUnits(t.totalRequiredHalfUnits)} credits`;
}

export function validateEnrollmentForm(f: EnrollmentForm): string | null {
  if (!f.templateKey) return "Choose a curriculum template.";
  if (f.overrideCredits.trim() !== "") {
    if (parseCreditInput(f.overrideCredits) === null || (parseCreditInput(f.overrideCredits) ?? 0) < 2) return "Total required must be a multiple of 0.5 (for example 22).";
    if (f.overrideReason.trim().length < 5) return "Explain why this student's total differs from the template (at least 5 characters).";
  } else if (f.overrideReason.trim() !== "") {
    return "A reason is only used together with a total-required override.";
  }
  if (f.startedOn && f.targetCompletionDate && f.targetCompletionDate < f.startedOn) return "The target completion date is before the start date.";
  return null;
}

export function createEnrollmentBody(f: EnrollmentForm, templateTotalHalfUnits: number) {
  const override = f.overrideCredits.trim() === "" ? null : parseCreditInput(f.overrideCredits);
  const isOverride = override !== null && override !== templateTotalHalfUnits;
  return {
    templateKey: f.templateKey,
    templateVersion: f.templateVersion,
    status: f.status,
    startedOn: f.startedOn || null,
    targetCompletionDate: f.targetCompletionDate || null,
    totalRequiredHalfUnitsOverride: isOverride ? override : null,
    overrideReason: isOverride ? f.overrideReason.trim() : null,
  };
}

export const OPEN_STATUSES = ["planned", "active", "on_hold"] as const;
export const isOpenEnrollment = (e: Pick<HsEnrollmentSummary, "status">): boolean => (OPEN_STATUSES as readonly string[]).includes(e.status);

export function enrollmentTimeline(state: StaffHighSchoolState): { id: string; label: string; status: string; open: boolean; selected: boolean; note: string | null; period: string }[] {
  const currentId = state.current?.enrollment.id ?? null;
  return state.enrollments.map((e) => ({
    id: e.id,
    label: `${e.programTitle}${e.isHistorical ? " (historical graduate)" : ""}`,
    status: statusLabel(e.status),
    period: enrollmentPeriod(e),
    open: isOpenEnrollment(e),
    selected: e.id === currentId,
    note: e.requiredOverrideReason ? `Exception: ${formatHalfUnits(e.totalRequiredHalfUnits)} credits — ${e.requiredOverrideReason}` : null,
  }));
}

/** "Started Sep 2, 2024" — what the history row says about timing. */
export function enrollmentPeriod(e: Pick<HsEnrollmentSummary, "startedOn" | "targetCompletionDate" | "createdAt" | "status">): string {
  const started = e.startedOn ? `Started ${formatDate(e.startedOn)}` : `Created ${formatDate(e.createdAt)}`;
  // The target date lives in the summary strip and the edit form only; it is never repeated in the history.
  return started;
}

export interface DisclosureGate extends Gate {
  readonly studentSees: string;
}

export interface DisclosurePreview {
  /** What the student sees. */
  readonly sees: string;
  readonly nameVisible: boolean;
  /** Why the student sees what they see (always set when the name is not visible). */
  readonly why: string;
}

/** The server rule: the name is visible only when disclosed AND a name is set AND the enrollment is active or completed. */
export function disclosurePreview(status: HsEnrollmentSummary["status"], disclosed: boolean, name: string | null, genericText: string): DisclosurePreview {
  const trimmed = (name ?? "").trim();
  if (disclosed && trimmed && (status === "active" || status === "completed")) {
    return { sees: trimmed, nameVisible: true, why: "Disclosure is on, a name is set and the enrollment is confirmed." };
  }
  if (!disclosed) return { sees: genericText, nameVisible: false, why: "Disclosure is off, so the school name stays confidential." };
  if (!trimmed) return { sees: genericText, nameVisible: false, why: "Disclosure is on but no school name is set." };
  return { sees: genericText, nameVisible: false, why: `The enrollment is ${statusLabel(status).toLowerCase()}. The name appears once it is active or completed.` };
}

export function disclosureGate(e: Pick<HsEnrollmentSummary, "status" | "institutionDisclosed" | "awardingSchoolName">, wantDisclosed: boolean, name: string, genericText: string): DisclosureGate {
  const studentSees = disclosurePreview(e.status, wantDisclosed, name, genericText).sees;
  if (wantDisclosed) {
    if (e.status !== "active" && e.status !== "completed") return { enabled: false, reason: "Disclose the school name only after the enrollment is confirmed (active or completed).", studentSees };
    if (name.trim().length < 2) return { enabled: false, reason: "Enter the awarding school's name first.", studentSees };
  }
  return { enabled: true, reason: null, studentSees };
}

export function updateEnrollmentBody(revision: number, patch: Record<string, unknown>, note: string) {
  return { expectedRevision: revision, ...patch, note: note.trim() };
}

export const noteGate = (note: string, min = 3): Gate => (note.trim().length >= min ? { enabled: true, reason: null } : { enabled: false, reason: `Add a note of at least ${min} characters for the record.` });

// ── prior education and transfer claims ──────────────────────────────────────

export const CLAIM_STATUS_LABEL: Record<TransferClaimStatus, string> = {
  claimed: "Claimed — not credit",
  submitted_to_school: "Submitted to school — not credit",
  accepted: "Accepted by school — credit only after an official award",
  partially_accepted: "Partially accepted — credit only after an official award",
  declined: "Declined by school",
};

export const CLAIM_NOT_CREDIT_NOTICE =
  "A prior-study record or transfer claim is not credit. Credit exists only after the awarding school accepts the claim and staff record an official transfer award with its evaluation as evidence.";

export const canAwardTransfer = (status: TransferClaimStatus): boolean => status === "accepted" || status === "partially_accepted";

export function transferAwardGate(c: ClaimLike, credits: string, evidenceId: string, docs: readonly EvidenceDoc[] | undefined | null): Gate {
  const half = parseCreditInput(credits);
  const cap = acceptedHalfUnitsOf(c);
  if (half === null) return { enabled: false, reason: "Awarded credit must be a multiple of 0.5." };
  if (half > cap) return { enabled: false, reason: `At most ${formatHalfUnits(cap)} credits were accepted for this claim.` };
  return evidenceGate(evidenceId, docs, "transferAward");
}

export function priorEducationBody(f: { schoolName: string; country: string; gradeLevels: string; status: string; evidenceDocumentId: string; staffNote: string }) {
  return {
    schoolName: f.schoolName.trim(),
    country: f.country.trim(),
    gradeLevels: f.gradeLevels.trim() || null,
    status: f.status,
    evidenceDocumentId: f.evidenceDocumentId || null,
    staffNote: f.staffNote.trim() || null,
  };
}

export function validatePriorEducation(f: { schoolName: string; country: string }): string | null {
  if (f.schoolName.trim().length < 2) return "Enter the previous school's name.";
  if (f.country.trim().length < 2) return "Enter the country.";
  return null;
}

export function validateClaim(f: { priorEducationId: string; courseTitle: string; areaKey: string; credits: string }): string | null {
  if (!f.priorEducationId) return "Record the prior school first, then add claims to it.";
  if (f.courseTitle.trim().length < 2) return "Enter the course title.";
  if (!f.areaKey) return "Choose the requirement area the claim would count toward.";
  if (parseCreditInput(f.credits) === null) return "Claimed credit must be a multiple of 0.5.";
  return null;
}

export function claimBody(f: { priorEducationId: string; courseTitle: string; areaKey: string; credits: string }) {
  return { priorEducationId: f.priorEducationId, courseTitle: f.courseTitle.trim(), areaKey: f.areaKey, claimedHalfUnits: parseCreditInput(f.credits) as number };
}

/** "claimed" is only offered as the saved (unchanged) value of a claim that was never sent to the school. */
export type ClaimDecision = "claimed" | "submitted_to_school" | "accepted" | "partially_accepted" | "declined";

export function resolveClaimBody(status: Exclude<ClaimDecision, "claimed">, note: string, acceptedHalfUnits?: number | null) {
  return status === "partially_accepted" && acceptedHalfUnits ? { status, note: note.trim(), acceptedHalfUnits } : { status, note: note.trim() };
}

/** The "Change to" select starts at the saved decision, so nothing is proposed until staff pick a different one. */
export const initialClaimDecision = (status: TransferClaimStatus): ClaimDecision => status;

/** Short labels for the decision select (the saved status is shown separately as the current state). */
export const CLAIM_DECISION_LABEL: Record<ClaimDecision, string> = {
  claimed: "Claimed (not yet sent to the school)",
  submitted_to_school: "Submitted to school",
  accepted: "Accepted",
  partially_accepted: "Partially accepted",
  declined: "Declined",
};

export interface ClaimLike {
  readonly claimedHalfUnits: number;
  readonly acceptedHalfUnits?: number | null;
  readonly status: TransferClaimStatus;
}

/** Credit the school accepted: the claimed amount unless it accepted only part of it. */
export const acceptedHalfUnitsOf = (c: ClaimLike): number => (c.status === "partially_accepted" ? c.acceptedHalfUnits ?? 0 : c.acceptedHalfUnits ?? c.claimedHalfUnits);

/** 0.5-credit steps from 0.5 up to `max` half-units. */
export const halfUnitSteps = (max: number): number[] => Array.from({ length: Math.max(0, max) }, (_, i) => i + 1);

export function claimDecisionGate(c: ClaimLike, status: ClaimDecision, note: string, acceptedUnits: number): Gate {
  if (status === "partially_accepted" && (acceptedUnits < 1 || acceptedUnits > c.claimedHalfUnits)) return { enabled: false, reason: `Choose how much the school accepted (up to ${formatHalfUnits(c.claimedHalfUnits)} credits).` };
  const savedUnits = c.acceptedHalfUnits ?? 0;
  const changed = status !== c.status || (status === "partially_accepted" && acceptedUnits !== savedUnits);
  if (!changed) return { enabled: false, reason: "No change from the saved decision." };
  return noteGate(note);
}

/** Badge for a claim; an existing award always wins over the "accepted" wording. */
export function claimBadge(status: TransferClaimStatus, awarded: boolean): { label: string; tone: "good" | "warn" | "bad" | "neutral" } {
  if (awarded) return { label: "Credit awarded", tone: "good" };
  if (status === "declined") return { label: "Declined by school", tone: "bad" };
  if (status === "accepted") return { label: "Accepted — credit not yet awarded", tone: "warn" };
  if (status === "partially_accepted") return { label: "Partly accepted — credit not yet awarded", tone: "warn" };
  if (status === "submitted_to_school") return { label: "Submitted to school — not credit", tone: "neutral" };
  return { label: "Claimed — not credit", tone: "neutral" };
}

/** "Accepted 0.5 of 1 credits" once the school has decided; null before. */
export function acceptedSummary(c: ClaimLike): string | null {
  if (c.status !== "accepted" && c.status !== "partially_accepted") return null;
  return `Accepted ${formatHalfUnits(acceptedHalfUnitsOf(c))} of ${formatHalfUnits(c.claimedHalfUnits)} credits`;
}

// ── evidence ─────────────────────────────────────────────────────────────────

export interface EvidenceDoc {
  readonly id: string;
  readonly doc_type?: string | null;
  readonly file_name?: string | null;
  readonly status?: string | null;
}

/** Only verified documents of this student may be evidence (the server enforces the same rule). */
export const verifiedEvidenceDocs = <D extends EvidenceDoc>(docs: readonly D[] | undefined | null, purpose?: HsEvidencePurpose): D[] => {
  const allowed: readonly string[] | null = purpose ? HS_EVIDENCE_DOC_TYPES[purpose] : null;
  return (docs ?? []).filter((d) => d.status === "verified" && (!allowed || allowed.includes(d.doc_type ?? "")));
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  hs_transcript: "High school transcript", hs_diploma: "Diploma", foreign_eval: "Foreign credential evaluation", other: "Other document",
};
export const docTypeLabel = (t: string | null | undefined): string => DOC_TYPE_LABEL[t ?? ""] ?? (t || "Document").replace(/_/g, " ");

export const evidenceLabel = (d: EvidenceDoc): string => `${d.file_name || "Document"} · ${docTypeLabel(d.doc_type)}`;

/** What kinds of document a purpose accepts, in words ("High school transcript or Other document"). */
export const evidenceTypesText = (purpose: HsEvidencePurpose): string => HS_EVIDENCE_DOC_TYPES[purpose].map((t) => docTypeLabel(t)).join(" or ");

export function evidenceGate(id: string, docs: readonly EvidenceDoc[] | undefined | null, purpose?: HsEvidencePurpose): Gate {
  if (!id) return { enabled: false, reason: "Select a verified document as evidence." };
  const all = (docs ?? []).find((d) => d.id === id);
  if (!all || all.status !== "verified") return { enabled: false, reason: "The selected document is not verified. Verify it in Documents first." };
  if (purpose && !verifiedEvidenceDocs(docs, purpose).some((d) => d.id === id)) return { enabled: false, reason: `This evidence must be a ${evidenceTypesText(purpose)}.` };
  return { enabled: true, reason: null };
}

// ── results ──────────────────────────────────────────────────────────────────

export function taskResultBody(f: { courseKey: string; taskKey: string; outcome: string; score: string; evidenceDocumentId: string; note: string }) {
  const t = f.score.trim();
  return { courseKey: f.courseKey, taskKey: f.taskKey, outcome: f.outcome, scorePercent: t === "" ? null : Number(t), evidenceDocumentId: f.evidenceDocumentId, note: f.note.trim() || null };
}

export function validateScore(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  if (!/^\d{1,3}$/.test(t) || Number(t) > 100) return "Score must be a whole number from 0 to 100.";
  return null;
}

export const courseResultBody = (f: { courseKey: string; outcome: string; evidenceDocumentId: string; note: string }) => ({
  courseKey: f.courseKey, outcome: f.outcome, evidenceDocumentId: f.evidenceDocumentId, note: f.note.trim() || null,
});

export const transferAwardBody = (f: { claimId: string; areaKey: string; credits: string; evidenceDocumentId: string }) => ({
  claimId: f.claimId, areaKey: f.areaKey, halfUnits: parseCreditInput(f.credits) as number, evidenceDocumentId: f.evidenceDocumentId,
});

export const voidAwardBody = (reason: string) => ({ reason: reason.trim() });

export function planCourseOptions(state: StaffHighSchoolState): { key: string; title: string; halfUnits: number }[] {
  const published = state.current?.published?.content ?? null;
  return (published?.courses ?? []).filter((c) => c.status === "planned").map((c) => ({ key: c.key, title: c.title, halfUnits: c.halfUnits }));
}

export function taskOptions(state: StaffHighSchoolState, courseKey: string): { key: string; title: string; kind: HsTaskKind }[] {
  const content = state.current?.published?.content ?? null;
  return (content?.courses.find((c) => c.key === courseKey)?.tasks ?? []).map((t) => ({ key: t.key, title: t.title, kind: t.kind }));
}

// ── graduation ───────────────────────────────────────────────────────────────

export function graduationGates(state: StaffHighSchoolState, isAdmin: boolean) {
  const g = state.current?.graduation;
  const blockers = g?.blockers ?? [];
  const closed = !!state.current && isClosedEnrollment(state.current.enrollment.status);
  const confirm: Gate = !g
    ? { enabled: false, reason: "No enrollment." }
    : closed && g.status !== "diploma_conferred"
      ? { enabled: false, reason: CLOSED_RECORD_TEXT }
    : g.status !== "in_progress"
      ? { enabled: false, reason: "Eligibility is already confirmed." }
      : !isAdmin
        ? { enabled: false, reason: "Admin only." }
      : blockers.length > 0
        ? { enabled: false, reason: `${blockers.length} ${blockers.length === 1 ? "blocker remains" : "blockers remain"}: resolve ${blockers.length === 1 ? "it" : "them"} first.` }
        : { enabled: true, reason: null };
  const confer: Gate = !g
    ? { enabled: false, reason: "No enrollment." }
    : closed && g.status !== "diploma_conferred"
      ? { enabled: false, reason: CLOSED_RECORD_TEXT }
    : !isAdmin
      ? { enabled: false, reason: "Only an administrator can confer the diploma." }
      : g.status === "diploma_conferred"
        ? { enabled: false, reason: "The diploma is already conferred." }
        : g.status !== "eligibility_confirmed"
          ? { enabled: false, reason: "Confirm graduation eligibility first." }
          : { enabled: true, reason: null };
  return { confirm, confer };
}

export const confirmEligibilityBody = (evidenceDocumentId: string, note: string) => ({ action: "confirm_eligibility" as const, evidenceDocumentId, note: note.trim() || null });
export const conferDiplomaBody = (conferredOn: string, diplomaEvidenceDocumentId: string, transcriptEvidenceDocumentId: string) => ({
  action: "confer_diploma" as const, conferredOn, diplomaEvidenceDocumentId, transcriptEvidenceDocumentId,
});
export const financialClearanceBody = (value: "unknown" | "cleared" | "hold", note: string) => ({ action: "set_financial_clearance" as const, value, note: note.trim() });
export const deliveryBody = (action: "set_transcript_status" | "set_diploma_delivery", value: string) => ({ action, value });

/** Delivery statuses only move forward: the options start at the current one. */
export const deliveryOptions = (current: string, hasEvidence = true): string[] => {
  const order = ["not_requested", "requested", "issued", "delivered"];
  const forward = order.slice(Math.max(0, order.indexOf(current)));
  // Server rule: "issued" and "delivered" need the school's document, which is recorded when the diploma is conferred.
  return hasEvidence ? forward : forward.filter((v) => v !== "issued" && v !== "delivered");
};

/** Delivery statuses stay editable after conferral (completed) but never on a withdrawn or transferred-out enrollment. */
export const deliveryLocked = (status: string): boolean => status === "withdrawn" || status === "transferred_out";

/** Server rule: a closed enrollment (completed, withdrawn, transferred out) is locked for every field. */
export const isClosedEnrollment = (status: string): boolean => !(OPEN_STATUSES as readonly string[]).includes(status);
export const CLOSED_RECORD_TEXT = "This record is closed.";

export function financialGate(state: StaffHighSchoolState, value: string, note: string): Gate {
  const g = state.current?.graduation;
  if (state.current && (state.current.enrollment.status === "withdrawn" || state.current.enrollment.status === "transferred_out")) return { enabled: false, reason: `This enrollment is ${statusLabel(state.current.enrollment.status).toLowerCase()}: financial clearance is locked.` };
  if (g?.status === "diploma_conferred") return { enabled: false, reason: "Financial clearance is locked once the diploma is conferred." };
  if (value === (g?.financialClearance ?? "unknown")) return { enabled: false, reason: "No change from the current clearance." };
  return noteGate(note);
}

export const FINANCIAL_LABEL: Record<string, string> = { unknown: "Unknown", cleared: "Cleared", hold: "Hold" };
export const DELIVERY_LABEL: Record<string, string> = { not_requested: "Not requested", requested: "Requested", issued: "Issued by school", delivered: "Delivered" };

// ── guardians ────────────────────────────────────────────────────────────────

export interface GuardianGuidance {
  readonly label: string;
  readonly tone: "none" | "pending" | "verified" | "problem";
  readonly discuss: string[];
  readonly doNotDiscuss: string[];
}

export function guardianGuidance(g: Pick<HsGuardianView, "standing" | "mayDiscussAcademics" | "mayDiscussFinances">): GuardianGuidance {
  switch (g.standing) {
    case "verified_guardian": {
      const discuss = ["Emergency and scheduling matters"];
      const doNot: string[] = [];
      if (g.mayDiscussAcademics) discuss.push("Academic progress"); else doNot.push("Academic progress (no academic scope in force)");
      if (g.mayDiscussFinances) discuss.push("Billing and payments"); else doNot.push("Billing and payments (no financial scope in force)");
      return { label: "Verified guardian", tone: "verified", discuss, doNotDiscuss: doNot };
    }
    case "guardian_unverified":
      return { label: "Guardian — awaiting verification", tone: "pending", discuss: ["Emergency contact only"], doNotDiscuss: ["Academic progress", "Billing and payments", "Any student record detail"] };
    case "revoked":
      return { label: "Authority revoked", tone: "problem", discuss: [], doNotDiscuss: ["Everything except a safety emergency"] };
    default:
      return { label: "Listed parent — no authority", tone: "none", discuss: ["Emergency contact only"], doNotDiscuss: ["Academic progress", "Billing and payments", "Any student record detail"] };
  }
}

export const guardianNoteBody = (contactId: string, note: string) => ({ contactId, note: note.trim() });

export const GUARDIAN_NO_ACCESS = "Contacts never receive portal access, whatever their standing. Share information only outside the portal, only within the scope shown.";

// ── events and misc ──────────────────────────────────────────────────────────

export function pathwayHeadline(state: StaffHighSchoolState): string {
  const c = state.current;
  if (!c) return "No high school program yet";
  const credits = c.credits;
  return `${formatHalfUnits(credits.earnedHalfUnits)} of ${formatHalfUnits(credits.requiredHalfUnits)} credits officially earned`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-10-26" or an ISO timestamp -> "Oct 26, 2026". Anything unparseable is shown as-is; blank is an em dash. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : value;
}

export const humanize = (s: string): string => s.replace(/[._]/g, " ").replace(/^high school /, "").trim();

/** "on_hold" -> "On hold", "transferred_out" -> "Transferred out". */
export const statusLabel = (s: string): string => {
  const t = s.replace(/[._]/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Role of an actor from its id. Ids are never shown as people: only the role, or "Lumière staff" when unknown. */
export const actorRole = (id: string | null | undefined): "admin" | "staff" | "unknown" => (id && /^admin\b/i.test(id) ? "admin" : id && /^staff\b/i.test(id) ? "staff" : "unknown");

/** Sentence form: "an admin", "a staff member", "Lumière staff". */
export const actorLabel = (id: string | null | undefined): string => ({ admin: "an admin", staff: "a staff member", unknown: "Lumière staff" })[actorRole(id)];

/** Column form: "Admin", "Staff member", "Lumière staff". */
export const actorRoleLabel = (id: string | null | undefined): string => ({ admin: "Admin", staff: "Staff member", unknown: "Lumière staff" })[actorRole(id)];

/** "2026-10" -> "Oct 2026"; anything else is shown as-is. */
export function formatMonth(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${month} ${m[1]}` : value ?? "—";
}

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** Course/claim title for an award row ("Transfer credit · Spanish 1 · 1 credit", "Course completion · English 1 · 1 credit"), never a raw key or "1 cr". */
export function awardLabel(
  a: { source: string; courseKey: string | null; claimId: string | null; halfUnits: number },
  courses: readonly { key: string; title: string }[],
  claims: readonly { id: string; courseTitle: string }[],
): string {
  const credits = creditsLabel(a.halfUnits);
  if (a.source === "transfer") return `Transfer credit · ${claims.find((c) => c.id === a.claimId)?.courseTitle ?? "Prior study"} · ${credits}`;
  return `Course completion · ${courses.find((c) => c.key === a.courseKey)?.title ?? "Course"} · ${credits}`;
}

/** The server's event summaries name courses by key; show their titles. */
export function friendlyEventSummary(summary: string, courses: readonly { key: string; title: string; tasks: readonly { key: string; title: string }[] }[]): string {
  const title = (k: string) => courses.find((c) => c.key === k)?.title ?? k;
  return summary
    .replace(/for course ([a-z0-9-]+)/g, (_, k: string) => `for ${title(k)}`)
    .replace(/for ([a-z0-9-]+)\/([a-z0-9-]+)/g, (_, k: string, t: string) => `for ${courses.find((c) => c.key === k)?.tasks.find((x) => x.key === t)?.title ?? t} (${title(k)})`);
}

/** Official remaining credit is never negative. */
export const remainingHalfUnits = (required: number, earned: number): number => Math.max(0, required - earned);

export interface CreditSlot { readonly key: string; readonly label: string; readonly kind: "core" | "elective"; readonly requiredHalfUnits: number; readonly countedHalfUnits: number; readonly earnedHalfUnits: number }

/** Segments for the official-credit bar, one slot per area in order (core first); counted credit never exceeds the slot. */
export function creditSlots(credits: HsCreditSummary): CreditSlot[] {
  const slots = credits.byArea.map((a) => ({ key: a.key, label: a.label, kind: a.kind, requiredHalfUnits: a.requiredHalfUnits, countedHalfUnits: Math.min(a.countedHalfUnits, a.requiredHalfUnits), earnedHalfUnits: a.earnedHalfUnits }));
  return [...slots.filter((s) => s.kind === "core"), ...slots.filter((s) => s.kind === "elective")];
}

export const isCompleted = (state: StaffHighSchoolState): boolean => {
  const c = state.current;
  return !!c && (c.enrollment.status === "completed" || c.graduation.status === "diploma_conferred");
};

/** Where the S09 authority verification lives (not duplicated here). */
export const profileIdentityHref = (studentId: string): string => `/admin/students/${encodeURIComponent(studentId)}#workspace-profile`;
export const documentsHref = (studentId: string): string => `/admin/students/${encodeURIComponent(studentId)}#workspace-documents`;
