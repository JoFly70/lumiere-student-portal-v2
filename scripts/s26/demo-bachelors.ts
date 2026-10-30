/**
 * S27 — the BACHELOR'S demo persona (DEMO-S27-P9, "DEMO Avery"): the only synthetic DEGREE student of the demo
 * cohort, so the owner can open the degree Roadmap (/roadmap) and "Beyond the Bachelor's" with "View as student".
 *
 * Everything is synthetic and marked: "DEMO" names, a fictional "DEMO University (fictional)" catalog entry,
 * DEMO claim keys / requirement codes, .invalid email (see demo-cohort.ts). No money: this persona has no billing
 * obligation, installment, receipt or payment proof. No real school is named anywhere.
 *
 * Written through the application's own services wherever one exists:
 *   - student academic record: studentAcademicService (assignment, sources, credit records, verification, decisions)
 *   - placements: the student credit placement service
 *   - requirement claims: knowledgeService (evidence source/excerpt, claim, version, evidence link, verification, confirm)
 *   - roadmap: the real import-package converter -> draft -> acknowledge -> publish, then the student's own
 *     progress reports (as the student) through the roadmap service
 * Two gaps have no service and use the typed Drizzle tables (shared/knowledge-schema.ts) directly:
 *   - the catalog rows (institution, program, program version, requirements): no create service exists;
 *   - a requirement claim version's normalized value: the knowledge service has no field for it, and the degree
 *     engine needs it ({ projectionKind: QUANTITATIVE_REQUIREMENT, kind: minimum, unit: credits, requiredAmount }).
 *     It is set once, while the version is still "working", before confirmation.
 *
 * Idempotent and convergent: every row is found by a stable DEMO key first (slug, code, claim key, source title,
 * source line key, plan title) and only what is missing is created, so a second run changes nothing. Only the
 * student passed in (already checked to be a DEMO student by the caller) is touched.
 */
import crypto from "node:crypto";
import { DEMO_TAG } from "./demo-plan.mjs";
import type { RoadmapContent, RoadmapItem, RoadmapTask } from "../../shared/student-roadmap-contract";
import type { UpdateAgreementInput } from "../../shared/s27-contract";

/** The staff agreement form's goal shape (what updateAgreement accepts). */
export type DemoGoal = NonNullable<UpdateAgreementInput["goal"]>;

export const BACHELORS_KEY = "DEMO-S27-P9";

// ── Catalog (fictional) ─────────────────────────────────────────────────────

export const DEMO_INSTITUTION = { slug: "demo-fictional-university", name: "DEMO University (fictional)" } as const;
export const DEMO_PROGRAM = { code: "DEMO-BSBA", name: "Bachelor of Science in Business Administration", degreeLevel: "bachelor" } as const;
export const DEMO_PROGRAM_VERSION = { label: "DEMO 2026 catalog (synthetic)", catalogYear: 2026, totalCredits: 120 } as const;

export interface DemoRequirement { code: string; title: string; credits: number; sequence: number }
/** 36 + 36 + 33 + 15 = 120. */
export const DEMO_REQUIREMENTS: readonly DemoRequirement[] = [
  { code: "DEMO-GEN", title: "General education", credits: 36, sequence: 1 },
  { code: "DEMO-BUS", title: "Business major", credits: 36, sequence: 2 },
  { code: "DEMO-ELE", title: "Free electives", credits: 33, sequence: 3 },
  { code: "DEMO-RES", title: "Residency: courses taken at the university itself", credits: 15, sequence: 4 },
];

// ── Canonical prior credit (synthetic) ──────────────────────────────────────

/** Every credit is verified, accepted AND placed in a requirement: the degree engine sends the whole record to manual
 *  review (no totals for the student) as soon as one credit is undecided or accepted without a placement. */
export interface DemoCredit { line: string; code: string | null; title: string; credits: number; requirement: string }
export interface DemoSource { title: string; sourceType: "transcript" | "provider_record"; sourceDate: string; credits: readonly DemoCredit[] }

const cc = (line: string, code: string | null, title: string, requirement: string): DemoCredit => ({ line, code, title, credits: 3, requirement });

