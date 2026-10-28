/**
 * S09 — helpers for the real-Postgres profile HTTP e2e suite.
 * Synthetic data only. No server imports (those happen in the test's beforeAll).
 */
import crypto from "node:crypto";
import type { LocalPg } from "./s05-local-pg";
import { CANONICAL_TABLES } from "./s05-roadmap-stack";

const JWT_SECRET = process.env.SESSION_SECRET || "local-dev-secret-change-in-production";

export function makeLocalJWT(userId: string, email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ userId, email, iss: "lumiere-local", exp: now + 3600, iat: now, sub: userId, aud: "authenticated", role: "authenticated" }),
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/**
 * Test-only provider response for this harness's signed fixtures. Application
 * requireAuth/RBAC still run unchanged; no network or local-token bypass flag.
 */
export async function fixtureProviderGetUser(token: string) {
  try {
    const [header, payload, signature, extra] = token.split(".");
    if (!header || !payload || !signature || extra) throw new Error("invalid fixture");
    const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("invalid fixture");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (claims.iss !== "lumiere-local" || claims.sub !== claims.userId ||
        typeof claims.userId !== "string" || typeof claims.email !== "string" ||
        !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) throw new Error("invalid fixture");
    return { data: { user: { id: claims.userId as string, email: claims.email as string,
      email_confirmed_at: "2000-01-01T00:00:00.000Z" } }, error: null };
  } catch {
    return { data: { user: null }, error: { message: "invalid fixture token" } };
  }
}

/** A real 1x1 PNG. */
export const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
export const NOT_AN_IMAGE = Buffer.from("this is plain text pretending to be a picture", "utf8");

export interface StorageMock {
  upload: ReturnType<typeof import("vitest").vi.fn>;
  remove: ReturnType<typeof import("vitest").vi.fn>;
  createSignedUrl: ReturnType<typeof import("vitest").vi.fn>;
  getPublicUrl: ReturnType<typeof import("vitest").vi.fn>;
}

/** Tables that must be byte-identical across the whole profile journey. */
export async function protectedTables(pg: LocalPg): Promise<string[]> {
  const rows = await pg.sql(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
      and (table_name like 'student\\_roadmap\\_%'
        or table_name ~ '(payment|invoice|billing|ledger|financial|charge|tuition)')
    order by table_name`);
  const names = new Set<string>([...CANONICAL_TABLES, ...rows.map((r) => String(r.table_name))]);
  return Array.from(names).sort();
}

export type TableSnapshot = Record<string, { count: number; digest: string }>;

export async function snapshotTables(pg: LocalPg, tables: readonly string[]): Promise<TableSnapshot> {
  const out: TableSnapshot = {};
  for (const t of tables) {
    const [row] = await pg.sql(
      `select count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as d from "${t}" x`,
    );
    out[t] = { count: Number(row.n), digest: String(row.d) };
  }
  return out;
}

export async function seedIdDocument(
  pg: LocalPg,
  studentId: string,
  opts: { status?: "pending" | "verified" | "rejected" | "resubmit_requested"; docType?: string } = {},
): Promise<string> {
  const status = opts.status ?? "verified";
  const [row] = await pg.sql(`
    insert into student_documents (student_id, doc_type, file_name, url, storage_path, status, verified, verified_at)
    values ('${studentId}', '${opts.docType ?? "id_gov"}', 'passport.pdf', 'storage://synthetic/${studentId}/passport.pdf',
            'students/synthetic/${studentId}/passport.pdf', '${status}', ${status === "verified"}, ${status === "verified" ? "now()" : "null"})
    returning id`);
  return String(row.id);
}

export async function studentRow(pg: LocalPg, studentId: string): Promise<Record<string, unknown>> {
  const [row] = await pg.sql(`select * from students where id = '${studentId}'`);
  return row as Record<string, unknown>;
}

/** Fields a student must never change directly. */
export const PROTECTED_STUDENT_FIELDS: ReadonlyArray<[string, unknown]> = [
  ["hs_completion", true],
  ["residency", "foreign"],
  ["status", "graduated"],
  ["prior_credits_est", 90],
  ["target_degree", "Doctorate of Synthetic Studies"],
  ["hs_school", "Forged High School"],
  ["consent_signature", "forged signature"],
  ["student_code", "HACK-0001"],
];

export const IDENTITY_FIELDS_DIRECT: ReadonlyArray<[string, unknown]> = [
  ["first_name", "Forged"],
  ["last_name", "Forged"],
  ["dob", "1980-02-02"],
  ["gov_id_number", "ZZ99999999"],
];

/** Pulls the correction request view out of a create/resolve response regardless of envelope. */
export function requestFrom(body: any): any {
  return body?.request ?? body?.correction ?? body;
}
