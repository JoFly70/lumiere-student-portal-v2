/**
 * S22 bootstrap manifest: the single, reviewable source of truth for the order in which a
 * brand-new Supabase project (or the throwaway local PG16) is built. It encodes the 11 steps of
 * docs/recovery/s21/staging-readiness.md section 3, with every globbed set written out explicitly.
 *
 * `verifyManifest()` is the unit-checkable assertion: every listed file exists, no file is listed
 * twice inside one step, and every supabase/migrations file is either listed or excluded with a reason.
 */
import fs from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

export type StepKind = 'apply' | 'verify';

export interface ManifestStep {
  /** 1-based step number as in staging-readiness.md; `reapply-*` ids are S22 additions (see notes). */
  id: string;
  label: string;
  kind: StepKind;
  /** Repo-relative paths, in the exact order they are applied. */
  files: string[];
  /**
   * One-shot baseline: skipped by the idempotency (second) pass. Re-applying the baseline is not meaningful: 011 is
   * documented non-idempotent, phase1a_knowledge_core_integrity_fix (ALTER ... TYPE uuid USING NULLIF(uuid,'')) and
   * phase5e_restore_profiles (bare CREATE TABLE profiles) fail on a second run, and re-running the earlier phase1a
   * files silently undoes the hardening of knowledge_is_staff() (90-verify G4/G5). A Supabase ledger never re-runs them.
   * Like scripts/release/s14/rehearse-local.sh, the second pass re-applies steps 04 onward only.
   */
  oneShot?: boolean;
  note?: string;
}

const M = 'supabase/migrations/';
const S14 = 'scripts/release/s14/';

export const STEPS: ManifestStep[] = [
  {
    id: '01', label: 'degree programs / courses baseline (not idempotent, must run first)', kind: 'apply',
    files: [`${M}20251217230356_011_degree_programs_courses.sql`],
    oneShot: true,
  },
  { id: '02', label: 'production lineage (extensions, enums, users, students, tickets, ...)', kind: 'apply', files: ['PRODUCTION_DATABASE_SETUP.sql'], oneShot: true },
  {
    id: '03', label: 'RLS performance fix + every 202609* migration (15 files, filename order)', kind: 'apply',
    files: [
      `${M}20251217235151_fix_rls_performance_security.sql`,
      `${M}20260914182506_phase0_add_staff_role.sql`,
      `${M}20260914195204_phase1a_knowledge_core_schema.sql`,
      `${M}20260914200029_phase1a_knowledge_core_integrity_fix.sql`,
      `${M}20260914200820_phase1a_knowledge_history_hardening.sql`,
      `${M}20260914234000_phase1db_verification_event_sequence.sql`,
      `${M}20260915160000_phase2a_student_academic_record.sql`,
      `${M}20260915180000_phase2d_audit_logging.sql`,
      `${M}20260915190000_phase2d_audit_security_hardening.sql`,
      `${M}20260915200000_pre_replit_security_hardening.sql`,
      `${M}20260915210000_policy_auth_users_remediation.sql`,
      `${M}20260915220000_pre_replit_security_corrections.sql`,
      `${M}20260916010000_phase4b_student_credit_placement.sql`,
      `${M}20260916020000_phase4b_student_credit_placement_lifecycle_hardening.sql`,
      `${M}20260916100000_phase5e_restore_profiles.sql`,
      `${M}20260917100000_knowledge_evidence_source_metadata.sql`,
    ],
    oneShot: true,
    note: 'staging-readiness.md says "11 files" for the 202609* set; the directory holds 15 (16 with the RLS fix). The list here is the real one.',
  },
  { id: '04', label: 'prerequisite tables (student_documents, student_contacts, student_english_proof)', kind: 'apply', files: [`${S14}10-prereq-tables.sql`] },
  {
    id: '05', label: 'S05-S11 migrations (roadmap, profile, support, high school)', kind: 'apply',
    files: [
      `${M}20261026100000_s05_student_roadmap.sql`,
      `${M}20261026110000_s07_roadmap_audit_event_types.sql`,
      `${M}20261026200000_s09_student_profile.sql`,
      `${M}20261027100000_s08_support_audit_events.sql`,
      `${M}20261028100000_s10_support_idempotency_index.sql`,
      `${M}20261028200000_s10_support_schema_repair.sql`,
      `${M}20261029100000_s11_high_school_pathway.sql`,
      `${M}20261029110000_s11_high_school_audit_event_types.sql`,
    ],
  },
  { id: '06', label: 'account gate (invitations + active-account helper functions)', kind: 'apply', files: [`${S14}30-account-gate.sql`] },
  { id: '07', label: 'client privilege hardening (anon revoked, profiles.status read-only)', kind: 'apply', files: [`${S14}35-client-privilege-hardening.sql`] },
  { id: '08', label: 'storage buckets (private)', kind: 'apply', files: ['scripts/disposable-env/90_storage_buckets.sql'] },
  {
    id: '09', label: 'S18-S20 release migrations (billing, ticket idempotency, assistant usage)', kind: 'apply',
    files: [
      `${M}20261030100000_s18_billing_ledger.sql`,
      `${M}20261030100100_s18_billing_audit_event_types.sql`,
      `${M}20261030110000_s18_document_student_message.sql`,
      `${M}20261031100000_s19_ticket_comment_idempotency.sql`,
      `${M}20261031110000_s19_billing_corrections.sql`,
      `${M}20261101100000_s20_billing_evidence_void.sql`,
      `${M}20261101200000_s20_assistant_usage.sql`,
    ],
  },
  {
    id: '10', label: 'S21 (conversations, attachments, memory, welcome)', kind: 'apply',
    files: [
      `${M}20261102100000_s21_assistant_conversations.sql`,
      `${M}20261102110000_s21_document_attachments.sql`,
      `${M}20261102120000_s21_student_memory.sql`,
      `${M}20261102130000_s21_student_welcome.sql`,
    ],
  },
  {
    id: '10b', label: 'S22 forward migration: restore active-account check on RLS helpers, revoke anon EXECUTE on assistant_purge_active()', kind: 'apply',
    files: [`${M}20261103100000_s22_account_gate_restore.sql`],
    note: '20261030100000_s18_billing_ledger.sql overwrites is_staff_or_admin() without the active check (90-verify V3); the S21 conversations migration creates assistant_purge_active() after the hardening (90-verify G4). Also required on production.',
  },
  {
    id: '10c', label: 'S25 forward migrations: server-side portal language preference; authenticated loses all public-table write privileges; pin search_path on remaining helper/guard functions', kind: 'apply',
    files: [`${M}20261104100000_s25_user_language_preference.sql`, `${M}20261104110000_s25_client_write_lockdown.sql`],
    note: 'Defence in depth: the browser has no Supabase data client and the server uses the service role / owner connection. Also required on production.',
  },
  {
    id: '11', label: 'verify (read-only)', kind: 'verify',
    files: [`${S14}00-baseline-probe.sql`, `${S14}01-account-readiness.sql`, `${S14}90-verify.sql`, 'scripts/s22/hosted-verify.sql'],
  },
];

