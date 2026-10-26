/**
 * Student Roadmap Service (S05).
 *
 * Business logic for the Lumière-assigned roadmap. Staff import / edit /
 * acknowledge / publish; students only report coursework activity against the
 * CURRENT PUBLISHED version. Credit is never created, awarded or recomputed
 * here: the foundation and official standings come only from the canonical S04
 * StudentDegreeProgressView.
 *
 * Every mutation runs in ONE transaction and locks the plan row first, so
 * publish / import / edit / progress for one student are serialized. All
 * collaborators are injected, so the service is unit-testable without a DB and
 * runs unchanged against Postgres (see defaultStudentRoadmapService).
 */
import {
  ITEM_LEVEL_TASK_KEY,
  roadmapContentSchema,
  studentItemStatusSchema,
  studentProgressUpdateSchema,
  roadmapReportBlockedReason,
  studentTaskStatusSchema,
  type AdminRoadmapDraftView,
  type AdminRoadmapState,
  type AdminRoadmapVersionSummary,
  type ConversionResult,
  type ConversionSourceSummary,
  type DiffRoadmapContent,
  type RoadmapContent,
  type RoadmapDiff,
  type RoadmapErrorCode,
  type RoadmapException,
  type RoadmapExceptionAcknowledgement,
  type RoadmapExceptionCode,
  type RoadmapProgressRecord,
  type StudentProgressUpdate,
  type StudentRoadmapView,
  type ValidateRoadmapContent,
} from "@shared/student-roadmap-contract";
import { projectStudentRoadmap } from "@shared/student-roadmap-projection";
import { reviewRoadmapPlan } from "@shared/student-roadmap-plan-review";
import type { StudentDegreeProgressView } from "@shared/student-degree-progress-view";
import type { ImportRow, PlanRow, ProgressRow, RoadmapRepository, Tx, VersionRow } from "../repositories/student-roadmap-repo";

// ── Errors ───────────────────────────────────────────────────────────────────

export class RoadmapError extends Error {
  constructor(
    readonly code: RoadmapErrorCode,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RoadmapError";
  }
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface StudentRoadmapServiceDeps {
  readonly repo: RoadmapRepository;
  /** Runs fn in ONE database transaction. */
  readonly transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  /** Handle used for read-only operations. */
  readonly readTx: Tx;
  /** Canonical S04 view for a student (never throws NOT_FOUND; null = none). */
  readonly loadDegreeProgress: (studentId: string) => Promise<StudentDegreeProgressView | null>;
  readonly validate: ValidateRoadmapContent;
  readonly diff: DiffRoadmapContent;
  readonly now: () => Date;
}

export interface ImportInput {
  readonly conversion: ConversionResult;
  readonly fileSha256: string;
  readonly fileName: string | null;
}

export interface ImportOptions {
  readonly replaceDraft: boolean;
}

export interface ImportOutcome {
  readonly state: AdminRoadmapState;
  /** True when the same import already existed and no new version was made. */
  readonly replay: boolean;
}

// ── Exceptions helpers ───────────────────────────────────────────────────────

/** Exception codes produced by conversion (kept across edits). Everything else is re-derived. */
const CONVERSION_CODES: ReadonlySet<RoadmapExceptionCode> = new Set<RoadmapExceptionCode>([
  "UNKNOWN_TEMPLATE",
  "MISSING_REQUIRED_COLUMN",
  "UNMAPPED_COLUMN",
  "ROW_SKIPPED",
  "MISSING_TITLE",
  "INVALID_DATE",
  "INVALID_CREDITS",
  "INVALID_TASK_COUNT",
  "PHASE_CREATED_FROM_ROW",
  "OBJECTIVE_CREATED_FROM_ROW",
  "GENERATED_ITEM_KEY",
  "AI_LOW_CONFIDENCE",
  "AI_CREDIT_CLAIM_IGNORED",
  "CONDITIONAL_ALLOCATION",
  "PACKAGE_INVALID",
]);

function dedupe(exceptions: readonly RoadmapException[]): RoadmapException[] {
  const seen = new Set<string>();
  const out: RoadmapException[] = [];
  for (const e of exceptions) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    out.push(e);
  }
  return out;
}

