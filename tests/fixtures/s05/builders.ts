/**
 * S05 synthetic scenario fixtures — shared builders.
 *
 * Everything here is SYNTHETIC. No real student, institution or document data.
 * A scenario is described once as typed specs (items, objectives, milestones,
 * foundation credits); the workbook, the reference RoadmapContent, the canonical
 * StudentDegreeProgressView and the expectation data are all derived from those
 * specs so they cannot drift apart.
 */
import ExcelJS from "exceljs";
import type { RoadmapContent, RoadmapException } from "../../../shared/student-roadmap-contract";
import { ROADMAP_CONTENT_VERSION } from "../../../shared/student-roadmap-contract";
import type { StudentDegreeProgressView } from "../../../shared/student-degree-progress-view";
import {
  projectStudentDegreeProgress,
  type ProjectionCreditRecord,
  type ProjectionRequirementResult,
  type ProjectionSource,
} from "../../../shared/student-degree-progress-projection";

// ── primitives ───────────────────────────────────────────────────────────────

/** Deterministic v4-shaped UUID (zod 3 and 4 both accept it). */
export const fixtureUuid = (n: number): string =>
  `5a05f1c7-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type TaskCountKind = "challenge" | "milestone" | "touchstone" | "paper" | "quiz" | "exam" | "assignment";

/** Workbook column for each task-count kind, in the order tasks are generated. */
export const TASK_COUNT_COLUMNS: readonly { kind: TaskCountKind; header: string }[] = [
  { kind: "challenge", header: "Challenges" },
  { kind: "milestone", header: "Milestones" },
  { kind: "touchstone", header: "Touchstones" },
  { kind: "paper", header: "Papers" },
  { kind: "quiz", header: "Quizzes" },
  { kind: "exam", header: "Exams" },
  { kind: "assignment", header: "Assignments" },
];

// ── specs ────────────────────────────────────────────────────────────────────

export interface ObjectiveSpec {
  key: string;
  title: string;
  kind: "primary" | "secondary" | "parallel" | "prerequisite";
  institution?: string;
  credential?: string;
  status?: "active" | "completed" | "changed" | "alternative";
  note?: string;
}

export interface ItemSpec {
  /** Stable plan key (written to the "Plan Key" column unless omitKey). */
  key: string;
  phase: string;
  objective: string;
  seq?: number;
  kind?: "course" | "exam" | "application" | "task";
  code?: string;
  title: string;
  provider?: string;
  institution?: string;
  credits?: string;
  /** ISO dates; rendered in a mix of Excel date cells and text formats. */
  start?: string;
  end?: string;
  dependsOn?: string[];
  /** Render dependsOn with course codes instead of plan keys (where every dependency has a code). */
  dependsOnByCode?: boolean;
  status?: "planned" | "hold" | "alternative" | "dropped";
  holdReason?: string;
  approval?: "pending" | "approved";
  alternativeFor?: string;
  counts?: Partial<Record<TaskCountKind, number>>;
  /** Free-text "Tasks" column (task keys are importer-defined; assert counts only). */
  tasksList?: string[];
  studentNote?: string;
  staffNote?: string;
  condition?: string;
  /** Leave the Plan Key cell empty: the importer generates `slug(objective-key + "-" + (code||title))`. */
  omitKey?: boolean;
}

export interface MilestoneSpec {
  key: string;
  title: string;
  kind: "checkpoint" | "application" | "objective_complete" | "graduation";
  target?: string;
  objective?: string;
  after?: string[];
}

export interface WorkbookSpec {
  planTitle: string;
  summary?: string;
  primaryDegree?: string;
  institution?: string;
  objectives?: ObjectiveSpec[];
  items: ItemSpec[];
  milestones?: MilestoneSpec[];
  /** Header aliases: canonical column name -> text written in row 1. */
  headers?: Partial<Record<string, string>>;
  /** Sheet name for the plan sheet ("Plan" | "Roadmap"). */
  planSheetName?: string;
  /** Extra unmapped columns (header -> value per item key). */
  extraColumns?: { header: string; values: Record<string, string> }[];
  /** Raw rows appended after the items (comments, blanks, repeated header). */
  trailingRows?: ("comment" | "blank" | "repeatHeader")[];
  /** Include Objectives sheet / Milestones sheet / About sheet (default true when data exists). */
  includeAbout?: boolean;
}

// ── workbook rendering ───────────────────────────────────────────────────────

type Cell = string | number | Date | null;

const utc = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Realistic staff-spreadsheet date variety: Excel date cell, ISO text, M/D/YYYY text, "Mon YYYY" (start of month only). */
function renderDate(iso: string | undefined, variant: number, allowMonthYear: boolean): Cell {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  switch (variant % 4) {
    case 0:
      return utc(iso);
    case 1:
      return iso;
    case 2:
      return `${m}/${d}/${y}`;
    default:
      return allowMonthYear && d === 1 ? `${MONTHS[m - 1]} ${y}` : utc(iso);
  }
}

const CANONICAL_PLAN_HEADERS = [
  "Phase", "Objective", "Seq", "Code", "Title", "Provider", "Institution", "Credits", "Start", "End",
  "Depends On", "Status", "Hold Reason", "Approval", "Alternative For",
  "Challenges", "Milestones", "Touchstones", "Papers", "Quizzes", "Exams", "Assignments",
  "Tasks", "Kind", "Student Note", "Staff Note", "Plan Key", "Condition",
] as const;

const KIND_LABEL = { course: "Course", exam: "Exam", application: "Application", task: "Task" } as const;
const STATUS_LABEL = { planned: "Planned", hold: "Hold", alternative: "Alternative", dropped: "Dropped" } as const;
const APPROVAL_LABEL = { pending: "Pending", approved: "Approved" } as const;

function activeHeaders(spec: WorkbookSpec): string[] {
  const used = (h: string) => spec.items.some((i) => itemValue(i, h, 0, spec) !== null);
  // Required columns are always present; optional ones only when some item uses them.
  const always = new Set(["Phase", "Title"]);
  return CANONICAL_PLAN_HEADERS.filter((h) => always.has(h) || used(h)) as string[];
}

function itemValue(item: ItemSpec, header: string, rowIndex: number, spec: WorkbookSpec): Cell {
  const keyOf = (k: string) => k;
  const codeOf = (k: string) => spec.items.find((i) => i.key === k)?.code ?? k;
  switch (header) {
    case "Phase": return item.phase;
    case "Objective": return spec.objectives && spec.objectives.length > 1 ? objectiveLabel(spec, item.objective, rowIndex) : null;
    case "Seq": return item.seq ?? rowIndex + 1;
    case "Code": return item.code ?? null;
    case "Title": return item.title;
    case "Provider": return item.provider ?? null;
    case "Institution": return item.institution ?? null;
    case "Credits": return item.credits ? Number(item.credits) : null;
    case "Start": return renderDate(item.start, rowIndex, true);
    case "End": return renderDate(item.end, rowIndex + 1, false);
    case "Depends On":
      return item.dependsOn?.length
        ? item.dependsOn.map(item.dependsOnByCode ? codeOf : keyOf).join(", ")
        : null;
    case "Status": return item.status ? STATUS_LABEL[item.status] : null;
    case "Hold Reason": return item.holdReason ?? null;
    case "Approval": return item.approval ? APPROVAL_LABEL[item.approval] : null;
    case "Alternative For": return item.alternativeFor ?? null;
    case "Tasks": return item.tasksList?.length ? item.tasksList.join("; ") : null;
    case "Kind": return item.kind && item.kind !== "course" ? KIND_LABEL[item.kind] : null;
    case "Student Note": return item.studentNote ?? null;
    case "Staff Note": return item.staffNote ?? null;
    case "Plan Key": return item.omitKey ? null : item.key;
    case "Condition": return item.condition ?? null;
    default: {
      const col = TASK_COUNT_COLUMNS.find((c) => c.header === header);
      if (col) return item.counts?.[col.kind] ? item.counts[col.kind]! : null;
      return null;
    }
  }
}

/** Objective cell: alternate between the objective key and its title, as staff do. */
function objectiveLabel(spec: WorkbookSpec, key: string, rowIndex: number): string {
  const obj = spec.objectives?.find((o) => o.key === key);
  if (!obj) return key;
  return rowIndex % 2 === 0 ? obj.title : obj.key;
}

export async function buildWorkbookBuffer(spec: WorkbookSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Synthetic fixture builder";
  wb.created = new Date(Date.UTC(2026, 9, 26));
  wb.modified = new Date(Date.UTC(2026, 9, 26));

  const canonicalHeaders = activeHeaders(spec);
  const aliasOf = (h: string) => spec.headers?.[h] ?? h;
  const headerRow = [...canonicalHeaders.map(aliasOf), ...(spec.extraColumns ?? []).map((c) => c.header)];

  const plan = wb.addWorksheet(spec.planSheetName ?? "Plan");
  plan.addRow(headerRow).font = { bold: true };
  const dateCols = new Set(
    ["Start", "End"].map((h) => canonicalHeaders.indexOf(h) + 1).filter((n) => n > 0),
  );
  spec.items.forEach((item, idx) => {
    const cells = canonicalHeaders.map((h) => itemValue(item, h, idx, spec));
    for (const extra of spec.extraColumns ?? []) cells.push(extra.values[item.key] ?? null);
    const row = plan.addRow(cells);
    for (const col of dateCols) {
      const c = row.getCell(col);
      if (c.value instanceof Date) c.numFmt = "yyyy-mm-dd";
    }
  });
  for (const t of spec.trailingRows ?? []) {
    if (t === "comment") plan.addRow(["# staff scratch: ignore everything below the line"]);
    else if (t === "blank") plan.addRow([]);
    else plan.addRow(headerRow);
  }
  plan.views = [{ state: "frozen", ySplit: 1 }];
  plan.columns.forEach((col) => { col.width = 16; });

  if (spec.objectives?.length) {
    const sh = wb.addWorksheet("Objectives");
    sh.addRow(["Key", "Title", "Kind", "Institution", "Credential", "Status", "Note"]).font = { bold: true };
    for (const o of spec.objectives) {
      sh.addRow([
        o.key, o.title, o.kind[0].toUpperCase() + o.kind.slice(1), o.institution ?? null, o.credential ?? null,
        o.status ? o.status[0].toUpperCase() + o.status.slice(1) : null, o.note ?? null,
      ]);
    }
  }
  if (spec.milestones?.length) {
    const sh = wb.addWorksheet("Milestones");
    sh.addRow(["Key", "Title", "Kind", "Target Date", "Objective", "After"]).font = { bold: true };
    spec.milestones.forEach((m, i) => {
      sh.addRow([
        m.key, m.title, m.kind, renderDate(m.target, i, false), m.objective ?? null, m.after?.join(", ") ?? null,
      ]);
    });
  }
  if (spec.includeAbout !== false) {
    const sh = wb.addWorksheet("About");
    sh.addRow(["Label", "Value"]).font = { bold: true };
    sh.addRow(["Plan Title", spec.planTitle]);
    if (spec.summary) sh.addRow(["Summary", spec.summary]);
    if (spec.primaryDegree) sh.addRow(["Primary Degree", spec.primaryDegree]);
    if (spec.institution) sh.addRow(["Institution", spec.institution]);
    sh.addRow(["Prepared by", "Synthetic fixture builder (not an institutional document)"]);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── reference RoadmapContent (what a faithful import should produce) ─────────

function taskListFor(item: ItemSpec) {
  const tasks: { key: string; kind: TaskCountKind; title: string; sequence: number }[] = [];
  for (const col of TASK_COUNT_COLUMNS) {
    const n = item.counts?.[col.kind] ?? 0;
    for (let i = 1; i <= n; i++) {
      const title = col.kind[0].toUpperCase() + col.kind.slice(1);
      tasks.push({ key: `${col.kind}-${i}`, kind: col.kind, title: `${title} ${i}`, sequence: tasks.length + 1 });
    }
  }
  for (const entry of item.tasksList ?? []) {
    const kind = (TASK_COUNT_COLUMNS.find((c) => entry.toLowerCase().includes(c.kind))?.kind ?? "other") as TaskCountKind | "other";
    tasks.push({ key: slug(entry), kind: kind as TaskCountKind, title: entry, sequence: tasks.length + 1 });
  }
  return tasks;
}

/** Item key the importer should use (Plan Key, else slug(objectiveKey-code|title)). */
export function expectedItemKey(item: ItemSpec): string {
  return item.omitKey ? slug(`${item.objective}-${item.code || item.title}`) : item.key;
}

export function toRoadmapContent(spec: WorkbookSpec): RoadmapContent {
  const objectives = (spec.objectives?.length
    ? spec.objectives
    : [{ key: "primary", title: spec.primaryDegree ?? "Primary degree", kind: "primary" as const }]
  ).map((o, i) => ({
    key: o.key,
    title: o.title,
    kind: o.kind,
    institution: o.institution ?? null,
    credentialLabel: o.credential ?? null,
    linkedToProgramAssignment: o.kind === "primary" && spec.objectives!.findIndex((x) => x.kind === "primary") === i,
    status: o.status ?? ("active" as const),
    note: o.note ?? null,
  }));
  const phaseTitles = [...new Set(spec.items.map((i) => i.phase))];
  const keyMap = new Map(spec.items.map((i) => [i.key, expectedItemKey(i)]));
  const content: RoadmapContent = {
    contentVersion: ROADMAP_CONTENT_VERSION,
    title: spec.planTitle,
    summary: spec.summary ?? null,
    objectives,
    phases: phaseTitles.map((t, i) => ({
      key: slug(t), title: t, sequence: i + 1, objectiveKey: null, startDate: null, endDate: null, description: null,
    })),
    items: spec.items.map((i, idx) => ({
      key: expectedItemKey(i),
      phaseKey: slug(i.phase),
      objectiveKey: i.objective,
      sequence: i.seq ?? idx + 1,
      kind: i.kind ?? "course",
      code: i.code ?? null,
      title: i.title,
      provider: i.provider ?? null,
      institution: i.institution ?? null,
      credits: i.credits ?? null,
      plannedStart: i.start ?? null,
      plannedEnd: i.end ?? null,
      dependsOn: (i.dependsOn ?? []).map((d) => keyMap.get(d) ?? d),
      planStatus: i.status ?? "planned",
      hold: i.status === "hold" && i.holdReason ? { reason: i.holdReason } : null,
      approval: i.approval ? { required: true, status: i.approval, note: null } : null,
      alternativeOf: i.alternativeFor ? keyMap.get(i.alternativeFor) ?? i.alternativeFor : null,
      linkedCreditRecordId: null,
      tasks: taskListFor(i),
      studentNote: i.studentNote ?? null,
      staffNote: i.staffNote ?? null,
    })),
    milestones: (spec.milestones ?? []).map((m) => ({
      key: m.key,
      title: m.title,
      kind: m.kind,
      targetDate: m.target ?? null,
      objectiveKey: m.objective ?? null,
      afterItemKeys: (m.after ?? []).map((a) => keyMap.get(a) ?? a),
    })),
  };
  return content;
}

// ── canonical foundation (synthetic StudentDegreeProgressView) ───────────────

export interface FoundationSourceSpec {
  id: string;
  sourceType: "transcript" | "credential_evaluation" | "provider_record" | "exam_score" | "institution_record" | "manual" | "other";
  status: "received" | "extracted" | "verified" | "rejected";
  title: string;
  sourceDate?: string;
}

export interface FoundationCreditSpec {
  id: string;
  sourceId: string;
  recordType?: "course" | "exam" | "credential_award" | "other";
  code?: string;
  title: string;
  reported: string;
  /** verified = verified event + accepted decision (awarded credits); rejected = rejected decision. */
  state: "verified" | "pending" | "needs_review" | "rejected";
  awarded?: string;
  completedOn?: string;
  term?: string;
}

export interface FoundationRequirementSpec {
  id: string;
  code: string;
  title: string;
  required: string;
  applied: string;
  creditIds?: string[];
}

export interface FoundationSpec {
  program: { name: string; code: string; version: string; institution: string; cohort: string } | null;
  /** MANUAL_REVIEW -> state UNDER_REVIEW (no totals). */
  composed: boolean;
  sources: FoundationSourceSpec[];
  credits: FoundationCreditSpec[];
  requirements: FoundationRequirementSpec[];
  asOf?: string;
}

const hundredths = (v: string): bigint => {
  const [w, f = ""] = v.split(".");
  return BigInt(w) * 100n + BigInt(f.padEnd(2, "0").slice(0, 2));
};
const fromHundredths = (v: bigint): string => {
  const w = v / 100n;
  const f = (v % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
};

export function buildFoundationView(spec: FoundationSpec): StudentDegreeProgressView {
  const asOf = spec.asOf ?? "2026-10-20T12:00:00.000Z";
  const academicSources: ProjectionSource[] = spec.sources.map((s) => ({
    id: s.id, sourceType: s.sourceType, status: s.status, title: s.title,
    sourceDate: s.sourceDate ?? null, receivedAt: new Date("2026-09-01T12:00:00.000Z"),
  }));
  const creditRecords: ProjectionCreditRecord[] = spec.credits.map((c) => ({
    id: c.id, sourceId: c.sourceId, recordType: c.recordType ?? "course",
    status: c.state === "verified" ? "verified" : c.state === "rejected" ? "rejected" : c.state === "needs_review" ? "needs_review" : "extracted",
    rawCourseCode: c.code ?? null, rawTitle: c.title, rawCredits: c.reported,
    term: c.term ?? null, completedOn: c.completedOn ?? null,
  }));
  const latestVerifications: Record<string, { action: string }> = {};
  const latestDecisions: Record<string, { action: string; creditsAwarded?: string | null }> = {};
  for (const c of spec.credits) {
    if (c.state === "verified") {
      latestVerifications[c.id] = { action: "verified" };
      latestDecisions[c.id] = { action: "accepted", creditsAwarded: c.awarded ?? c.reported };
    } else if (c.state === "rejected") {
      latestVerifications[c.id] = { action: "verified" };
      latestDecisions[c.id] = { action: "rejected", creditsAwarded: null };
    } else if (c.state === "needs_review") {
      latestVerifications[c.id] = { action: "needs_review" };
    } else {
      latestVerifications[c.id] = { action: "submitted" };
    }
  }
  const results: ProjectionRequirementResult[] = spec.requirements.map((r) => {
    const req = hundredths(r.required);
    const app = hundredths(r.applied);
    const remaining = req > app ? req - app : 0n;
    return {
      requirementId: r.id,
      status: app >= req ? "SATISFIED" : app > 0n ? "PARTIAL" : "MISSING",
      requiredAmount: r.required,
      appliedAmount: r.applied,
      remainingAmount: fromHundredths(remaining),
      provenance: { studentCreditRecordIds: r.creditIds ?? [] },
    };
  });
  return projectStudentDegreeProgress({
    report: spec.program
      ? spec.composed
        ? { status: "COMPOSED", snapshot: { asOf }, phase3Output: { results } }
        : { status: "MANUAL_REVIEW", snapshot: { asOf }, phase3Output: null }
      : null,
    record: {
      activeProgramAssignment: spec.program ? { cohortLabel: spec.program.cohort } : null,
      programVersion: spec.program
        ? {
          version: { versionLabel: spec.program.version },
          program: { name: spec.program.name, code: spec.program.code },
          institution: { name: spec.program.institution },
        }
        : null,
      academicSources,
      creditRecords,
      latestVerifications,
      latestDecisions,
    },
    requirementLabels: Object.fromEntries(
      spec.requirements.map((r, i) => [r.id, { code: r.code, title: r.title, sequence: i + 1 }]),
    ),
  });
}

// ── scenario contract ────────────────────────────────────────────────────────

export interface DiffExpectation {
  added: string[];
  removed: string[];
  /** itemKey -> exact changed field names (sorted). */
  changed: Record<string, string[]>;
  rescheduleOnlyKeys: string[];
  unchangedCount: number;
  objectivesAdded: string[];
  objectivesRemoved: string[];
  objectivesChanged: string[];
  phasesChanged: boolean;
  milestonesChanged: boolean;
  /** Exception codes the diff step is expected to raise (given progress on removed items where noted). */
  exceptionCodes: string[];
}

export interface WorkbookExpectations {
  templateId: "lumiere-roadmap-v1";
  sheetsRead: string[];
  itemCount: number;
  itemKeys: string[];
  /** Objective key -> kind. */
  objectives: Record<string, string>;
  objectiveKinds: string[];
  phaseCount: number;
  milestoneCount: number;
  /** itemKey -> total generated tasks (count columns; Tasks-list rows count their entries). */
  taskCounts: Record<string, number>;
  /** Exact count of exceptions per listed code. Codes not listed may appear (e.g. UNMAPPED_COLUMN). */
  exceptionCodes: Record<string, number>;
  /** Severities that must not appear at all. */
  forbiddenSeverities: RoadmapException["severity"][];
  /** Items expected to carry a CONDITIONAL_ALLOCATION warning. */
  conditionalItemKeys: string[];
  rowsSkipped: number;
}

export interface FoundationExpectations {
  state: "COMPOSED" | "UNDER_REVIEW" | "NO_ACTIVE_PROGRAM";
  credentialAwardCount: number;
  verifiedCreditRecords: number;
  pendingOrReviewRecords: number;
  /** totals.* as decimal strings; null when state is not COMPOSED. */
  totals: { required: string; applied: string; verifiedOnRecord: string; surplus: string } | null;
}

export interface ScenarioFixture {
  id: "R" | "N" | "M" | "A" | "Rc" | "E" | "S";
  /** Synthetic label only; not a real person. */
  studentLabel: string;
  description: string;
  workbook: { spec: WorkbookSpec; build(): Promise<Buffer>; fileName: string; content: RoadmapContent; expectations: WorkbookExpectations };
  /** Revised workbooks for re-import tests, in order (each applies on top of the previous published version). */
  revisions: {
    id: string;
    description: string;
    spec: WorkbookSpec;
    build(): Promise<Buffer>;
    fileName: string;
    content: RoadmapContent;
    expectations: WorkbookExpectations;
    /** Diff against the previous version in this scenario's chain. */
    diff: DiffExpectation;
  }[];
  foundationSpec: FoundationSpec;
  foundation: StudentDegreeProgressView;
  foundationExpectations: FoundationExpectations;
  /** What round-2 integration tests should assert beyond the data above. */
  integrationNotes: string[];
}

export function expectationsFromSpec(
  spec: WorkbookSpec,
  extra: {
    sheetsRead: string[];
    exceptionCodes?: Record<string, number>;
    rowsSkipped?: number;
  },
): WorkbookExpectations {
  const content = toRoadmapContent(spec);
  const objectives = Object.fromEntries(content.objectives.map((o) => [o.key, o.kind]));
  const conditionalItemKeys = spec.items.filter((i) => i.condition).map(expectedItemKey);
  const generated = spec.items.filter((i) => i.omitKey).length;
  const exceptionCodes: Record<string, number> = { ...(extra.exceptionCodes ?? {}) };
  if (generated > 0 && exceptionCodes.GENERATED_ITEM_KEY === undefined) exceptionCodes.GENERATED_ITEM_KEY = generated;
  if (conditionalItemKeys.length > 0 && exceptionCodes.CONDITIONAL_ALLOCATION === undefined) {
    exceptionCodes.CONDITIONAL_ALLOCATION = conditionalItemKeys.length;
  }
  return {
    templateId: "lumiere-roadmap-v1",
    sheetsRead: extra.sheetsRead,
    itemCount: content.items.length,
    itemKeys: content.items.map((i) => i.key),
    objectives,
    objectiveKinds: [...new Set(content.objectives.map((o) => o.kind))].sort(),
    phaseCount: content.phases.length,
    milestoneCount: content.milestones.length,
    taskCounts: Object.fromEntries(
      spec.items.map((i) => [
        expectedItemKey(i),
        taskListFor(i).length,
      ]),
    ),
    exceptionCodes,
    forbiddenSeverities: ["blocking"],
    conditionalItemKeys,
    rowsSkipped: extra.rowsSkipped ?? 0,
  };
}

/** Shift an ISO date by whole days (UTC). */
export function addDays(iso: string, days: number): string {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function sheetsFor(spec: WorkbookSpec): string[] {
  return [
    spec.planSheetName ?? "Plan",
    ...(spec.objectives?.length ? ["Objectives"] : []),
    ...(spec.milestones?.length ? ["Milestones"] : []),
    ...(spec.includeAbout !== false ? ["About"] : []),
  ];
}

type ExpectationExtra = Parameters<typeof expectationsFromSpec>[1];

export function workbookEntry(
  spec: WorkbookSpec,
  fileName: string,
  extra: Omit<ExpectationExtra, "sheetsRead"> = {},
): ScenarioFixture["workbook"] {
  return {
    spec,
    fileName,
    build: () => buildWorkbookBuffer(spec),
    content: toRoadmapContent(spec),
    expectations: expectationsFromSpec(spec, { ...extra, sheetsRead: sheetsFor(spec) }),
  };
}

export function revisionEntry(
  id: string,
  description: string,
  spec: WorkbookSpec,
  fileName: string,
  diff: DiffExpectation,
  extra: Omit<ExpectationExtra, "sheetsRead"> = {},
): ScenarioFixture["revisions"][number] {
  return { id, description, diff, ...workbookEntry(spec, fileName, extra) };
}
