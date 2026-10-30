/**
 * S10 - consolidated journey, PROFILE steps (P01-P08).
 *
 * ONE Express app (production `registerRoutes`), real RBAC with local HS256 JWTs, real disposable
 * PostgreSQL 16 (+ the S09 migration re-applied after the disposable supplement creates
 * student_contacts). Proves profile + roadmap + support together:
 *
 *   setup  staff imports + admin publishes a roadmap; the student opens a support ticket (S08 router
 *          over the S08 in-memory Supabase fake, exactly as tests/s10-consolidated-journey.test.ts)
 *   P01..P08  the student works the profile; staff approve an identity correction; roadmap view,
 *          degree-progress, tickets and every canonical / roadmap / billing table stay unchanged.
 *
 * Support-ticket name behaviour (documented, asserted): a ticket stores reporter_name at creation
 * time, read from users.name. An approved legal-name correction changes students.first/last_name
 * only; it does NOT rewrite users.name or any existing ticket. P06 pins that.
 *
 * STUBBED: hosted Supabase auth lookups (local JWT), audit sink (captured), email.
 * Evidence: docs/recovery/s10-evidence/journey/P*.json, normalised so reruns do not dirty git.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  PG_BINARIES_AVAILABLE,
  S05_PG_SKIP_MESSAGE,
  s05MigrationExists,
  seedAcademicRecord,
  seedStudent,
  seedUser,
  startLocalPg,
  type LocalPg,
  type SeededStudent,
  type SeededUser,
} from "./helpers/s05-local-pg";
import { applyS09Migration } from "./helpers/s09-apply-migration";
import { protectedTables, snapshotTables, studentRow, type TableSnapshot } from "./helpers/s09-profile-stack";
import { CANONICAL_TABLES, snapshotCanonical } from "./helpers/s05-roadmap-stack";
import { buildEphExecution, buildEphMaster } from "./fixtures/s07/builders";
import { createFakeSupportSupabase } from "./helpers/fake-supabase-support";

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

const shared = vi.hoisted(() => ({
  current: null as null | { client: { from(t: string): unknown; storage: unknown } },
  audit: [] as Array<Record<string, any>>,
}));

vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "invalid token" } })) },
    from: (t: string) => shared.current!.client.from(t),
    get storage() {
      return shared.current!.client.storage;
    },
  },
  createUserAuthClient: vi.fn(),
  isSupabaseConfigured: true,
}));
vi.mock("../server/lib/audit", () => ({
  auditAdmin: vi.fn().mockResolvedValue(undefined),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  auditAction: vi.fn().mockResolvedValue(undefined),
  auditSystem: vi.fn().mockResolvedValue(undefined),
  auditSupport: vi.fn().mockResolvedValue(undefined),
  writeAuditLog: vi.fn(async (e: Record<string, any>) => {
    shared.audit.push(e);
  }),
  redactAuditPayload: (v: unknown) => v,
}));
vi.mock("../server/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(false),
  deliverEmail: vi.fn().mockResolvedValue("not_configured"), emailTransportConfigured: vi.fn(() => false),
  sendTicketCreatedEmailToStaff: vi.fn(),
  sendTicketStatusUpdateEmail: vi.fn(),
  sendNewCommentEmail: vi.fn(),
}));

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);
const ready = PG_BINARIES_AVAILABLE && s05MigrationExists();
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const OUT = path.resolve(import.meta.dirname, "..", "docs/recovery/s10-evidence/journey");

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalise(value: unknown): unknown {
  const ids = new Map<string, string>();
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const walk = (v: any): any => {
    if (typeof v === "string") {
      if (/^[0-9a-f]{32,64}$/i.test(v)) return "<hash>";
      let s = v.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<ts>");
      s = s.replace(UUID, (m) => {
        if (!ids.has(m)) ids.set(m, `<id-${ids.size + 1}>`);
        return ids.get(m)!;
      });
      return s.replace(/[a-z]+-[0-9a-z]{6,}@synthetic\.example/g, "<email>@synthetic.example");
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}
const save = (name: string, data: unknown) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(normalise(data), null, 2) + "\n");
};
const digest = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
const allItems = (view: any): any[] => view.phases.flatMap((p: any) => p.items);
const warningKeys = (draft: { exceptions: Array<{ key: string; severity: string }> }) => draft.exceptions.filter((e) => e.severity === "warning").map((e) => e.key);
/** degree-progress carries a wall-clock `asOf`; every other field (incl. fingerprint) is compared. */
function dropClock(v: any): any {
  if (Array.isArray(v)) return v.map(dropClock);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "asOf").map(([k, x]) => [k, dropClock(x)]));
  return v;
}
const SUPPORT_TABLES = ["support_tickets", "ticket_comments", "ticket_attachments", "ticket_status_history"];

