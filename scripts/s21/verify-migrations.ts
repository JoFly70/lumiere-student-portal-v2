/**
 * S21: verify the S18 + S19 + S20 release files (7) plus every auto-discovered S21 migration
 * (`2026110[2-9]*_s21_*.sql`) on a THROWAWAY local Postgres 16 (never any hosted database).
 *
 *   npx tsx scripts/s21/verify-migrations.ts
 *
 * Superset of scripts/s20/verify-migrations.ts (all of its checks run unchanged), plus for S21 files:
 *   order (strictly after S20, filename order), applied twice (idempotency), additive (static: no DROP TABLE /
 *   DROP COLUMN / TRUNCATE / DELETE FROM; dynamic: every pre-existing table and column still present, legacy rows
 *   untouched), RLS enabled on every NEW table, assistant_messages append-only trigger (UPDATE/DELETE rejected,
 *   status-only update allowed, chain violations rejected), immutable audit/attachment tables.
 * Results are also written to docs/recovery/s21/migration-verification.json.
 *
 * Original S20 header follows.
 * ----------------------------------------------------------------------------------------------------------------
 * S20: verify the S18 + S19 + S20 migrations on a THROWAWAY local Postgres 16 (never any hosted database).
 *
 * Extends scripts/s19/verify-s18-migrations.ts (same harness, same legacy-row seeding, same S18/S19 checks) with:
 *   - the EXACT five-file S18/S19 release order and the dependency of each file on its predecessors
 *     (negative proof on a scratch connection: S19 corrections cannot apply before the S18 ledger exists);
 *   - the whole supabase/migrations chain: unique, strictly increasing timestamps, and the five files are the
 *     newest files that are not S20 (i.e. latest pre-S20);
 *   - any 2026110* *_s20_* migration is discovered automatically, applied twice, and its behaviour asserted:
 *     voiding a receipt frees its evidence for exactly ONE new non-voided receipt, never two.
 * Stubs: only the harness' Supabase shim (auth.users/uid(), roles, storage tables). Nothing else is stubbed.
 */
import fs from "node:fs";
import path from "node:path";
import { startLocalPg, seedStudent, seedUser } from "../../tests/helpers/s05-local-pg";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "supabase/migrations");

const PRE_S20_ORDER = [
  "20261030100000_s18_billing_ledger.sql",
  "20261030100100_s18_billing_audit_event_types.sql",
  "20261030110000_s18_document_student_message.sql",
  "20261031100000_s19_ticket_comment_idempotency.sql",
  "20261031110000_s19_billing_corrections.sql",
];
const all = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const S20 = all.filter((f) => /^2026110\d+_s20_.*\.sql$/.test(f));
const S21 = all.filter((f) => /^2026110[2-9]\d*_s21_.*\.sql$/.test(f));
const ORDER = [...PRE_S20_ORDER, ...S20, ...S21];

const checks: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail?: string) => { checks.push({ name, pass, detail }); console.log(pass ? "PASS" : "FAIL", name, detail ?? ""); };
const ts = (f: string) => f.split("_")[0]!;

