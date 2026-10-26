/**
 * In-memory RoadmapRepository for unit tests: same contract as the drizzle
 * repository (unique constraints, partial uniques, rollback on throw).
 */
import crypto from "crypto";
import type {
  DraftPatch, ImportRow, NewImport, NewProgressEvent, NewVersion, PlanRow, ProgressRow, ProgressUpsert,
  RoadmapRepository, Tx, VersionRow,
} from "../../server/repositories/student-roadmap-repo";

interface State {
  plans: PlanRow[];
  versions: VersionRow[];
  imports: ImportRow[];
  progress: ProgressRow[];
  events: NewProgressEvent[];
}

export function createFakeRoadmapStore(students: string[] = ["stu-1"]) {
  let state: State = { plans: [], versions: [], imports: [], progress: [], events: [] };
  const uuid = () => crypto.randomUUID();
  const clone = <T,>(v: T): T => structuredClone(v);

  const repo: RoadmapRepository = {
    async studentExists(id) { return students.includes(id); },
    async getPlan(studentId) { return clone(state.plans.find((p) => p.studentId === studentId) ?? null); },
    async lockPlan(studentId) { return clone(state.plans.find((p) => p.studentId === studentId) ?? null); },
    async ensureAndLockPlan(studentId) {
      let plan = state.plans.find((p) => p.studentId === studentId);
      if (!plan) {
        plan = { id: uuid(), studentId, publishedVersionId: null, revision: 0, createdAt: new Date(), updatedAt: new Date() };
        state.plans.push(plan);
      }
      return clone(plan);
    },
    async setPublished(planId, versionId, now) {
      const plan = state.plans.find((p) => p.id === planId)!;
      plan.publishedVersionId = versionId;
      plan.revision += 1;
      plan.updatedAt = now;
      return clone(plan);
    },
    async getVersion(id) { return clone(state.versions.find((v) => v.id === id) ?? null); },
    async getOpenDraft(planId) { return clone(state.versions.find((v) => v.planId === planId && v.status === "draft") ?? null); },
    async listVersions(planId) {
      return clone(state.versions.filter((v) => v.planId === planId).sort((a, b) => b.versionNumber - a.versionNumber));
    },
    async nextVersionNumber(planId) {
      return Math.max(0, ...state.versions.filter((v) => v.planId === planId).map((v) => v.versionNumber)) + 1;
    },
    async insertVersion(input: NewVersion) {
      if (state.versions.some((v) => v.planId === input.planId && v.status === "draft")) throw new Error("one draft per plan");
      if (state.versions.some((v) => v.planId === input.planId && v.versionNumber === input.versionNumber)) throw new Error("version unique");
      const row: VersionRow = {
        id: uuid(), planId: input.planId, versionNumber: input.versionNumber, status: "draft", content: clone(input.content),
        baseVersionId: input.baseVersionId, importId: input.importId, draftRevision: 0, exceptions: clone(input.exceptions),
        acknowledgements: clone(input.acknowledgements), createdBy: input.createdBy, createdAt: new Date(),
        publishedBy: null, publishedAt: null, supersededAt: null, discardedAt: null,
      };
      state.versions.push(row);
      return clone(row);
    },
    async updateVersion(id, patch: DraftPatch) {
      const row = state.versions.find((v) => v.id === id)!;
      if ((row.status === "published" || row.status === "superseded") && patch.content !== undefined) throw new Error("immutable");
      if (patch.status === "published" && state.versions.some((v) => v.planId === row.planId && v.status === "published" && v.id !== id)) {
        throw new Error("one published per plan");
      }
      Object.assign(row, clone(patch));
      return clone(row);
    },
    async findImport(planId, sha, baseVersionId) {
      return clone(state.imports.find((i) => i.planId === planId && i.fileSha256 === sha && (i.baseVersionId ?? "") === (baseVersionId ?? "")) ?? null);
    },
    async getImport(id) { return clone(state.imports.find((i) => i.id === id) ?? null); },
    async insertImport(input: NewImport) {
      if (state.imports.some((i) => i.planId === input.planId && i.fileSha256 === input.fileSha256 && (i.baseVersionId ?? "") === (input.baseVersionId ?? ""))) {
        throw new Error("import idempotency unique");
      }
      const row = { id: uuid(), createdAt: new Date(), ...clone(input) } as ImportRow;
      state.imports.push(row);
      return clone(row);
    },
    async updateImport(id, patch) {
      const row = state.imports.find((i) => i.id === id)!;
      Object.assign(row, clone(patch));
      return clone(row);
    },
    async listProgress(studentId) { return clone(state.progress.filter((p) => p.studentId === studentId)); },
    async getProgressForUpdate(studentId, itemKey, taskKey) {
      return clone(state.progress.find((p) => p.studentId === studentId && p.itemKey === itemKey && p.taskKey === taskKey) ?? null);
    },
    async upsertProgress(input: ProgressUpsert) {
      const existing = state.progress.find((p) => p.studentId === input.studentId && p.itemKey === input.itemKey && p.taskKey === input.taskKey);
      if (existing) {
        Object.assign(existing, { status: input.status, revision: input.revision, updatedBy: input.updatedBy, updatedAt: input.updatedAt });
        return clone(existing);
      }
      const row: ProgressRow = {
        id: uuid(), studentId: input.studentId, itemKey: input.itemKey, taskKey: input.taskKey, status: input.status,
        revision: input.revision, updatedBy: input.updatedBy, updatedAt: input.updatedAt,
      };
      state.progress.push(row);
      return clone(row);
    },
    async appendProgressEvent(input) { state.events.push(clone(input)); },
  };

  const tx = {} as Tx;
  return {
    repo,
    tx,
    get state() { return state; },
    /** All-or-nothing, like a database transaction. */
    async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      const snapshot = clone(state);
      try {
        return await fn(tx);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
  };
}