/** Prior community college: 48 credits applied (General education 36 + Free electives 12). Introduction to
 *  Psychology ("placement to confirm") is NOT on the canonical record: it is a roadmap item awaiting the university. */
export const DEMO_TRANSFER: DemoSource = {
  title: "DEMO prior community college transcript (synthetic)", sourceType: "transcript", sourceDate: "2024-06-15",
  credits: [
    cc("demo-cc-01", "ENG110", "College Writing", "DEMO-GEN"), cc("demo-cc-02", "COM110", "Public Speaking", "DEMO-GEN"),
    cc("demo-cc-03", "HIS101", "World History I", "DEMO-GEN"), cc("demo-cc-04", "HIS102", "World History II", "DEMO-GEN"),
    cc("demo-cc-05", "MAT110", "Quantitative Reasoning", "DEMO-GEN"), cc("demo-cc-06", "BIO101", "Principles of Biology", "DEMO-GEN"),
    cc("demo-cc-07", "CHE101", "Introductory Chemistry", "DEMO-GEN"), cc("demo-cc-08", "PHI110", "Critical Thinking", "DEMO-GEN"),
    cc("demo-cc-09", "ART101", "Art Appreciation", "DEMO-GEN"), cc("demo-cc-10", "GEO101", "World Geography", "DEMO-GEN"),
    cc("demo-cc-11", "POL101", "American Government", "DEMO-GEN"), cc("demo-cc-12", "LIT201", "Introduction to Literature", "DEMO-GEN"),
    cc("demo-cc-13", "SPA101", "Elementary Spanish I", "DEMO-ELE"), cc("demo-cc-14", "SPA102", "Elementary Spanish II", "DEMO-ELE"),
    cc("demo-cc-15", "MUS101", "Music Appreciation", "DEMO-ELE"), cc("demo-cc-16", "PED110", "Personal Wellness", "DEMO-ELE"),
  ],
};

/** Employer training with recommended college credit (workplace credit): 12 credits applied to the Business major. */
export const DEMO_WORKPLACE: DemoSource = {
  title: "DEMO employer training — ACE-recommended credit (synthetic)", sourceType: "provider_record", sourceDate: "2025-03-01",
  credits: [
    cc("demo-wp-01", null, "Supervisory Management (employer training)", "DEMO-BUS"),
    cc("demo-wp-02", null, "Business Communication (employer training)", "DEMO-BUS"),
    cc("demo-wp-03", null, "Project Management Essentials (employer training)", "DEMO-BUS"),
    cc("demo-wp-04", null, "Sales and Customer Relations (employer training)", "DEMO-BUS"),
  ],
};

// ── Roadmap (planning document) ─────────────────────────────────────────────

export const DEMO_PLAN_TITLE = "DEMO — Bachelor's plan (synthetic)";
const SOPHIA = "Sophia";
const STUDY = "Study.com";

const sophiaTasks = (): RoadmapTask[] => [
  { key: "touchstone-1", kind: "touchstone", title: "Touchstone 1", sequence: 1 },
  { key: "milestone-1", kind: "milestone", title: "Milestone 1", sequence: 2 },
  { key: "touchstone-2", kind: "touchstone", title: "Touchstone 2", sequence: 3 },
  { key: "final-milestone", kind: "milestone", title: "Final milestone", sequence: 4 },
];
const studyTasks = (): RoadmapTask[] => [
  { key: "quiz-1", kind: "quiz", title: "Quiz 1", sequence: 1 },
  { key: "quiz-2", kind: "quiz", title: "Quiz 2", sequence: 2 },
  { key: "assignment-1", kind: "assignment", title: "Written assignment", sequence: 3 },
  { key: "final-exam", kind: "exam", title: "Final exam", sequence: 4 },
];

