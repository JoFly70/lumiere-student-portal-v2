/**
 * S32-B / SA-05 — student-scoped audit rows are really written and reach the student Activity feed.
 *
 * Production registerRoutes over a disposable PostgreSQL 16 with the FULL migration chain, so the
 * audit_logs foreign keys (target_user_id -> users(id)) are the real ones. The Supabase client is a
 * Postgres-backed double for students / student_documents / audit_logs; createAuditLog is the REAL
 * implementation (not mocked), so a rejected insert is counted exactly as in production.
 * Synthetic data only.
 */
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedUser, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";
import { seedActor, seedHsStudent, type Actor, type HsStudent } from "./helpers/s11-hs-e2e-extra";
import { seedContact } from "./helpers/s11-hs-stack";
import { makeS13Supabase } from "./helpers/s13-supabase-shim";
import { applyS09Migration } from "./helpers/s09-apply-migration";

const holder = vi.hoisted(() => ({ supabase: null as any, pg: null as any }));

/** audit_logs insert against the real table: same builder surface createAuditLog uses (insert().setHeader()). */
function auditInsert(row: Record<string, unknown>) {
  const run = async () => {
    const pg = holder.pg as LocalPg;
    const cols = Object.keys(row);
    const list = cols.map((c) => `"${c}"`).join(", ");
    try {
      await pg.client.unsafe(
        `insert into audit_logs (${list}) select ${list} from jsonb_populate_record(null::audit_logs, $1::jsonb)`,
        [pg.client.json(row as never)] as never[],
      );
      return { data: null, error: null };
    } catch (e: any) {
      return { data: null, error: { message: String(e?.message ?? e), code: e?.code } };
    }
  };
  const builder: any = { setHeader: () => builder, then: (ok: any, bad: any) => run().then(ok, bad) };
  return builder;
}

vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", async () => ({
  supabaseAdmin: {
    auth: { getUser: (await import("./helpers/s09-profile-stack")).fixtureProviderGetUser },
    from: (t: string) => (t === "audit_logs" ? { insert: auditInsert } : holder.supabase.client.from(t)),
    get storage() {
      return holder.supabase.client.storage;
    },
  },
  createUserAuthClient: vi.fn(),
  isSupabaseConfigured: true,
}));
vi.mock("../server/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(false),
  deliverEmail: vi.fn().mockResolvedValue("not_configured"), emailTransportConfigured: vi.fn(() => false),
  sendTicketCreatedEmailToStaff: vi.fn(),
  sendTicketStatusUpdateEmail: vi.fn(),
  sendNewCommentEmail: vi.fn(),
}));

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

interface FeedItem { eventType: string; description: string; actorRole: string | null }

