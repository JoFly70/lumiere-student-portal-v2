/**
 * S10 — guardian / contact authority: changes to already-verified permissions.
 *
 * Real Express app (registerRoutes), real requireAuth/RBAC, real disposable Postgres 16.
 * Mocked (external only): Supabase client, account-status lookup, audit sink (captured, so the
 * authority audit events can be asserted).
 *
 * Rule under test (server/services/student-profile-service.ts updateContact):
 *   verified + (name change | type change | any scope not already verified) -> pending_verification,
 *   authority_verified_by/at/note cleared. Pure narrowing (same name, same type, scopes a strict or
 *   equal subset) stays verified. revoked stays revoked on every edit. Students cannot change
 *   name/type/scopes/delete a verified contact (403 PROFILE_CONTACT_AUTHORITY_STAFF_MANAGED).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { makeLocalJWT, protectedTables, snapshotTables } from "./helpers/s09-profile-stack";

const mocks = vi.hoisted(() => ({ audit: [] as Array<Record<string, any>> }));

vi.mock("../server/lib/account-status", () => ({
  ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
  getAccountStatus: vi.fn(async () => "active"),
  isAccountActive: vi.fn(async () => true),
}));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "invalid token" } })) },
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
  createUserAuthClient: vi.fn(),
  isSupabaseConfigured: vi.fn(() => false),
}));
vi.mock("../server/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [k, typeof v === "function" ? vi.fn().mockResolvedValue(undefined) : v]),
  );
  out.writeAuditLog = vi.fn(async (entry: Record<string, any>) => {
    mocks.audit.push(entry);
  });
  return out;
});

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);
const ready = PG_BINARIES_AVAILABLE && s05MigrationExists();

describe.skipIf(!ready)("S10 contact authority — verified permissions are fail-closed", () => {
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

  const S = "/api/students";
  const api = () => request(base);
  const tok = (u: SeededUser) => ({ Authorization: `Bearer ${makeLocalJWT(u.id, u.email)}` });
  const code = (res: request.Response) => res.body?.code;

  const addContact = async (who: SeededUser, studentId: string, over: Record<string, unknown> = {}) => {
    const res = await api().post(`${S}/${studentId}/contacts`).set(tok(who)).send({
      type: "guardian",
      full_name: "Gina Guardian",
      relationship: "Mother",
      phone: "+15550101010",
      email: "gina@synthetic.example",
      language: "English",
      scopes: ["emergency", "academic"],
      ...over,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string };
  };
  const verify = async (id: string, note = "Court order sighted") => {
    const res = await api().post(`${S}/contacts/${id}/authority`).set(tok(staff)).send({ decision: "verify", note });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.authorityStatus).toBe("verified");
  };
  const row = async (id: string) => (await pg.sql(`select * from student_contacts where id = '${id}'`))[0];
  /** A verified guardian with scopes [emergency, academic, financial] unless overridden. */
  const verifiedContact = async (over: Record<string, unknown> = {}) => {
    const c = await addContact(studentUser, student.id, { scopes: ["emergency", "academic", "financial"], ...over });
    await verify(c.id);
    mocks.audit.length = 0; // setup events are not under test
    return c.id;
  };

  beforeAll(async () => {
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
    await seedAcademicRecord(pg, student.id, { staffUserId: staff.id });
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

  beforeEach(() => {
    mocks.audit.length = 0;
  });

  // ── student side (S09 rules must stay) ────────────────────────────────────
  it("student cannot change name, type or scopes of, or delete, a verified contact; may edit phone/email/language/relationship", async () => {
    const id = await verifiedContact();
    for (const body of [{ full_name: "Someone Else" }, { type: "other" }, { scopes: ["emergency", "academic", "financial", "release"] }, { scopes: ["emergency"] }]) {
      const res = await api().put(`${S}/contacts/${id}`).set(tok(studentUser)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(code(res)).toBe("PROFILE_CONTACT_AUTHORITY_STAFF_MANAGED");
    }
    const del = await api().delete(`${S}/contacts/${id}`).set(tok(studentUser));
    expect(del.status).toBe(403);
    expect(code(del)).toBe("PROFILE_CONTACT_AUTHORITY_STAFF_MANAGED");
    const ok = await api().put(`${S}/contacts/${id}`).set(tok(studentUser)).send({ phone: "+15550202020", email: "new@synthetic.example", language: "Spanish", relationship: "Guardian (mother)" });
    expect(ok.status).toBe(200);
    expect(ok.body.authorityStatus).toBe("verified");
    const r = await row(id);
    expect(r.authority_status).toBe("verified");
    expect(r.phone).toBe("+15550202020");
    expect(r.scopes).toEqual(["emergency", "academic", "financial"]);
    expect(mocks.audit.filter((a) => a.action?.startsWith("authority_"))).toEqual([]);
  });

  it("student cannot smuggle authority fields into a contact create or update (strict schema)", async () => {
    const id = await verifiedContact();
    for (const extra of [{ authority_status: "verified" }, { authority_verified_by: "x" }, { user_id: studentUser.id }, { student_id: otherStudent.id }]) {
      const put = await api().put(`${S}/contacts/${id}`).set(tok(studentUser)).send({ phone: "+15550303030", ...extra });
      expect(put.status, JSON.stringify(extra)).toBe(400);
    }
    const create = await api().post(`${S}/${student.id}/contacts`).set(tok(studentUser)).send({
      type: "guardian", full_name: "Forged", relationship: "x", phone: "+15550404040", email: null, language: null, scopes: ["financial"], authority_status: "verified",
    });
    expect(create.status).toBe(400);
    expect((await pg.sql(`select 1 from student_contacts where full_name = 'Forged'`)).length).toBe(0);
  });

  // ── staff edits of a verified contact ─────────────────────────────────────
  it("staff WIDENING scopes of a verified contact drops it to pending_verification, clears the verifier, and audits", async () => {
    const id = await verifiedContact({ scopes: ["emergency", "academic"] });
    expect((await row(id)).authority_verified_by).toBe(staff.id);
    const res = await api().put(`${S}/contacts/${id}`).set(tok(staff)).send({ scopes: ["emergency", "academic", "financial"] });
    expect(res.status).toBe(200);
    expect(res.body.authorityStatus).toBe("pending_verification");
    expect(res.body.authorityVerifiedAt).toBeNull();
    expect(res.body.requestedScopes).toEqual(["emergency", "academic", "financial"]);
    expect(res.body.effectiveScopes).toEqual(["emergency"]);
    const r = await row(id);
    expect(r.authority_status).toBe("pending_verification");
    expect(r.authority_verified_by).toBeNull();
    expect(r.authority_verified_at).toBeNull();
    expect(r.authority_note).toBeNull();
    const ev = mocks.audit.find((a) => a.action === "authority_reset");
    expect(ev).toMatchObject({
      entityType: "contact",
      entityId: id,
      studentId: student.id,
      actorId: staff.id,
      oldValue: { authority_status: "verified" },
      newValue: { authority_status: "pending_verification" },
    });
    // staff must explicitly re-verify
    await verify(id, "Re-sighted court order");
    expect((await row(id)).authority_verified_by).toBe(staff.id);
  });

  it("staff changing scopes to ones that include release/academic/financial when previously only emergency+one drops authority", async () => {
    for (const scopes of [["release"], ["emergency", "release"], ["financial", "academic"]]) {
      const id = await verifiedContact({ scopes: ["emergency", "academic"] });
      const res = await api().put(`${S}/contacts/${id}`).set(tok(admin)).send({ scopes });
      expect(res.status).toBe(200);
      expect(res.body.authorityStatus, JSON.stringify(scopes)).toBe("pending_verification");
      expect((await row(id)).authority_verified_by).toBeNull();
    }
  });

  it("staff NARROWING scopes keeps the contact verified for the remaining subset (audited as authority_narrowed)", async () => {
    const id = await verifiedContact({ scopes: ["emergency", "academic", "financial"] });
    const res = await api().put(`${S}/contacts/${id}`).set(tok(staff)).send({ scopes: ["emergency", "academic"] });
    expect(res.status).toBe(200);
    expect(res.body.authorityStatus).toBe("verified");
    expect(res.body.effectiveScopes).toEqual(["emergency", "academic"]);
    const r = await row(id);
    expect(r.authority_status).toBe("verified");
    expect(r.authority_verified_by).toBe(staff.id);
    expect(mocks.audit.find((a) => a.action === "authority_narrowed")).toMatchObject({ entityId: id, newValue: { authority_status: "verified", scopes: ["emergency", "academic"] } });
    // narrowing to nothing is still a pure subset
    const none = await api().put(`${S}/contacts/${id}`).set(tok(staff)).send({ scopes: [] });
    expect(none.body.authorityStatus).toBe("verified");
    expect(none.body.effectiveScopes).toEqual([]);
    // ...and widening back is a widening: it must drop
    const back = await api().put(`${S}/contacts/${id}`).set(tok(staff)).send({ scopes: ["emergency", "academic"] });
    expect(back.body.authorityStatus).toBe("pending_verification");
  });

  it("a scope swap (one removed, one new) is not a narrowing and drops authority", async () => {
    const id = await verifiedContact({ scopes: ["emergency", "academic"] });
    const res = await api().put(`${S}/contacts/${id}`).set(tok(staff)).send({ scopes: ["emergency", "release"] });
    expect(res.body.authorityStatus).toBe("pending_verification");
  });

  it("resubmitting identical scopes/name/type (whole-form save) does not drop verification", async () => {
    const id = await verifiedContact({ scopes: ["emergency", "academic"] });
    const res = await api().put(`${S}/contacts/${id}`).set(tok(staff)).send({
      type: "guardian", full_name: "Gina Guardian", scopes: ["academic", "emergency"], phone: "+15550505050",
    });
    expect(res.status).toBe(200);
    expect(res.body.authorityStatus).toBe("verified");
    expect(mocks.audit.filter((a) => a.action?.startsWith("authority_"))).toEqual([]);
  });

  it("changing the contact type into or out of guardian/representative drops authority", async () => {
    // out of guardian
    const a = await verifiedContact({ type: "guardian" });
    const outRes = await api().put(`${S}/contacts/${a}`).set(tok(staff)).send({ type: "parent" });
    expect(outRes.body.authorityStatus).toBe("pending_verification");
    // into representative
    const b = await verifiedContact({ type: "parent", scopes: ["emergency", "academic"] });
    const intoRes = await api().put(`${S}/contacts/${b}`).set(tok(staff)).send({ type: "representative" });
    expect(intoRes.body.authorityStatus).toBe("pending_verification");
    expect((await row(b)).authority_verified_by).toBeNull();
    // any other type change on a verified contact is also treated as a different person/role
    const c = await verifiedContact({ type: "parent", scopes: ["emergency", "academic"] });
    const otherRes = await api().put(`${S}/contacts/${c}`).set(tok(staff)).send({ type: "spouse" });
    expect(otherRes.body.authorityStatus).toBe("pending_verification");
  });

  it("changing the identity-relevant name on a verified contact drops authority (even case-only)", async () => {
    const a = await verifiedContact();
    const res = await api().put(`${S}/contacts/${a}`).set(tok(staff)).send({ full_name: "Gina Guardian-Smith" });
    expect(res.body.authorityStatus).toBe("pending_verification");
    expect(res.body.effectiveScopes).toEqual(["emergency"]);
    const b = await verifiedContact();
    const res2 = await api().put(`${S}/contacts/${b}`).set(tok(staff)).send({ full_name: "gina guardian" });
    expect(res2.body.authorityStatus).toBe("pending_verification");
  });

  // ── revoked ───────────────────────────────────────────────────────────────
  it("revoked stays revoked through student and staff edits; only an explicit staff verify restores it", async () => {
    const id = await verifiedContact();
    const rev = await api().post(`${S}/contacts/${id}/authority`).set(tok(staff)).send({ decision: "revoke", note: "Order expired" });
    expect(rev.body.authorityStatus).toBe("revoked");
    // a student can still tidy details, and even re-request scopes, but it cannot resurrect authority
    for (const [who, body] of [
      [studentUser, { phone: "+15550606060" }],
      [studentUser, { scopes: ["emergency", "academic", "financial", "release"] }],
      [studentUser, { type: "representative" }],
      [staff, { scopes: ["emergency", "release"] }],
      [staff, { full_name: "Gina Renamed" }],
    ] as const) {
      const res = await api().put(`${S}/contacts/${id}`).set(tok(who)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(res.body.authorityStatus, JSON.stringify(body)).toBe("revoked");
      expect(res.body.effectiveScopes.every((s: string) => s === "emergency")).toBe(true);
    }
    expect((await row(id)).authority_status).toBe("revoked");
    await verify(id, "New consent document on file");
    expect((await row(id)).authority_status).toBe("verified");
  });

  it("revoke, then the student deletes and re-adds the person: the new row is pending_verification, never inherits verification", async () => {
    const id = await verifiedContact();
    await api().post(`${S}/contacts/${id}/authority`).set(tok(staff)).send({ decision: "revoke", note: "Withdrawn by court" });
    const del = await api().delete(`${S}/contacts/${id}`).set(tok(studentUser));
    expect(del.status).toBe(204);
    const again = await addContact(studentUser, student.id, { scopes: ["emergency", "academic", "financial"] });
    expect(again.id).not.toBe(id);
    const r = await row(again.id);
    expect(r.authority_status).toBe("pending_verification");
    expect(r.authority_verified_by).toBeNull();
    const profile = await api().get(`${S}/me/profile`).set(tok(studentUser));
    const view = profile.body.contacts.find((c: any) => c.id === again.id);
    expect(view.effectiveScopes).toEqual(["emergency"]);
  });

  // ── pending / listed ──────────────────────────────────────────────────────
  it("pending contact edited by the student stays non-authoritative and recomputes from what is requested", async () => {
    const c = await addContact(studentUser, student.id, { type: "emergency", scopes: ["emergency"], full_name: "Erin Emergency" });
    expect((await row(c.id)).authority_status).toBe("listed");
    const up = await api().put(`${S}/contacts/${c.id}`).set(tok(studentUser)).send({ scopes: ["emergency", "release"] });
    expect(up.body.authorityStatus).toBe("pending_verification");
    expect(up.body.effectiveScopes).toEqual(["emergency"]);
    const down = await api().put(`${S}/contacts/${c.id}`).set(tok(studentUser)).send({ scopes: ["emergency"] });
    expect(down.body.authorityStatus).toBe("listed");
  });

  // ── isolation ─────────────────────────────────────────────────────────────
  it("another student cannot edit, delete or verify this student's contact; rows stay unchanged", async () => {
    const id = await verifiedContact();
    const before = await row(id);
    expect((await api().put(`${S}/contacts/${id}`).set(tok(otherUser)).send({ phone: "+15550707070" })).status).toBe(403);
    expect((await api().put(`${S}/contacts/${id}`).set(tok(otherUser)).send({ scopes: ["release"] })).status).toBe(403);
    expect((await api().delete(`${S}/contacts/${id}`).set(tok(otherUser))).status).toBe(403);
    expect((await api().post(`${S}/contacts/${id}/authority`).set(tok(otherUser)).send({ decision: "revoke", note: "malicious" })).status).toBe(403);
    expect((await api().get(`${S}/${student.id}/contacts`).set(tok(otherUser))).status).toBe(403);
    expect((await api().post(`${S}/${student.id}/contacts`).set(tok(otherUser)).send({ type: "emergency", full_name: "Injected", relationship: "x", phone: "+15550808080", email: null, language: null, scopes: ["emergency"] })).status).toBe(403);
    expect(await row(id)).toEqual(before);
    expect((await pg.sql(`select 1 from student_contacts where full_name = 'Injected'`)).length).toBe(0);
    // unknown id
    expect((await api().put(`${S}/contacts/00000000-0000-0000-0000-000000000000`).set(tok(studentUser)).send({ phone: "+15550909090" })).status).toBe(404);
  });

  it("the student cannot use their own contact ids to change another student's contact (id mixing)", async () => {
    const mine = await verifiedContact();
    const theirs = await addContact(otherUser, otherStudent.id, { type: "emergency", scopes: ["emergency"], full_name: "Olive Other" });
    const before = await row(theirs.id);
    const res = await api().put(`${S}/contacts/${theirs.id}`).set(tok(studentUser)).send({ phone: "+15551010101" });
    expect(res.status).toBe(403);
    expect(await row(theirs.id)).toEqual(before);
    expect((await row(mine)).student_id).toBe(student.id);
  });

  it("coach and anonymous callers cannot read, edit, delete or resolve authority", async () => {
    const id = await verifiedContact();
    const before = await row(id);
    const attempts: Array<[string, request.Test, number]> = [];
    const mk = (who: "coach" | "anon") => (t: request.Test) => (who === "coach" ? t.set(tok(coach)) : t);
    for (const [who, expected] of [["coach", 403], ["anon", 401]] as const) {
      const w = mk(who);
      attempts.push([`${who} GET`, w(api().get(`${S}/${student.id}/contacts`)), expected]);
      attempts.push([`${who} PUT`, w(api().put(`${S}/contacts/${id}`).send({ scopes: ["release"] })), expected]);
      attempts.push([`${who} DELETE`, w(api().delete(`${S}/contacts/${id}`)), expected]);
      attempts.push([`${who} POST`, w(api().post(`${S}/${student.id}/contacts`).send({ type: "guardian", full_name: "X Y", relationship: "x", phone: "+15551212121", email: null, language: null, scopes: ["release"] })), expected]);
      attempts.push([`${who} AUTHORITY`, w(api().post(`${S}/contacts/${id}/authority`).send({ decision: "revoke", note: "no standing" })), expected]);
    }
    for (const [label, t, expected] of attempts) {
      expect((await t).status, label).toBe(expected);
    }
    expect(await row(id)).toEqual(before);
  });

  it("admin and staff can verify/revoke; both are audited with the note", async () => {
    const id = await addContact(studentUser, student.id, { scopes: ["emergency", "release"] });
    const v = await api().post(`${S}/contacts/${id.id}/authority`).set(tok(admin)).send({ decision: "verify", note: "Notarised consent" });
    expect(v.status).toBe(200);
    expect(mocks.audit.find((a) => a.action === "authority_verify")).toMatchObject({ actorId: admin.id, entityId: id.id, metadata: { note: "Notarised consent" } });
    const r = await row(id.id);
    expect(r.authority_verified_by).toBe(admin.id);
  });

  // ── a contact never becomes a portal principal ────────────────────────────
  it("a verified contact never gains portal access and cannot reach roadmap, support, credit or student records", async () => {
    const id = await verifiedContact({ scopes: ["emergency", "academic", "financial", "release"], email: "guardian-login@synthetic.example" });
    const [dbRow] = await pg.sql(`select * from student_contacts where id = '${id}'`);
    expect(Object.keys(dbRow)).not.toContain("user_id");
    expect(dbRow.authority_status).toBe("verified");
    const profile = await api().get(`${S}/me/profile`).set(tok(studentUser));
    const view = profile.body.contacts.find((c: any) => c.id === id);
    expect(view.hasPortalAccess).toBe(false);
    expect(view.authorityStatus).toBe("verified");
    expect(view.effectiveScopes).toEqual(["emergency", "academic", "financial", "release"]);
    expect(profile.body.contacts.every((c: any) => c.hasPortalAccess === false)).toBe(true);
    // there is no users row for the contact's e-mail
    expect((await pg.sql(`select 1 from users where email = 'guardian-login@synthetic.example'`)).length).toBe(0);
    // a token minted for the guardian's email (no users row / not a student) is refused everywhere
    const ghost = { Authorization: `Bearer ${makeLocalJWT("00000000-0000-4000-8000-00000000abcd", "guardian-login@synthetic.example")}` };
    for (const p of ["/api/student/roadmap", "/api/tickets", `${S}/${student.id}`, `${S}/${student.id}/profile`, `${S}/${student.id}/contacts`, `${S}/me/profile`, `/api/student/degree-progress`]) {
      const res = await api().get(p).set(ghost);
      expect([401, 403, 404], `${p} -> ${res.status}`).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(student.email);
    }
    // another student's token sees none of this student's contacts either
    expect((await api().get(`${S}/${student.id}/contacts`).set(tok(otherUser))).status).toBe(403);
  });

  it("authority edits never touch canonical credit, roadmap or billing tables", async () => {
    const tables = await protectedTables(pg);
    const before = await snapshotTables(pg, tables);
    const id = await verifiedContact();
    await api().put(`${S}/contacts/${id}`).set(tok(staff)).send({ scopes: ["release"] });
    await api().post(`${S}/contacts/${id}/authority`).set(tok(staff)).send({ decision: "revoke", note: "Authority test cleanup" });
    await api().delete(`${S}/contacts/${id}`).set(tok(studentUser));
    expect(await snapshotTables(pg, tables)).toEqual(before);
  });
});
