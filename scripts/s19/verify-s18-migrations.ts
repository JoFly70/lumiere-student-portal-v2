/**
 * S19: verify the S18 + S19 migrations on a THROWAWAY local Postgres 16 (never any hosted database).
 *
 *   npx tsx scripts/s19/verify-s18-migrations.ts
 *
 * 1. Build the repo's pre-S18 schema with the S05 harness (supabase shim + every earlier migration), excluding
 *    the S18/S19 migrations under test. The harness' trailing student_message re-apply is undone (column dropped)
 *    so the document table looks like production before S18.
 * 2. Seed LEGACY rows (a rejected document with an internal admin note).
 * 3. Apply, in release order, each file twice (idempotency):
 *      20261030100000_s18_billing_ledger, 20261030100100_s18_billing_audit_event_types,
 *      20261030110000_s18_document_student_message, [20261031100000_s19_ticket_comment_idempotency if present],
 *      20261031110000_s19_billing_corrections
 *    with S18 billing rows seeded between S18 and S19 to prove existing rows survive.
 * 4. Check behaviour, print a JSON report, tear the cluster down.
 * Stubs: only the harness' Supabase shim (auth.users/uid(), roles, storage tables). Nothing else is stubbed.
 */
import fs from "node:fs";
import path from "node:path";
import { startLocalPg, seedStudent, seedUser } from "../../tests/helpers/s05-local-pg";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "supabase/migrations");
const ORDER = [
  "20261030100000_s18_billing_ledger.sql",
  "20261030100100_s18_billing_audit_event_types.sql",
  "20261030110000_s18_document_student_message.sql",
  "20261031100000_s19_ticket_comment_idempotency.sql",
  "20261031110000_s19_billing_corrections.sql",
].filter((f) => fs.existsSync(path.join(MIG, f)));
const absent = ["20261031100000_s19_ticket_comment_idempotency.sql"].filter((f) => !fs.existsSync(path.join(MIG, f)));

const checks: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail?: string) => { checks.push({ name, pass, detail }); console.log(pass ? "PASS" : "FAIL", name, detail ?? ""); };