type ItemSeed = { key: string; phase: string; seq: number; code: string; title: string; provider: string; start: string; end: string; extra?: Partial<RoadmapItem> };
const SEEDS: readonly ItemSeed[] = [
  // Block 1 — autumn 2026
  { key: "soc101", phase: "block-1", seq: 1, code: "SOC101", title: "Introduction to Sociology", provider: SOPHIA, start: "2026-09-07", end: "2026-10-09" },
  { key: "mat120", phase: "block-1", seq: 2, code: "MAT120", title: "College Algebra", provider: SOPHIA, start: "2026-09-14", end: "2026-10-23" },
  { key: "fin301", phase: "block-1", seq: 3, code: "FIN301", title: "Principles of Finance", provider: STUDY, start: "2026-09-21", end: "2026-10-30" },
  { key: "eng101", phase: "block-1", seq: 4, code: "ENG101", title: "English Composition I", provider: SOPHIA, start: "2026-10-05", end: "2026-11-13" },
  { key: "law201", phase: "block-1", seq: 5, code: "LAW201", title: "Business Law", provider: STUDY, start: "2026-10-12", end: "2026-11-20" },
  { key: "sci110", phase: "block-1", seq: 6, code: "SCI110", title: "Environmental Science", provider: SOPHIA, start: "2026-11-16", end: "2026-12-18",
    extra: { planStatus: "hold", hold: { reason: "DEMO: the university must pre-approve this course before you start it." }, studentNote: "DEMO: Lumière has asked the university to pre-approve this course." } },
  { key: "acc101", phase: "block-1", seq: 7, code: "ACC101", title: "Financial Accounting", provider: SOPHIA, start: "2026-11-16", end: "2026-12-18" },
  { key: "eco101", phase: "block-1", seq: 8, code: "ECO101", title: "Principles of Macroeconomics", provider: SOPHIA, start: "2026-11-23", end: "2026-12-18" },
  // Block 2 — winter 2027
  { key: "mgt330", phase: "block-2", seq: 1, code: "MGT330", title: "Organizational Behavior", provider: STUDY, start: "2027-01-04", end: "2027-02-05" },
  { key: "eng215", phase: "block-2", seq: 2, code: "ENG215", title: "Professional Writing", provider: SOPHIA, start: "2027-01-04", end: "2027-02-05" },
  { key: "eco102", phase: "block-2", seq: 3, code: "ECO102", title: "Principles of Microeconomics", provider: SOPHIA, start: "2027-01-11", end: "2027-02-12" },
  { key: "bus101", phase: "block-2", seq: 4, code: "BUS101", title: "Introduction to Business", provider: SOPHIA, start: "2027-01-18", end: "2027-02-12" },
  { key: "mkt101", phase: "block-2", seq: 5, code: "MKT101", title: "Principles of Marketing", provider: SOPHIA, start: "2027-01-25", end: "2027-02-12" },
  // Block 3 — finish line
  { key: "hrm301", phase: "block-3", seq: 1, code: "HRM301", title: "Human Resource Management", provider: STUDY, start: "2027-02-15", end: "2027-03-19" },
  { key: "hum101", phase: "block-3", seq: 2, code: "HUM101", title: "Art History I", provider: SOPHIA, start: "2027-02-15", end: "2027-03-12" },
  { key: "cs101", phase: "block-3", seq: 3, code: "CS101", title: "Introduction to Information Technology", provider: SOPHIA, start: "2027-02-22", end: "2027-03-19" },
  { key: "phi101", phase: "block-3", seq: 4, code: "PHI101", title: "Introduction to Ethics", provider: SOPHIA, start: "2027-03-01", end: "2027-03-26" },
];

/** Planned credit by provider (3 credits per course): Sophia 13 x 3 = 39, Study.com 4 x 3 = 12. */
export const DEMO_PLANNED = { [SOPHIA]: 39, [STUDY]: 12 } as const;
export const DEMO_TARGET_FINISH = "2027-03-31";
const OBJECTIVE = "bsba";
const PSY_KEY = "psy101";

