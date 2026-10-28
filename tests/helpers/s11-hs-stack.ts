/**
 * S11 — helpers for the High School Pathway real-Postgres suites.
 * Synthetic data only. Server modules are imported dynamically AFTER
 * DATABASE_URL is set (server/lib/db.ts reads it at module load), so never
 * import server code statically from a test that uses this helper.
 *
 *   const pg = await startHighSchoolPg();               // disposable PG16 + S09 re-apply
 *   const hs = await bootHighSchoolApp(pg);              // Express app, real routers + real requireAuth
 *   const noa = await seedStudent(pg, { name: "Noa Fischer" });
 *   await request(hs.app).get("/api/student/high-school").set(authHeader(noa.token));
 *
 * bootHighSchoolApp uses vi.doMock for the two EXTERNAL services requireAuth
 * touches (the account-status lookup against Supabase and the Supabase client);
 * everything else (requireAuth, RBAC, routers, service, repository, Postgres)
 * is real. Audit records and refused staff-route requests are captured in
 * `hs.audits` / `hs.denied` (the real audit emitter still runs; it is a no-op
 * without Supabase).
 */
import type { Express } from "express";
import { vi } from "vitest";
import {
  seedAcademicRecord,
  seedStudent as seedStudentRow,
  seedUser,
  startLocalPg,
  type LocalPg,
  type SeedRole,
} from "./s05-local-pg";
import { applyS09Migration } from "./s09-apply-migration";
import { fixtureProviderGetUser, makeLocalJWT, protectedTables, snapshotTables, type TableSnapshot } from "./s09-profile-stack";
import type { HsAuditRecord, HighSchoolService } from "../../server/services/high-school-service";

export { makeLocalJWT, snapshotTables };
export type { LocalPg, TableSnapshot, HsAuditRecord };

/** The fixed "today" of the stack clock unless a test sets another. */
export const HS_TEST_NOW = "2026-10-26T12:00:00.000Z";

/** Disposable Postgres with the full migration chain, S09 re-applied (student_contacts authority columns). */
export async function startHighSchoolPg(): Promise<LocalPg> {
  const pg = await startLocalPg();
  await applyS09Migration(pg);
  return pg;
}

export const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface HsClock {
  /** Pin the clock; it then advances 1 second per read so ordering stays strict. */
  set(iso: string): void;
  now(): Date;
}

export interface HighSchoolApp {
  readonly app: Express;
  readonly service: HighSchoolService;
  readonly clock: HsClock;
  /** Every audit record emitted by successful mutations, in order. */
  readonly audits: HsAuditRecord[];
  /** Requests refused by the staff role guard (audited as high_school.access_denied). */
  readonly denied: { method: string; path: string; role: string | null }[];
  /** Add a user id to make the account-status lookup report "inactive" (401/403 from requireAuth). */
  readonly inactiveUsers: Set<string>;
  close(): Promise<void>;
}

export async function bootHighSchoolApp(pg: LocalPg, opts: { now?: string } = {}): Promise<HighSchoolApp> {
  process.env.DATABASE_URL = pg.url;
  delete process.env.ALLOW_DEMO_MODE;
  const inactiveUsers = new Set<string>();

  vi.doMock("../../server/lib/account-status", () => ({
    ACCOUNT_INACTIVE_RESPONSE: { error: "Account is not active", code: "ACCOUNT_INACTIVE" },
    getAccountStatus: async (id: string) => (inactiveUsers.has(id) ? "inactive" : "active"),
    isAccountActive: async (id: string) => !inactiveUsers.has(id),
  }));
  vi.doMock("../../server/lib/supabase", () => ({
    supabaseAdmin: {
      auth: { getUser: fixtureProviderGetUser },
      from: () => ({}),
      storage: { from: () => ({}) },
    },
    createUserAuthClient: () => ({}),
    isSupabaseConfigured: false,
  }));

  const express = (await import("express")).default;
  const { db } = await import("../../server/lib/db");
  const { highSchoolRepository } = await import("../../server/repositories/high-school-repo");
  const { createHighSchoolService } = await import("../../server/services/high-school-service");
  const { createStudentHighSchoolRouter } = await import("../../server/routes/student-high-school");
  const { createAdminHighSchoolRouter } = await import("../../server/routes/admin-high-school");
  const { emitAccessDenied, emitHighSchoolAudit } = await import("../../server/routes/high-school-audit");
  const { getStudentByUserId } = await import("../../server/repositories/student-academic-repo");

  let current = Date.parse(opts.now ?? HS_TEST_NOW);
  const clock: HsClock = {
    set(iso) {
      current = Date.parse(iso);
    },
    now() {
      current += 1000;
      return new Date(current);
    },
  };

  const service = createHighSchoolService({
    repo: highSchoolRepository,
    transaction: (fn) => db.transaction((tx) => fn(tx as never)),
    readTx: db,
    now: () => clock.now(),
  });

  const audits: HsAuditRecord[] = [];
  const denied: HighSchoolApp["denied"] = [];
  const audit = (req: Parameters<typeof emitHighSchoolAudit>[0], records: readonly HsAuditRecord[]) => {
    audits.push(...records);
    emitHighSchoolAudit(req, records);
  };

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(
    "/api/admin",
    createAdminHighSchoolRouter({
      service,
      audit,
      onAccessDenied: (req) => {
        denied.push({ method: req.method, path: (req.originalUrl ?? "").split("?")[0], role: req.user?.role ?? null });
        emitAccessDenied(req);
      },
    }),
  );
  app.use("/api/student", createStudentHighSchoolRouter({ getStudentByUserId: (id) => getStudentByUserId(id), service, audit }));

  return { app, service, clock, audits, denied, inactiveUsers, async close() {} };
}

