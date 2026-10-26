/**
 * S09 — student profile: real HTTP end to end over a real Postgres.
 *
 * Real: Express app from server/routes.ts registerRoutes, real routers with
 * default dependencies (drizzle -> disposable Postgres), real requireAuth
 * (local JWT -> users row), real RBAC, multer, validation.
 * Mocked (external services only): Supabase client incl. storage
 * (upload/remove/createSignedUrl), the account-status lookup (controllable per
 * user), audit logging.
 */
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
import {
  IDENTITY_FIELDS_DIRECT,
  NOT_AN_IMAGE,
  PROTECTED_STUDENT_FIELDS,
  VALID_PNG,
  makeLocalJWT,
  protectedTables,
  requestFrom,
  seedIdDocument,
  snapshotTables,
  studentRow,
  type TableSnapshot,
} from "./helpers/s09-profile-stack";

const mocks = vi.hoisted(() => ({
  inactive: new Set<string>(),
  upload: vi.fn(),
  remove: vi.fn(),
  createSignedUrl: vi.fn(),
  getPublicUrl: vi.fn(),
}));

vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async (id: string) => (mocks.inactive.has(id) ? "inactive" : "active")),
  isAccountActive: vi.fn(async (id: string) => !mocks.inactive.has(id)),
}));
vi.mock("../server/lib/supabase", () => {
  const getUser = vi.fn(async () => ({ data: { user: null }, error: { message: "invalid token" } }));
  const bucket = () => ({
    upload: mocks.upload,
    remove: mocks.remove,
    createSignedUrl: mocks.createSignedUrl,
    getPublicUrl: mocks.getPublicUrl,
  });
  return {
    supabaseAdmin: { auth: { getUser }, from: vi.fn(), storage: { from: vi.fn(bucket) } },
    createUserAuthClient: vi.fn(),
    isSupabaseConfigured: vi.fn(() => false),
  };
});
vi.mock("../server/lib/audit", async (importOriginal) => {
  // Every exported audit function becomes a no-op (audit sinks are external).
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [k, typeof v === "function" ? vi.fn().mockResolvedValue(undefined) : v]),
  );
});

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);
const ready = PG_BINARIES_AVAILABLE && s05MigrationExists();

const EVIDENCE_DIR = path.resolve(import.meta.dirname, "..", "docs", "recovery", "s09-evidence");

function resetStorageMocks() {
  mocks.upload.mockReset().mockImplementation(async (p: string) => ({ data: { path: p }, error: null }));
  mocks.remove.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.createSignedUrl
    .mockReset()
    .mockImplementation(async (p: string) => ({ data: { signedUrl: `https://storage.synthetic.example/sign/${p}?token=t` }, error: null }));
  mocks.getPublicUrl.mockReset().mockImplementation((p: string) => ({ data: { publicUrl: `https://storage.synthetic.example/public/${p}` } }));
}