export function makeBachelorsContent(): RoadmapContent {
  const items: RoadmapItem[] = SEEDS.map((s) => ({
    key: s.key, phaseKey: s.phase, objectiveKey: OBJECTIVE, sequence: s.seq, kind: "course", code: s.code, title: s.title,
    provider: s.provider, institution: DEMO_INSTITUTION.name, credits: "3", plannedStart: s.start, plannedEnd: s.end,
    dependsOn: [], planStatus: "planned", provenance: [], tasks: s.provider === SOPHIA ? sophiaTasks() : studyTasks(),
    staffNote: `${DEMO_TAG}`, ...s.extra,
  }));
  items.unshift({
    key: PSY_KEY, phaseKey: "foundation", objectiveKey: OBJECTIVE, sequence: 1, kind: "course", code: "PSY101", title: "Introduction to Psychology",
    // Taken at the prior college but not yet on the canonical record (any undecided credit would put the whole degree
    // view under review): no planned credit here; the university still has to confirm where it counts, so the item
    // waits on that approval and cannot be logged.
    provider: null, institution: "Prior community college (DEMO)", credits: null, plannedStart: null, plannedEnd: null, dependsOn: [],
    planStatus: "planned", approval: { required: true, status: "pending", note: "DEMO: placement to confirm" }, provenance: [], tasks: [],
    studentNote: "DEMO: earned at your prior college; the university still has to confirm which requirement it counts toward.",
    staffNote: `${DEMO_TAG}`,
  });
  return {
    contentVersion: "roadmap-content/1",
    title: DEMO_PLAN_TITLE,
    summary: `${DEMO_TAG}. Synthetic bachelor's plan: prior college and workplace credit already earned, the rest planned with two course providers, finishing around March 2027.`,
    objectives: [{
      key: OBJECTIVE, title: DEMO_PROGRAM.name, kind: "primary", institution: DEMO_INSTITUTION.name, credentialLabel: "Bachelor's degree",
      linkedToProgramAssignment: true, status: "active", note: DEMO_TAG,
    }],
    phases: [
      { key: "foundation", title: "Already on your record", sequence: 0, objectiveKey: OBJECTIVE, description: "DEMO: prior credit (synthetic)." },
      { key: "block-1", title: "Block 1 — autumn 2026", sequence: 1, objectiveKey: OBJECTIVE, startDate: "2026-09-07", endDate: "2026-12-18" },
      { key: "block-2", title: "Block 2 — winter 2027", sequence: 2, objectiveKey: OBJECTIVE, startDate: "2027-01-04", endDate: "2027-02-12" },
      { key: "block-3", title: "Block 3 — finish line", sequence: 3, objectiveKey: OBJECTIVE, startDate: "2027-02-15", endDate: "2027-03-26" },
    ],
    items,
    milestones: [
      { key: "winter-start", title: "Winter block starts", kind: "checkpoint", targetDate: "2027-01-04", objectiveKey: OBJECTIVE, afterItemKeys: SEEDS.filter((s) => s.phase === "block-1").map((s) => s.key) },
      { key: "degree-complete", title: "All degree courses complete (target)", kind: "graduation", targetDate: DEMO_TARGET_FINISH, objectiveKey: OBJECTIVE, afterItemKeys: SEEDS.map((s) => s.key) },
    ],
    reportedHistory: [],
    schedule: { preparedOn: "2026-09-01", startsOn: "2026-09-07", weeks: 30, label: "DEMO schedule (synthetic)" },
  };
}

/** Student-reported progress (as the student): grade posted, finished at the provider, all work sent, in progress. */
type Report = { item: string; task: string | null; status: string };
export const DEMO_PROGRESS: readonly Report[] = [
  ...sophiaTasks().map((t) => ({ item: "soc101", task: t.key, status: "graded" })),
  { item: "mat120", task: null, status: "provider_complete" },
  ...studyTasks().map((t) => ({ item: "fin301", task: t.key, status: "submitted" })),
  { item: "eng101", task: "touchstone-1", status: "graded" }, { item: "eng101", task: "milestone-1", status: "graded" },
  { item: "eng101", task: "touchstone-2", status: "in_progress" },
  { item: "law201", task: "quiz-1", status: "graded" }, { item: "law201", task: "quiz-2", status: "in_progress" },
];

