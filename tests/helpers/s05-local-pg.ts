/**
 * S05 — real, disposable PostgreSQL 16 harness.
 *
 * Starts a throwaway cluster (temp data dir, trust auth, free loopback port,
 * unix socket in the temp dir), applies the repository's REAL schema build
 * sequence on top of a minimal Supabase shim, and exposes seed helpers.
 *
 * Schema build sequence (mirrors scripts/disposable-env/apply-schema.sh, S02):
 *   0. tests/helpers/s05-supabase-shim.sql   (SHIM: auth schema/uid(), roles, storage tables)
 *   1. supabase/migrations/20251217230356_011_degree_programs_courses.sql
 *   2. PRODUCTION_DATABASE_SETUP.sql          (production lineage the modern chain assumes)
 *   3. every other supabase/migrations/*.sql in filename order, UNMODIFIED
 *      (this includes supabase/migrations/20261026100000_s05_student_roadmap.sql
 *       when present, by filename order)
 *   4. scripts/disposable-env/50_runtime_supplement.sql, migrations/004 + 007,
 *      per_credit_price column, 60_s03_security_remediation.sql
 *      (disposable-only supplements documented in scripts/disposable-env/README.md)
 *
 * NEVER point this at anything but the cluster it starts itself.
 *
 * Root handling: initdb/postgres refuse to run as root, so when the current
 * uid is 0 every server binary runs through `runuser -u postgres --` and the
 * temp directory is chowned to that user.
 */
import { execFile } from "node:child_process";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";

export const PG_BIN_DIR = process.env.S05_PG_BIN_DIR ?? "/usr/lib/postgresql/16/bin";
export const PG_BINARIES_AVAILABLE = fs.existsSync(path.join(PG_BIN_DIR, "initdb"));

/** Message to use with describe.skipIf / console when the binaries are missing. */
export const S05_PG_SKIP_MESSAGE =
  `S05 local Postgres harness skipped: ${path.join(PG_BIN_DIR, "initdb")} not found ` +
  "(install PostgreSQL 16 server binaries or set S05_PG_BIN_DIR).";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const S05_MIGRATION_FILE = "20261026100000_s05_student_roadmap.sql";
const FIRST_MIGRATION = "20251217230356_011_degree_programs_courses.sql";

export interface LocalPg {
  /** postgres://postgres@127.0.0.1:PORT/DB — safe to put in DATABASE_URL for server/lib/db.ts. */
  readonly url: string;
  readonly port: number;
  readonly database: string;
  /** Temp directory holding the cluster and the unix socket. */
  readonly dir: string;
  /** Migration files that were applied, in order (paths relative to the repo). */
  readonly appliedFiles: readonly string[];
  /** Run one (possibly multi-statement) query on a superuser connection. */
  sql(query: string): Promise<postgres.RowList<postgres.Row[]>>;
  /** Shared postgres-js client (superuser, bypasses RLS). */
  readonly client: postgres.Sql;
  /** Open an additional connection (e.g. to test as another role); caller must end() it. */
  connect(opts?: postgres.Options<Record<string, never>>): postgres.Sql;
  stop(): Promise<void>;
}

const isRoot = () => typeof process.getuid === "function" && process.getuid() === 0;

function wrap(bin: string, args: string[]): [string, string[]] {
  const full = path.join(PG_BIN_DIR, bin);
  return isRoot() ? ["runuser", ["-u", "postgres", "--", full, ...args]] : [full, args];
}