describe.skipIf(!PG_BINARIES_AVAILABLE)("S32-B SA-05 — audit rows are written and visible in the student Activity feed", () => {
  let pg: LocalPg;
  let server: http.Server;
  let base: string;
  let admin: Actor;
  let staff: Actor;
  let student: HsStudent;
  let fake: ReturnType<typeof makeS13Supabase>["fake"];

  const api = () => request(base);
  const feed = async (studentId: string): Promise<FeedItem[]> => {
    const res = await api().get(`/api/admin/students/${studentId}/activity`).set(admin.auth);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.events;
  };
  /** Audit writes after the response are fire-and-forget: poll the feed until the expected entry shows. */
  const feedHas = async (studentId: string, pattern: RegExp): Promise<FeedItem[]> => {
    let events: FeedItem[] = [];
    for (let i = 0; i < 40; i++) {
      events = await feed(studentId);
      if (events.some((e) => pattern.test(e.description))) return events;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no feed entry matching ${pattern}; got ${JSON.stringify(events.map((e) => e.description))}`);
  };

  beforeAll(async () => {
    pg = await startLocalPg();
    await applyS09Migration(pg);
    holder.pg = pg;
    process.env.DATABASE_URL = pg.url;
    delete process.env.ALLOW_DEMO_MODE;
    const sb = makeS13Supabase(pg);
    holder.supabase = sb;
    fake = sb.fake;
    admin = await seedActor(pg, "admin");
    staff = await seedActor(pg, "staff");
    student = await seedHsStudent(pg, "Audit");
    const { registerRoutes } = await import("../server/routes");
    const app = express();
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

  it("root cause stays pinned: audit_logs.target_user_id is a real FK to users, so a students.id there is rejected and COUNTED", async () => {
    const { createAuditLog, getAuditFailureStats, resetAuditFailureStats } = await import("../server/lib/audit");
    resetAuditFailureStats();
    await createAuditLog({ eventType: "admin.bulk_operation", targetUserId: student.student.id, actionDescription: "fk probe" });
    const stats = getAuditFailureStats();
    expect(stats.total).toBe(1);
    expect(stats.byEventType["admin.bulk_operation"]).toBe(1);
    expect(stats.last?.message).toMatch(/foreign key|target_user_id/i);
    const rows = await pg.sql(`select count(*)::int as n from audit_logs where action_description = 'fk probe'`);
    expect(rows[0].n).toBe(0);
    resetAuditFailureStats();
  });

  it("document create, verify, reject and resubmit-request are written (no failures) and appear in the feed", async () => {
    const { getAuditFailureStats, resetAuditFailureStats } = await import("../server/lib/audit");
    resetAuditFailureStats();
    const sp = (n: string) => `students/${student.student.code}/hs_transcript/17900000000${n}_synthetic.pdf`;
    const make = async (n: string) => {
      const storage_path = sp(n);
      fake.addStorageObject(storage_path);
      const res = await api().post(`/api/documents/student/${student.student.id}`).set(student.user.auth)
        .send({ doc_type: "hs_transcript", file_name: "synthetic.pdf", storage_path });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.id as string;
    };
    const d1 = await make("1");
    const verified = await api().post(`/api/documents/${d1}/verify`).set(staff.auth).send({ admin_notes: "checked" });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    const d2 = await make("2");
    const rejected = await api().post(`/api/documents/${d2}/reject`).set(staff.auth).send({ student_message: "Please upload a clearer scan" });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);

    const events = await feedHas(student.student.id, /rejected document/);
    for (const re of [/created document/, /verified document/, /rejected document/]) {
      expect(events.some((e) => re.test(e.description)), String(re)).toBe(true);
    }
    // persisted with the student in metadata and NO users FK value
    const rows = await pg.sql(`select target_user_id, target_resource_type, metadata->>'studentId' as sid from audit_logs where target_resource_type = 'document'`);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      expect(r.target_user_id).toBeNull();
      expect(r.sid).toBe(student.student.id);
    }
    expect(getAuditFailureStats().total).toBe(0);
  });

  it("guardian authority decision is written and appears in the feed", async () => {
    const contactId = await seedContact(pg, student.student.id, { type: "guardian", authorityStatus: "pending_verification" });
    const res = await api().post(`/api/students/contacts/${contactId}/authority`).set(staff.auth).send({ decision: "verify", note: "Court order sighted" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await feedHas(student.student.id, /authority_verify contact/);
  });

  it("student create appears in the feed; activation (lead -> active) is written and shown even with no linked login", async () => {
    const body = {
      status: "lead", first_name: "Lea", middle_name: null, last_name: "Audit", preferred_name: null,
      dob: "2009-04-12", sex: null, nationality: ["FR"], gov_id_type: null, gov_id_number: null, photo_url: null,
      residency: "us", hs_completion: false, hs_path: null, hs_country: null, hs_school: null, hs_year: null, hs_doc_url: null,
      email: "lead.audit@synthetic.invalid", phone_primary: "+15550001234", phone_secondary: null, whatsapp_primary: false, timezone: null,
      preferred_contact_channel: "email", address_country: "US", address_state: null, address_city: null, address_postal: null,
      address_line1: "1 Synthetic Way", address_line2: null, target_degree: null, target_major: null, start_term: null,
      prior_credits: false, prior_credits_est: null, prior_sources: [], transcripts_url: [], target_pace: null,
      marketing_opt_in: false, media_release: false, consent_signature: null,
    };
    const created = await api().post("/api/students").set(staff.auth).send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const leadId = created.body.id as string;
    expect(created.body.user_id).toBeNull();
    await feedHas(leadId, /created student/);

    const activated = await api().patch(`/api/admin/students/${leadId}/status`).set(admin.auth).send({ status: "active" });
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    const events = await feedHas(leadId, /Changed student status to active/);
    expect(events.length).toBeGreaterThanOrEqual(2);

    // duplicate email -> clear 409 with a pointer to the existing record (SA-32)
    const dup = await api().post("/api/students").set(staff.auth).send(body);
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: "STUDENT_EMAIL_EXISTS", existingStudentId: leadId });
  });

  it("account unlink for a student with no linked login (after unlink) is in the feed", async () => {
    const created = await seedUser(pg, "student");
    // a student record created through the API, linked then unlinked by the admin
    const leadRes = await api().post("/api/students").set(staff.auth).send({
      status: "lead", first_name: "Una", middle_name: null, last_name: "Link", preferred_name: null,
      dob: "2009-04-12", sex: null, nationality: [], gov_id_type: null, gov_id_number: null, photo_url: null,
      residency: "us", hs_completion: false, hs_path: null, hs_country: null, hs_school: null, hs_year: null, hs_doc_url: null,
      email: created.email, phone_primary: "+15550001234", phone_secondary: null, whatsapp_primary: false, timezone: null,
      preferred_contact_channel: "email", address_country: "US", address_state: null, address_city: null, address_postal: null,
      address_line1: "1 Synthetic Way", address_line2: null, target_degree: null, target_major: null, start_term: null,
      prior_credits: false, prior_credits_est: null, prior_sources: [], transcripts_url: [], target_pace: null,
      marketing_opt_in: false, media_release: false, consent_signature: null,
    });
    expect(leadRes.status, JSON.stringify(leadRes.body)).toBe(201);
    const id = leadRes.body.id as string;
    const link = await api().post(`/api/admin/students/${id}/account/link`).set(admin.auth).send({ userId: created.id });
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    const unlink = await api().post(`/api/admin/students/${id}/account/unlink`).set(admin.auth).send({ reason: "Linked to the wrong login" });
    expect(unlink.status, JSON.stringify(unlink.body)).toBe(200);
    const [s] = await pg.sql(`select user_id from students where id = '${id}'`);
    expect(s.user_id).toBeNull();
    const events = await feedHas(id, /Unlinked portal account/);
    expect(events.some((e) => /Linked portal account/.test(e.description))).toBe(true);
  });

  it("credit placement create is written with the student and appears in that student's feed", async () => {
    const FINGERPRINT = `sha256:${"a".repeat(64)}`;
    const PLACEMENT_ID = "60000000-0000-4000-8000-000000000001";
    const { createAdminStudentCreditPlacementRouter } = await import("../server/routes/admin-student-credit-placement");
    const { createAuditLog } = await import("../server/lib/audit");
    const placementApp = express();
    placementApp.use(express.json());
    placementApp.use("/api/admin", createAdminStudentCreditPlacementRouter({
      resolveContext: async () => ({ studentId: student.student.id, programAssignmentId: "10000000-0000-4000-8000-000000000001", programVersionId: "20000000-0000-4000-8000-000000000001" }),
      getProgress: async () => ({ snapshot: { fingerprint: FINGERPRINT } }),
      placementService: {
        assertPlacementContext: async () => ({}),
        createPlacement: async () => ({ id: PLACEMENT_ID }),
        supersedePlacement: async () => ({}),
        revokePlacement: async () => ({}),
      },
      audit: createAuditLog,
      readSnapshotInTransaction: async () => ({ status: "ACCEPTED", academicSnapshot: { status: "ACCEPTED", snapshotFingerprint: FINGERPRINT } }),
    } as never));
    const res = await request(placementApp).post(`/api/admin/students/${student.student.id}/placements`).set(admin.auth).send({
      expectedSnapshotFingerprint: FINGERPRINT,
      studentCreditDecisionId: "30000000-0000-4000-8000-000000000001",
      requirementId: "40000000-0000-4000-8000-000000000001",
      academicRuleId: "50000000-0000-4000-8000-000000000001",
      rationale: "Operator selected canonical requirement",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await feedHas(student.student.id, /create student_credit_placement/);
    // another student's feed does not include it
    const other = await seedHsStudent(pg, "Other");
    expect((await feed(other.student.id)).some((e) => /student_credit_placement/.test(e.description))).toBe(false);
  });
});