/** Post-secondary goal for "Beyond the Bachelor's": a master's direction (fictional school). */
export const DEMO_BACHELORS_GOAL: DemoGoal = {
  field: "Business management (master's)",
  region: "Online (DEMO)",
  interests: ["Management", "Finance", "Marketing communication"],
  targets: [
    { name: "DEMO Graduate School of Management (fictional)", city: "DEMO city", track: "Part-time online", program: "Master of Business Administration (demo)",
      why: "DEMO — synthetic example: builds on the business major and the student's supervisory experience.",
      admission: "DEMO — synthetic example: a completed bachelor's degree and two years of work experience.", url: null },
    { name: "DEMO Institute of Finance (fictional)", city: "DEMO city", track: "Evening cohort", program: "Master of Science in Finance (demo)",
      why: "DEMO — synthetic example: for a move into corporate finance.", admission: "DEMO — synthetic example.", url: null },
  ],
  alsoReviewed: ["DEMO Business School (fictional)"],
  studyOn: null,
};

// ── Seeding ─────────────────────────────────────────────────────────────────

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Fictional catalog entry with one confirmed, evidenced requirement claim per requirement (convergent). */
export async function ensureDemoProgram(actorId: string): Promise<{ programVersionId: string; requirementIds: Record<string, string> }> {
  const { db } = await import("../../server/lib/db");
  const { and, eq } = await import("drizzle-orm");
  const k = await import("../../shared/knowledge-schema");
  const { knowledgeService } = await import("../../server/services/knowledge-service");
  const repo = await import("../../server/repositories/knowledge-repo");

  let [inst] = await db.select().from(k.institutions).where(eq(k.institutions.slug, DEMO_INSTITUTION.slug));
  if (!inst) [inst] = await db.insert(k.institutions).values({ slug: DEMO_INSTITUTION.slug, name: DEMO_INSTITUTION.name, metadata: { synthetic: true, note: DEMO_TAG } }).returning();
  let [prog] = await db.select().from(k.programsV2).where(and(eq(k.programsV2.institutionId, inst.id), eq(k.programsV2.code, DEMO_PROGRAM.code)));
  if (!prog) [prog] = await db.insert(k.programsV2).values({ institutionId: inst.id, code: DEMO_PROGRAM.code, name: DEMO_PROGRAM.name, degreeLevel: DEMO_PROGRAM.degreeLevel, metadata: { synthetic: true, note: DEMO_TAG } }).returning();
  let [pv] = await db.select().from(k.programVersions).where(and(eq(k.programVersions.programId, prog.id), eq(k.programVersions.versionLabel, DEMO_PROGRAM_VERSION.label)));
  if (!pv) [pv] = await db.insert(k.programVersions).values({
    programId: prog.id, versionLabel: DEMO_PROGRAM_VERSION.label, catalogYear: DEMO_PROGRAM_VERSION.catalogYear, effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    status: "active", totalCreditsRequired: DEMO_PROGRAM_VERSION.totalCredits, metadata: { synthetic: true, note: DEMO_TAG },
  }).returning();

  // One synthetic evidence source for the program sheet (found by title + institution).
  const sourceTitle = "DEMO program sheet (synthetic, not a real catalog)";
  let [source] = await db.select().from(k.evidenceSources).where(and(eq(k.evidenceSources.title, sourceTitle), eq(k.evidenceSources.institutionId, inst.id)));
  if (!source) source = await knowledgeService.createEvidenceSource({ sourceType: "internal_research", title: sourceTitle, institutionId: inst.id, authorityLevel: "unknown", lifecycleStatus: "current", createdBy: actorId } as never);

  const requirementIds: Record<string, string> = {};
  for (const r of DEMO_REQUIREMENTS) {
    let [req] = await db.select().from(k.requirementsV2).where(and(eq(k.requirementsV2.programVersionId, pv.id), eq(k.requirementsV2.code, r.code)));
    if (!req) [req] = await db.insert(k.requirementsV2).values({
      programVersionId: pv.id, code: r.code, title: r.title, creditsRequired: r.credits, sequence: r.sequence, active: true, metadata: { synthetic: true, note: DEMO_TAG },
    }).returning();
    requirementIds[r.code] = req.id;

    const claimKey = `demo.bsba.requirement.${r.code.toLowerCase()}`;
    let claim = await repo.getClaimByKey(claimKey);
    if (!claim) claim = await knowledgeService.createKnowledgeClaim({ claimKey, claimType: "requirement", subjectType: "requirement", subjectId: req.id, createdBy: actorId } as never);
    if (claim.status === "confirmed" && claim.currentVersionId) continue;
    const version = (await repo.listClaimVersions(claim.id)).find((v) => v.status === "working")
      ?? await knowledgeService.createClaimVersion({ claimId: claim.id, statement: `DEMO: ${r.title} requires ${r.credits} credits (synthetic).`, confidence: 90, createdBy: actorId } as never);
    // No service field exists for the engine's normalized requirement value (see header).
    await db.update(k.claimVersions).set({ normalizedValue: { projectionKind: "QUANTITATIVE_REQUIREMENT", kind: "minimum", unit: "credits", requiredAmount: String(r.credits), academicRuleId: null } })
      .where(and(eq(k.claimVersions.id, version.id), eq(k.claimVersions.status, "working")));
    if ((await repo.listEvidenceForClaimVersion(version.id)).length === 0) {
      const excerpt = await knowledgeService.addEvidenceExcerpt({ evidenceSourceId: source.id, excerptText: `DEMO (synthetic): ${r.title} — ${r.credits} credits.`, section: r.code } as never);
      await knowledgeService.attachEvidenceToClaimVersion({ claimVersionId: version.id, evidenceExcerptId: excerpt.id, relationshipType: "supports" } as never);
    }
    const latest = await repo.getLatestVerificationEvent(version.id);
    if (latest?.action !== "verified") await knowledgeService.recordVerification({ claimVersionId: version.id, action: "verified", reviewerId: actorId, rationale: DEMO_TAG } as never);
    await knowledgeService.confirmClaimVersion(version.id);
  }
  return { programVersionId: pv.id, requirementIds };
}

