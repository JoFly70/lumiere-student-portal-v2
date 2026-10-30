/**
 * S20 — synthetic first-student launch journey (local rehearsal; NOT a hosted-staging run).
 *
 * ONE Express app (production registerRoutes) over ONE disposable PostgreSQL 16 (all migrations incl. S18/S19/S20).
 * Composes the S13 stack (real requireAuth/RBAC with local JWTs, real HS service, students/documents/billing on
 * Postgres) and adds, per step, an honest BACKING label written to docs/recovery/s20/journey-results.json:
 *   DB        = the behaviour under test ran against real Postgres rows
 *   DB+MOCK   = real code and DB, but one external dependency is doubled (named in the label)
 *   MOCKED    = the dependency that decides the outcome is a test double
 * Doubled externally: Supabase Auth (createUser/verifyOtp/signIn/getUser), account-status lookup, audit sink, email,
 * storage (S08 fake), the four support tables (S08 in-memory fake, same as S13). Synthetic data only.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { StaffHighSchoolState, StudentHighSchoolView } from "../shared/high-school-contract";
import type { StaffBillingView, StudentBillingView } from "../shared/billing-contract";
import type { AcademicProjection } from "../shared/academic-projection-contract";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedUser, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";
import { applyS09Migration } from "./helpers/s09-apply-migration";
import { makeLocalJWT, seedActor, seedHsStudent, type Actor, type HsStudent } from "./helpers/s11-hs-e2e-extra";
import { makeS13Supabase } from "./helpers/s13-supabase-shim";
import { InvitationQuery } from "./helpers/s20-invitations-pg";

const holder = vi.hoisted(() => ({
  supabase: null as any,
  pg: null as any,
  InvitationQuery: null as any,
  inactive: new Set<string>(),
  confirmedEmails: new Set<string>(),
  createUser: vi.fn(),
  deleteUser: vi.fn(async () => ({ error: null })),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async (id: string) => (holder.inactive.has(id) ? "suspended" : "active")),
  isAccountActive: vi.fn(async (id: string) => !holder.inactive.has(id)),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    auth: { getUser: async (...a: unknown[]) => (await holder.getUser(...a)) ?? (await import("./helpers/s09-profile-stack")).fixtureProviderGetUser(...(a as [string])), admin: { createUser: (...a: unknown[]) => holder.createUser(...a), deleteUser: (...a: unknown[]) => holder.deleteUser(...a) } },
    from: (t: string) => {
      if (t === "account_invitations") return new holder.InvitationQuery(holder.pg);
      if (t === "users" || t === "profiles") {
        const ok = Promise.resolve({ data: null, error: null });
        return { insert: () => ok, delete: () => ({ eq: () => ok }), select: () => ({ eq: () => ({ maybeSingle: () => ok }) }) };
      }
      return holder.supabase.client.from(t);
    },
    get storage() { return holder.supabase.client.storage; },
  },
  createUserAuthClient: () => ({ auth: { signInWithPassword: (...a: unknown[]) => holder.signIn(...a), verifyOtp: (...a: unknown[]) => holder.verifyOtp(...a), resend: vi.fn(async () => ({ error: null })) } }),
  isSupabaseConfigured: true,
}));
vi.mock("../server/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, typeof v === "function" ? vi.fn().mockResolvedValue(undefined) : v]));
});
vi.mock("../server/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(false),
  deliverEmail: vi.fn().mockResolvedValue("not_configured"), emailTransportConfigured: vi.fn(() => false),
  sendTicketCreatedEmailToStaff: vi.fn(), sendTicketStatusUpdateEmail: vi.fn(), sendNewCommentEmail: vi.fn(),
}));

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const OUT = path.resolve(import.meta.dirname, "..", "docs/recovery/s20/journey-results.json");
type Backing = "DB" | "DB+MOCK" | "MOCKED";
const results: { id: string; title: string; backing: Backing; mocked?: string; status: "pass" | "fail"; numbers?: Record<string, unknown>; note?: string }[] = [];

const ELECTIVES = [
  { key: "elective-art", title: "Synthetic Art", halfUnits: 2 },
  { key: "elective-music", title: "Synthetic Music", halfUnits: 2 },
  { key: "elective-coding", title: "Synthetic Coding", halfUnits: 2 },
  { key: "elective-drama", title: "Synthetic Drama", halfUnits: 2 },
  { key: "elective-half-a", title: "Synthetic Seminar A (0.5 credit)", halfUnits: 1 },
  { key: "elective-half-b", title: "Synthetic Seminar B (0.5 credit)", halfUnits: 1 },
];

describe.skipIf(!PG_BINARIES_AVAILABLE)("S20 first student launch journey (local rehearsal)", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let staff: Actor, admin: Actor, s1User: Actor;
  let other: HsStudent;
  let support: ReturnType<typeof makeS13Supabase>["fake"];
  let s1Id = "", s1Code = "", eid = "", docRejectedId = "", docVerifiedId = "";

  const api = () => request(base);
  const A = (sid: string) => `/api/admin/students/${sid}/high-school`;
  const AE = (sid: string, e: string) => `${A(sid)}/enrollments/${e}`;
  const BILL = (sid: string) => `/api/admin/students/${sid}/billing`;
  const ok = (res: request.Response, label = "request"): any => {
    if (res.status >= 300) throw new Error(`${label} failed ${res.status}: ${JSON.stringify(res.body).slice(0, 500)}`);
    return res.body;
  };
  const staffState = async (): Promise<StaffHighSchoolState> => ok(await api().get(A(s1Id)).set(staff.auth), "staff state");
  const studentView = async (who: Actor): Promise<StudentHighSchoolView> => ok(await api().get("/api/student/high-school").set(who.auth), "student view");
  const projection = async (who: Actor): Promise<AcademicProjection> => ok(await api().get("/api/student/academic-projection").set(who.auth), "projection");
  const billingView = async (who: Actor): Promise<StudentBillingView> => ok(await api().get("/api/student/billing").set(who.auth), "student billing");
  const upload = async (who: Actor, docType: string, name: string) => {
    const storage_path = `students/${s1Code}/${docType}/${Date.now()}${Math.floor(Math.random() * 1000)}_${name}`;
    support.addStorageObject(storage_path);
    return api().post(`/api/documents/student/${s1Id}`).set(who.auth).send({ doc_type: docType, file_name: name, storage_path });
  };

  function step(id: string, title: string, backing: Backing, mocked: string | undefined, fn: (rec: (n: Record<string, unknown>) => void) => Promise<void>) {
    it(`${id}. ${title}`, async () => {
      let numbers: Record<string, unknown> = {};
      try {
        await fn((x) => { numbers = { ...numbers, ...x }; });
        results.push({ id, title, backing, mocked, status: "pass", numbers });
      } catch (e) {
        results.push({ id, title, backing, mocked, status: "fail", numbers, note: String((e as Error).message).slice(0, 400) });
        throw e;
      }
    }, 120_000);
  }

  beforeAll(async () => {
    pg = await startLocalPg();
    await applyS09Migration(pg);
    process.env.DATABASE_URL = pg.url;
    delete process.env.ALLOW_DEMO_MODE;
    holder.pg = pg;
    holder.InvitationQuery = InvitationQuery;
    const sb = makeS13Supabase(pg);
    holder.supabase = sb;
    support = sb.fake;
    staff = await seedActor(pg, "staff");
    admin = await seedActor(pg, "admin");
    other = await seedHsStudent(pg, "Other");
    const { registerRoutes } = await import("../server/routes");
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    server = await registerRoutes(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 300_000);

  afterAll(async () => {
    try {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      const sorted = [...results].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      fs.writeFileSync(OUT, JSON.stringify({
        journey: "S20 first student launch (local rehearsal, throwaway Postgres 16; no hosted environment)",
        counts: { pass: sorted.filter((r) => r.status === "pass").length, fail: sorted.filter((r) => r.status === "fail").length },
        steps: sorted,
      }, null, 2) + "\n");
    } catch (e) { console.warn("could not write S20 evidence", e); }
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await pg?.stop();
  }, 60_000);

  // ── J1-J3 invitation, signup gating, email verification ───────────────────────────────────────────────────────
  let inviteToken = "";
  const INVITE_EMAIL = "Ada.Journey@Example.test";

  step("J1", "admin issues an invitation; only the SHA-256 hash is stored; staff/students cannot issue", "DB", undefined, async (rec) => {
    expect((await api().post("/api/admin/invitations").set(staff.auth).send({ email: INVITE_EMAIL })).status).toBe(403);
    const res = await api().post("/api/admin/invitations").set(admin.auth).send({ email: INVITE_EMAIL });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    inviteToken = res.body.token;
    expect(inviteToken.length).toBeGreaterThan(20);
    const [row] = await pg.sql(`select email, token_hash, role, consumed_at, claimed_at from account_invitations where email = 'ada.journey@example.test'`);
    expect(row!.token_hash).not.toBe(inviteToken);
    expect(row!.token_hash).toBe(crypto.createHash("sha256").update(inviteToken).digest("hex"));
    expect(row).toMatchObject({ role: "student", consumed_at: null, claimed_at: null });
    rec({ staffIssue: 403, adminIssue: res.status, hashOnly: true, emailNormalizedLowercase: true });
  });

  step("J2", "signup is invitation-gated and, with ENABLE_EMAIL_VERIFICATION=true, creates an UNCONFIRMED account with no session", "DB+MOCK", "Supabase Auth createUser/signIn (provider behaviour emulated); invitation rows are real", async (rec) => {
    process.env.ENABLE_EMAIL_VERIFICATION = "true";
    const body = { email: INVITE_EMAIL, password: "Correct-horse-9!", fullName: "Ada Journey" };
    const noToken = await api().post("/api/auth/signup").send(body);
    expect(noToken.status).toBe(403);
    expect(noToken.body.code).toBe("INVITATION_REQUIRED");
    const wrongEmail = await api().post("/api/auth/signup").send({ ...body, email: "someone.else@example.test", invitationToken: inviteToken });
    expect(wrongEmail.status).toBe(403);
    expect(wrongEmail.body.code).toBe("INVITATION_INVALID");
    expect(holder.createUser).not.toHaveBeenCalled();

    // a failed provider call releases the invitation (still reusable)
    holder.createUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "provider down" } });
    const failed = await api().post("/api/auth/signup").send({ ...body, invitationToken: inviteToken });
    expect(failed.status).toBe(400);
    expect((await pg.sql(`select claimed_at, consumed_at from account_invitations where email='ada.journey@example.test'`))[0]).toMatchObject({ claimed_at: null, consumed_at: null });

    const newUserId = crypto.randomUUID();
    holder.createUser.mockImplementationOnce(async (arg: { email: string; email_confirm: boolean }) => {
      if (!arg.email_confirm) holder.confirmedEmails.delete(arg.email); else holder.confirmedEmails.add(arg.email);
      // the real route inserts public.users via the (stubbed) client; mirror that row in real Postgres so consumed_by's FK holds
      await pg.sql(`insert into users (id, email, name, role) values ('${newUserId}', '${arg.email}', 'Ada Journey', 'student')`);
      return { data: { user: { id: newUserId, email: arg.email } }, error: null };
    });
    holder.signIn.mockImplementation(async ({ email }: { email: string }) =>
      holder.confirmedEmails.has(email) ? { data: { session: { access_token: "a", refresh_token: "b", expires_at: 1 } }, error: null } : { data: { session: null }, error: { message: "Email not confirmed" } });
    const created = await api().post("/api/auth/signup").send({ ...body, invitationToken: inviteToken });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(holder.createUser.mock.calls.at(-1)![0]).toMatchObject({ email: "ada.journey@example.test", email_confirm: false });
    expect(created.body.session).toBeUndefined();
    const [inv] = await pg.sql(`select consumed_at, consumed_by from account_invitations where email='ada.journey@example.test'`);
    expect(inv!.consumed_at).not.toBeNull();
    expect(inv!.consumed_by).toBe(newUserId);
    const reuse = await api().post("/api/auth/signup").send({ ...body, invitationToken: inviteToken });
    expect(reuse.status).toBe(403);
    expect(reuse.body.code).toBe("INVITATION_INVALID");
    rec({ noToken: 403, wrongEmail: 403, providerFailureReleasedInvitation: true, createdUnconfirmed: true, sessionReturned: false, reuse: 403 });
  });

  step("J3", "email verification: only a provider-confirmed email counts; unconfirmed/invalid links never report success", "MOCKED", "Supabase verifyOtp/getUser answers are scripted; the route, validation and response contract are real", async (rec) => {
    const url = "/api/auth/verify-email";
    expect((await api().post(url).send({})).status).toBe(400);
    holder.verifyOtp.mockResolvedValueOnce({ data: { user: { email_confirmed_at: null } }, error: null });
    const unconfirmed = await api().post(url).send({ token_hash: "pkce_unconfirmed123", type: "signup" });
    expect(unconfirmed.body.verified).toBe(false);
    expect(unconfirmed.status).toBeGreaterThanOrEqual(400);
    holder.verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: { message: "Token has expired" } });
    const expired = await api().post(url).send({ token_hash: "pkce_expired123456", type: "signup" });
    expect(expired.body.verified).toBe(false);
    expect(expired.body.code).toBe("INVALID_OR_EXPIRED");
    holder.verifyOtp.mockResolvedValueOnce({ data: { user: { email_confirmed_at: "2026-10-27T10:00:00Z" } }, error: null });
    const good = await api().post(url).send({ token_hash: "pkce_confirmed12345", type: "signup" });
    expect(good.status).toBe(200);
    expect(good.body.verified).toBe(true);
    expect(JSON.stringify(good.body)).not.toContain("pkce_confirmed12345");
    // a bare token with no provider confirmation is not success
    holder.getUser.mockResolvedValueOnce({ data: { user: { email_confirmed_at: null } }, error: null });
    const bare = await api().post(url).send({ access_token: "aaaa1111.bbbb2222.cccc3333" });
    expect(bare.body.verified).toBe(false);
    rec({ missing: 400, unconfirmed: unconfirmed.status, expired: expired.status, confirmed: 200, credentialEchoed: false });
  });

  // ── J4 session handling ──────────────────────────────────────────────────────────────────────────────────────
  step("J4", "session handling: valid token works; expired, tampered, forged-issuer and absent tokens are 401; suspended account is refused", "DB+MOCK", "account-status lookup is doubled; JWT verification and RBAC are real (local-JWT dev path, not Supabase JWTs)", async (rec) => {
    s1User = await seedActor(pg, "student");
    const secret = process.env.SESSION_SECRET || "local-dev-secret-change-in-production";
    const mint = (over: Record<string, unknown>, sign = true) => {
      const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const now = Math.floor(Date.now() / 1000);
      const p = Buffer.from(JSON.stringify({ userId: s1User.id, email: s1User.email, iss: "lumiere-local", iat: now, exp: now + 3600, ...over })).toString("base64url");
      const s = sign ? crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url") : "AAAA";
      return { Authorization: `Bearer ${h}.${p}.${s}` };
    };
    const probe = (h: Record<string, string> | object) => api().get("/api/student/billing").set(h as Record<string, string>);
    expect((await probe(s1User.auth)).status).toBeLessThan(500); // linked or not, authenticated requests are not 401
    expect((await probe(s1User.auth)).status).not.toBe(401);
    const expired = await probe(mint({ exp: Math.floor(Date.now() / 1000) - 10 }));
    const tampered = await probe(mint({}, false));
    const wrongIssuer = await probe(mint({ iss: "attacker" }));
    const none = await api().get("/api/student/billing");
    expect([expired.status, tampered.status, wrongIssuer.status, none.status]).toEqual([401, 401, 401, 401]);
    holder.inactive.add(s1User.id);
    const suspended = await probe(s1User.auth);
    holder.inactive.delete(s1User.id);
    expect(suspended.status).toBe(403);
    expect(suspended.body.code).toBe("ACCOUNT_INACTIVE");
    expect((await probe(s1User.auth)).status).not.toBe(403);
    rec({ expired: 401, tampered: 401, wrongIssuer: 401, noToken: 401, suspended: 403, reactivated: "ok" });
  });

  // ── J5-J7 student record, program, plan ───────────────────────────────────────────────────────────────────────
  step("J5", "staff creates the student record; admin links the login (account linkage)", "DB", "audit sink", async (rec) => {
    const body = {
      status: "active", first_name: "Ada", middle_name: null, last_name: "Journey", preferred_name: null, dob: "2009-04-12", sex: null, nationality: ["FR"],
      gov_id_type: null, gov_id_number: null, photo_url: null, residency: "us", hs_completion: false, hs_path: null, hs_country: null, hs_school: null, hs_year: null,
      hs_doc_url: null, email: s1User.email, phone_primary: "+15550001234", phone_secondary: null, whatsapp_primary: false, timezone: null,
      preferred_contact_channel: "email", address_country: "US", address_state: null, address_city: null, address_postal: null, address_line1: "1 Synthetic Way",
      address_line2: null, target_degree: null, target_major: null, start_term: null, prior_credits: false, prior_credits_est: null, prior_sources: [],
      transcripts_url: [], target_pace: null, marketing_opt_in: false, media_release: false, consent_signature: null,
    };
    expect((await api().post("/api/students").set(s1User.auth).send(body)).status).toBe(403);
    const res = await api().post("/api/students").set(staff.auth).send(body);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    s1Id = res.body.id; s1Code = res.body.student_code;
    expect((await api().get("/api/student/high-school").set(s1User.auth)).status).toBe(404); // unlinked
    const linked = await api().post(`/api/admin/students/${s1Id}/account/link`).set(admin.auth).send({ userId: s1User.id });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    rec({ created: 201, linked: true });
  });

  step("J6", "high-school enrollment + plan: 17 core courses = 16 core credits, 6 electives = 5 credits (incl. two 0.5-credit), total 21 credits = 42 half-units; admin publishes", "DB", "audit sink", async (rec) => {
    let st = ok(await api().post(`${A(s1Id)}/enrollments`).set(staff.auth).send({ templateKey: "us-hs-diploma-21", templateVersion: 2, status: "active" }), "enroll") as StaffHighSchoolState;
    eid = st.current!.enrollment.id;
    st = ok(await api().post(`${AE(s1Id, eid)}/roadmap/draft/from-template`).set(staff.auth).send({}), "draft");
    const draft = st.current!.draft!;
    const content = JSON.parse(JSON.stringify(draft.content));
    const core = content.courses.filter((c: any) => c.areaKey !== "electives");
    expect(core.reduce((n: number, c: any) => n + c.halfUnits, 0)).toBe(32);
    for (const e of ELECTIVES) content.courses.push({ key: e.key, title: e.title, areaKey: "electives", halfUnits: e.halfUnits, status: "planned", replacesCourseKey: null, plannedStart: null, plannedEnd: null, tasks: [] });
    const task = (key: string, title: string) => ({ key, kind: "lesson", title, dueDate: "2027-01-10" });
    content.courses.find((c: any) => c.key === "english-1").tasks = [task("lesson-1", "Unit 1 lessons")];
    content.courses.find((c: any) => c.key === "science-biology").tasks = [task("lab-1", "Lab 1")];
    st = ok(await api().put(`${AE(s1Id, eid)}/roadmap/draft`).set(staff.auth).send({ expectedDraftRevision: draft.draftRevision, content }), "save draft");
    expect(st.current!.draft!.content.courses.reduce((n: number, c: any) => n + c.halfUnits, 0)).toBe(42);
    const d2 = (await staffState()).current!.draft!;
    expect((await api().post(`${AE(s1Id, eid)}/roadmap/publish`).set(staff.auth).send({ expectedDraftRevision: d2.draftRevision, expectedPublishedVersionId: null })).status).toBe(403);
    ok(await api().post(`${AE(s1Id, eid)}/roadmap/publish`).set(admin.auth).send({ expectedDraftRevision: d2.draftRevision, expectedPublishedVersionId: null }), "publish");
    const v = await studentView(s1User);
    expect(v.credits).toMatchObject({ requiredHalfUnits: 42, earnedHalfUnits: 0 });
    expect(v.credits.core.requiredHalfUnits).toBe(32);
    expect(v.credits.elective.requiredHalfUnits).toBe(10);
    const programs = ok(await api().get("/api/student/programs").set(s1User.auth), "programs");
    expect(programs.programs.filter((p: any) => p.kind === "high_school")).toHaveLength(1);
    rec({ coreCourses: 17, coreHalfUnits: 32, electiveCourses: 6, electiveHalfUnits: 10, totalHalfUnits: 42, totalCredits: 21, highSchoolProgramRecognised: true });
  });

  step("J7", "academic projection before any evidence: nothing official, nothing invented (no graduation date, no earned credit)", "DB", undefined, async (rec) => {
    const p = await projection(s1User);
    expect(p.dataState).toBe("plan_published");
    expect(p.program.kind).toBe("high_school");
    expect(p.credits.total.requiredHalfUnits).toBe(42);
    expect(p.credits.total.officialHalfUnits).toBe(0);
    expect(p.credits.total.officialPercent).toBe(0);
    expect(p.credits.total.remainingHalfUnits).toBe(42);
    expect(p.credits.core.requiredHalfUnits).toBe(32);
    expect(p.credits.elective.requiredHalfUnits).toBe(10);
    expect(p.program.targetCompletionDate).toBeNull();
    expect(JSON.stringify(p)).not.toMatch(/graduat\w* (date|on)\b/i);
    rec({ required: 42, official: 0, targetCompletionDate: null, officialPercent: p.credits.total.officialPercent });
  });

  // ── J8 reported vs awaiting vs in-progress vs planned vs official ──────────────────────────────────────────────
  step("J8", "student reports progress: submitted -> awaiting_school, started -> in_progress, untouched -> planned; none of it is official credit", "DB", undefined, async (rec) => {
    ok(await api().post("/api/student/high-school/progress").set(s1User.auth).send({ courseKey: "english-1", taskKey: "lesson-1", status: "submitted", expectedRevision: 0 }), "report submitted");
    ok(await api().post("/api/student/high-school/progress").set(s1User.auth).send({ courseKey: "science-biology", taskKey: "lab-1", status: "in_progress", expectedRevision: 0 }), "report in progress");
    const p = await projection(s1User);
    const course = (k: string) => p.subjects.flatMap((s) => s.courses).find((c) => c.key === k)!;
    expect(course("english-1")).toMatchObject({ status: "awaiting_school", basis: "awaiting_school" });
    expect(course("science-biology")).toMatchObject({ status: "in_progress", basis: "in_progress" });
    expect(course("english-2").basis).toBe("planned");
    expect(p.credits.total.officialHalfUnits).toBe(0);
    expect(p.credits.total.awaitingSchoolHalfUnits).toBe(course("english-1").halfUnits);
    expect(p.credits.total.inProgressHalfUnits).toBe(course("science-biology").halfUnits);
    const t = p.credits.total;
    expect(t.officialHalfUnits + t.awaitingSchoolHalfUnits + t.inProgressHalfUnits + t.plannedHalfUnits).toBeLessThanOrEqual(42);
    rec({ official: t.officialHalfUnits, awaiting: t.awaitingSchoolHalfUnits, inProgress: t.inProgressHalfUnits, planned: t.plannedHalfUnits });
  });

  // ── J9 documents ──────────────────────────────────────────────────────────────────────────────────────────────
  step("J9", "document upload -> staff rejection with a student-visible reason (internal note hidden) -> student resubmission -> staff verification", "DB+MOCK", "object storage (the signed upload itself is not exercised); audit sink", async (rec) => {
    const first = await upload(s1User, "hs_transcript", "school-record-v1.pdf");
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    docRejectedId = first.body.id;
    expect(first.body).toMatchObject({ status: "pending", verified: false });
    expect((await api().post(`/api/documents/${docRejectedId}/reject`).set(s1User.auth).send({ student_message: "x" })).status).toBe(403);
    expect((await api().post(`/api/documents/${docRejectedId}/reject`).set(staff.auth).send({ admin_notes: "no reason" })).status).toBe(400);
    const rej = await api().post(`/api/documents/${docRejectedId}/reject`).set(staff.auth).send({ student_message: "The scan is cut off; please upload the full page.", admin_notes: "INTERNAL-S20: suspicious crop" });
    expect(rej.status, JSON.stringify(rej.body)).toBe(200);
    expect(rej.body.status).toBe("rejected");
    const list = await api().get(`/api/documents/student/${s1Id}`).set(s1User.auth);
    expect(list.status).toBe(200);
    const text = JSON.stringify(list.body);
    expect(text).toContain("The scan is cut off");
    expect(text).not.toContain("INTERNAL-S20");
    const second = await upload(s1User, "hs_transcript", "school-record-v2.pdf");
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    docVerifiedId = second.body.id;
    expect(docVerifiedId).not.toBe(docRejectedId);
    // a rejected document is not usable as official evidence
    const bad = await api().post(`${AE(s1Id, eid)}/results/course`).set(staff.auth).send({ courseKey: "english-1", outcome: "completed", evidenceDocumentId: docRejectedId });
    expect(bad.status).toBe(422);
    const ver = await api().post(`/api/documents/${docVerifiedId}/verify`).set(staff.auth).send({ admin_notes: "ok" });
    expect(ver.status, JSON.stringify(ver.body)).toBe(200);
    expect(ver.body).toMatchObject({ status: "verified", verified: true });
    expect((await pg.sql(`select status from student_documents where id='${docRejectedId}'`))[0]!.status).toBe("rejected");
    rec({ uploaded: 201, rejectedWithStudentMessage: true, internalNoteHiddenFromStudent: true, rejectedAsEvidence: 422, resubmitted: 201, verified: true });
  });

  step("J10", "official results from verified evidence: english-1 (2 half-units) + a 0.5-credit elective (1 half-unit) = 3 half-units; buckets stay distinct", "DB", "audit sink", async (rec) => {
    const r1 = ok(await api().post(`${AE(s1Id, eid)}/results/course`).set(staff.auth).send({ courseKey: "english-1", outcome: "completed", evidenceDocumentId: docVerifiedId }), "english-1");
    expect(r1.current.credits.earnedHalfUnits).toBe(2);
    const r2 = ok(await api().post(`${AE(s1Id, eid)}/results/course`).set(staff.auth).send({ courseKey: "elective-half-a", outcome: "completed", evidenceDocumentId: docVerifiedId }), "half elective");
    expect(r2.current.credits).toMatchObject({ earnedHalfUnits: 3, remainingHalfUnits: 39 });
    const p = await projection(s1User);
    expect(p.credits.total.officialHalfUnits).toBe(3);
    expect(p.credits.total.remainingHalfUnits).toBe(39);
    expect(p.credits.total.awaitingSchoolHalfUnits).toBe(0); // english-1 moved from awaiting to official, not double counted
    expect(p.credits.core.officialHalfUnits).toBe(2);
    expect(p.credits.elective.officialHalfUnits).toBe(1);
    expect(p.credits.total.officialPercent).toBeCloseTo((3 / 42) * 100, 0);
    const c = p.subjects.flatMap((s) => s.courses);
    expect(c.find((x) => x.key === "science-biology")!.basis).toBe("in_progress");
    expect(c.find((x) => x.key === "english-1")!.basis).toBe("official");
    const st = await staffState();
    expect(st.current!.graduation.status).toBe("in_progress");
    expect(st.current!.graduation.blockers.length).toBeGreaterThan(0);
    rec({ officialHalfUnits: 3, officialCredits: 1.5, remainingHalfUnits: 39, graduation: "in_progress", targetCompletionDate: p.program.targetCompletionDate });
  });

  // ── J11 isolation ─────────────────────────────────────────────────────────────────────────────────────────────
  step("J11", "access isolation: student B cannot read or change student A's projection, documents, billing, tickets or staff surfaces", "DB", undefined, async (rec) => {
    const o = other.user;
    expect((await api().get("/api/student/academic-projection").set(o.auth)).status).toBe(404); // B has no program of their own
    const q = await api().get(`/api/student/academic-projection?studentId=${s1Id}`).set(o.auth);
    expect(q.status).toBe(400);
    expect((await api().get(`/api/student/billing?studentId=${s1Id}`).set(o.auth)).status).toBe(400);
    expect((await api().get(`/api/documents/student/${s1Id}`).set(o.auth)).status).toBe(403);
    expect((await api().get(`/api/documents/${docVerifiedId}`).set(o.auth)).status).toBeGreaterThanOrEqual(403);
    expect((await api().get(A(s1Id)).set(o.auth)).status).toBe(403);
    expect((await api().get(BILL(s1Id)).set(o.auth)).status).toBe(403);
    expect((await api().post(`${BILL(s1Id)}/obligation`).set(o.auth).send({ agreedCents: 1, currency: "USD" })).status).toBe(403);
    const bBill = await billingView(o);
    expect(bBill.state).toBe("not_configured");
    expect((await api().get("/api/student/billing")).status).toBe(401);
    rec({ projectionOfOther: 404, queryStudentId: 400, documents: 403, staffHs: 403, staffBilling: 403, bBilling: bBill.state });
  });

  // ── J12 support ───────────────────────────────────────────────────────────────────────────────────────────────
  step("J12", "support: ticket creation, staff reply, student reply with Idempotency-Key sent twice => exactly one comment; internal notes hidden", "DB+MOCK", "support tables are the S08 in-memory fake (not in the local migration chain); the 20261031100000 unique index is covered by scripts/s20/verify-migrations.ts", async (rec) => {
    const created = await api().post("/api/tickets").set(s1User.auth).send({ subject: "Help with English 1", description: "I am unsure how to approach the first English 1 unit.", topic: "course_assistance" });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const id = created.body.ticket.id;
    expect((await api().post(`/api/tickets/${id}/comments`).set(staff.auth).send({ content: "Start with unit 1.", isInternal: false })).status).toBe(201);
    expect((await api().post(`/api/tickets/${id}/comments`).set(staff.auth).send({ content: "INTERNAL-S20 behind pace", isInternal: true })).status).toBe(201);
    const KEY = "journey-reply-key-0123456789";
    const r1 = await api().post(`/api/tickets/${id}/comments`).set(s1User.auth).set("Idempotency-Key", KEY).send({ content: "Thanks, I started unit 1." });
    const r2 = await api().post(`/api/tickets/${id}/comments`).set(s1User.auth).set("Idempotency-Key", KEY).send({ content: "Thanks, I started unit 1." });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r2.body.replayed).toBe(true);
    expect(r2.body.comment.id).toBe(r1.body.comment.id);
    const detail = await api().get(`/api/tickets/${id}`).set(s1User.auth);
    const mine = detail.body.ticket.ticket_comments.filter((c: any) => c.content === "Thanks, I started unit 1.");
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(detail.body)).not.toContain("INTERNAL-S20");
    expect(JSON.stringify((await api().get("/api/tickets").set(other.user.auth)).body)).not.toContain(id);
    expect((await api().get(`/api/tickets/${id}`).set(other.user.auth)).status).toBeGreaterThanOrEqual(403);
    rec({ created: 201, firstReply: 201, duplicateReply: 200, replayed: true, commentsWithText: 1, internalHidden: true });
  });

  // ── J13 billing ───────────────────────────────────────────────────────────────────────────────────────────────
  let evidenceId = "", receiptId = "";
  step("J13", "staff configure billing (obligation, discount, 4 installments); student sees exact integer-cent totals and no staff-only fields", "DB", "audit sink", async (rec) => {
    expect((await billingView(s1User)).state).toBe("not_configured");
    const post = (p: string, b: object) => api().post(`${BILL(s1Id)}/${p}`).set(staff.auth).send(b);
    ok(await post("obligation", { agreedCents: 1_200_000, currency: "usd", note: "internal-note-S20" }), "obligation");
    ok(await post("discounts", { amountCents: 200_000, reason: "Early enrollment INTERNAL" }), "discount");
    ok(await post("installments", { installments: [
      { dueDate: "2026-11-01", amountCents: 250_000, label: "Deposit" }, { dueDate: "2026-12-01", amountCents: 250_000 },
      { dueDate: "2027-01-01", amountCents: 250_000 }, { dueDate: "2027-02-01", amountCents: 250_000 }] }), "installments");
    const v = await billingView(s1User);
    expect(v).toMatchObject({ state: "configured", currency: "USD", agreedCents: 1_200_000, discountCents: 200_000, netObligationCents: 1_000_000, paidCents: 0, remainingCents: 1_000_000 });
    expect(JSON.stringify(v)).not.toMatch(/internal-note-S20|INTERNAL|confirmedBy|approvedBy/);
    expect((await api().post(`${BILL(s1Id)}/obligation`).set(s1User.auth).send({ agreedCents: 1, currency: "USD" })).status).toBe(403);
    rec({ net: v.netObligationCents, remaining: v.remainingCents, installments: v.installments?.length });
  });

  step("J14", "proof of payment: student-uploaded evidence never counts until staff confirm; confirming records an exact receipt", "DB+MOCK", "object storage for the proof file; audit sink", async (rec) => {
    const up = await upload(s1User, "other", "proof-of-payment.pdf");
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const reg = ok(await api().post(`${BILL(s1Id)}/evidence`).set(staff.auth).send({ documentId: up.body.id }), "register evidence") as StaffBillingView;
    evidenceId = reg.evidence.find((e) => e.documentId === up.body.id)!.id;
    const mid = await billingView(s1User);
    expect(mid.evidenceAwaitingReview).toHaveLength(1);
    expect(mid.paidCents).toBe(0);
    const c = ok(await api().post(`${BILL(s1Id)}/evidence/${evidenceId}/confirm`).set(staff.auth).send({ amountCents: 300_000, receivedDate: "2026-10-27", methodLabel: "Bank transfer", reference: "REF-S20" }), "confirm") as StaffBillingView;
    receiptId = c.receipts[0]!.id;
    const after = await billingView(s1User);
    expect(after).toMatchObject({ paidCents: 300_000, remainingCents: 700_000 });
    expect(after.evidenceAwaitingReview).toHaveLength(0);
    expect((await api().post(`${BILL(s1Id)}/evidence/${evidenceId}/confirm`).set(staff.auth).send({ amountCents: 300_000, receivedDate: "2026-10-27", methodLabel: "Bank transfer" })).status).toBe(409);
    expect(JSON.stringify(after)).not.toContain("REF-S20");
    rec({ awaitingBeforeConfirm: 1, paidBefore: 0, paidAfter: 300_000, remainingAfter: 700_000, secondConfirm: 409 });
  });

  step("J15", "correction: void the receipt (reason required) -> totals revert, evidence returns to review; same evidence backs ONE new receipt, never two", "DB", "audit sink", async (rec) => {
    const voidUrl = `${BILL(s1Id)}/receipts/${receiptId}/void`;
    expect((await api().post(voidUrl).set(staff.auth).send({})).status).toBe(400);
    expect((await api().post(voidUrl).set(s1User.auth).send({ reason: "x" })).status).toBe(403);
    const voided = ok(await api().post(voidUrl).set(staff.auth).send({ reason: "Entered against the wrong amount" }), "void") as StaffBillingView;
    expect(voided.voidedReceipts[0]).toMatchObject({ id: receiptId, amountCents: 300_000 });
    expect((await api().post(voidUrl).set(staff.auth).send({ reason: "again" })).status).toBe(409);
    const reverted = await billingView(s1User);
    expect(reverted).toMatchObject({ paidCents: 0, remainingCents: 1_000_000 });
    expect(reverted.evidenceAwaitingReview).toHaveLength(1); // proof is back in the review queue
    expect(JSON.stringify(reverted)).not.toMatch(/wrong amount|voided/i);
    const re = await api().post(`${BILL(s1Id)}/evidence/${evidenceId}/confirm`).set(staff.auth).send({ amountCents: 250_000, receivedDate: "2026-10-27", methodLabel: "Bank transfer" });
    expect(re.status, JSON.stringify(re.body)).toBe(200);
    expect((await api().post(`${BILL(s1Id)}/evidence/${evidenceId}/confirm`).set(staff.auth).send({ amountCents: 250_000, receivedDate: "2026-10-27", methodLabel: "Bank transfer" })).status).toBe(409);
    const [cnt] = await pg.sql(`select count(*) filter (where voided_at is null)::int a, count(*) filter (where voided_at is not null)::int v from student_billing_receipts where evidence_id = '${evidenceId}'`);
    expect(cnt).toMatchObject({ a: 1, v: 1 });
    const final = await billingView(s1User);
    expect(final).toMatchObject({ paidCents: 250_000, remainingCents: 750_000 });
    expect(Number.isInteger(final.paidCents) && Number.isInteger(final.remainingCents)).toBe(true);
    rec({ voidWithoutReason: 400, afterVoidPaid: 0, evidenceBackInReview: true, newReceiptPaid: 250_000, activeReceiptsOnEvidence: 1, voidedHistory: 1 });
  });
});