// ── seeding (synthetic data) ─────────────────────────────────────────────────

export interface SeededHsStudent {
  readonly studentId: string;
  readonly userId: string;
  readonly email: string;
  readonly token: string;
}

/** A student with a login: users + students rows linked, plus a ready-to-use bearer token. */
export async function seedStudent(pg: LocalPg, opts: { name?: string } = {}): Promise<SeededHsStudent> {
  const [first, ...rest] = (opts.name ?? "Noa Fischer").split(" ");
  const user = await seedUser(pg, "student", (first ?? "student").toLowerCase());
  const row = await seedStudentRow(pg, { userId: user.id, firstName: first, lastName: rest.join(" ") || "Student" });
  await pg.sql(`update students set email = '${user.email}' where id = '${row.id}'`);
  return { studentId: row.id, userId: user.id, email: user.email, token: makeLocalJWT(user.id, user.email) };
}

export interface SeededHsStaff {
  readonly userId: string;
  readonly email: string;
  readonly role: SeedRole;
  readonly token: string;
}

export async function seedStaff(pg: LocalPg, role: "staff" | "admin" | "coach"): Promise<SeededHsStaff> {
  const user = await seedUser(pg, role);
  return { userId: user.id, email: user.email, role, token: makeLocalJWT(user.id, user.email) };
}

/**
 * A student_documents row for the student. Default status "verified" (counts as
 * evidence). Pass { status: "pending" } etc. for a SAMPLE / unverified document.
 * docType must be a doc_type_enum value: hs_transcript, hs_diploma, foreign_eval, other, ...
 */
export async function seedVerifiedDocument(
  pg: LocalPg,
  studentId: string,
  docType = "hs_transcript",
  opts: { status?: "pending" | "verified" | "rejected" | "resubmit_requested"; softDeleted?: boolean } = {},
): Promise<string> {
  const status = opts.status ?? "verified";
  const [row] = await pg.sql(`
    insert into student_documents (student_id, doc_type, file_name, url, storage_path, status, verified, verified_at, soft_deleted)
    values ('${studentId}', '${docType}', 'synthetic-${docType}.pdf', 'storage://synthetic/${studentId}/${docType}.pdf',
            'students/synthetic/${studentId}/${docType}.pdf', '${status}', ${status === "verified"},
            ${status === "verified" ? "now()" : "null"}, ${opts.softDeleted ? "true" : "false"})
    returning id`);
  return String(row.id);
}

export interface SeedContactInput {
  readonly type?: "parent" | "guardian" | "representative" | "emergency" | "spouse" | "other";
  readonly fullName?: string;
  readonly relationship?: string;
  readonly scopes?: readonly ("emergency" | "academic" | "financial" | "release")[];
  readonly authorityStatus?: "listed" | "pending_verification" | "verified" | "revoked";
}

/** A student_contacts row (S09 authority columns). Never creates a login. Returns the contact id. */
export async function seedContact(pg: LocalPg, studentId: string, c: SeedContactInput = {}): Promise<string> {
  const scopes = `{${(c.scopes ?? []).join(",")}}`;
  const [row] = await pg.client`
    insert into student_contacts (student_id, type, full_name, relationship, phone, scopes, authority_status)
    values (${studentId}, ${c.type ?? "parent"}::contact_type_enum, ${c.fullName ?? "Mira Fischer"}, ${c.relationship ?? "Mother"},
            '+15550001111', ${scopes}::text[], ${c.authorityStatus ?? "listed"})
    returning id`;
  return String(row.id);
}

/** Gives the student an ACTIVE university degree assignment (read-only context for /programs). */
export async function seedUniversityProgram(pg: LocalPg, studentId: string, staffUserId?: string) {
  return seedAcademicRecord(pg, studentId, { staffUserId: staffUserId ?? null });
}

/** University / roadmap / financial tables that S11 must never touch. */
export async function universityTables(pg: LocalPg): Promise<string[]> {
  return protectedTables(pg);
}

export async function snapshotUniversity(pg: LocalPg): Promise<TableSnapshot> {
  return snapshotTables(pg, await universityTables(pg));
}