describe.skipIf(!ready)("S09 student profile — real HTTP end to end", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let staff: SeededUser;
  let admin: SeededUser;
  let coach: SeededUser;
  let studentUser: SeededUser;
  let student: SeededStudent;
  let otherUser: SeededUser;
  let otherStudent: SeededStudent;
  let protectedList: string[] = [];
  let journeyBefore: TableSnapshot;
  let idDocId: string;
  let approvedCorrectionId: string;

  const tok = (u: SeededUser) => ({ Authorization: `Bearer ${makeLocalJWT(u.id, u.email)}` });
  const api = () => request(base);
  const S = "/api/students";
  const code = (res: request.Response) => res.body?.code ?? res.body?.error?.code;

  async function linkLoginEmail(s: SeededStudent, u: SeededUser) {
    await pg.sql(`update students set email = '${u.email}' where id = '${s.id}'`);
  }

  beforeAll(async () => {
    resetStorageMocks();
    pg = await startLocalPg();
    await applyS09Migration(pg);
    process.env.DATABASE_URL = pg.url;
    delete process.env.ALLOW_DEMO_MODE;
    staff = await seedUser(pg, "staff");
    admin = await seedUser(pg, "admin");
    coach = await seedUser(pg, "coach");
    studentUser = await seedUser(pg, "student");
    student = await seedStudent(pg, { userId: studentUser.id, firstName: "Ada", lastName: "Smyth" });
    otherUser = await seedUser(pg, "student");
    otherStudent = await seedStudent(pg, { userId: otherUser.id, firstName: "Grace", lastName: "Other" });
    await linkLoginEmail(student, studentUser);
    await linkLoginEmail(otherStudent, otherUser);
    await pg.sql(`update students set gov_id_type = 'Passport', gov_id_number = 'X12348765' where id = '${student.id}'`);
    await seedAcademicRecord(pg, student.id, { staffUserId: staff.id });
    protectedList = await protectedTables(pg);
    journeyBefore = await snapshotTables(pg, protectedList);

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

  // ── 1–2: read access ─────────────────────────────────────────────────────
  it("1. a student loads their own profile", async () => {
    const res = await api().get(`${S}/me/profile`).set(tok(studentUser));
    expect(res.status).toBe(200);
    expect(res.body.identity.studentId).toBe(student.id);
    expect(res.body.identity.firstName).toBe("Ada");
    expect(res.body.contact.email).toBe(studentUser.email);
    expect(res.body.contacts).toEqual([]);
    expect(Array.isArray(res.body.readiness)).toBe(true);
    // the government ID is only ever masked
    expect(JSON.stringify(res.body)).not.toContain("X12348765");
    expect(res.body.identity.govIdNumberMasked).toMatch(/^•+/);
    expect(res.body.identity.verification).toBe("not_submitted");
  });

  it("2. a student cannot access another student's profile (/:id, /:id/profile, /:id/full)", async () => {
    for (const suffix of ["", "/profile", "/full"]) {
      const res = await api().get(`${S}/${otherStudent.id}${suffix}`).set(tok(studentUser));
      expect(res.status, `GET ${suffix || "/:id"}`).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(otherStudent.email);
    }
    const own = await api().get(`${S}/${student.id}/profile`).set(tok(studentUser));
    expect(own.status).toBe(200);
  });

  // ── 3–4: self-service edits ──────────────────────────────────────────────
  it("3. a student updates permitted contact info and it persists", async () => {
    const edit = {
      preferred_name: "Addie",
      phone_primary: "+15551234567",
      phone_secondary: "+15557654321",
      whatsapp_primary: true,
      timezone: "America/Chicago",
      preferred_contact_channel: "whatsapp",
      address_line1: "22 Persisted Lane",
      address_city: "Austin",
      address_state: "TX",
      address_postal: "78701",
      address_country: "US",
      marketing_opt_in: true,
    };
    const put = await api().put(`${S}/${student.id}`).set(tok(studentUser)).send(edit);
    expect(put.status).toBe(200);
    const get = await api().get(`${S}/me/profile`).set(tok(studentUser));
    expect(get.status).toBe(200);
    expect(get.body.contact).toMatchObject({
      phonePrimary: "+15551234567",
      phoneSecondary: "+15557654321",
      whatsappPrimary: true,
      timezone: "America/Chicago",
      preferredContactChannel: "whatsapp",
      addressLine1: "22 Persisted Lane",
      addressCity: "Austin",
      marketingOptIn: true,
    });
    expect(get.body.identity.preferredName).toBe("Addie");
    const row = await studentRow(pg, student.id);
    expect(row.phone_primary).toBe("+15551234567");
  });

  it("4. a student modifying a protected academic/status field is refused and the DB is unchanged", async () => {
    const before = await studentRow(pg, student.id);
    for (const [field, val] of PROTECTED_STUDENT_FIELDS) {
      const res = await api().put(`${S}/${student.id}`).set(tok(studentUser)).send({ [field]: val });
      expect(res.status, `field ${field}`).toBe(403);
      expect(code(res), `field ${field}`).toBe("PROFILE_FIELDS_STAFF_CONTROLLED");
    }
    // mixed payload: one allowed + one protected field must not partially apply
    const mixed = await api().put(`${S}/${student.id}`).set(tok(studentUser)).send({ address_city: "Mixedville", hs_completion: true });
    expect(mixed.status).toBe(403);
    const after = await studentRow(pg, student.id);
    expect(after).toEqual(before);
  });

  // ── 5–7: identity corrections ────────────────────────────────────────────
  it("5. a student requests correction of verified legal identity", async () => {
    idDocId = await seedIdDocument(pg, student.id, { status: "verified" });
    const view = await api().get(`${S}/me/profile`).set(tok(studentUser));
    expect(view.body.identity.verification).toBe("verified");

    // no-op request is a 422
    const same = await api().post(`${S}/me/identity-corrections`).set(tok(studentUser)).send({ changes: { last_name: "Smyth" }, reason: "Nothing actually changes here" });
    expect(same.status).toBe(422);
    expect(code(same)).toBe("PROFILE_CORRECTION_NO_CHANGE");

    // evidence from another student is refused
    const foreignDoc = await seedIdDocument(pg, otherStudent.id, { status: "pending" });
    const stolen = await api().post(`${S}/me/identity-corrections`).set(tok(studentUser)).send({ changes: { last_name: "Smith" }, reason: "Passport spelling is Smith", evidence_document_id: foreignDoc });
    expect(stolen.status).toBe(403);
    expect(code(stolen)).toBe("PROFILE_EVIDENCE_NOT_OWNED");

    const created = await api()
      .post(`${S}/me/identity-corrections`)
      .set(tok(studentUser))
      .send({ changes: { last_name: "Smith", gov_id_number: "X99998765" }, reason: "Passport spelling is Smith", evidence_document_id: idDocId });
    expect(created.status).toBe(201);
    const reqView = requestFrom(created.body);
    expect(reqView.status).toBe("pending");
    expect(reqView.fields.sort()).toEqual(["gov_id_number", "last_name"]);
    expect(JSON.stringify(created.body)).not.toContain("X99998765");

    const dup = await api().post(`${S}/me/identity-corrections`).set(tok(studentUser)).send({ changes: { first_name: "Adeline" }, reason: "Second concurrent request" });
    expect(dup.status).toBe(409);
    expect(code(dup)).toBe("PROFILE_CORRECTION_ALREADY_PENDING");

    const profile = await api().get(`${S}/me/profile`).set(tok(studentUser));
    expect(profile.body.identity.pendingCorrection.id).toBe(reqView.id);
    approvedCorrectionId = reqView.id;
  });

  it("6. identity values are unchanged in the DB until approval (direct writes are refused too)", async () => {
    const row = await studentRow(pg, student.id);
    expect(row.last_name).toBe("Smyth");
    expect(row.gov_id_number).toBe("X12348765");
    const before = await studentRow(pg, student.id);
    for (const [field, val] of IDENTITY_FIELDS_DIRECT) {
      const res = await api().put(`${S}/${student.id}`).set(tok(studentUser)).send({ [field]: val });
      expect(res.status, `field ${field}`).toBe(403);
      expect(code(res), `field ${field}`).toBe("PROFILE_IDENTITY_REQUIRES_CORRECTION");
    }
    expect(await studentRow(pg, student.id)).toEqual(before);
    const [pending] = await pg.sql(`select count(*)::int as n from student_identity_corrections where student_id = '${student.id}' and status = 'pending'`);
    expect(pending.n).toBe(1);
  });

  it("7. staff reviews the queue and resolves; the student sees the outcome; students cannot resolve; double-resolve is 409", async () => {
    const docsBefore = await snapshotTables(pg, ["student_documents"]);

    // a student can neither see the queue nor resolve
    const asStudentQueue = await api().get(`${S}/identity-corrections?status=pending`).set(tok(studentUser));
    expect(asStudentQueue.status).toBe(403);
    const asStudentResolve = await api().post(`${S}/identity-corrections/${approvedCorrectionId}/resolve`).set(tok(studentUser)).send({ decision: "approve" });
    expect(asStudentResolve.status).toBe(403);
    expect((await studentRow(pg, student.id)).last_name).toBe("Smyth");

    const queue = await api().get(`${S}/identity-corrections?status=pending`).set(tok(staff));
    expect(queue.status).toBe(200);
    const items: any[] = Array.isArray(queue.body) ? queue.body : (queue.body.requests ?? queue.body.items ?? []);
    expect(items.map((i) => i.id)).toContain(approvedCorrectionId);
    expect(JSON.stringify(queue.body)).not.toContain("X99998765");

    // reject without a note is invalid
    const noNote = await api().post(`${S}/identity-corrections/${approvedCorrectionId}/resolve`).set(tok(staff)).send({ decision: "reject" });
    expect(noNote.status).toBe(400);

    // approve applies the values
    const approve = await api().post(`${S}/identity-corrections/${approvedCorrectionId}/resolve`).set(tok(staff)).send({ decision: "approve", note: "Passport checked" });
    expect(approve.status).toBe(200);
    const row = await studentRow(pg, student.id);
    expect(row.last_name).toBe("Smith");
    expect(row.gov_id_number).toBe("X99998765");
    expect(row.first_name).toBe("Ada");

    // double resolve
    const again = await api().post(`${S}/identity-corrections/${approvedCorrectionId}/resolve`).set(tok(admin)).send({ decision: "reject", note: "Too late to reject" });
    expect(again.status).toBe(409);
    expect(code(again)).toBe("PROFILE_CORRECTION_NOT_PENDING");
    expect((await studentRow(pg, student.id)).last_name).toBe("Smith");

    // a second request rejected leaves values untouched
    const second = await api().post(`${S}/me/identity-corrections`).set(tok(studentUser)).send({ changes: { first_name: "Adeline", dob: "1991-05-05" }, reason: "I prefer a different legal first name" });
    expect(second.status).toBe(201);
    const secondId = requestFrom(second.body).id;
    const reject = await api().post(`${S}/identity-corrections/${secondId}/resolve`).set(tok(staff)).send({ decision: "reject", note: "No supporting document supplied" });
    expect(reject.status).toBe(200);
    const after = await studentRow(pg, student.id);
    expect(after.first_name).toBe("Ada");
    expect(String(after.dob).slice(0, 10) === "1991-05-05" || (after.dob as Date)?.toISOString?.().startsWith("1991-05-05")).toBe(false);

    // the student sees the outcome and its note; the reviewer id is staff-only
    const profile = await api().get(`${S}/me/profile`).set(tok(studentUser));
    expect(profile.body.identity.pendingCorrection).toBeNull();
    expect(profile.body.identity.lastResolvedCorrection.status).toBe("rejected");
    expect(profile.body.identity.lastResolvedCorrection.reviewNote).toBe("No supporting document supplied");
    expect(profile.body.identity.lastResolvedCorrection.reviewerUserId).toBeNull();
    expect(JSON.stringify(profile.body)).not.toContain(staff.id);
    const mine = await api().get(`${S}/me/identity-corrections`).set(tok(studentUser));
    expect(mine.status).toBe(200);
    const staffHistory = await api().get(`${S}/${student.id}/identity-corrections`).set(tok(staff));
    expect(staffHistory.status).toBe(200);
    expect(JSON.stringify(staffHistory.body)).toContain(staff.id);

    // approval did not touch document verification
    expect(await snapshotTables(pg, ["student_documents"])).toEqual(docsBefore);
  });

  // ── 8–10: contacts ───────────────────────────────────────────────────────
  it("8. a student adds an ordinary emergency contact", async () => {
    const res = await api().post(`${S}/${student.id}/contacts`).set(tok(studentUser)).send({
      type: "emergency", full_name: "Erin Emergency", relationship: "Friend", phone: "+15550101010",
      email: "erin.emergency@synthetic.example", language: "English", scopes: ["emergency"],
    });
    expect(res.status).toBe(201);
    const profile = await api().get(`${S}/me/profile`).set(tok(studentUser));
    const c = profile.body.contacts.find((x: any) => x.fullName === "Erin Emergency");
    expect(c).toBeTruthy();
    expect(c.type).toBe("emergency");
    expect(c.authorityStatus).toBe("listed");
    expect(c.effectiveScopes).toEqual(["emergency"]);
    expect(c.hasPortalAccess).toBe(false);
  });

  it("9. an unverified guardian has no authority and no login; only staff verification changes that", async () => {
    const email = "gina.guardian@synthetic.example";
    const res = await api().post(`${S}/${student.id}/contacts`).set(tok(studentUser)).send({
      type: "guardian", full_name: "Gina Guardian", relationship: "Mother", phone: "+15550202020",
      email, language: null, scopes: ["emergency", "academic", "financial"],
    });
    expect(res.status).toBe(201);
    let profile = await api().get(`${S}/me/profile`).set(tok(studentUser));
    let g = profile.body.contacts.find((x: any) => x.fullName === "Gina Guardian");
    expect(g.authorityStatus).toBe("pending_verification");
    expect(g.requestedScopes).toEqual(expect.arrayContaining(["academic", "financial"]));
    expect(g.effectiveScopes).toEqual(["emergency"]);
    expect(g.effectiveScopes).not.toContain("academic");
    expect(g.effectiveScopes).not.toContain("financial");
    expect(g.hasPortalAccess).toBe(false);

    // the student cannot set authority_status, on create or update
    const forgedCreate = await api().post(`${S}/${student.id}/contacts`).set(tok(studentUser)).send({
      type: "guardian", full_name: "Forged Guardian", relationship: "Uncle", phone: "+15550303030", email: null, language: null,
      scopes: ["academic"], authority_status: "verified",
    });
    expect([400, 403]).toContain(forgedCreate.status);
    const forgedUpdate = await api().put(`${S}/contacts/${g.id}`).set(tok(studentUser)).send({
      type: "guardian", full_name: "Gina Guardian", relationship: "Mother", phone: "+15550202020", email, language: null,
      scopes: ["academic"], authority_status: "verified",
    });
    expect([400, 403]).toContain(forgedUpdate.status);
    const [row] = await pg.sql(`select authority_status from student_contacts where id = '${g.id}'`);
    expect(row.authority_status).toBe("pending_verification");
    const forgedRows = await pg.sql(`select 1 from student_contacts where full_name = 'Forged Guardian'`);
    expect(forgedRows.length).toBe(0);

    // a contact never gets a user / login
    const users = await pg.sql(`select 1 from users where email = '${email}'`);
    expect(users.length).toBe(0);
    const authUsers = await pg.sql(`select 1 from auth.users where email = '${email}'`);
    expect(authUsers.length).toBe(0);

    // a student cannot verify; coach cannot verify; staff can
    const byStudent = await api().post(`${S}/contacts/${g.id}/authority`).set(tok(studentUser)).send({ decision: "verify", note: "I am the student" });
    expect(byStudent.status).toBe(403);
    const byCoach = await api().post(`${S}/contacts/${g.id}/authority`).set(tok(coach)).send({ decision: "verify", note: "coach attempt" });
    expect(byCoach.status).toBe(403);
    const noNote = await api().post(`${S}/contacts/${g.id}/authority`).set(tok(staff)).send({ decision: "verify" });
    expect(noNote.status).toBe(400);
    const [still] = await pg.sql(`select authority_status from student_contacts where id = '${g.id}'`);
    expect(still.authority_status).toBe("pending_verification");

    const verify = await api().post(`${S}/contacts/${g.id}/authority`).set(tok(staff)).send({ decision: "verify", note: "Court order sighted" });
    expect(verify.status).toBe(200);
    profile = await api().get(`${S}/me/profile`).set(tok(studentUser));
    g = profile.body.contacts.find((x: any) => x.fullName === "Gina Guardian");
    expect(g.authorityStatus).toBe("verified");
    expect(g.effectiveScopes).toEqual(expect.arrayContaining(["emergency", "academic", "financial"]));
    expect(g.hasPortalAccess).toBe(false);

    // verified authority is staff-managed: student edit/delete is refused
    const edit = await api().put(`${S}/contacts/${g.id}`).set(tok(studentUser)).send({
      type: "guardian", full_name: "Gina Guardian", relationship: "Mother", phone: "+15559999999", email, language: null, scopes: ["emergency"],
    });
    expect(edit.status).toBe(403);
    expect(code(edit)).toBe("PROFILE_CONTACT_AUTHORITY_STAFF_MANAGED");
    const del = await api().delete(`${S}/contacts/${g.id}`).set(tok(studentUser));
    expect(del.status).toBe(403);

    const revoke = await api().post(`${S}/contacts/${g.id}/authority`).set(tok(admin)).send({ decision: "revoke", note: "Order expired" });
    expect(revoke.status).toBe(200);
    profile = await api().get(`${S}/me/profile`).set(tok(studentUser));
    g = profile.body.contacts.find((x: any) => x.fullName === "Gina Guardian");
    expect(g.authorityStatus).toBe("revoked");
    expect(g.effectiveScopes).toEqual(["emergency"]);
  });

  it("10. cross-student contact edit/delete is refused and the row is unchanged", async () => {
    const created = await api().post(`${S}/${otherStudent.id}/contacts`).set(tok(otherUser)).send({
      type: "emergency", full_name: "Olive Other", relationship: "Sister", phone: "+15550404040", email: null, language: null, scopes: ["emergency"],
    });
    expect(created.status).toBe(201);
    const [row] = await pg.sql(`select * from student_contacts where student_id = '${otherStudent.id}'`);
    const put = await api().put(`${S}/contacts/${row.id}`).set(tok(studentUser)).send({
      type: "emergency", full_name: "Hijacked", relationship: "Sister", phone: "+15550000001", email: null, language: null, scopes: ["emergency"],
    });
    expect(put.status).toBe(403);
    const del = await api().delete(`${S}/contacts/${row.id}`).set(tok(studentUser));
    expect(del.status).toBe(403);
    const [after] = await pg.sql(`select * from student_contacts where id = '${row.id}'`);
    expect(after).toEqual(row);
    // cannot add a contact to another student either
    const add = await api().post(`${S}/${otherStudent.id}/contacts`).set(tok(studentUser)).send({
      type: "emergency", full_name: "Planted", relationship: "Friend", phone: "+15550505050", email: null, language: null, scopes: [],
    });
    expect(add.status).toBe(403);
  });

  // ── 11–12: photo ─────────────────────────────────────────────────────────
  it("11. photo upload: foreign id 403; non-image bytes 400; valid PNG stored privately with a signed URL", async () => {
    resetStorageMocks();
    const foreign = await api().post(`${S}/${otherStudent.id}/photo`).set(tok(studentUser)).attach("photo", VALID_PNG, { filename: "p.png", contentType: "image/png" });
    expect(foreign.status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();

    const fake = await api().post(`${S}/${student.id}/photo`).set(tok(studentUser)).attach("photo", NOT_AN_IMAGE, { filename: "evil.png", contentType: "image/png" });
    expect(fake.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect((await studentRow(pg, student.id)).photo_url).toBeNull();

    const big = await api().post(`${S}/${student.id}/photo`).set(tok(studentUser)).attach("photo", Buffer.concat([VALID_PNG, Buffer.alloc(5 * 1024 * 1024 + 10)]), { filename: "big.png", contentType: "image/png" });
    expect([413, 400]).toContain(big.status);
    expect(mocks.upload).not.toHaveBeenCalled();

    const ok = await api().post(`${S}/${student.id}/photo`).set(tok(studentUser)).attach("photo", VALID_PNG, { filename: "../../etc/passwd.png", contentType: "image/png" });
    expect(ok.status).toBe(200);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    const [objectPath, , opts] = mocks.upload.mock.calls[0];
    expect(objectPath).not.toContain("passwd");
    expect(objectPath).toContain(student.id);
    expect(opts.contentType).toBe("image/png");
    const stored = String((await studentRow(pg, student.id)).photo_url);
    expect(stored).not.toMatch(/^(https?:|data:)/);
    expect(stored).toContain(objectPath);
    expect(mocks.getPublicUrl).not.toHaveBeenCalled();
    expect(ok.body.photoUrl ?? ok.body.student?.photo_url).toMatch(/^https:\/\/storage\.synthetic\.example\/sign\/.*token=/);
    const profile = await api().get(`${S}/me/profile`).set(tok(studentUser));
    expect(profile.body.identity.photoUrl).toMatch(/\/sign\//);
  });

  it("12. storage failure -> 500 with the DB photo_url unchanged; DB failure after upload -> 500 and the object is removed", async () => {
    resetStorageMocks();
    const before = (await studentRow(pg, student.id)).photo_url;
    mocks.upload.mockResolvedValueOnce({ data: null, error: { message: "storage down" } });
    const storageFail = await api().post(`${S}/${student.id}/photo`).set(tok(studentUser)).attach("photo", VALID_PNG, { filename: "a.png", contentType: "image/png" });
    expect(storageFail.status).toBe(500);
    expect((await studentRow(pg, student.id)).photo_url).toBe(before);

    resetStorageMocks();
    await pg.sql(`
      create or replace function s09_block_photo() returns trigger language plpgsql as $$
      begin
        if new.photo_url is distinct from old.photo_url then raise exception 's09 forced db failure'; end if;
        return new;
      end $$;
      create trigger s09_block_photo_trg before update on students for each row execute function s09_block_photo();`);
    try {
      const dbFail = await api().post(`${S}/${student.id}/photo`).set(tok(studentUser)).attach("photo", VALID_PNG, { filename: "b.png", contentType: "image/png" });
      expect(dbFail.status).toBe(500);
      expect(mocks.upload).toHaveBeenCalledTimes(1);
      const uploaded = mocks.upload.mock.calls[0][0];
      expect(mocks.remove).toHaveBeenCalledTimes(1);
      expect(mocks.remove.mock.calls[0][0]).toEqual([uploaded]);
      expect((await studentRow(pg, student.id)).photo_url).toBe(before);
    } finally {
      await pg.sql(`drop trigger if exists s09_block_photo_trg on students; drop function if exists s09_block_photo();`);
    }
  });

  // ── 13–14: email + document bypass ───────────────────────────────────────
  it("13. email change via PUT is refused for student and staff; login and profile email stay equal", async () => {
    const student1 = await api().put(`${S}/${student.id}`).set(tok(studentUser)).send({ email: "changed@synthetic.example" });
    expect(student1.status).toBe(403);
    expect(code(student1)).toBe("PROFILE_EMAIL_MANAGED_BY_ACCOUNT");
    for (const actor of [staff, admin]) {
      const res = await api().put(`${S}/${student.id}`).set(tok(actor)).send({ email: "changed-by-staff@synthetic.example" });
      expect(res.status).toBe(403);
      expect(code(res)).toBe("PROFILE_EMAIL_MANAGED_BY_ACCOUNT");
    }
    const [u] = await pg.sql(`select u.email as login, s.email as profile from students s join users u on u.id = s.user_id where s.id = '${student.id}'`);
    expect(u.login).toBe(studentUser.email);
    expect(u.profile).toBe(u.login);
    const profile = await api().get(`${S}/me/profile`).set(tok(studentUser));
    expect(profile.body.contact.email).toBe(studentUser.email);
  });

  it("14. document verification cannot be bypassed by a student or by a correction approval", async () => {
    const pendingDoc = await seedIdDocument(pg, otherStudent.id, { status: "pending" });
    const verify = await api().post(`/api/documents/${pendingDoc}/verify`).set(tok(otherUser)).send({});
    expect(verify.status).toBe(403);
    const asCoach = await api().post(`/api/documents/${pendingDoc}/verify`).set(tok(coach)).send({});
    expect(asCoach.status).toBe(403);
    const [d1] = await pg.sql(`select status, verified from student_documents where id = '${pendingDoc}'`);
    expect(d1).toMatchObject({ status: "pending", verified: false });

    // a correction citing the pending document, once approved, does not verify it
    const created = await api().post(`${S}/me/identity-corrections`).set(tok(otherUser)).send({ changes: { last_name: "Otherwise" }, reason: "Marriage name change documented", evidence_document_id: pendingDoc });
    expect(created.status).toBe(201);
    const approve = await api().post(`${S}/identity-corrections/${requestFrom(created.body).id}/resolve`).set(tok(staff)).send({ decision: "approve" });
    expect(approve.status).toBe(200);
    expect((await studentRow(pg, otherStudent.id)).last_name).toBe("Otherwise");
    const [d2] = await pg.sql(`select status, verified, verified_by from student_documents where id = '${pendingDoc}'`);
    expect(d2).toMatchObject({ status: "pending", verified: false, verified_by: null });

    // the student's own verified id document is untouched as well
    const [d3] = await pg.sql(`select status, verified from student_documents where id = '${idDocId}'`);
    expect(d3).toMatchObject({ status: "verified", verified: true });
  });

  // ── 15: canonical invariants ─────────────────────────────────────────────
  it("15. canonical credit, roadmap and billing tables are identical before and after the whole profile journey", async () => {
    expect(protectedList).toEqual(expect.arrayContaining(["student_credit_records", "student_program_assignments"]));
    expect(protectedList.some((t) => t.startsWith("student_roadmap_"))).toBe(true);
    const after = await snapshotTables(pg, protectedList);
    expect(after).toEqual(journeyBefore);
    expect(after.student_credit_records.count).toBeGreaterThan(0);
  });

  // ── 16: deactivated accounts ─────────────────────────────────────────────
  it("16. a deactivated account gets 403 ACCOUNT_INACTIVE on profile, update, contacts, photo and corrections", async () => {
    resetStorageMocks();
    const before = await studentRow(pg, student.id);
    mocks.inactive.add(studentUser.id);
    try {
      const calls: Array<[string, request.Test]> = [
        ["GET /me/profile", api().get(`${S}/me/profile`).set(tok(studentUser))],
        ["PUT /:id", api().put(`${S}/${student.id}`).set(tok(studentUser)).send({ address_city: "Ghost Town" })],
        ["POST contacts", api().post(`${S}/${student.id}/contacts`).set(tok(studentUser)).send({ type: "emergency", full_name: "Ghost", relationship: "Friend", phone: "+15550606060", email: null, language: null, scopes: ["emergency"] })],
        ["POST photo", api().post(`${S}/${student.id}/photo`).set(tok(studentUser)).attach("photo", VALID_PNG, { filename: "a.png", contentType: "image/png" })],
        ["POST corrections", api().post(`${S}/me/identity-corrections`).set(tok(studentUser)).send({ changes: { first_name: "Ghost" }, reason: "Deactivated account attempt" })],
        ["GET corrections", api().get(`${S}/me/identity-corrections`).set(tok(studentUser))],
      ];
      for (const [label, call] of calls) {
        const res = await call;
        expect(res.status, label).toBe(403);
        expect(code(res), label).toBe("ACCOUNT_INACTIVE");
      }
    } finally {
      mocks.inactive.delete(studentUser.id);
    }
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(await studentRow(pg, student.id)).toEqual(before);
    expect((await pg.sql(`select 1 from student_contacts where full_name = 'Ghost'`)).length).toBe(0);
    const ok = await api().get(`${S}/me/profile`).set(tok(studentUser));
    expect(ok.status).toBe(200);
  });

  // ── staff permissions ────────────────────────────────────────────────────
  it("staff-only endpoints: coach denied, staff and admin allowed, anonymous 401", async () => {
    const paths = [
      `${S}/${student.id}/profile`,
      `${S}/identity-corrections?status=pending`,
      `${S}/${student.id}/identity-corrections`,
    ];
    for (const p of paths) {
      expect((await api().get(p).set(tok(coach))).status, `coach ${p}`).toBe(403);
      expect((await api().get(p)).status, `anon ${p}`).toBe(401);
      expect((await api().get(p).set(tok(staff))).status, `staff ${p}`).toBe(200);
      expect((await api().get(p).set(tok(admin))).status, `admin ${p}`).toBe(200);
    }
    const resolveCoach = await api().post(`${S}/identity-corrections/nonexistent/resolve`).set(tok(coach)).send({ decision: "approve" });
    expect(resolveCoach.status).toBe(403);
    const authCoach = await api().post(`${S}/contacts/nonexistent/authority`).set(tok(coach)).send({ decision: "verify", note: "coach attempt" });
    expect(authCoach.status).toBe(403);
    // staff may change staff-controlled fields (but never the login email)
    const staffEdit = await api().put(`${S}/${student.id}`).set(tok(staff)).send({ hs_completion: true });
    expect(staffEdit.status).toBe(200);
    expect((await studentRow(pg, student.id)).hs_completion).toBe(true);
    // staff profile view carries the reviewer id; student view never does (see test 7)
    const view = await api().get(`${S}/${student.id}/profile`).set(tok(staff));
    expect(view.body.identity.studentId).toBe(student.id);
    // unknown request ids are 404 for staff
    const missing = await api().post(`${S}/identity-corrections/00000000-0000-0000-0000-000000000000/resolve`).set(tok(staff)).send({ decision: "approve" });
    expect(missing.status).toBe(404);
  });

  // ── acceptance journey (writes a JSON transcript) ────────────────────────
  it("acceptance journey", async () => {
    resetStorageMocks();
    const jUser = await seedUser(pg, "student", "journey");
    const jStudent = await seedStudent(pg, { userId: jUser.id, firstName: "Jordan", lastName: "Rivera" });
    await linkLoginEmail(jStudent, jUser);
    await pg.sql(`update students set gov_id_type = 'Passport', gov_id_number = 'Q55512349', hs_completion = true, hs_path = 'local_diploma', hs_school = 'Synthetic High', hs_country = 'US', hs_year = 2008 where id = '${jStudent.id}'`);
    await seedAcademicRecord(pg, jStudent.id, { staffUserId: staff.id });
    const jDoc = await seedIdDocument(pg, jStudent.id, { status: "verified" });
    const tables = await protectedTables(pg);
    const before = await snapshotTables(pg, tables);

    const transcript: Array<Record<string, unknown>> = [];
    const J = { jUser };
    const record = (step: number, title: string, method: string, url: string, res: request.Response, observed: Record<string, unknown>) => {
      transcript.push({ step, title, request: `${method} ${url.replace(jStudent.id, ":studentId")}`, status: res.status, observed });
    };

    // 1 sign in (local JWT) + 2 open profile
    const profile0 = await api().get(`${S}/me/profile`).set(tok(J.jUser));
    expect(profile0.status).toBe(200);
    record(1, "Sign in as a synthetic student (local JWT verified by requireAuth)", "GET", `${S}/me/profile`, profile0, { authenticatedAs: "student" });
    record(2, "Open the profile", "GET", `${S}/me/profile`, profile0, {
      sections: Object.keys(profile0.body),
      identityVerification: profile0.body.identity.verification,
      govIdNumberMasked: profile0.body.identity.govIdNumberMasked,
      readinessItems: profile0.body.readiness.length,
    });

    // 3 update phone / address / preferences
    const edit = { phone_primary: "+15553334444", address_line1: "9 Journey Road", address_city: "Denver", address_state: "CO", address_postal: "80202", address_country: "US", preferred_contact_channel: "sms", timezone: "America/Denver", marketing_opt_in: false };
    const put = await api().put(`${S}/${jStudent.id}`).set(tok(J.jUser)).send(edit);
    expect(put.status).toBe(200);
    record(3, "Update phone, address and communication preferences", "PUT", `${S}/${jStudent.id}`, put, { fieldsSent: Object.keys(edit) });

    // 4 re-fetch
    const profile1 = await api().get(`${S}/me/profile`).set(tok(J.jUser));
    expect(profile1.body.contact).toMatchObject({ phonePrimary: "+15553334444", addressCity: "Denver", preferredContactChannel: "sms" });
    record(4, "Re-fetch: changes persisted", "GET", `${S}/me/profile`, profile1, { phonePrimary: profile1.body.contact.phonePrimary, addressCity: profile1.body.contact.addressCity, preferredContactChannel: profile1.body.contact.preferredContactChannel });

    // 5 add an emergency contact
    const addC = await api().post(`${S}/${jStudent.id}/contacts`).set(tok(J.jUser)).send({ type: "emergency", full_name: "Casey Contact", relationship: "Sibling", phone: "+15550707070", email: null, language: "English", scopes: ["emergency"] });
    expect(addC.status).toBe(201);
    const profile2 = await api().get(`${S}/me/profile`).set(tok(J.jUser));
    const contact = profile2.body.contacts[0];
    record(5, "Add an emergency contact", "POST", `${S}/${jStudent.id}/contacts`, addC, { authorityStatus: contact.authorityStatus, effectiveScopes: contact.effectiveScopes, hasPortalAccess: contact.hasPortalAccess });

    // 6 read background and eligibility
    expect(profile2.body.academicBackground.highSchool.completionRecorded).toBe(true);
    record(6, "Read academic background and eligibility (read-only)", "GET", `${S}/me/profile`, profile2, {
      highSchool: profile2.body.academicBackground.highSchool,
      residency: profile2.body.eligibility.residency,
      documentStatuses: profile2.body.eligibility.documents.map((d: any) => `${d.docType}:${d.status}`),
    });

    // 7 request identity correction
    const corr = await api().post(`${S}/me/identity-corrections`).set(tok(J.jUser)).send({ changes: { last_name: "Rivera-Stone" }, reason: "Legal name changed after marriage; passport attached", evidence_document_id: jDoc });
    expect(corr.status).toBe(201);
    const corrId = requestFrom(corr.body).id;
    const mid = await studentRow(pg, jStudent.id);
    expect(mid.last_name).toBe("Rivera");
    record(7, "Request an identity correction (record unchanged until review)", "POST", `${S}/me/identity-corrections`, corr, { status: requestFrom(corr.body).status, lastNameInDbBeforeReview: mid.last_name });

    // 8 staff approves
    const queue = await api().get(`${S}/identity-corrections?status=pending`).set(tok(staff));
    expect(JSON.stringify(queue.body)).toContain(corrId);
    const approve = await api().post(`${S}/identity-corrections/${corrId}/resolve`).set(tok(staff)).send({ decision: "approve", note: "Passport and marriage certificate checked" });
    expect(approve.status).toBe(200);
    record(8, "Staff reviews the queue and approves", "POST", `${S}/identity-corrections/:requestId/resolve`, approve, { queueContainedRequest: true, decision: "approve" });

    // 9 student sees the result without extra privileges
    const profile3 = await api().get(`${S}/me/profile`).set(tok(J.jUser));
    expect(profile3.body.identity.lastName).toBe("Rivera-Stone");
    expect(profile3.body.identity.lastResolvedCorrection.status).toBe("approved");
    expect(profile3.body.identity.lastResolvedCorrection.reviewerUserId).toBeNull();
    const selfResolve = await api().post(`${S}/identity-corrections/${corrId}/resolve`).set(tok(J.jUser)).send({ decision: "approve" });
    expect(selfResolve.status).toBe(403);
    const stillStudent = await api().get(`${S}/identity-corrections?status=pending`).set(tok(J.jUser));
    expect(stillStudent.status).toBe(403);
    record(9, "Student sees the outcome and gains no privileges", "GET", `${S}/me/profile`, profile3, {
      lastName: profile3.body.identity.lastName,
      correctionStatus: profile3.body.identity.lastResolvedCorrection.status,
      role: profile3.body.account.role,
      studentCanResolveHttp: selfResolve.status,
      studentCanReadStaffQueueHttp: stillStudent.status,
    });

    // 10 other student blocked
    const blocked = await api().get(`${S}/${jStudent.id}/profile`).set(tok(otherUser));
    expect(blocked.status).toBe(403);
    const blockedPut = await api().put(`${S}/${jStudent.id}`).set(tok(otherUser)).send({ address_city: "Nowhere" });
    expect(blockedPut.status).toBe(403);
    record(10, "Another student is blocked from this profile", "GET", `${S}/${jStudent.id}/profile`, blocked, { readHttp: blocked.status, writeHttp: blockedPut.status });

    // 11–12 photo changed securely
    const photo = await api().post(`${S}/${jStudent.id}/photo`).set(tok(J.jUser)).attach("photo", VALID_PNG, { filename: "me.png", contentType: "image/png" });
    expect(photo.status).toBe(200);
    const fake = await api().post(`${S}/${jStudent.id}/photo`).set(tok(J.jUser)).attach("photo", NOT_AN_IMAGE, { filename: "me.png", contentType: "image/png" });
    expect(fake.status).toBe(400);
    const storedRef = String((await studentRow(pg, jStudent.id)).photo_url);
    expect(storedRef).not.toMatch(/^(https?:|data:)/);
    record(11, "Change the photo: magic bytes validated, stored privately, returned as a signed URL", "POST", `${S}/${jStudent.id}/photo`, photo, {
      validPngHttp: photo.status, fakePngHttp: fake.status, storedReferenceIsPublicUrl: false, signedUrlReturned: /\/sign\//.test(String(photo.body.photoUrl ?? photo.body.student?.photo_url)),
    });

    // 13 canonical snapshot unchanged
    const after = await snapshotTables(pg, tables);
    expect(after).toEqual(before);
    transcript.push({ step: 12, title: "Canonical credit, roadmap and billing tables unchanged by the whole journey", observed: { tablesChecked: tables, identical: true } });

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "acceptance-journey.json"),
      JSON.stringify({ generatedBy: "tests/s09-profile-http-e2e.test.ts", note: "Synthetic data, disposable local Postgres, real Express + requireAuth + RBAC; Supabase/audit/account-status mocked.", steps: transcript }, null, 2),
    );
  });
});