describe.skipIf(!ready)("S10 consolidated PROFILE journey - real Postgres + real HTTP + S08 support router", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let staff: SeededUser;
  let admin: SeededUser;
  let studentUser: SeededUser;
  let otherUser: SeededUser;
  let student: SeededStudent;
  let otherStudent: SeededStudent;
  let ticketId = "";
  const fake = createFakeSupportSupabase();
  shared.current = fake;

  const S = "/api/students";
  const api = () => request(base);
  const tok = (u: SeededUser) => ({ Authorization: `Bearer ${makeLocalJWT(u.id, u.email)}` });
  const roadmapView = async () => (await api().get("/api/student/roadmap").set(tok(studentUser))).body;
  const degreeProgress = async () => {
    const res = await api().get(`/api/admin/degree-progress/students/${student.id}/degree-progress`).set(tok(admin));
    return { status: res.status, body: dropClock(res.body) };
  };
  const ticketsAsStudent = async () => {
    const list = await api().get("/api/tickets").set(tok(studentUser));
    const detail = await api().get(`/api/tickets/${ticketId}`).set(tok(studentUser));
    return { list: list.body, detail: detail.body };
  };
  const supportDigest = () => digest(SUPPORT_TABLES.map((t) => fake.rows(t)));

  let tables: string[] = [];
  let before: {
    tables: TableSnapshot;
    canonical: Awaited<ReturnType<typeof snapshotCanonical>>;
    roadmap: any;
    degree: { status: number; body: any };
    tickets: { list: any; detail: any };
    supportRows: string;
    supportWrites: string[];
  };

  beforeAll(async () => {
    pg = await startLocalPg();
    await applyS09Migration(pg);
    process.env.DATABASE_URL = pg.url;
    delete process.env.ALLOW_DEMO_MODE;
    staff = await seedUser(pg, "staff");
    admin = await seedUser(pg, "admin");
    studentUser = await seedUser(pg, "student");
    otherUser = await seedUser(pg, "student");
    student = await seedStudent(pg, { userId: studentUser.id, firstName: "Ada", lastName: "Journey" });
    otherStudent = await seedStudent(pg, { userId: otherUser.id, firstName: "Ben", lastName: "Other" });
    await pg.sql(`update students set email = '${studentUser.email}' where id = '${student.id}'`);
    await pg.sql(`update students set email = '${otherUser.email}' where id = '${otherStudent.id}'`);
    await pg.sql(`update students set gov_id_type = 'Passport', gov_id_number = 'X12348765' where id = '${student.id}'`);
    await seedAcademicRecord(pg, student.id, { staffUserId: staff.id });
    for (const [u, name] of [[staff, "Sam Staff"], [admin, "Alex Admin"], [studentUser, "Ada Journey"], [otherUser, "Ben Other"]] as const) {
      fake.seedUser({ id: u.id, email: u.email, name, role: u.role });
    }
    const { registerRoutes } = await import("../server/routes");
    const app = express();
    app.use(/^\/api\/admin\/students\/[^/]+\/roadmap(\/|$)/, express.json({ limit: "2mb" }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // ---- setup: published roadmap + one support ticket (same flow as the A/S journeys) ----
    const m = await buildEphMaster(1);
    const e = await buildEphExecution(1);
    const rm = `/api/admin/students/${student.id}/roadmap`;
    const up = await api()
      .post(`${rm}/imports`)
      .set(tok(staff))
      .attach("workbook", m.buffer, { filename: m.fileName, contentType: XLSX })
      .attach("companion", e.buffer, { filename: e.fileName, contentType: XLSX });
    expect(up.status).toBe(201);
    const ack = await api().post(`${rm}/draft/acknowledge`).set(tok(staff)).send({ expectedDraftRevision: up.body.draft.draftRevision, exceptionKeys: warningKeys(up.body.draft), note: "S10 profile journey setup" });
    expect(ack.status).toBe(200);
    const pub = await api().post(`${rm}/draft/publish`).set(tok(admin)).send({ expectedDraftRevision: ack.body.draft.draftRevision, expectedPublishedVersionId: null });
    expect(pub.status).toBe(200);
    const ticket = await api().post("/api/tickets").set(tok(studentUser)).send({ subject: "Question about Business 103", description: "I am unsure which assignment to do next in Business 103.", topic: "roadmap_question", context: { roadmapItemKey: "business-103" } });
    expect(ticket.status).toBe(201);
    ticketId = ticket.body.ticket.id;
    tables = await protectedTables(pg);
    before = {
      tables: await snapshotTables(pg, tables),
      canonical: await snapshotCanonical(pg),
      roadmap: await roadmapView(),
      degree: await degreeProgress(),
      tickets: await ticketsAsStudent(),
      supportRows: supportDigest(),
      supportWrites: [...fake.writtenTables()].sort(),
    };
  }, 300_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pg?.stop();
  }, 60_000);

  const assertUnaffected = async (label: string) => {
    expect(await roadmapView(), `${label}: roadmap view`).toEqual(before.roadmap);
    expect(await degreeProgress(), `${label}: degree progress`).toEqual(before.degree);
    expect(await ticketsAsStudent(), `${label}: tickets`).toEqual(before.tickets);
    expect(supportDigest(), `${label}: support rows`).toBe(before.supportRows);
    expect([...fake.writtenTables()].sort(), `${label}: support writes`).toEqual(before.supportWrites);
    expect(await snapshotTables(pg, tables), `${label}: roadmap/billing tables`).toEqual(before.tables);
    const canonical = await snapshotCanonical(pg);
    for (const t of CANONICAL_TABLES) expect(canonical[t], `${label}: ${t}`).toEqual(before.canonical[t]);
  };
  const unaffectedDigests = () => ({
    roadmapViewSha: digest(before.roadmap),
    degreeProgressStatus: before.degree.status,
    degreeProgressSha: digest(before.degree.body),
    ticketsSha: digest(before.tickets),
    canonicalTables: CANONICAL_TABLES.length,
    protectedTables: tables.length,
  });

  it("P01 student opens their profile: own record, ID masked, nothing from roadmap or support is mixed in", async () => {
    expect(allItems(before.roadmap)).toHaveLength(24);
    expect(before.degree.status).toBe(200); // admin degree-progress read is a real, non-trivial baseline
    const res = await api().get(`${S}/me/profile`).set(tok(studentUser));
    expect(res.status).toBe(200);
    expect(res.body.identity).toMatchObject({ studentId: student.id, firstName: "Ada", lastName: "Journey" });
    expect(JSON.stringify(res.body)).not.toContain("X12348765");
    expect(res.body.identity.govIdNumberMasked).toMatch(/^•+/);
    expect(res.body.contacts).toEqual([]);
    await assertUnaffected("P01");
    save("P01-student-opens-profile.json", { step: "P01 student opens profile", status: res.status, identity: { first: res.body.identity.firstName, last: res.body.identity.lastName, idMasked: true, verification: res.body.identity.verification }, unaffected: unaffectedDigests() });
  });

  it("P02 student updates contact info; persists; roadmap, degree progress, tickets and credits unaffected", async () => {
    const edit = { preferred_name: "Addie", phone_primary: "+15551234567", timezone: "America/Chicago", preferred_contact_channel: "sms", address_line1: "22 Journey Lane", address_city: "Austin", address_state: "TX", address_postal: "78701", address_country: "US" };
    const put = await api().put(`${S}/${student.id}`).set(tok(studentUser)).send(edit);
    expect(put.status).toBe(200);
    const get = await api().get(`${S}/me/profile`).set(tok(studentUser));
    expect(get.body.contact).toMatchObject({ phonePrimary: "+15551234567", addressCity: "Austin", preferredContactChannel: "sms" });
    const contact = await api().post(`${S}/${student.id}/contacts`).set(tok(studentUser)).send({ type: "guardian", full_name: "Gina Guardian", relationship: "Mother", phone: "+15550101010", email: null, language: "English", scopes: ["emergency", "academic", "financial"] });
    expect(contact.status).toBe(201);
    expect(contact.body).toMatchObject({ authorityStatus: "pending_verification", hasPortalAccess: false });
    expect(contact.body.effectiveScopes).toEqual(["emergency"]);
    await assertUnaffected("P02");
    save("P02-update-contact-info.json", { step: "P02 student updates contact info + lists a guardian", put: put.status, persisted: true, guardian: { authorityStatus: contact.body.authorityStatus, effectiveScopes: contact.body.effectiveScopes, hasPortalAccess: contact.body.hasPortalAccess }, unaffected: unaffectedDigests() });
  });

  it("P03 student cannot edit protected identity, academic or staff-controlled fields (403 codes); records unchanged", async () => {
    const row0 = await studentRow(pg, student.id);
    const results: Record<string, unknown> = {};
    const attempts: Array<[string, Record<string, unknown>, number, string]> = [
      ["legal_name", { first_name: "Forged" }, 403, "PROFILE_IDENTITY_REQUIRES_CORRECTION"],
      ["dob", { dob: "1980-02-02" }, 403, "PROFILE_IDENTITY_REQUIRES_CORRECTION"],
      ["gov_id", { gov_id_number: "ZZ99999999" }, 403, "PROFILE_IDENTITY_REQUIRES_CORRECTION"],
      ["login_email", { email: "other@synthetic.example" }, 403, "PROFILE_EMAIL_MANAGED_BY_ACCOUNT"],
      ["status", { status: "graduated" }, 403, "PROFILE_FIELDS_STAFF_CONTROLLED"],
      ["residency", { residency: "foreign" }, 403, "PROFILE_FIELDS_STAFF_CONTROLLED"],
      ["prior_credits", { prior_credits_est: 90 }, 403, "PROFILE_FIELDS_STAFF_CONTROLLED"],
      ["target_degree", { target_degree: "Doctorate" }, 403, "PROFILE_FIELDS_STAFF_CONTROLLED"],
      ["hs_completion", { hs_completion: true }, 403, "PROFILE_FIELDS_STAFF_CONTROLLED"],
    ];
    for (const [label, body, status, code] of attempts) {
      const res = await api().put(`${S}/${student.id}`).set(tok(studentUser)).send(body);
      expect(res.status, label).toBe(status);
      expect(res.body.code, label).toBe(code);
      results[label] = { status: res.status, code: res.body.code };
    }
    const sid = await api().put(`${S}/${student.id}`).set(tok(studentUser)).send({ student_code: "HACK-1" });
    expect([400, 403]).toContain(sid.status);
    results.student_code = sid.status;
    // the roadmap's own credit/plan rejection still holds next to the profile
    const roadmapBad = await api().post("/api/student/roadmap/progress").set(tok(studentUser)).send({ itemKey: "business-103", taskKey: null, status: "provider_complete", expectedRevision: 1, credits: "3" });
    expect(roadmapBad.status).toBe(400);
    expect(await studentRow(pg, student.id)).toEqual(row0);
    await assertUnaffected("P03");
    save("P03-protected-fields.json", { step: "P03 protected fields are 403 with stable codes", attempts: results, roadmapCreditFieldRejected: roadmapBad.status, studentRowUnchanged: true, unaffected: unaffectedDigests() });
  });

  let correctionId = "";
  it("P04 student requests an identity correction; nothing changes until staff decide", async () => {
    const row0 = await studentRow(pg, student.id);
    const res = await api().post(`${S}/me/identity-corrections`).set(tok(studentUser)).send({ changes: { first_name: "Adaline", last_name: "Journey-Smyth" }, reason: "My passport spells my name Adaline Journey-Smyth." });
    expect(res.status).toBe(201);
    const view = res.body.request ?? res.body.correction ?? res.body;
    correctionId = view.id;
    expect(view.status).toBe("pending");
    const dup = await api().post(`${S}/me/identity-corrections`).set(tok(studentUser)).send({ changes: { first_name: "Other" }, reason: "A second request should be refused while one is pending." });
    expect(dup.status).toBe(409);
    expect(await studentRow(pg, student.id)).toEqual(row0);
    const profile = await api().get(`${S}/me/profile`).set(tok(studentUser));
    expect(profile.body.identity.firstName).toBe("Ada");
    await assertUnaffected("P04");
    save("P04-request-identity-correction.json", { step: "P04 student requests a correction", create: res.status, status: view.status, secondWhilePending: dup.status, recordUnchangedUntilApproval: true, unaffected: unaffectedDigests() });
  });

  it("P05 staff approves; the student record changes in one step and is audited; the student gains no privileges", async () => {
    const queue = await api().get(`${S}/identity-corrections?status=pending`).set(tok(staff));
    expect(queue.status).toBe(200);
    expect(JSON.stringify(queue.body)).toContain(correctionId);
    expect((await api().post(`${S}/identity-corrections/${correctionId}/resolve`).set(tok(studentUser)).send({ decision: "approve" })).status).toBe(403);
    shared.audit.length = 0;
    const res = await api().post(`${S}/identity-corrections/${correctionId}/resolve`).set(tok(staff)).send({ decision: "approve", note: "Passport sighted." });
    expect(res.status).toBe(200);
    const row = await studentRow(pg, student.id);
    expect(row.first_name).toBe("Adaline");
    expect(row.last_name).toBe("Journey-Smyth");
    const profile = await api().get(`${S}/me/profile`).set(tok(studentUser));
    expect(profile.body.identity).toMatchObject({ firstName: "Adaline", lastName: "Journey-Smyth" });
    expect(JSON.stringify(profile.body)).toContain("approved");
    expect(shared.audit.length).toBeGreaterThanOrEqual(1);
    expect(shared.audit.every((a) => a.actorId === staff.id && a.studentId === student.id)).toBe(true);
    expect((await api().post(`${S}/identity-corrections/${correctionId}/resolve`).set(tok(staff)).send({ decision: "approve" })).status).toBe(409);
    expect((await api().get(`/api/admin/students/${student.id}/roadmap`).set(tok(studentUser))).status).toBe(403);
    save("P05-staff-approves-correction.json", { step: "P05 staff approves", resolve: res.status, studentRowNow: { first: row.first_name, last: row.last_name }, studentResolveAttempt: 403, secondResolve: 409, auditEntries: shared.audit.length, auditActorsAreStaff: true });
  });

  it("P06 after the approved legal-name change: roadmap, degree progress, credits and support tickets are unaffected; ticket name behaviour pinned", async () => {
    await assertUnaffected("P06");
    const detail = await api().get(`/api/tickets/${ticketId}`).set(tok(staff));
    expect(detail.status).toBe(200);
    // DOCUMENTED BEHAVIOUR: reporter_name is stored when the ticket is created (from users.name), and users.name
    // is not rewritten by a students-row legal-name correction. The existing ticket and a new ticket both keep
    // "Ada Journey" until the account display name is changed through account management.
    expect(detail.body.ticket.reporter_name).toBe("Ada Journey");
    const second = await api().post("/api/tickets").set(tok(studentUser)).send({ subject: "Second question after correction", description: "Checking the name shown on a new ticket after my correction.", topic: "roadmap_question", context: { roadmapItemKey: "business-103" } });
    expect(second.status).toBe(201);
    const secondDetail = await api().get(`/api/tickets/${second.body.ticket.id}`).set(tok(staff));
    expect(secondDetail.body.ticket.reporter_name).toBe("Ada Journey");
    const [u] = await pg.sql(`select name from users where id = '${studentUser.id}'`);
    expect(u.name).toBe("Synthetic student"); // public.users.name is untouched by profile corrections
    save("P06-roadmap-degree-support-unaffected.json", {
      step: "P06 other modules unaffected by the approved correction",
      unaffected: unaffectedDigests(),
      ticketReporterNameAtCreation: detail.body.ticket.reporter_name,
      newTicketReporterNameAfterCorrection: secondDetail.body.ticket.reporter_name,
      behaviour: "reporter_name comes from the account display name (users.name) at ticket creation; profile corrections change students.first_name/last_name only, so ticket names are stable and do not follow the legal-name change (documented gap, not a leak)",
    });
    // the second ticket is a deliberate support write: refresh the support baseline
    before.supportRows = supportDigest();
    before.supportWrites = [...fake.writtenTables()].sort();
    before.tickets = await ticketsAsStudent();
  });

  it("P07 another student cannot read or act on this student's profile, corrections or contacts", async () => {
    const codes: Record<string, number> = {};
    for (const [label, req] of [
      ["GET /:id", api().get(`${S}/${student.id}`)],
      ["GET /:id/profile", api().get(`${S}/${student.id}/profile`)],
      ["GET /:id/full", api().get(`${S}/${student.id}/full`)],
      ["GET /:id/contacts", api().get(`${S}/${student.id}/contacts`)],
      ["GET /:id/identity-corrections", api().get(`${S}/${student.id}/identity-corrections`)],
      ["PUT /:id", api().put(`${S}/${student.id}`).send({ phone_primary: "+15559999999" })],
      ["GET /identity-corrections (staff queue)", api().get(`${S}/identity-corrections?status=pending`)],
    ] as const) {
      const res = await req.set(tok(otherUser));
      expect([403, 404], label).toContain(res.status);
      expect(JSON.stringify(res.body), label).not.toContain(student.email);
      codes[label] = res.status;
    }
    const resolve = await api().post(`${S}/identity-corrections/${correctionId}/resolve`).set(tok(otherUser)).send({ decision: "reject", note: "not yours to reject" });
    expect(resolve.status).toBe(403);
    expect((await api().get(`/api/tickets/${ticketId}`).set(tok(otherUser))).status).toBe(404);
    expect((await studentRow(pg, student.id)).phone_primary).toBe("+15551234567");
    save("P07-cross-student-isolation.json", { step: "P07 other student blocked", attempts: codes, resolveCorrection: resolve.status, ticketRead: 404, victimRowUnchanged: true });
  });

  it("P08 end state: contact authority is inert, and profile activity wrote no roadmap, credit, billing or support rows", async () => {
    const profile = await api().get(`${S}/me/profile`).set(tok(studentUser));
    const g = profile.body.contacts.find((c: any) => c.fullName === "Gina Guardian");
    expect(g).toMatchObject({ authorityStatus: "pending_verification", hasPortalAccess: false });
    expect(g.effectiveScopes).toEqual(["emergency"]);
    expect((await pg.sql(`select 1 from users where email like 'gina%'`)).length).toBe(0);
    await assertUnaffected("P08");
    save("P08-final-state.json", {
      step: "P08 final",
      guardian: { authorityStatus: g.authorityStatus, effectiveScopes: g.effectiveScopes, hasPortalAccess: g.hasPortalAccess },
      protectedTablesChecked: tables.length,
      canonicalTablesIdentical: true,
      supportWritesDuringProfileSteps: "none (the only support write after setup is the deliberate second ticket in P06)",
      academicBackend: "real disposable PostgreSQL 16 + repository migrations + S09 migration",
      supportBackend: "S08 in-memory Supabase fake behind the production /api/tickets router",
    });
  });
});