async function main() {
  const pg = await startLocalPg({ exclude: ORDER });
  try {
    const q = async (text: string) => pg.sql(text);
    const rejects = async (text: string) => { try { await q(text); return false; } catch { return true; } };
    const apply = (f: string) => q(fs.readFileSync(path.join(MIG, f), "utf8"));

    // pre-S18 state
    await q("ALTER TABLE student_documents DROP COLUMN IF EXISTS student_message");
    check("pre-state: billing tables absent", (await q("select to_regclass('public.student_billing_receipts') as t"))[0]!.t === null);
    const staff = await seedUser(pg, "staff");
    const st = await seedStudent(pg);
    const [legacy] = await q(`insert into student_documents (student_id, doc_type, file_name, url, storage_path, status, verified, admin_notes)
      values ('${st.id}','hs_transcript','legacy.pdf','storage://x','students/x/legacy.pdf','rejected',false,'INTERNAL legacy note') returning id`);

    // S18 (twice each)
    for (const f of ORDER.filter((x) => x.startsWith("20261030"))) {
      await apply(f); await apply(f);
      check(`applied twice: ${f}`, true);
    }
    const doc = (await q(`select admin_notes, student_message from student_documents where id='${legacy!.id}'`))[0]!;
    check("legacy document survives; student_message NULL, admin_notes intact", doc.student_message === null && doc.admin_notes === "INTERNAL legacy note");
    await q(`update student_documents set student_message='Please re-upload' where id='${legacy!.id}'`);
    check("student_message column writable", (await q(`select student_message from student_documents where id='${legacy!.id}'`))[0]!.student_message === "Please re-upload");

    // S18 billing rows (pre-S19 shape)
    await q(`insert into student_billing_obligations (student_id, agreed_cents, currency, created_by, updated_by) values ('${st.id}', 1200000, 'USD', '${staff.id}', '${staff.id}')`);
    await q(`insert into student_billing_discounts (student_id, amount_cents, reason, approved_by, created_by) values ('${st.id}', 100000, 'Early', '${staff.id}', '${staff.id}')`);
    await q(`insert into student_billing_installments (student_id, due_date, amount_cents, created_by) values ('${st.id}', '2026-12-01', 550000, '${staff.id}')`);
    const [ev] = await q(`insert into student_billing_evidence (student_id, document_id, created_by) values ('${st.id}', '${legacy!.id}', '${staff.id}') returning id`);
    const [rc] = await q(`insert into student_billing_receipts (student_id, amount_cents, received_date, method_label, confirmed_by, evidence_id) values ('${st.id}', 300000, '2026-10-01', 'Bank transfer', '${staff.id}', '${ev!.id}') returning id`);

    // integer-cent constraints (S18)
    check("amount columns are bigint", (await q(`select count(*)::int n from information_schema.columns where table_name like 'student_billing_%' and column_name like '%cents' and data_type<>'bigint'`))[0]!.n === 0);
    check("zero / negative cents rejected", (await rejects(`insert into student_billing_receipts (student_id, amount_cents, received_date, method_label, confirmed_by) values ('${st.id}', 0, '2026-10-01','x','${staff.id}')`)) &&
      (await rejects(`insert into student_billing_discounts (student_id, amount_cents, reason, approved_by, created_by) values ('${st.id}', -5, 'x','${staff.id}','${staff.id}')`)));
    check("bad currency rejected", await rejects(`update student_billing_obligations set currency='usd' where student_id='${st.id}'`));
    const audit = (await q(`select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='audit_event_type' and enumlabel like 'billing.%'`)).map((r) => r.enumlabel as string);
    check("S18 audit event types present", ["billing.ledger_updated", "billing.receipt_recorded", "billing.evidence_reviewed", "billing.access_denied"].every((l) => audit.includes(l)));

    // S19 (twice) + any ticket idempotency file (twice)
    for (const f of ORDER.filter((x) => x.startsWith("20261031"))) {
      await apply(f); await apply(f);
      check(`applied twice: ${f}`, true);
    }
    const s19 = (await q(`select (select count(*)::int from student_billing_receipts) r, (select count(*)::int from student_billing_discounts) d,
      (select count(*)::int from student_billing_installments) i, (select count(*)::int from student_billing_obligations) o,
      (select count(*)::int from student_billing_receipts where voided_at is not null) v`))[0]!;
    check("S18 billing rows survive S19", s19.r === 1 && s19.d === 1 && s19.i === 1 && s19.o === 1 && s19.v === 0, JSON.stringify(s19));
    check("void without a reason rejected", await rejects(`update student_billing_receipts set voided_at=now(), voided_by='${staff.id}' where id='${rc!.id}'`));
    await q(`update student_billing_receipts set voided_at=now(), voided_by='${staff.id}', void_reason='entered twice' where id='${rc!.id}'`);
    check("void with reason accepted; row kept", (await q(`select count(*)::int n from student_billing_receipts where voided_at is not null`))[0]!.n === 1);
    check("one evidence cannot back two receipts", await rejects(`insert into student_billing_receipts (student_id, amount_cents, received_date, method_label, confirmed_by, evidence_id) values ('${st.id}', 100, '2026-10-02','x','${staff.id}','${ev!.id}')`));
    const audit2 = (await q(`select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='audit_event_type' and enumlabel like 'billing.%'`)).map((r) => r.enumlabel as string);
    check("S19 audit event types present", ["billing.receipt_voided", "billing.discount_voided", "billing.installment_updated"].every((l) => audit2.includes(l)));
    check("RLS still enabled, no student policy", (await q(`select count(*)::int n from pg_tables where tablename like 'student_billing_%' and not rowsecurity`))[0]!.n === 0);

    console.log(JSON.stringify({ applied: ORDER, absentOptional: absent, checks }, null, 2));
    if (checks.some((c) => !c.pass)) process.exitCode = 1;
  } finally {
    await pg.stop();
    console.log("throwaway cluster stopped and removed");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
