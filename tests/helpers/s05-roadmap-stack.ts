/**
 * S05 round-2 integration helpers: wires the REAL repository + service against
 * the disposable Postgres cluster.
 *
 * `DATABASE_URL` is set before server/lib/db.ts is imported (db.ts reads the
 * variable at module load). Callers must never statically import server
 * modules; use `bootRoadmapStack(pg)` from beforeAll.
 */
import crypto from "node:crypto";
import type {
  AdminRoadmapState,
  RoadmapContent,
  StudentRoadmapView,
} from "../../shared/student-roadmap-contract";
import type { StudentDegreeProgressView } from "../../shared/student-degree-progress-view";
import type { LocalPg } from "./s05-local-pg";

export const sha256 = (data: Buffer | string): string => crypto.createHash("sha256").update(data).digest("hex");

/** Tables the student must never be able to influence (canonical credit). */
export const CANONICAL_TABLES = [
  "student_credit_records",
  "student_credit_decisions",
  "student_credit_verification_events",
  "student_program_assignments",
] as const;

export interface CanonicalSnapshot {
  readonly [table: string]: { readonly count: number; readonly digest: string };
}

export async function snapshotCanonical(pg: LocalPg): Promise<CanonicalSnapshot> {
  const out: Record<string, { count: number; digest: string }> = {};
  for (const t of CANONICAL_TABLES) {
    const [row] = await pg.sql(
      `select count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as d from ${t} x`,
    );
    out[t] = { count: Number(row.n), digest: String(row.d) };
  }
  return out;
}

export async function bootRoadmapStack(pg: LocalPg) {
  process.env.DATABASE_URL = pg.url;
  const { db } = await import("../../server/lib/db");
  const { roadmapRepository } = await import("../../server/repositories/student-roadmap-repo");
  const { createStudentRoadmapService, RoadmapError } = await import("../../server/services/student-roadmap-service");
  const { diffRoadmapContent, validateRoadmapContent } = await import("../../shared/student-roadmap-validation");
  const { loadStudentDegreeProgressView } = await import("../../server/routes/student-degree-progress");
  const { convertWorkbook, convertImportPackage } = await import("../../server/services/roadmap-import");

  /** studentId -> synthetic canonical view. Students not listed use the REAL canonical loader. */
  const injectedFoundations = new Map<string, StudentDegreeProgressView>();
  let clock = Date.UTC(2026, 9, 26, 12, 0, 0);

  const service = createStudentRoadmapService({
    repo: roadmapRepository,
    transaction: (fn) => db.transaction((tx) => fn(tx as never)),
    readTx: db,
    loadDegreeProgress: async (studentId) =>
      injectedFoundations.get(studentId) ?? (await loadStudentDegreeProgressView(studentId)),
    validate: validateRoadmapContent,
    diff: diffRoadmapContent,
    now: () => new Date((clock += 1000)),
  });

  const importWorkbook = (studentId: string, actorId: string, buffer: Buffer, fileName: string, replaceDraft = false) =>
    convertWorkbook(buffer, { fileName }).then((conversion) =>
      service.createDraftFromConversion(
        studentId,
        actorId,
        { conversion, fileSha256: sha256(buffer), fileName },
        { replaceDraft },
      ),
    );

  /** Acknowledges every unacknowledged warning of the open draft. */
  const ackAll = async (studentId: string, actorId: string): Promise<AdminRoadmapState> => {
    const state = await service.getAdminState(studentId);
    const draft = state.draft!;
    const acked = new Set(draft.acknowledgements.map((a) => a.exceptionKey));
    const keys = draft.exceptions.filter((e) => e.severity === "warning" && !acked.has(e.key)).map((e) => e.key);
    if (keys.length === 0) return state;
    return service.acknowledge(studentId, actorId, draft.draftRevision, keys, "reviewed in integration test");
  };

  const publishOpenDraft = async (studentId: string, actorId: string): Promise<AdminRoadmapState> => {
    const state = await service.getAdminState(studentId);
    return service.publish(studentId, actorId, state.draft!.draftRevision, state.published?.versionId ?? null);
  };

  const importAckPublish = async (studentId: string, actorId: string, buffer: Buffer, fileName: string) => {
    await importWorkbook(studentId, actorId, buffer, fileName);
    await ackAll(studentId, actorId);
    return publishOpenDraft(studentId, actorId);
  };

  return {
    db,
    service,
    RoadmapError,
    convertWorkbook,
    convertImportPackage,
    injectedFoundations,
    importWorkbook,
    ackAll,
    publishOpenDraft,
    importAckPublish,
    /** server/lib/db.ts exposes only a Proxy (no handle to end the pool); the cluster is stopped with -m immediate. */
    async close() {},
  };
}

export type RoadmapStack = Awaited<ReturnType<typeof bootRoadmapStack>>;

/** First planned/hold item (optionally with tasks) of a content document. */
export function reportableItems(content: RoadmapContent) {
  return content.items.filter((i) => i.planStatus === "planned" || i.planStatus === "hold");
}

export function findItem(view: StudentRoadmapView, key: string) {
  for (const phase of view.phases) {
    const item = phase.items.find((i) => i.key === key);
    if (item) return item;
  }
  return undefined;
}

export const numEq = (a: string | null | undefined, b: string | number) => Number(a) === Number(b);