function run(bin: string, args: string[], timeoutMs = 60_000): Promise<string> {
  const [cmd, a] = wrap(bin, args);
  return new Promise((resolve, reject) => {
    execFile(cmd, a, { timeout: timeoutMs, env: { ...process.env, LC_ALL: "C" } }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${bin} failed: ${err.message}\n${stdout}\n${stderr}`));
      else resolve(stdout + stderr);
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function migrationSequence(lineage: "full" | "production" = "full", exclude: readonly string[] = []): string[] {
  const dir = path.join(REPO_ROOT, "supabase", "migrations");
  const all = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const rest = all
    .filter((f) => f !== FIRST_MIGRATION && !exclude.includes(f))
    .map((f) => `supabase/migrations/${f}`);
  const head = [
    "tests/helpers/s05-supabase-shim.sql",
    `supabase/migrations/${FIRST_MIGRATION}`,
    "PRODUCTION_DATABASE_SETUP.sql",
    ...rest,
  ];
  // S10: "production" = the legacy production lineage only (PRODUCTION_DATABASE_SETUP.sql + the modern
  // chain), WITHOUT the disposable-only supplements below that reconstruct tables production may lack.
  if (lineage === "production") return head;
  return [
    ...head,
    "scripts/disposable-env/50_runtime_supplement.sql",
    "migrations/004_financial_timeline.sql",
    "migrations/007_course_roadmap_tables.sql",
    "@inline:ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS per_credit_price INTEGER",
    "scripts/disposable-env/60_s03_security_remediation.sql",
    "scripts/disposable-env/90_storage_buckets.sql",
    // S18: guarded (to_regclass) and idempotent; it no-ops in the chain above because the disposable
    // student_documents table only exists after 50_runtime_supplement. Re-run it here, as production
    // (where the table exists) would apply it.
    "supabase/migrations/20261030110000_s18_document_student_message.sql",
    // S21 attachments: guarded DDL on student_documents only takes effect once the runtime supplement created it.
    "supabase/migrations/20261102110000_s21_document_attachments.sql",
  ];
}

async function applySchema(sql: postgres.Sql, lineage: "full" | "production", exclude: readonly string[]): Promise<string[]> {
  const applied: string[] = [];
  for (const entry of migrationSequence(lineage, exclude)) {
    const text = entry.startsWith("@inline:")
      ? entry.slice("@inline:".length)
      : fs.readFileSync(path.join(REPO_ROOT, entry), "utf8");
    try {
      await sql.unsafe(text).simple();
    } catch (err) {
      throw new Error(`S05 harness: applying ${entry} failed: ${(err as Error).message}`);
    }
    applied.push(entry);
  }
  return applied;
}

export interface StartLocalPgOptions {
  /** Skip applying the repository schema (bare cluster only). */
  readonly bare?: boolean;
  /** S10: "production" skips the disposable-only supplements (legacy production lineage approximation). */
  readonly lineage?: "full" | "production";
  /** S10: supabase/migrations file names (not paths) to leave out of the chain. */
  readonly exclude?: readonly string[];
}

export async function startLocalPg(options: StartLocalPgOptions = {}): Promise<LocalPg> {
  if (!PG_BINARIES_AVAILABLE) throw new Error(S05_PG_SKIP_MESSAGE);

  // Short path: unix socket paths are limited to ~107 bytes.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s05pg-"));
  fs.chmodSync(dir, 0o755);
  if (isRoot()) execFileSync("chown", ["postgres:postgres", dir]);
  const dataDir = path.join(dir, "data");
  const logFile = path.join(dir, "server.log");
  let started = false;
  let stopped = false;

  const cleanup = async () => {
    if (started) {
      try {
        await run("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"], 30_000);
      } catch {
        /* already down */
      }
      started = false;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  // Safety net if a test process dies without calling stop().
  const onExit = () => {
    if (!started) return;
    try {
      const [cmd, a] = wrap("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"]);
      execFileSync(cmd, a, { stdio: "ignore", timeout: 15_000 });
    } catch {
      /* ignore */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  process.once("exit", onExit);

  try {
    await run("initdb", ["-D", dataDir, "-A", "trust", "-U", "postgres", "-E", "UTF8", "--no-sync"]);
    const port = await freePort();
    await run("pg_ctl", [
      "-D", dataDir, "-w", "-l", logFile,
      "-o", `-c listen_addresses=127.0.0.1 -p ${port} -k ${dir} -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=60`,
      "start",
    ]);
    started = true;

    const database = `s05_${randomUUID().slice(0, 8)}`;
    const admin = postgres(`postgres://postgres@127.0.0.1:${port}/postgres`, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${database}`).simple();
    await admin.end();

    const url = `postgres://postgres@127.0.0.1:${port}/${database}`;
    const open = (opts: postgres.Options<Record<string, never>> = {}) =>
      postgres(url, { max: 4, onnotice: () => {}, ...opts });
    const client = open();
    let appliedFiles: string[] = [];
    if (!options.bare) {
      // Single connection so files that contain their own BEGIN/COMMIT are allowed.
      const migrator = postgres(url, { max: 1, onnotice: () => {} });
      try {
        appliedFiles = await applySchema(migrator, options.lineage ?? "full", options.exclude ?? []);
      } finally {
        await migrator.end({ timeout: 5 });
      }
    }

    return {
      url,
      port,
      database,
      dir,
      appliedFiles,
      client,
      connect: open,
      sql: (q) => client.unsafe(q).simple() as Promise<postgres.RowList<postgres.Row[]>>,
      async stop() {
        if (stopped) return;
        stopped = true;
        process.removeListener("exit", onExit);
        await client.end({ timeout: 5 }).catch(() => {});
        await cleanup();
      },
    };
  } catch (err) {
    process.removeListener("exit", onExit);
    await cleanup();
    throw err;
  }
}

// ── Seed helpers (synthetic data only) ───────────────────────────────────────

export type SeedRole = "student" | "staff" | "admin" | "coach";

export interface SeededUser {
  readonly id: string;
  readonly email: string;
  readonly role: SeedRole;
}

let seedCounter = 0;
const nextSeed = () => `${Date.now().toString(36)}${(seedCounter++).toString(36)}`;

/** Creates auth.users (shim) + public.users with the same id. */
export async function seedUser(pg: Pick<LocalPg, "client">, role: SeedRole = "student", label?: string): Promise<SeededUser> {
  const id = randomUUID();
  const email = `${label ?? role}-${nextSeed()}@synthetic.example`;
  await pg.client`INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES (${id}, ${email}, ${JSON.stringify({ role })}::jsonb)`;
  await pg.client`INSERT INTO public.users (id, email, name, role) VALUES (${id}, ${email}, ${`Synthetic ${role}`}, ${role}::role)`;
  return { id, email, role };
}

export interface SeededStudent {
  readonly id: string;
  readonly userId: string | null;
  readonly code: string;
  readonly email: string;
}

/** Creates a students row (optionally linked to a user). */
export async function seedStudent(
  pg: Pick<LocalPg, "client">,
  opts: { userId?: string | null; firstName?: string; lastName?: string } = {},
): Promise<SeededStudent> {
  const id = randomUUID();
  const tag = nextSeed();
  const code = `S05-${tag}`.toUpperCase();
  const email = `student-${tag}@synthetic.example`;
  await pg.client`
    INSERT INTO students (id, user_id, student_code, status, first_name, last_name, dob, residency, email, phone_primary,
                          address_country, address_line1)
    VALUES (${id}, ${opts.userId ?? null}, ${code}, 'active', ${opts.firstName ?? "Scenario"}, ${opts.lastName ?? "Student"},
            '1990-01-01', 'us', ${email}, '+15550000000', 'US', '1 Synthetic Way')`;
  return { id, userId: opts.userId ?? null, code, email };
}

export interface SeededAcademic {
  readonly institutionId: string;
  readonly programId: string;
  readonly programVersionId: string;
  readonly assignmentId: string;
  readonly sourceId: string;
  readonly creditRecordId: string;
}

/**
 * Seeds the canonical academic chain for a student: institution, program,
 * program version, ACTIVE program assignment, one transcript source, one
 * credit record with a `verified` event and an `accepted` decision
 * (credits awarded). Uses the same tables as server/repositories/student-academic-repo.ts.
 */
export async function seedAcademicRecord(
  pg: Pick<LocalPg, "client">,
  studentId: string,
  opts: { staffUserId?: string | null; awardedCredits?: string; courseTitle?: string } = {},
): Promise<SeededAcademic> {
  const c = pg.client;
  const tag = nextSeed();
  const staff = opts.staffUserId ?? null;
  const awarded = opts.awardedCredits ?? "3.00";

  const [inst] = await c`
    INSERT INTO knowledge_institutions (slug, name)
    VALUES (${`pathways-${tag}`}, ${`Pathways State University ${tag}`}) RETURNING id`;
  const [prog] = await c`
    INSERT INTO knowledge_programs_v2 (institution_id, code, name, degree_level)
    VALUES (${inst.id}, ${`BA-LS-${tag}`}, ${`BA Liberal Studies ${tag}`}, 'bachelor') RETURNING id`;
  const [pv] = await c`
    INSERT INTO knowledge_program_versions (program_id, version_label, catalog_year, effective_from, status, total_credits_required)
    VALUES (${prog.id}, '2026 Catalog', 2026, '2026-01-01', 'active', 120) RETURNING id`;
  const [pa] = await c`
    INSERT INTO student_program_assignments (student_id, program_version_id, status, cohort_label, assigned_by)
    VALUES (${studentId}, ${pv.id}, 'active', 'Synthetic cohort', ${staff}) RETURNING id`;
  const [src] = await c`
    INSERT INTO student_academic_sources (student_id, source_type, status, title, source_date, received_at, created_by)
    VALUES (${studentId}, 'transcript', 'verified', 'Synthetic transcript', '2026-01-15', now(), ${staff}) RETURNING id`;
  const [cr] = await c`
    INSERT INTO student_credit_records (student_id, source_id, record_type, status, raw_course_code, raw_title, raw_credits,
                                       term, completed_on, created_by)
    VALUES (${studentId}, ${src.id}, 'course', 'verified', 'SYN101', ${opts.courseTitle ?? "Synthetic Composition"}, ${awarded},
            'Fall 2025', '2025-12-15', ${staff}) RETURNING id`;
  await c`
    INSERT INTO student_credit_verification_events (credit_record_id, action, reviewer_id, rationale)
    VALUES (${cr.id}, 'verified', ${staff}, 'synthetic verification')`;
  await c`
    INSERT INTO student_credit_decisions (credit_record_id, program_assignment_id, action, credits_awarded, decided_by, rationale)
    VALUES (${cr.id}, ${pa.id}, 'accepted', ${awarded}, ${staff}, 'synthetic acceptance')`;
  return {
    institutionId: inst.id,
    programId: prog.id,
    programVersionId: pv.id,
    assignmentId: pa.id,
    sourceId: src.id,
    creditRecordId: cr.id,
  };
}

/** Table names the S05 migration is expected to create (see shared/student-roadmap-schema.ts when present). */
export function s05MigrationExists(): boolean {
  return fs.existsSync(path.join(REPO_ROOT, "supabase", "migrations", S05_MIGRATION_FILE));
}
