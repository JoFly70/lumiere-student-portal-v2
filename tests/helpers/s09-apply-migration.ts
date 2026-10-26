/**
 * S09 — re-apply the student-profile migration on the disposable Postgres.
 *
 * In the harness, student_contacts / contact_type_enum are created by
 * scripts/disposable-env/50_runtime_supplement.sql AFTER supabase/migrations,
 * so the guarded parts of the S09 migration are skipped on the first pass.
 * Call this once after startLocalPg(); the migration is idempotent.
 */
import fs from "node:fs";
import path from "node:path";
import type { LocalPg } from "./s05-local-pg";

export const S09_MIGRATION_FILE = "20261026200000_s09_student_profile.sql";

const MIGRATION_PATH = path.resolve(import.meta.dirname, "..", "..", "supabase", "migrations", S09_MIGRATION_FILE);

export async function applyS09Migration(pg: Pick<LocalPg, "client">): Promise<void> {
  const text = fs.readFileSync(MIGRATION_PATH, "utf8");
  await pg.client.unsafe(text).simple();
}