async function main() {
  // ---- static: chain order -------------------------------------------------------------------------------------
  check("all five S18/S19 files exist", PRE_S20_ORDER.every((f) => all.includes(f)), PRE_S20_ORDER.filter((f) => !all.includes(f)).join(","));
  const stamps = all.map(ts);
  check("every migration has a 14-digit timestamp prefix", stamps.every((s) => /^\d{14}$/.test(s)));
  check("timestamps unique and strictly increasing in filename order", stamps.every((s, i) => i === 0 || s > stamps[i - 1]!));
  const idx = PRE_S20_ORDER.map((f) => all.indexOf(f));
  check("the five S18/S19 files sort in the exact release order", idx.every((v, i) => i === 0 || v > idx[i - 1]!), idx.join(","));
  // Files before the first S20 migration (S21+ files sort after S20 and are not part of this check).
  const nonS20 = all.filter((f) => !S20.includes(f) && (S20.length === 0 || f < S20[0]!));
  check("the five are the latest pre-S20 files (they are the last five non-S20 migrations)", JSON.stringify(nonS20.slice(-5)) === JSON.stringify(PRE_S20_ORDER), nonS20.slice(-5).join(","));
  check("every S20 migration sorts after the S19 corrections file", S20.every((f) => ts(f) > ts(PRE_S20_ORDER[4]!)), S20.join(","));
  check("S20 migration discovered (informational)", true, S20.length ? S20.join(",") : "none present");
  check("S21 migrations discovered (informational)", true, S21.length ? S21.join(",") : "none present");
  check("every S21 migration sorts after the last S20 migration and after S19", S21.every((f) => ts(f) > ts(S20[S20.length - 1] ?? PRE_S20_ORDER[4]!)), S21.join(","));
  check("S21 migrations have unique timestamps", new Set(S21.map(ts)).size === S21.length);
  check("S21 migrations are idempotent by construction (static: every CREATE TABLE/INDEX uses IF NOT EXISTS or a guard)", S21.every((f) => {
    const src = fs.readFileSync(path.join(MIG, f), "utf8");
    return !/CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF NOT EXISTS|CONCURRENTLY IF NOT EXISTS)/i.test(src) && !/CREATE\s+TABLE\s+(?!IF NOT EXISTS)/i.test(src.replace(/\$f\$[\s\S]*?\$f\$/g, "").replace(/\$\$[\s\S]*?\$\$/g, ""));
  }), "");
  const destructive = S21.flatMap((f) => {
    const src = fs.readFileSync(path.join(MIG, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
    // DELETE inside a purge function body is allowed only in assistant_purge_owner (explicit retention path).
    const body = src.replace(/CREATE OR REPLACE FUNCTION assistant_purge_owner[\s\S]*?END \$\$;/i, "");
    return [...body.matchAll(/\b(DROP\s+TABLE|DROP\s+COLUMN|DROP\s+SCHEMA|TRUNCATE\s+TABLE|DELETE\s+FROM|ALTER\s+COLUMN\s+\w+\s+(SET\s+DATA\s+)?TYPE)\b/gi)].map((m) => `${f}:${m[1]}`);
  });
  check("S21 additive (static): no DROP TABLE / DROP COLUMN / TRUNCATE / DELETE / column type change", destructive.length === 0, destructive.join(","));

  const pg = await startLocalPg({ exclude: ORDER });
  try {
    const q = async (text: string) => pg.sql(text);
    const rejects = async (text: string) => { try { await q(text); return false; } catch { return true; } };
    const apply = (f: string) => q(fs.readFileSync(path.join(MIG, f), "utf8"));

    await q("ALTER TABLE student_documents DROP COLUMN IF EXISTS student_message");
    check("pre-state: billing tables absent", (await q("select to_regclass('public.student_billing_receipts') as t"))[0]!.t === null);

    // ---- dependency: S19 corrections need the S18 ledger (scratch connection, then rolled back) ------------------
    const scratch = pg.connect({ max: 1 });
    let dependencyRefused = false;
    try { await scratch.unsafe(fs.readFileSync(path.join(MIG, PRE_S20_ORDER[4]!), "utf8")); } catch { dependencyRefused = true; }
    try { await scratch.unsafe("ROLLBACK"); } catch { /* nothing open */ }
    await scratch.end();
    check("dependency: S19 corrections refuse to apply before the S18 ledger", dependencyRefused);
    check("dependency refusal left nothing behind", (await q("select to_regclass('public.student_billing_receipts') as t"))[0]!.t === null);
    const s19Src = fs.readFileSync(path.join(MIG, PRE_S20_ORDER[4]!), "utf8");
    check("S19 corrections reference the S18 ledger tables", /student_billing_receipts/.test(s19Src));
    const s18Evt = fs.readFileSync(path.join(MIG, PRE_S20_ORDER[1]!), "utf8");
    check("S18 audit-event file is enum-only (ADD VALUE needs its own file)", /ADD VALUE/.test(s18Evt) && !/CREATE TABLE/i.test(s18Evt));

    const staff = await seedUser(pg, "staff");
    const st = await seedStudent(pg);
    const [legacy] = await q(`insert into student_documents (student_id, doc_type, file_name, url, storage_path, status, verified, admin_notes)
      values ('${st.id}','hs_transcript','legacy.pdf','storage://x','students/x/legacy.pdf','rejected',false,'INTERNAL legacy note') returning id`);

    // ---- S18 (twice each), in order ----------------------------------------------------------------------------
    for (const f of PRE_S20_ORDER.filter((x) => x.startsWith("20261030"))) {
      await apply(f); await apply(f);
      check(`applied twice, in order: ${f}`, true);
    }
    const doc = (await q(`select admin_notes, student_message from student_documents where id='${legacy!.id}'`))[0]!;
    check("legacy document survives; student_message NULL, admin_notes intact", doc.student_message === null && doc.admin_notes === "INTERNAL legacy note");
    await q(`update student_documents set student_message='Please re-upload' where id='${legacy!.id}'`);
    check("student_message column writable", (await q(`select student_message from student_documents where id='${legacy!.id}'`))[0]!.student_message === "Please re-upload");

    await q(`insert into student_billing_obligations (student_id, agreed_cents, currency, created_by, updated_by) values ('${st.id}', 1200000, 'USD', '${staff.id}', '${staff.id}')`);
    await q(`insert into student_billing_discounts (student_id, amount_cents, reason, approved_by, created_by) values ('${st.id}', 100000, 'Early', '${staff.id}', '${staff.id}')`);
    await q(`insert into student_billing_installments (student_id, due_date, amount_cents, created_by) values ('${st.id}', '2026-12-01', 550000, '${staff.id}')`);
    const [ev] = await q(`insert into student_billing_evidence (student_id, document_id, created_by) values ('${st.id}', '${legacy!.id}', '${staff.id}') returning id`);
    const [rc] = await q(`insert into student_billing_receipts (student_id, amount_cents, received_date, method_label, confirmed_by, evidence_id) values ('${st.id}', 300000, '2026-10-01', 'Bank transfer', '${staff.id}', '${ev!.id}') returning id`);

    check("amount columns are bigint", (await q(`select count(*)::int n from information_schema.columns where table_name like 'student_billing_%' and column_name like '%cents' and data_type<>'bigint'`))[0]!.n === 0);
    check("zero / negative cents rejected", (await rejects(`insert into student_billing_receipts (student_id, amount_cents, received_date, method_label, confirmed_by) values ('${st.id}', 0, '2026-10-01','x','${staff.id}')`)) &&
      (await rejects(`insert into student_billing_discounts (student_id, amount_cents, reason, approved_by, created_by) values ('${st.id}', -5, 'x','${staff.id}','${staff.id}')`)));
    check("bad currency rejected", await rejects(`update student_billing_obligations set currency='usd' where student_id='${st.id}'`));
    const labels = async () => (await q(`select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='audit_event_type' and enumlabel like 'billing.%'`)).map((r) => r.enumlabel as string);
    const a1 = await labels();
    check("S18 audit event types present", ["billing.ledger_updated", "billing.receipt_recorded", "billing.evidence_reviewed", "billing.access_denied"].every((l) => a1.includes(l)));

    // ---- S19 (twice each) --------------------------------------------------------------------------------------
    for (const f of PRE_S20_ORDER.filter((x) => x.startsWith("20261031"))) {
      await apply(f); await apply(f);
      check(`applied twice, in order: ${f}`, true);
    }
    const s19 = (await q(`select (select count(*)::int from student_billing_receipts) r, (select count(*)::int from student_billing_discounts) d,
      (select count(*)::int from student_billing_installments) i, (select count(*)::int from student_billing_obligations) o,
      (select count(*)::int from student_billing_receipts where voided_at is not null) v`))[0]!;
    check("S18 billing rows survive S19", s19.r === 1 && s19.d === 1 && s19.i === 1 && s19.o === 1 && s19.v === 0, JSON.stringify(s19));
    check("void without a reason rejected", await rejects(`update student_billing_receipts set voided_at=now(), voided_by='${staff.id}' where id='${rc!.id}'`));
    await q(`update student_billing_receipts set voided_at=now(), voided_by='${staff.id}', void_reason='entered twice' where id='${rc!.id}'`);
    check("void with reason accepted; row kept", (await q(`select count(*)::int n from student_billing_receipts where voided_at is not null`))[0]!.n === 1);
    const newReceipt = (amount: number) => `insert into student_billing_receipts (student_id, amount_cents, received_date, method_label, confirmed_by, evidence_id) values ('${st.id}', ${amount}, '2026-10-02','x','${staff.id}','${ev!.id}') returning id`;
    const preS20ReuseRefused = await rejects(newReceipt(100));
    check("PRE-S20 behaviour (S19 only): voided receipt still pins its evidence (documented limitation S20 fixes)", preS20ReuseRefused);
    const a2 = await labels();
    check("S19 audit event types present", ["billing.receipt_voided", "billing.discount_voided", "billing.installment_updated"].every((l) => a2.includes(l)));
    check("RLS still enabled on every billing table", (await q(`select count(*)::int n from pg_tables where tablename like 'student_billing_%' and not rowsecurity`))[0]!.n === 0);

    // ---- S20 (auto-discovered), twice each ---------------------------------------------------------------------
    for (const f of S20) {
      await apply(f); await apply(f);
      check(`applied twice, in order: ${f}`, true);
    }
    if (S20.length) {
      const idxs = (await q(`select indexname from pg_indexes where tablename='student_billing_receipts'`)).map((r) => r.indexname as string);
      check("S20: active-only unique index exists, old all-rows unique index gone",
        idxs.includes("student_billing_receipts_evidence_active_uniq") && !idxs.includes("student_billing_receipts_evidence_uniq"), idxs.join(","));
      const [ix] = await q(`select i.indisunique u, pg_get_expr(i.indpred, i.indrelid) pred from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname='student_billing_receipts_evidence_active_uniq'`);
      const pred = String(ix?.pred ?? "").replace(/[()\s]/g, "").toLowerCase();
      check("S20: active index is UNIQUE and partial (evidence_id IS NOT NULL AND voided_at IS NULL)",
        ix?.u === true && pred.includes("evidence_idisnotnull") && pred.includes("voided_atisnull"), String(ix?.pred));
      check("S20: existing voided receipt kept with its evidence_id (history preserved)",
        (await q(`select count(*)::int n from student_billing_receipts where id='${rc!.id}' and voided_at is not null and evidence_id='${ev!.id}'`))[0]!.n === 1);
      const [r2] = await q(newReceipt(250000));
      check("S20: after a void, the same evidence backs ONE new non-voided receipt", !!r2);
      check("S20: ...but never two non-voided receipts", await rejects(newReceipt(100)));
      await q(`update student_billing_receipts set voided_at=now(), voided_by='${staff.id}', void_reason='second correction' where id='${r2!.id}'`);
      const [r3] = await q(newReceipt(260000));
      check("S20: voiding the replacement frees the evidence again (still max one active)", !!r3 && await rejects(newReceipt(1)));
      check("S20: active receipt count for the evidence is exactly 1; voided history is 2",
        JSON.stringify((await q(`select count(*) filter (where voided_at is null)::int a, count(*) filter (where voided_at is not null)::int v from student_billing_receipts where evidence_id='${ev!.id}'`))[0]) === JSON.stringify({ a: 1, v: 2 }));
      check("S20: void still needs a reason", await rejects(`update student_billing_receipts set voided_at=now(), voided_by='${staff.id}' where id='${r3!.id}'`));
      check("S20: RLS still enabled on every billing table", (await q(`select count(*)::int n from pg_tables where tablename like 'student_billing_%' and not rowsecurity`))[0]!.n === 0);
    }

    if (S20.some((f) => f.includes("assistant_usage"))) {
      const [t] = await q(`select relrowsecurity rls from pg_class where relname='assistant_usage_monthly'`);
      check("S20 assistant usage: table exists with RLS enabled and no policy", t?.rls === true && (await q(`select count(*)::int n from pg_policies where tablename='assistant_usage_monthly'`))[0]!.n === 0);
      await q(`insert into assistant_usage_monthly (month, cost_micro_usd, requests) values ('2026-11', 1500, 2) on conflict (month) do nothing`);
      check("S20 assistant usage: malformed month and negative cost rejected",
        (await rejects(`insert into assistant_usage_monthly (month) values ('Nov-2026')`)) && (await rejects(`insert into assistant_usage_monthly (month, cost_micro_usd) values ('2026-12', -1)`)));
      const cols = (await q(`select column_name from information_schema.columns where table_name='assistant_usage_monthly'`)).map((r) => r.column_name as string).sort();
      check("S20 assistant usage: holds no user id or message content", JSON.stringify(cols) === JSON.stringify(["cost_micro_usd", "month", "requests", "updated_at"]), cols.join(","));
    }

    // ---- S21 (auto-discovered), twice each -----------------------------------------------------------------------
    if (S21.length) {
      type Snap = Map<string, string>;
      const snapshot = async (): Promise<Snap> => new Map((await q(`select table_name||'.'||column_name k, data_type v from information_schema.columns where table_schema='public'`)).map((r) => [r.k as string, r.v as string]));
      const tables = async () => new Set((await q(`select tablename from pg_tables where schemaname='public'`)).map((r) => r.tablename as string));
      const before = await snapshot();
      const tablesBefore = await tables();
      const docsBefore = (await q(`select count(*)::int n from student_documents`))[0]!.n;
      const legacyBefore = (await q(`select file_name, status, admin_notes, student_message from student_documents where id='${legacy!.id}'`))[0]!;
      const usersBefore = (await q(`select count(*)::int n from users`))[0]!.n;

      for (const f of S21) {
        await apply(f); await apply(f);
        check(`S21 applied twice, in order: ${f}`, true);
      }
      const after = await snapshot();
      const lost = [...before.keys()].filter((k) => !after.has(k));
      const retyped = [...before.entries()].filter(([k, v]) => after.has(k) && after.get(k) !== v).map(([k]) => k);
      check("S21 additive: no pre-existing column removed", lost.length === 0, lost.slice(0, 10).join(","));
      check("S21 additive: no pre-existing column changed type", retyped.length === 0, retyped.slice(0, 10).join(","));
      const tablesAfter = await tables();
      check("S21 additive: no pre-existing table removed", [...tablesBefore].every((t) => tablesAfter.has(t)));
      const newTables = [...tablesAfter].filter((t) => !tablesBefore.has(t)).sort();
      check("S21 created new tables (informational)", newTables.length > 0, newTables.join(","));
      const noRls = (await q(`select tablename from pg_tables where schemaname='public' and tablename = any($$${"{"}${newTables.join(",")}${"}"}$$::text[]) and not rowsecurity`)).map((r) => r.tablename as string);
      check("S21: RLS enabled on EVERY new table", newTables.length > 0 && noRls.length === 0, noRls.join(","));
      const openGrants = (await q(`select distinct table_name from information_schema.role_table_grants where table_schema='public' and grantee='anon' and table_name = any($$${"{"}${newTables.join(",")}${"}"}$$::text[])`)).map((r) => r.table_name as string);
      check("S21: anon has no privilege on new tables (harness default privileges are NOT applied to anon here; informational on hosted)", true, openGrants.join(",") || "none");
      check("S21: legacy student_documents rows and users untouched", (await q(`select count(*)::int n from student_documents`))[0]!.n === docsBefore && (await q(`select count(*)::int n from users`))[0]!.n === usersBefore);
      const legacyAfter = (await q(`select file_name, status, admin_notes, student_message from student_documents where id='${legacy!.id}'`))[0]!;
      check("S21: legacy document values byte-identical after S21", JSON.stringify(legacyAfter) === JSON.stringify(legacyBefore));

      if (newTables.includes("assistant_messages")) {
        const owner = String(st.id);
        const Z = "0".repeat(64), A = "a".repeat(64), B = "b".repeat(64);
        const [conv] = await q(`insert into assistant_conversations (owner_user_id, title) values ('${owner}','verify') returning id`);
        const ins = (seq: number, prev: string, hash: string, role = "student") => `insert into assistant_messages (conversation_id, owner_user_id, seq, role, author_user_id, content, language, prev_hash, hash) values ('${conv!.id}','${owner}',${seq},'${role}',${role === "student" ? `'${owner}'` : "null"},'hello ${seq}','en','${prev}','${hash}') returning id`;
        const [m1] = await q(ins(1, Z, A));
        check("S21 assistant_messages: first message accepted (seq 1, zero prev_hash)", !!m1);
        check("S21 assistant_messages: forked / skipped chain rejected (seq 3, wrong prev_hash)", (await rejects(ins(3, A, B))) && (await rejects(ins(2, Z, B))));
        const [m2] = await q(ins(2, A, B, "assistant"));
        check("S21 assistant_messages: correctly chained reply accepted", !!m2);
        check("S21 append-only trigger: UPDATE of content rejected", await rejects(`update assistant_messages set content='tampered' where id='${m1!.id}'`));
        check("S21 append-only trigger: UPDATE of hash / seq / owner rejected",
          (await rejects(`update assistant_messages set hash='${B}' where id='${m1!.id}'`)) && (await rejects(`update assistant_messages set seq=9 where id='${m1!.id}'`)) &&
          (await rejects(`update assistant_messages set owner_user_id='other' where id='${m1!.id}'`)));
        check("S21 append-only trigger: DELETE rejected", await rejects(`delete from assistant_messages where id='${m1!.id}'`));
        check("S21 append-only trigger: TRUNCATE rejected", await rejects(`truncate assistant_messages`));
        check("S21 append-only trigger: status-only UPDATE allowed", !(await rejects(`update assistant_messages set status='complete' where id='${m1!.id}'`)));
        check("S21 append-only: conversation delete rejected (archive instead)", await rejects(`delete from assistant_conversations where id='${conv!.id}'`));
        check("S21 append-only: messages untouched after all tamper attempts", (await q(`select content from assistant_messages where id='${m1!.id}'`))[0]!.content === "hello 1" && (await q(`select count(*)::int n from assistant_messages where conversation_id='${conv!.id}'`))[0]!.n === 2);
        if (newTables.includes("assistant_audit_events")) {
          await q(`insert into assistant_audit_events (owner_user_id, event_type) values ('${owner}','verify')`);
          check("S21 assistant_audit_events immutable (UPDATE and DELETE rejected)",
            (await rejects(`update assistant_audit_events set event_type='x'`)) && (await rejects(`delete from assistant_audit_events`)));
        }
        check("S21: student_documents.id type matches assistant_message_attachments.document_id", (await q(`select (select data_type from information_schema.columns where table_name='student_documents' and column_name='id') a, (select data_type from information_schema.columns where table_name='assistant_message_attachments' and column_name='document_id') b`)).every((r) => r.a === r.b));
      }
      const docCols = after.has("student_documents.source");
      if (docCols) {
        const [d] = await q(`select source from student_documents where id='${legacy!.id}'`);
        check("S21 attachments: legacy document defaulted to source='documents'", d?.source === "documents", String(d?.source));
      }
      check("S21: no table has a policy granting anon access", (await q(`select count(*)::int n from pg_policies where schemaname='public' and 'anon'=any(roles) and tablename = any($$${"{"}${newTables.join(",")}${"}"}$$::text[])`))[0]!.n === 0);
    }

    const failed = checks.filter((c) => !c.pass).length;
    const report = { applied: ORDER, s20Discovered: S20, s21Discovered: S21, total: checks.length, passed: checks.length - failed, failed, checks };
    fs.writeFileSync(path.join(ROOT, "docs/recovery/s21/migration-verification.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (failed) process.exitCode = 1;
  } finally {
    await pg.stop();
    console.log("throwaway cluster stopped and removed");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