/** The student's canonical academic record: assignment, two sources, credit records verified + accepted + placed. */
export async function ensureDemoAcademicRecord(studentId: string, actorId: string, program: { programVersionId: string; requirementIds: Record<string, string> }) {
  const { studentAcademicService: academic } = await import("../../server/services/student-academic-service");
  const arepo = await import("../../server/repositories/student-academic-repo");
  const { createStudentCreditPlacementServiceWithDefaults } = await import("../../server/services/student-credit-placement-service");
  const prepo = await import("../../server/repositories/student-credit-placement-repo");
  const placementService = createStudentCreditPlacementServiceWithDefaults();

  let assignment = await arepo.getActiveAssignmentForStudent(studentId);
  if (assignment && assignment.programVersionId !== program.programVersionId) throw new Error("DEMO_STUDENT_HAS_OTHER_PROGRAM");
  if (!assignment) assignment = await academic.assignProgram({ studentId, programVersionId: program.programVersionId, assignedBy: actorId, cohortLabel: "DEMO cohort (synthetic)", reason: DEMO_TAG });

  const placed = new Set((await prepo.listPlacementsForAssignment(assignment.id)).filter((p) => p.placement.status === "active").map((p) => p.placement.studentCreditDecisionId));
  for (const src of [DEMO_TRANSFER, DEMO_WORKPLACE]) {
    let source = (await arepo.listSourcesForStudent(studentId)).find((s) => s.title === src.title);
    if (!source) source = await academic.createAcademicSource({ studentId, sourceType: src.sourceType, title: src.title, sourceDate: src.sourceDate, receivedAt: new Date(`${src.sourceDate}T12:00:00Z`), createdBy: actorId });
    const existing = await arepo.listCreditRecordsBySource(source.id);
    for (const c of src.credits) {
      let record = existing.find((r) => r.sourceLineKey === c.line);
      if (!record) record = await academic.createCreditRecord({ sourceId: source.id, recordType: "course", sourceLineKey: c.line, rawCourseCode: c.code, rawTitle: c.title, rawCredits: String(c.credits), term: null, completedOn: src.sourceDate, createdBy: actorId });
      if (record.status !== "verified") await academic.recordCreditVerification({ creditRecordId: record.id, action: "verified", reviewerId: actorId, rationale: DEMO_TAG });
      let decision = await arepo.getLatestDecision(record.id, assignment.id);
      if (decision?.action !== "accepted") decision = await academic.recordCreditDecision({ creditRecordId: record.id, programAssignmentId: assignment.id, action: "accepted", creditsAwarded: String(c.credits), decidedBy: actorId, rationale: DEMO_TAG });
      if (!placed.has(decision.id)) {
        await placementService.createPlacement({ studentCreditDecisionId: decision.id, programAssignmentId: assignment.id, requirementId: program.requirementIds[c.requirement]!, actor: actorId, rationale: DEMO_TAG, metadata: { synthetic: true } });
        placed.add(decision.id);
      }
    }
    if (source.status === "received") source = await academic.transitionAcademicSource({ sourceId: source.id, newStatus: "extracted", reason: DEMO_TAG });
    if (source.status === "extracted") await academic.transitionAcademicSource({ sourceId: source.id, newStatus: "verified", reason: DEMO_TAG });
  }
  return { assignmentId: assignment.id };
}