function isPublishable(
  exceptions: readonly RoadmapException[],
  acknowledgements: readonly RoadmapExceptionAcknowledgement[],
): boolean {
  const acked = new Set(acknowledgements.map((a) => a.exceptionKey));
  return exceptions.every((e) => e.severity === "info" || (e.severity === "warning" && acked.has(e.key)));
}

const asExceptions = (value: unknown): RoadmapException[] => (Array.isArray(value) ? (value as RoadmapException[]) : []);
const asAcks = (value: unknown): RoadmapExceptionAcknowledgement[] =>
  Array.isArray(value) ? (value as RoadmapExceptionAcknowledgement[]) : [];
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function progressKeysOf(rows: readonly ProgressRow[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.status === "not_started") continue;
    let set = map.get(row.itemKey);
    if (!set) map.set(row.itemKey, (set = new Set()));
    set.add(row.taskKey);
  }
  return map;
}

function toProgressRecords(rows: readonly ProgressRow[]): RoadmapProgressRecord[] {
  return rows.map((r) => ({
    itemKey: r.itemKey,
    taskKey: r.taskKey,
    status: r.status as RoadmapProgressRecord["status"],
    revision: r.revision,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

function parseContent(value: unknown): RoadmapContent {
  const parsed = roadmapContentSchema.safeParse(value);
  if (!parsed.success) {
    throw new RoadmapError("ROADMAP_VALIDATION_ERROR", 400, "Roadmap content is not valid", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return parsed.data;
}

// ── Service ──────────────────────────────────────────────────────────────────

export function createStudentRoadmapService(deps: StudentRoadmapServiceDeps) {
  const { repo } = deps;

  async function requireStudent(studentId: string, tx: Tx): Promise<void> {
    if (!(await repo.studentExists(studentId, tx))) {
      throw new RoadmapError("ROADMAP_STUDENT_NOT_FOUND", 404, "Student not found");
    }
  }

  function summaryOf(v: VersionRow): AdminRoadmapVersionSummary {
    const content = v.content as { title?: unknown } | null;
    return {
      versionId: v.id,
      versionNumber: v.versionNumber,
      status: v.status,
      title: typeof content?.title === "string" ? content.title : "",
      createdAt: v.createdAt.toISOString(),
      createdBy: v.createdBy ?? null,
      publishedAt: iso(v.publishedAt),
      publishedBy: v.publishedBy ?? null,
      importId: v.importId ?? null,
    };
  }

  /** Re-derives validation + diff exceptions; keeps conversion exceptions from `stored`. */
  function evaluate(
    content: RoadmapContent,
    conversionExceptions: readonly RoadmapException[],
    published: VersionRow | null,
    progress: readonly ProgressRow[],
    foundation: StudentDegreeProgressView | null,
  ): { exceptions: RoadmapException[]; diff: RoadmapDiff } {
    const { diff, exceptions: diffExceptions } = deps.diff(
      published ? (published.content as RoadmapContent) : null,
      content,
      progressKeysOf(progress),
      published ? published.versionNumber : null,
    );
    return {
      exceptions: dedupe([
        ...conversionExceptions,
        ...deps.validate(content),
        ...diffExceptions,
        // S07 plan review: re-derived on every evaluation, never persisted as a conversion finding.
        ...reviewRoadmapPlan(content, {
          today: deps.now().toISOString().slice(0, 10),
          foundation,
          progressKeys: progressKeysOf(progress),
        }),
      ]),
      diff,
    };
  }

  /**
   * Canonical foundation for plan review. Loaded BEFORE a transaction opens (it
   * uses its own connection) and only ever read; a failure degrades to null,
   * which makes plan review more conservative (reported credits unverified).
   */
  async function loadFoundation(studentId: string): Promise<StudentDegreeProgressView | null> {
    try {
      return await deps.loadDegreeProgress(studentId);
    } catch {
      return null;
    }
  }

  const conversionPart = (stored: unknown): RoadmapException[] =>
    asExceptions(stored).filter((e) => CONVERSION_CODES.has(e.code));

  /**
   * After a staff edit, a blocking conversion finding can no longer be proven
   * open (the edited content is re-validated on its own), but it must not
   * silently disappear: it becomes a warning that staff acknowledge once the
   * draft reflects the workbook correctly.
   */
  const editedConversionPart = (stored: unknown): RoadmapException[] =>
    conversionPart(stored).map((e) => (e.severity === "blocking"
      ? { ...e, severity: "warning" as const, message: `${e.message} (draft edited by staff after import: acknowledge once corrected)` }
      : e));

  async function buildState(studentId: string, plan: PlanRow | null, tx: Tx): Promise<AdminRoadmapState> {
    if (!plan) return { studentId, planId: null, published: null, draft: null, versions: [] };
    const versions = await repo.listVersions(plan.id, tx);
    const published = versions.find((v) => v.id === plan.publishedVersionId) ?? null;
    const draftRow = versions.find((v) => v.status === "draft") ?? null;
    let draft: AdminRoadmapDraftView | null = null;
    if (draftRow) {
      const progress = await repo.listProgress(studentId, tx);
      const content = draftRow.content as RoadmapContent;
      const { exceptions, diff } = evaluate(content, conversionPart(draftRow.exceptions), published, progress, await loadFoundation(studentId));
      const keys = new Set(exceptions.map((e) => e.key));
      const acknowledgements = asAcks(draftRow.acknowledgements).filter((a) => keys.has(a.exceptionKey));
      const importRow = draftRow.importId ? await repo.getImport(draftRow.importId, tx) : null;
      draft = {
        versionId: draftRow.id,
        versionNumber: draftRow.versionNumber,
        draftRevision: draftRow.draftRevision,
        baseVersionId: draftRow.baseVersionId ?? null,
        content,
        exceptions,
        acknowledgements,
        diff,
        import: importRow
          ? {
              importId: importRow.id,
              templateId: importRow.templateId,
              fileName: importRow.fileName ?? null,
              fileSha256: importRow.fileSha256,
              summary: importRow.summary as ConversionSourceSummary,
            }
          : null,
        publishable: isPublishable(exceptions, acknowledgements),
      };
    }
    return {
      studentId,
      planId: plan.id,
      published: published ? { ...summaryOf(published), content: published.content as RoadmapContent } : null,
      draft,
      versions: versions.map(summaryOf).sort((a, b) => b.versionNumber - a.versionNumber),
    };
  }

  async function requireDraft(plan: PlanRow, tx: Tx, expectedDraftRevision: number): Promise<VersionRow> {
    const draft = await repo.getOpenDraft(plan.id, tx);
    if (!draft) throw new RoadmapError("ROADMAP_NO_DRAFT", 404, "There is no open draft");
    if (draft.draftRevision !== expectedDraftRevision) {
      throw new RoadmapError("ROADMAP_STALE_DRAFT", 409, "The draft changed since you loaded it", {
        currentDraftRevision: draft.draftRevision,
      });
    }
    return draft;
  }

  async function lockedPlan(studentId: string, tx: Tx): Promise<PlanRow> {
    await requireStudent(studentId, tx);
    return repo.ensureAndLockPlan(studentId, tx);
  }

  async function publishedOf(plan: PlanRow, tx: Tx): Promise<VersionRow | null> {
    return plan.publishedVersionId ? repo.getVersion(plan.publishedVersionId, tx) : null;
  }

  // ── Student view ───────────────────────────────────────────────────────────

  async function projectFor(
    studentId: string,
    plan: PlanRow | null,
    version: { content: RoadmapContent; versionNumber: number; publishedAt: Date | null } | null,
    preview: boolean,
  ): Promise<StudentRoadmapView> {
    const tx = deps.readTx;
    const progress = await repo.listProgress(studentId, tx);
    const degreeProgress = await deps.loadDegreeProgress(studentId);
    const versions = plan ? await repo.listVersions(plan.id, tx) : [];
    const previousVersions = versions
      .filter((v) => v.status === "superseded")
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map((v) => ({ versionNumber: v.versionNumber, publishedAt: iso(v.publishedAt), supersededAt: iso(v.supersededAt) }));
    const base = {
      content: version?.content ?? null,
      versionNumber: version?.versionNumber ?? 0,
      publishedAt: iso(version?.publishedAt ?? null),
      preview,
      progress: toProgressRecords(progress),
      degreeProgress,
      previousVersions,
    };
    const view = projectStudentRoadmap(base);
    if (view.history.retiredProgress.length === 0) return view;
    // Titles of retired items come from the newest older version that had them.
    const retiredTitles: Record<string, string> = {};
    const wanted = new Set(view.history.retiredProgress.map((r) => r.itemKey));
    for (const v of versions) {
      const items = (v.content as RoadmapContent | null)?.items ?? [];
      for (const item of items) {
        if (wanted.has(item.key) && !(item.key in retiredTitles)) retiredTitles[item.key] = item.title;
      }
    }
    return projectStudentRoadmap({ ...base, retiredTitles });
  }

  async function getStudentView(studentId: string): Promise<StudentRoadmapView> {
    const plan = await repo.getPlan(studentId, deps.readTx);
    const published = plan ? await publishedOf(plan, deps.readTx) : null;
    return projectFor(
      studentId,
      plan,
      published
        ? { content: published.content as RoadmapContent, versionNumber: published.versionNumber, publishedAt: published.publishedAt ?? null }
        : null,
      false,
    );
  }

  // ── Staff operations ───────────────────────────────────────────────────────

  async function getAdminState(studentId: string): Promise<AdminRoadmapState> {
    await requireStudent(studentId, deps.readTx);
    const plan = await repo.getPlan(studentId, deps.readTx);
    return buildState(studentId, plan, deps.readTx);
  }

  async function createDraftFromConversion(
    studentId: string,
    actorId: string,
    input: ImportInput,
    options: ImportOptions,
  ): Promise<ImportOutcome> {
    type TxResult =
      | { kind: "ok"; plan: PlanRow; replay: boolean }
      | { kind: "unreadable"; importId: string; exceptions: readonly RoadmapException[]; templateId: string; summary: ConversionSourceSummary };

    const { conversion } = input;
    let parsed: RoadmapContent | null = null;
    let conversionExceptions: RoadmapException[] = [...conversion.exceptions];
    if (conversion.content) {
      const result = roadmapContentSchema.safeParse(conversion.content);
      if (result.success) parsed = result.data;
      else {
        conversionExceptions = [
          ...conversionExceptions,
          {
            key: "PACKAGE_INVALID:schema",
            code: "PACKAGE_INVALID",
            severity: "blocking",
            message: `Converted content does not match the roadmap schema: ${result.error.issues
              .slice(0, 3)
              .map((i) => `${i.path.join(".")} ${i.message}`)
              .join("; ")}`,
            ref: { path: result.error.issues[0]?.path.join(".") },
          },
        ];
      }
    }

    const foundation = await loadFoundation(studentId);
    const outcome = await deps.transaction<TxResult>(async (tx) => {
      const plan = await lockedPlan(studentId, tx);
      const published = await publishedOf(plan, tx);
      const baseVersionId = published?.id ?? null;
      const existing = await repo.findImport(plan.id, input.fileSha256, baseVersionId, tx);

      if (existing?.resultingVersionId) {
        const resulting = await repo.getVersion(existing.resultingVersionId, tx);
        if (resulting && resulting.status === "draft") return { kind: "ok", plan, replay: true };
      }

      const openDraft = await repo.getOpenDraft(plan.id, tx);
      const now = deps.now();

      const writeImport = async (resultingVersionId: string | null): Promise<ImportRow> => {
        const fields = {
          planId: plan.id,
          studentId,
          fileSha256: input.fileSha256,
          fileName: input.fileName,
          templateId: conversion.templateId,
          baseVersionId,
          summary: conversion.summary,
          exceptions: conversionExceptions,
          resultingVersionId,
          createdBy: actorId,
        };
        return existing ? repo.updateImport(existing.id, fields, tx) : repo.insertImport(fields, tx);
      };

      if (!parsed) {
        const row = await writeImport(null);
        return {
          kind: "unreadable",
          importId: row.id,
          exceptions: conversionExceptions,
          templateId: conversion.templateId,
          summary: conversion.summary,
        };
      }

      if (openDraft) {
        if (!options.replaceDraft) {
          throw new RoadmapError("ROADMAP_DRAFT_EXISTS", 409, "An open draft already exists for this student", {
            draftVersionId: openDraft.id,
            draftRevision: openDraft.draftRevision,
          });
        }
        await repo.updateVersion(openDraft.id, { status: "discarded", discardedAt: now }, tx);
      }

      const importRow = await writeImport(null);
      const progress = await repo.listProgress(studentId, tx);
      const { exceptions } = evaluate(parsed, conversionExceptions, published, progress, foundation);
      const version = await repo.insertVersion(
        {
          planId: plan.id,
          versionNumber: await repo.nextVersionNumber(plan.id, tx),
          content: parsed,
          baseVersionId,
          importId: importRow.id,
          exceptions,
          acknowledgements: [],
          createdBy: actorId,
        },
        tx,
      );
      await repo.updateImport(importRow.id, { resultingVersionId: version.id }, tx);
      return { kind: "ok", plan, replay: false };
    });

    if (outcome.kind === "unreadable") {
      throw new RoadmapError("ROADMAP_IMPORT_UNREADABLE", 422, "The file could not be converted into a roadmap", {
        importId: outcome.importId,
        templateId: outcome.templateId,
        summary: outcome.summary,
        exceptions: outcome.exceptions,
      });
    }
    const state = await buildState(studentId, outcome.plan, deps.readTx);
    return { state, replay: outcome.replay };
  }

  async function updateDraft(
    studentId: string,
    actorId: string,
    expectedDraftRevision: number,
    contentInput: unknown,
  ): Promise<AdminRoadmapState> {
    const content = parseContent(contentInput);
    const foundation = await loadFoundation(studentId);
    const plan = await deps.transaction(async (tx) => {
      const plan = await lockedPlan(studentId, tx);
      const draft = await requireDraft(plan, tx, expectedDraftRevision);
      const published = await publishedOf(plan, tx);
      const progress = await repo.listProgress(studentId, tx);
      const { exceptions } = evaluate(content, editedConversionPart(draft.exceptions), published, progress, foundation);
      const keys = new Set(exceptions.map((e) => e.key));
      await repo.updateVersion(
        draft.id,
        {
          content,
          exceptions,
          acknowledgements: asAcks(draft.acknowledgements).filter((a) => keys.has(a.exceptionKey)),
          draftRevision: draft.draftRevision + 1,
        },
        tx,
      );
      void actorId;
      return plan;
    });
    return buildState(studentId, plan, deps.readTx);
  }

  async function acknowledge(
    studentId: string,
    actorId: string,
    expectedDraftRevision: number,
    exceptionKeys: readonly string[],
    note?: string | null,
  ): Promise<AdminRoadmapState> {
    const foundation = await loadFoundation(studentId);
    const plan = await deps.transaction(async (tx) => {
      const plan = await lockedPlan(studentId, tx);
      const draft = await requireDraft(plan, tx, expectedDraftRevision);
      const published = await publishedOf(plan, tx);
      const progress = await repo.listProgress(studentId, tx);
      const { exceptions } = evaluate(draft.content as RoadmapContent, conversionPart(draft.exceptions), published, progress, foundation);
      const byKey = new Map(exceptions.map((e) => [e.key, e]));
      const invalid = exceptionKeys.filter((k) => byKey.get(k)?.severity !== "warning");
      if (invalid.length > 0) {
        throw new RoadmapError(
          "ROADMAP_VALIDATION_ERROR",
          400,
          "Only existing warning exceptions can be acknowledged",
          { exceptionKeys: invalid },
        );
      }
      const stamp = deps.now().toISOString();
      const requested = new Set(exceptionKeys);
      const acknowledgements: RoadmapExceptionAcknowledgement[] = [
        ...asAcks(draft.acknowledgements).filter((a) => byKey.has(a.exceptionKey) && !requested.has(a.exceptionKey)),
        ...[...requested].map((exceptionKey) => ({
          exceptionKey,
          acknowledgedBy: actorId,
          acknowledgedAt: stamp,
          note: note ?? null,
        })),
      ];
      await repo.updateVersion(
        draft.id,
        { exceptions, acknowledgements, draftRevision: draft.draftRevision + 1 },
        tx,
      );
      return plan;
    });
    return buildState(studentId, plan, deps.readTx);
  }

  async function previewDraft(studentId: string): Promise<StudentRoadmapView> {
    await requireStudent(studentId, deps.readTx);
    const plan = await repo.getPlan(studentId, deps.readTx);
    const draft = plan ? await repo.getOpenDraft(plan.id, deps.readTx) : null;
    if (!plan || !draft) throw new RoadmapError("ROADMAP_NO_DRAFT", 404, "There is no open draft");
    return projectFor(
      studentId,
      plan,
      { content: draft.content as RoadmapContent, versionNumber: draft.versionNumber, publishedAt: null },
      true,
    );
  }

  async function publish(
    studentId: string,
    actorId: string,
    expectedDraftRevision: number,
    expectedPublishedVersionId: string | null,
  ): Promise<AdminRoadmapState> {
    const foundation = await loadFoundation(studentId);
    const plan = await deps.transaction(async (tx) => {
      const plan = await lockedPlan(studentId, tx);
      const draft = await repo.getOpenDraft(plan.id, tx);
      if (!draft) throw new RoadmapError("ROADMAP_NO_DRAFT", 404, "There is no open draft");
      const currentPublishedId = plan.publishedVersionId ?? null;
      if (
        draft.draftRevision !== expectedDraftRevision
        || currentPublishedId !== (expectedPublishedVersionId ?? null)
        || (draft.baseVersionId ?? null) !== currentPublishedId
      ) {
        throw new RoadmapError("ROADMAP_STALE_DRAFT", 409, "The draft or the published roadmap changed; reload before publishing", {
          currentDraftRevision: draft.draftRevision,
          currentPublishedVersionId: currentPublishedId,
        });
      }
      const published = await publishedOf(plan, tx);
      const progress = await repo.listProgress(studentId, tx);
      const content = parseContent(draft.content);
      const { exceptions } = evaluate(content, conversionPart(draft.exceptions), published, progress, foundation);
      const keys = new Set(exceptions.map((e) => e.key));
      const acknowledgements = asAcks(draft.acknowledgements).filter((a) => keys.has(a.exceptionKey));
      if (!isPublishable(exceptions, acknowledgements)) {
        const acked = new Set(acknowledgements.map((a) => a.exceptionKey));
        throw new RoadmapError("ROADMAP_NOT_PUBLISHABLE", 422, "Resolve blocking exceptions and acknowledge warnings before publishing", {
          blocking: exceptions.filter((e) => e.severity === "blocking"),
          unacknowledged: exceptions.filter((e) => e.severity === "warning" && !acked.has(e.key)),
        });
      }
      const now = deps.now();
      if (published) await repo.updateVersion(published.id, { status: "superseded", supersededAt: now }, tx);
      await repo.updateVersion(
        draft.id,
        { status: "published", publishedBy: actorId, publishedAt: now, exceptions, acknowledgements },
        tx,
      );
      return repo.setPublished(plan.id, draft.id, now, tx);
    });
    return buildState(studentId, plan, deps.readTx);
  }

  async function discardDraft(
    studentId: string,
    actorId: string,
    expectedDraftRevision: number,
  ): Promise<AdminRoadmapState> {
    const plan = await deps.transaction(async (tx) => {
      const plan = await lockedPlan(studentId, tx);
      const draft = await requireDraft(plan, tx, expectedDraftRevision);
      await repo.updateVersion(draft.id, { status: "discarded", discardedAt: deps.now() }, tx);
      void actorId;
      return plan;
    });
    return buildState(studentId, plan, deps.readTx);
  }

  async function draftFromPublished(studentId: string, actorId: string): Promise<AdminRoadmapState> {
    const foundation = await loadFoundation(studentId);
    const plan = await deps.transaction(async (tx) => {
      const plan = await lockedPlan(studentId, tx);
      const published = await publishedOf(plan, tx);
      if (!published) throw new RoadmapError("ROADMAP_NOT_FOUND", 404, "There is no published roadmap to copy");
      const open = await repo.getOpenDraft(plan.id, tx);
      if (open) {
        throw new RoadmapError("ROADMAP_DRAFT_EXISTS", 409, "An open draft already exists for this student", {
          draftVersionId: open.id,
          draftRevision: open.draftRevision,
        });
      }
      const progress = await repo.listProgress(studentId, tx);
      const content = published.content as RoadmapContent;
      const { exceptions } = evaluate(content, [], published, progress, foundation);
      await repo.insertVersion(
        {
          planId: plan.id,
          versionNumber: await repo.nextVersionNumber(plan.id, tx),
          content,
          baseVersionId: published.id,
          importId: null,
          exceptions,
          acknowledgements: [],
          createdBy: actorId,
        },
        tx,
      );
      return plan;
    });
    return buildState(studentId, plan, deps.readTx);
  }

  // ── Student progress ───────────────────────────────────────────────────────

  async function reportProgress(
    studentId: string,
    actorUserId: string,
    updateInput: StudentProgressUpdate,
  ): Promise<StudentRoadmapView> {
    const parsedUpdate = studentProgressUpdateSchema.safeParse(updateInput);
    if (!parsedUpdate.success) {
      throw new RoadmapError("ROADMAP_VALIDATION_ERROR", 400, "Invalid progress update", {
        issues: parsedUpdate.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const update = parsedUpdate.data;

    await deps.transaction(async (tx) => {
      const plan = await repo.lockPlan(studentId, tx);
      const published = plan ? await publishedOf(plan, tx) : null;
      if (!plan || !published) {
        throw new RoadmapError("ROADMAP_ITEM_NOT_FOUND", 404, "That item is not part of your current roadmap");
      }
      const content = published.content as RoadmapContent;
      const item = content.items.find((i) => i.key === update.itemKey);
      if (!item || (update.taskKey !== null && !item.tasks.some((t) => t.key === update.taskKey))) {
        throw new RoadmapError("ROADMAP_ITEM_NOT_FOUND", 404, "That item is not part of your current roadmap");
      }
      const blocked = roadmapReportBlockedReason(item);
      if (blocked) {
        throw new RoadmapError("ROADMAP_ITEM_NOT_REPORTABLE", 422, "Progress cannot be reported on this item", {
          reason: blocked,
        });
      }
      const levelSchema = update.taskKey === null ? studentItemStatusSchema : studentTaskStatusSchema;
      if (!levelSchema.safeParse(update.status).success) {
        throw new RoadmapError(
          "ROADMAP_ITEM_NOT_REPORTABLE",
          422,
          update.taskKey === null
            ? "That status cannot be reported for a whole course"
            : "That status cannot be reported for a task",
        );
      }

      const storedTaskKey = update.taskKey ?? ITEM_LEVEL_TASK_KEY;
      const current = await repo.getProgressForUpdate(studentId, update.itemKey, storedTaskKey, tx);
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== update.expectedRevision) {
        throw new RoadmapError("ROADMAP_PROGRESS_CONFLICT", 409, "This item changed since you loaded it", {
          currentRevision,
          currentStatus: current?.status ?? "not_started",
        });
      }
      const revision = currentRevision + 1;
      await repo.upsertProgress(
        {
          studentId,
          itemKey: update.itemKey,
          taskKey: storedTaskKey,
          status: update.status,
          revision,
          updatedBy: actorUserId,
          updatedAt: deps.now(),
          exists: current !== null,
        },
        tx,
      );
      await repo.appendProgressEvent(
        {
          studentId,
          itemKey: update.itemKey,
          taskKey: storedTaskKey,
          fromStatus: current?.status ?? null,
          toStatus: update.status,
          revision,
          planVersionId: published.id,
          actorId: actorUserId,
        },
        tx,
      );
    });

    return getStudentView(studentId);
  }

  return {
    getAdminState,
    createDraftFromConversion,
    updateDraft,
    acknowledge,
    previewDraft,
    publish,
    discardDraft,
    draftFromPublished,
    getStudentView,
    reportProgress,
  };
}

export type StudentRoadmapService = ReturnType<typeof createStudentRoadmapService>;