/** Applied only against the throwaway local cluster (a hosted Supabase project already has these). */
export const LOCAL_PRELUDE_FILES = ['tests/helpers/s05-supabase-shim.sql'];
/** Approximates Supabase default privileges (new public objects granted to the API roles). Local only. */
export const LOCAL_PRELUDE_SQL =
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;' +
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;';

/** supabase/migrations files deliberately not in the bootstrap (none today). file name -> reason. */
export const EXCLUDED_MIGRATIONS: Record<string, string> = {};

export const applySteps = (): ManifestStep[] => STEPS.filter((s) => s.kind === 'apply');
export const verifyFiles = (): string[] => STEPS.filter((s) => s.kind === 'verify').flatMap((s) => s.files);

/** Returns a list of problems; empty = manifest is consistent with the repository. */
export function verifyManifest(root = REPO_ROOT): string[] {
  const problems: string[] = [];
  const listed = new Set<string>();
  for (const step of STEPS) {
    const seen = new Set<string>();
    for (const f of step.files) {
      if (!fs.existsSync(path.join(root, f))) problems.push(`step ${step.id}: missing file ${f}`);
      if (seen.has(f)) problems.push(`step ${step.id}: duplicate ${f}`);
      seen.add(f);
      listed.add(f);
    }
  }
  for (const f of LOCAL_PRELUDE_FILES) if (!fs.existsSync(path.join(root, f))) problems.push(`prelude: missing ${f}`);
  const dir = path.join(root, 'supabase', 'migrations');
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    if (!listed.has(`${M}${name}`) && !EXCLUDED_MIGRATIONS[name]) problems.push(`migration neither listed nor excluded: ${name}`);
  }
  for (const name of Object.keys(EXCLUDED_MIGRATIONS)) {
    if (listed.has(`${M}${name}`)) problems.push(`excluded migration is also listed: ${name}`);
  }
  // filename order inside the migration-only steps (03, 05 is intentionally NOT sorted: s08 follows s09)
  const s03 = STEPS.find((s) => s.id === '03')!.files.map((f) => path.basename(f));
  if (s03.join() !== [...s03].sort().join()) problems.push('step 03 is not in filename order');
  return problems;
}
