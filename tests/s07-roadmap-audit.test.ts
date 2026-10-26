/**
 * S07 roadmap audit events, route level. Real requireAuth + requireRole, real
 * service over the in-memory fake store, and a CAPTURED audit sink (the mocked
 * createAuditLog of server/lib/audit.ts, the single audit infrastructure).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import crypto from "crypto";
import { createFakeRoadmapStore } from "./helpers/fake-roadmap-repo";

const IDS = {
  admin: "00000000-0000-0000-0000-000000000001",
  staff: "00000000-0000-0000-0000-000000000002",
};
const JWT_SECRET = process.env.SESSION_SECRET || "local-dev-secret-change-in-production";

function makeLocalJWT(userId: string, email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    userId, email, iss: "lumiere-local",
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    sub: userId, aud: "authenticated", role: "authenticated",
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const mockGetUser = vi.hoisted(() => vi.fn());
const auditSink = vi.hoisted(() => vi.fn());
vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { auth: { getUser: mockGetUser } },
  isSupabaseConfigured: true,
  createUserAuthClient: () => ({ auth: {} }),
}));
let currentUserRow: unknown[] = [];
vi.mock("../server/lib/db", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => currentUserRow) })) })) })),
  },
}));
vi.mock("../server/lib/audit", () => ({
  auditAdmin: vi.fn().mockResolvedValue(undefined),
  createAuditLog: auditSink,
}));
vi.mock("../server/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const userRows: Record<string, { id: string; email: string; name: string; role: string }> = {
  admin: { id: IDS.admin, email: "admin@test.com", name: "A", role: "admin" },
  staff: { id: IDS.staff, email: "staff@test.com", name: "S", role: "staff" },
};

import { createStudentRoadmapService } from "../server/services/student-roadmap-service";
import { diffRoadmapContent, validateRoadmapContent } from "../shared/student-roadmap-validation";
import { ROADMAP_CONTENT_VERSION, type ConversionResult, type RoadmapContent } from "../shared/student-roadmap-contract";
import { createAdminStudentRoadmapRouter } from "../server/routes/admin-student-roadmap";

const STAFF_SECRET = "STAFF-ONLY-NOTE-xyz";
const STUDENT_NOTE = "Visible note for student";
const FILE_NAME = "private-student-name.xlsx";
const STUDENT_ID = "stu-1";

const roadmap: RoadmapContent = {
  contentVersion: ROADMAP_CONTENT_VERSION,
  title: "Plan",
  objectives: [{ key: "ba", title: "BA", kind: "primary", linkedToProgramAssignment: true, status: "active" }],
  phases: [{ key: "p1", title: "Phase 1", sequence: 1 }],
  items: [{
    key: "eng101", phaseKey: "p1", objectiveKey: "ba", sequence: 1, kind: "course", title: "English", dependsOn: [],
    planStatus: "planned", staffNote: STAFF_SECRET, studentNote: STUDENT_NOTE,
    linkedCreditRecordId: "11111111-1111-4111-8111-111111111111",
    tasks: [{ key: "t1", kind: "paper", title: "Paper", sequence: 1 }],
  }],
  milestones: [],
} as unknown as RoadmapContent;

const conversion: ConversionResult = {
  templateId: "lumiere-roadmap-v1", content: roadmap, exceptions: [],
  summary: { kind: "workbook", fileName: FILE_NAME, sheetsRead: ["Plan"], rowsRead: 1, rowsConverted: 1, rowsSkipped: 0, generator: null },
};

function build() {
  const store = createFakeRoadmapStore([STUDENT_ID]);
  const service = createStudentRoadmapService({
    repo: store.repo, transaction: store.transaction, readTx: store.tx,
    loadDegreeProgress: async () => null, validate: validateRoadmapContent, diff: diffRoadmapContent, now: () => new Date(),
  });
  const app: Express = express();
  app.use(express.json());
  app.use("/api/admin", createAdminStudentRoadmapRouter({
    service,
    convertWorkbook: vi.fn(async () => conversion),
    convertImportPackage: vi.fn(() => conversion),
  }));
  return { app };
}

function as(role: keyof typeof userRows) {
  currentUserRow = [userRows[role]];
  return { Authorization: `Bearer ${makeLocalJWT(userRows[role].id, userRows[role].email)}` };
}

const BASE = `/api/admin/students/${STUDENT_ID}/roadmap`;
interface Counts { blocking: number; warning: number; info: number }
interface AuditCall {
  eventType: string; severity?: string; actorUserId?: string; actorRole?: string; targetUserId?: string;
  targetResourceType?: string; targetResourceId?: string; isEducationalRecord?: boolean;
  metadata: Record<string, unknown> & { studentId: string; exceptionCounts: Counts };
}
const events = () => auditSink.mock.calls.map((c) => c[0] as AuditCall);
const types = () => events().map((e) => e.eventType);

beforeEach(() => {
  vi.clearAllMocks();
  auditSink.mockResolvedValue(undefined);
  mockGetUser.mockResolvedValue({ data: { user: null }, error: "mock-no-supabase" });
});

describe("roadmap audit events (route level)", () => {
  it("records the full draft lifecycle with ids and counts only", async () => {
    const { app } = build();
    const imp = await request(app).post(`${BASE}/imports`).set(as("staff")).send({ format: "pkg" });
    expect(imp.status).toBe(201);
    const replay = await request(app).post(`${BASE}/imports`).set(as("staff")).send({ format: "pkg" });
    expect(replay.status).toBe(200);
    const draft = imp.body.draft;
    const edit = await request(app).put(`${BASE}/draft`).set(as("staff"))
      .send({ expectedDraftRevision: draft.draftRevision, content: { ...draft.content, title: "Edited" } });
    expect(edit.status).toBe(200);
    const pub = await request(app).post(`${BASE}/draft/publish`).set(as("admin"))
      .send({ expectedDraftRevision: edit.body.draft.draftRevision, expectedPublishedVersionId: null });
    expect(pub.status).toBe(200);
    const reopened = await request(app).post(`${BASE}/draft/from-published`).set(as("staff")).send({});
    expect(reopened.status).toBe(200);
    const discarded = await request(app).post(`${BASE}/draft/discard`).set(as("staff"))
      .send({ expectedDraftRevision: reopened.body.draft.draftRevision });
    expect(discarded.status).toBe(200);

    expect(types()).toEqual([
      "roadmap.import_created",
      "roadmap.import_replayed",
      "roadmap.draft_updated",
      "roadmap.published",
      "roadmap.draft_opened_from_published",
      "roadmap.draft_discarded",
    ]);

    const [created, replayed, updated, published, opened, dropped] = events();
    for (const e of events()) {
      expect(e.targetResourceType).toBe("student_roadmap");
      expect(e.targetResourceId).toBe(STUDENT_ID);
      expect(e.targetUserId).toBeUndefined(); // students.id is not a users.id (FK)
      expect(e.metadata.studentId).toBe(STUDENT_ID);
      expect(e.isEducationalRecord).toBe(true);
    }
    expect(created).toMatchObject({ actorUserId: IDS.staff, actorRole: "staff", severity: "info" });
    expect(created.metadata).toMatchObject({
      versionId: draft.versionId,
      versionNumber: 1,
      draftRevision: draft.draftRevision,
      templateId: "lumiere-roadmap-v1",
      replacedDraft: false,
    });
    expect(created.metadata.importSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(created.metadata.exceptionCounts).toEqual({
      blocking: draft.exceptions.filter((x: { severity: string }) => x.severity === "blocking").length,
      warning: draft.exceptions.filter((x: { severity: string }) => x.severity === "warning").length,
      info: draft.exceptions.filter((x: { severity: string }) => x.severity === "info").length,
    });
    expect(replayed.metadata.versionId).toBe(draft.versionId);
    expect(updated.metadata.draftRevision).toBe(edit.body.draft.draftRevision);
    expect(published).toMatchObject({ actorUserId: IDS.admin, actorRole: "admin" });
    expect(published.metadata).toMatchObject({
      versionId: pub.body.published.versionId,
      versionNumber: 1,
      draftRevision: edit.body.draft.draftRevision,
    });
    expect(opened.metadata.baseVersionId).toBe(pub.body.published.versionId);
    expect(dropped.metadata.draftRevision).toBe(reopened.body.draft.draftRevision);
  });

  it("records replaceDraft on a replacing import", async () => {
    const { app } = build();
    await request(app).post(`${BASE}/imports`).set(as("staff")).send({ format: "pkg" });
    auditSink.mockClear();
    const replaced = await request(app).post(`${BASE}/imports?replaceDraft=true`).set(as("staff")).send({ format: "pkg", other: 1 });
    expect(replaced.status).toBe(201);
    expect(events()).toHaveLength(1);
    expect(events()[0].metadata.replacedDraft).toBe(true);
  });

  it("records a rejected stale publish as a warning and does not record it as published", async () => {
    const { app } = build();
    await request(app).post(`${BASE}/imports`).set(as("staff")).send({ format: "pkg" });
    auditSink.mockClear();
    const stale = await request(app).post(`${BASE}/draft/publish`).set(as("admin")).send({ expectedDraftRevision: 7, expectedPublishedVersionId: null });
    expect(stale.status).toBe(409);
    expect(types()).toEqual(["roadmap.publish_rejected"]);
    expect(events()[0]).toMatchObject({ severity: "warning", actorUserId: IDS.admin, actorRole: "admin" });
    expect(events()[0].metadata).toMatchObject({ studentId: STUDENT_ID, draftRevision: 7, rejectionCode: "ROADMAP_STALE_DRAFT", httpStatus: 409 });
  });

  it("does not audit validation failures, authorization denials or unknown students", async () => {
    const { app } = build();
    expect((await request(app).post(`${BASE}/draft/publish`).set(as("admin")).send({ expectedDraftRevision: 0 })).status).toBe(400);
    expect((await request(app).post(`${BASE}/draft/publish`).set(as("staff")).send({ expectedDraftRevision: 0, expectedPublishedVersionId: null })).status).toBe(403);
    expect((await request(app).post(`${BASE}/draft/publish`).set(as("admin")).send({ expectedDraftRevision: 0, expectedPublishedVersionId: null })).status).toBe(404);
    expect(auditSink).not.toHaveBeenCalled();
  });

  it("never records workbook content, notes, file names or the credit link", async () => {
    const { app } = build();
    const imp = await request(app).post(`${BASE}/imports`).set(as("staff")).send({ format: "pkg" });
    await request(app).post(`${BASE}/draft/publish`).set(as("admin"))
      .send({ expectedDraftRevision: imp.body.draft.draftRevision, expectedPublishedVersionId: null });
    const text = JSON.stringify(auditSink.mock.calls);
    for (const secret of [STAFF_SECRET, STUDENT_NOTE, FILE_NAME, "11111111-1111-4111-8111-111111111111", "English", "eng101"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("never breaks the request when the audit sink rejects or throws", async () => {
    const { app } = build();
    auditSink.mockRejectedValue(new Error("audit store down"));
    const imp = await request(app).post(`${BASE}/imports`).set(as("staff")).send({ format: "pkg" });
    expect(imp.status).toBe(201);
    auditSink.mockImplementation(() => { throw new Error("sync boom"); });
    const pub = await request(app).post(`${BASE}/draft/publish`).set(as("admin"))
      .send({ expectedDraftRevision: imp.body.draft.draftRevision, expectedPublishedVersionId: null });
    expect(pub.status).toBe(200);
    expect(pub.body.published.versionNumber).toBe(1);
    expect(auditSink).toHaveBeenCalledTimes(2);
  });
});