/** Published roadmap through the real staff path (import package -> draft -> acknowledge -> publish), then the
 *  student's own progress reports. */
export async function ensureDemoRoadmap(studentId: string, studentUserId: string, actorId: string) {
  const { defaultStudentRoadmapService: roadmap } = await import("../../server/services/student-roadmap-service.default");
  const { convertImportPackage } = await import("../../server/services/roadmap-import");
  let state = await roadmap.getAdminState(studentId);
  if (!state.published) {
    if (!state.draft) {
      const pkg = { format: "lumiere-roadmap-package/1", generator: { name: "DEMO cohort provisioning (synthetic)" }, content: makeBachelorsContent(), itemAnnotations: [], creditClaims: [] };
      const json = JSON.stringify(pkg);
      await roadmap.createDraftFromConversion(studentId, actorId, { conversion: convertImportPackage(pkg), fileSha256: sha256(json), fileName: "DEMO-bachelors-plan.json" }, { replaceDraft: false });
      state = await roadmap.getAdminState(studentId);
    }
    const draft = state.draft!;
    const acked = new Set(draft.acknowledgements.map((a) => a.exceptionKey));
    const keys = draft.exceptions.filter((e) => e.severity === "warning" && !acked.has(e.key)).map((e) => e.key);
    if (keys.length) state = await roadmap.acknowledge(studentId, actorId, draft.draftRevision, keys, `${DEMO_TAG} — reviewed (synthetic plan)`);
    state = await roadmap.publish(studentId, actorId, state.draft!.draftRevision, null);
  }
  // Progress, only where nothing was reported yet (revision 0), so a re-run changes nothing.
  const view = await roadmap.getStudentView(studentId);
  const items = new Map(view.phases.flatMap((p) => p.items).map((i) => [i.key, i]));
  for (const r of DEMO_PROGRESS) {
    const item = items.get(r.item);
    if (!item) continue;
    const revision = r.task === null ? item.itemRevision : item.tasks.find((t) => t.key === r.task)?.revision ?? 0;
    if (revision !== 0) continue;
    await roadmap.reportProgress(studentId, studentUserId, { itemKey: r.item, taskKey: r.task, status: r.status as never, expectedRevision: 0 });
  }
}

/** Everything degree-related for the bachelor's persona. Each part is reported separately by the caller's step(). */
export async function seedBachelorsDegree(
  step: (name: string, fn: () => Promise<unknown>) => Promise<void>,
  studentId: string, studentUserId: string, actorId: string,
) {
  let program: Awaited<ReturnType<typeof ensureDemoProgram>> | null = null;
  let recorded = false;
  await step("degreeProgram", async () => { program = await ensureDemoProgram(actorId); });
  if (!program) return;
  await step("academicRecord", async () => { await ensureDemoAcademicRecord(studentId, actorId, program!); recorded = true; });
  if (!recorded) return;
  await step("roadmap", () => ensureDemoRoadmap(studentId, studentUserId, actorId));
}
