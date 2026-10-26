/**
 * S11 — extra helpers for the real-Postgres high school HTTP e2e suite.
 * Synthetic data only. No static server imports (done in the test's beforeAll).
 */
import type { LocalPg } from "./s05-local-pg";
import { seedStudent, seedUser, type SeededStudent, type SeededUser } from "./s05-local-pg";
import { makeLocalJWT, protectedTables, snapshotTables, type TableSnapshot } from "./s09-profile-stack";

export { makeLocalJWT, protectedTables, snapshotTables };
export type { TableSnapshot };

export interface Actor extends SeededUser {
  readonly token: string;
  readonly auth: { Authorization: string };
}

export async function seedActor(pg: LocalPg, role: "student" | "staff" | "admin" | "coach"): Promise<Actor> {
  const u = await seedUser(pg, role);
  const token = makeLocalJWT(u.id, u.email);
  return { ...u, token, auth: { Authorization: `Bearer ${token}` } };
}

export interface HsStudent {
  readonly student: SeededStudent;
  readonly user: Actor;
}

/** A student with a login, linked by user_id (the way requireAuth resolves them). */
export async function seedHsStudent(pg: LocalPg, name: string): Promise<HsStudent> {
  const user = await seedActor(pg, "student");
  const student = await seedStudent(pg, { userId: user.id, firstName: name, lastName: "Synthetic" });
  await pg.sql(`update students set email = '${user.email}' where id = '${student.id}'`);
  return { student, user };
}

let docCounter = 0;
/** Inserts a student_documents row. status 'verified' also sets verified=true. */
export async function seedDocument(
  pg: LocalPg,
  studentId: string,
  opts: { status?: "verified" | "pending" | "rejected"; docType?: string } = {},
): Promise<string> {
  const status = opts.status ?? "verified";
  const docType = opts.docType ?? (await pickDocType(pg));
  const n = ++docCounter;
  const [row] = await pg.sql(`
    insert into student_documents (student_id, doc_type, file_name, url, storage_path, status, verified, verified_at)
    values ('${studentId}', '${docType}', 'synthetic-${n}.pdf', 'storage://synthetic/${studentId}/${n}.pdf',
            'students/synthetic/${studentId}/${n}.pdf', '${status}', ${status === "verified"}, ${status === "verified" ? "now()" : "null"})
    returning id`);
  return String(row.id);
}

let cachedDocType: string | null = null;
async function pickDocType(pg: LocalPg): Promise<string> {
  if (cachedDocType) return cachedDocType;
  const rows = await pg.sql(`select unnest(enum_range(null::doc_type_enum))::text as v`);
  const values = rows.map((r) => String(r.v));
  cachedDocType = values.find((v) => /transcript/.test(v)) ?? values[0]!;
  return cachedDocType;
}

export interface ContactSpec {
  readonly type: "parent" | "guardian" | "representative" | "emergency";
  readonly fullName: string;
  readonly relationship: string;
  readonly scopes?: readonly string[];
  readonly authority?: "listed" | "pending_verification" | "verified" | "revoked";
}

export async function seedContact(pg: LocalPg, studentId: string, c: ContactSpec): Promise<string> {
  const scopes = `{${(c.scopes ?? ["emergency"]).join(",")}}`;
  const [row] = await pg.sql(`
    insert into student_contacts (student_id, type, full_name, relationship, phone, scopes, authority_status)
    values ('${studentId}', '${c.type}', '${c.fullName}', '${c.relationship}', '+15550001111', '${scopes}', '${c.authority ?? "listed"}')
    returning id`);
  return String(row.id);
}

/** Courses of the 21-credit template (16 core) + five 1-credit electives = a plan that can reach 21 credits. */
export function fullPlanContent(content: any): any {
  const next = JSON.parse(JSON.stringify(content));
  for (let i = 1; i <= 5; i++) {
    next.courses.push({
      key: `elective-${i}`, title: `Synthetic Elective ${i}`, areaKey: "electives", halfUnits: 2, status: "planned",
      replacesCourseKey: null, plannedStart: null, plannedEnd: null,
      tasks: [],
    });
  }
  return next;
}
