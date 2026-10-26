/**
 * S07 roadmap audit events through the real HTTP stack: production
 * registerRoutes, real routers/service/repository, real requireAuth/RBAC and the
 * xlsx importer over a disposable Postgres. Only the audit sink is captured.
 */
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  PG_BINARIES_AVAILABLE,
  S05_PG_SKIP_MESSAGE,
  s05MigrationExists,
  seedStudent,
  seedUser,
  startLocalPg,
  type LocalPg,
  type SeededStudent,
  type SeededUser,
} from "./helpers/s05-local-pg";
import { scenarioM } from "./fixtures/s05";

const JWT_SECRET = process.env.SESSION_SECRET || "local-dev-secret-change-in-production";

function makeLocalJWT(userId: string, email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ userId, email, iss: "lumiere-local", exp: now + 3600, iat: now, sub: userId, aud: "authenticated", role: "authenticated" }),
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const auditSink = vi.hoisted(() => vi.fn());
vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: { auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "invalid token" } })) }, from: vi.fn() },
  createUserAuthClient: vi.fn(),
  isSupabaseConfigured: vi.fn(() => false),
}));
vi.mock("../server/lib/audit", () => ({
  auditAdmin: vi.fn().mockResolvedValue(undefined),
  auditAction: vi.fn().mockResolvedValue(undefined),
  createAuditLog: auditSink,
}));

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);
const ready = PG_BINARIES_AVAILABLE && s05MigrationExists();

describe.skipIf(!ready)("S07 roadmap audit — real HTTP stack", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let staff: SeededUser;
  let admin: SeededUser;
  let student: SeededStudent;

  const tok = (u: SeededUser) => ({ Authorization: `Bearer ${makeLocalJWT(u.id, u.email)}` });
  const api = () => request(base);
  const path = (studentId: string, rest = "") => `/api/admin/students/${studentId}/roadmap${rest}`;
  interface AuditCall {
  eventType: string; severity?: string; actorUserId?: string; actorRole?: string; targetResourceId?: string;
  metadata: Record<string, unknown> & { exceptionCounts: { warning: number } };
}
const events = () => auditSink.mock.calls.map((c) => c[0] as AuditCall);

  beforeAll(async () => {
    pg = await startLocalPg();
    process.env.DATABASE_URL = pg.url;
    delete process.env.ALLOW_DEMO_MODE;
    staff = await seedUser(pg, "staff");
    admin = await seedUser(pg, "admin");
    student = await seedStudent(pg, { userId: (await seedUser(pg, "student")).id });

    auditSink.mockResolvedValue(undefined);
    const { registerRoutes } = await import("../server/routes");
    const app = express();
    app.use(/^\/api\/admin\/students\/[^/]+\/roadmap(\/|$)/, express.json({ limit: "2mb" }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pg?.stop();
  }, 60_000);

  it("audits upload, acknowledge, rejected and successful publish with identifiers and counts only", async () => {
    const fileName = scenarioM.workbook.fileName;
    const upload = await api()
      .post(path(student.id, "/imports"))
      .set(tok(staff))
      .attach("workbook", await scenarioM.workbook.build(), { filename: fileName, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    expect(upload.status).toBe(201);
    const draft = upload.body.draft;

    const created = events().find((e) => e.eventType === "roadmap.import_created")!;
    expect(created).toBeDefined();
    expect(created).toMatchObject({ actorUserId: staff.id, actorRole: "staff", targetResourceId: student.id });
    expect(created.metadata).toMatchObject({
      studentId: student.id,
      versionId: draft.versionId,
      versionNumber: 1,
      draftRevision: draft.draftRevision,
      importSha256: draft.import.fileSha256,
      importId: draft.import.importId,
      templateId: "lumiere-roadmap-v1",
    });
    const warnings = draft.exceptions.filter((e: { severity: string }) => e.severity === "warning");
    expect(created.metadata.exceptionCounts.warning).toBe(warnings.length);

    // not publishable while warnings are unacknowledged -> 422 audited as rejected
    expect(warnings.length).toBeGreaterThan(0);
    {
      const early = await api().post(path(student.id, "/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: draft.draftRevision, expectedPublishedVersionId: null });
      expect(early.status).toBe(422);
      const rejected = events().filter((e) => e.eventType === "roadmap.publish_rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0].metadata).toMatchObject({ rejectionCode: "ROADMAP_NOT_PUBLISHABLE", httpStatus: 422 });
      expect(rejected[0].severity).toBe("warning");

      const keys = warnings.map((e: { key: string }) => e.key);
      const ack = await api().post(path(student.id, "/draft/acknowledge")).set(tok(staff)).send({ expectedDraftRevision: draft.draftRevision, exceptionKeys: keys, note: "reviewed" });
      expect(ack.status).toBe(200);
      const acked = events().find((e) => e.eventType === "roadmap.exceptions_acknowledged")!;
      expect(acked.metadata).toMatchObject({ acknowledgedCount: keys.length, draftRevision: ack.body.draft.draftRevision });
      expect(JSON.stringify(acked)).not.toContain("reviewed");
    }

    const state = (await api().get(path(student.id)).set(tok(staff))).body;
    const stale = await api().post(path(student.id, "/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: state.draft.draftRevision + 5, expectedPublishedVersionId: null });
    expect(stale.status).toBe(409);
    expect(events().filter((e) => e.eventType === "roadmap.publish_rejected").at(-1)!.metadata.rejectionCode).toBe("ROADMAP_STALE_DRAFT");

    const pub = await api().post(path(student.id, "/draft/publish")).set(tok(admin)).send({ expectedDraftRevision: state.draft.draftRevision, expectedPublishedVersionId: null });
    expect(pub.status).toBe(200);
    const published = events().find((e) => e.eventType === "roadmap.published")!;
    expect(published).toMatchObject({ actorUserId: admin.id, actorRole: "admin" });
    expect(published.metadata).toMatchObject({ versionId: pub.body.published.versionId, versionNumber: 1, studentId: student.id });

    // No workbook content, file name or free text reached the sink.
    const text = JSON.stringify(auditSink.mock.calls);
    expect(text).not.toContain(fileName);
    expect(text).not.toContain("staffNote");
    expect(text).not.toContain("Capstone course: schedule only");
  });
});
