/**
 * Cleanup of exactly what one journey run created.
 *
 * Scope is the run id: synthetic accounts are recognised by their e-mail tag `s22-<runId>-` (never by pattern alone),
 * students by that e-mail or by a link to such an account, invitations by that e-mail. Manifest ids are only honoured
 * when the database row carries the tag. Everything below those roots is removed by walking the foreign-key graph
 * (children first) in ONE transaction: any failure rolls back and nothing is deleted. Append-only triggers (hash-chained
 * conversations, audit/result tables) are disabled only on tables the walk touches, inside the transaction (needs the
 * table-owner role; assistant conversations go through the owner-only assistant_purge_owner() function instead).
 * Storage objects and auth users are removed afterwards, from the same scope.
 *
 * Without `confirm` it only reports what it would delete (dry run).
 */
import type postgres from 'postgres';
import type { Manifest } from './ctx';
import type { Ops } from './types';

export interface CleanupReport {
  runId: string;
  dryRun: boolean;
  roots: { users: number; students: number; invitations: number };
  rows: Record<string, number>;
  assistantOwnersPurged: number;
  storageObjects: number;
  authUsers: number;
  triggersDisabledOn: string[];
  skippedCycles: string[];
  errors: string[];
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const lit = (ids: string[]): string => {
  for (const i of ids) if (!SAFE_ID.test(i)) throw new Error(`refusing unsafe id ${JSON.stringify(i)}`);
  return ids.length ? ids.map((i) => `'${i}'`).join(', ') : "'__none__'";
};
const MAX_ROWS = 20_000;

interface Fk { child: string; childCols: string[]; parentCols: string[] }

async function referencing(tx: postgres.Sql, table: string): Promise<Fk[]> {
  const rows = await tx.unsafe(
    `select c.conrelid::regclass::text as child,
       (select array_agg(quote_ident(a.attname) order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as child_cols,
       (select array_agg(quote_ident(a.attname) order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as parent_cols
     from pg_constraint c
     where c.contype = 'f' and c.confrelid = $1::regclass and c.confdeltype not in ('n', 'd')`,
    [table],
  );
  return (rows as any[]).map((r) => ({ child: r.child as string, childCols: r.child_cols as string[], parentCols: r.parent_cols as string[] }));
}

type Visit = (table: string, pred: string) => Promise<void>;

/** Post-order walk: children of (table WHERE pred) first, then the node itself. */
async function walk(tx: postgres.Sql, table: string, pred: string, path: string[], visit: Visit, cycles: Set<string>): Promise<void> {
  if (path.length > 8) throw new Error(`foreign-key depth limit reached at ${table}`);
  for (const fk of await referencing(tx, table)) {
    if (fk.child === table || path.includes(fk.child)) { cycles.add(`${fk.child} -> ${table}`); continue; }
    const cols = fk.childCols.length === 1 ? fk.childCols[0]! : `(${fk.childCols.join(', ')})`;
    const sel = fk.parentCols.join(', ');
    await walk(tx, fk.child, `${cols} in (select ${sel} from ${table} where ${pred})`, [...path, table], visit, cycles);
  }
  await visit(table, pred);
}

export async function cleanupRun(
  sql: postgres.Sql,
  ops: Pick<Ops, 'removeStorageObjects' | 'deleteAuthUser'> | null,
  input: { runId: string; confirm: boolean; manifest?: Partial<Manifest> | null; log?: (s: string) => void },
): Promise<CleanupReport> {
  const { runId, confirm } = input;
  const log = input.log ?? (() => {});
  if (!/^[a-z0-9-]{8,40}$/.test(runId)) throw new Error('runId must look like 20261027101500-ab12');
  const tag = `%s22-${runId}-%`;
  const report: CleanupReport = { runId, dryRun: !confirm, roots: { users: 0, students: 0, invitations: 0 }, rows: {}, assistantOwnersPurged: 0, storageObjects: 0, authUsers: 0, triggersDisabledOn: [], skippedCycles: [], errors: [] };
  const man = input.manifest ?? {};

  // 1. Scope: tagged rows only; a manifest id that is not tagged in the database is ignored.
  const users = (await sql.unsafe('select id::text as id from users where email ilike $1', [tag]) as any[]).map((r) => r.id as string);
  const userIds = [...new Set(users)];
  const students = (await sql.unsafe(`select id::text as id, student_code, photo_url from students where email ilike $1 or user_id::text in (${lit(userIds)})`, [tag]) as any[]);
  const studentIds = students.map((r) => r.id as string);
  const invitations = (await sql.unsafe('select id::text as id from account_invitations where email ilike $1', [tag]) as any[]).map((r) => r.id as string);
  report.roots = { users: userIds.length, students: studentIds.length, invitations: invitations.length };
  const ignored = [...(man.authUserIds ?? []), ...(man.studentIds ?? [])].filter((i) => !userIds.includes(i) && !studentIds.includes(i));
  if (ignored.length) report.errors.push(`${ignored.length} manifest id(s) are not tagged s22-${runId}- in the database and were ignored`);

  // 2. Storage objects to remove afterwards.
  const docPaths = (await sql.unsafe(`select storage_path from student_documents where student_id::text in (${lit(studentIds)})`) as any[]).map((r) => r.storage_path as string).filter(Boolean);
  const photoPaths = students.map((s) => /^storage:student-documents\/(profile-photos\/[A-Za-z0-9_.-]+)$/.exec(String(s.photo_url ?? ''))?.[1]).filter(Boolean) as string[];
  const studentCodes = new Set(students.map((s) => String(s.student_code)));
  const manifestPaths = (man.storagePaths ?? []).filter((p) => {
    const m = /^students\/([^/]+)\//.exec(p);
    return m ? studentCodes.has(m[1]!) : /^profile-photos\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/.test(p) && studentIds.some((id) => p.startsWith(`profile-photos/${id}_`));
  });
  const storagePaths = [...new Set([...docPaths, ...photoPaths, ...manifestPaths])];
  report.storageObjects = storagePaths.length;

  // 3. Database: one transaction.
  const roots: { table: string; pred: string }[] = [
    { table: 'student_assistant_memory', pred: `owner_user_id in (${lit(userIds)})` },
    { table: 'student_welcome_state', pred: `user_id in (${lit(userIds)})` },
    { table: 'students', pred: `id::text in (${lit(studentIds)})` },
    { table: 'account_invitations', pred: `id::text in (${lit(invitations)})` },
    { table: 'users', pred: `id::text in (${lit(userIds)})` },
  ];
  class DryRunDone extends Error {}
  try {
    await sql.begin(async (tx) => {
      const exists = async (t: string) => Boolean((await tx.unsafe('select to_regclass($1) as r', [t]) as any[])[0]?.r);
      const live: { table: string; pred: string }[] = [];
      for (const r of roots) if (await exists(r.table)) live.push(r);

      // plan: which tables does the walk touch, and how many rows
      const touched = new Set<string>();
      const cycles = new Set<string>();
      let total = 0;
      for (const r of live) {
        await walk(tx as unknown as postgres.Sql, r.table, r.pred, [], async (table, pred) => {
          touched.add(table);
          const n = Number((await tx.unsafe(`select count(*)::int as n from ${table} where ${pred}`) as any[])[0]!.n);
          report.rows[table] = Math.max(report.rows[table] ?? 0, 0) + n;
          total += n;
        }, cycles);
      }
      report.skippedCycles = [...cycles];
      if (total > MAX_ROWS) throw new Error(`refusing to delete ${total} rows (limit ${MAX_ROWS}): the run scope looks wrong`);
      report.triggersDisabledOn = [...touched].sort();
      if (!confirm) throw new DryRunDone();

      // assistant conversations: owner-only purge function
      if (userIds.length && (await tx.unsafe("select to_regprocedure('assistant_purge_owner(text,text)') as p") as any[])[0]?.p) {
        for (const id of userIds) { await tx.unsafe("select assistant_purge_owner($1, 'S22 hosted-journey cleanup')", [id]); report.assistantOwnersPurged++; }
      }
      for (const t of touched) await tx.unsafe(`alter table ${t} disable trigger user`);
      report.rows = {};
      for (const r of live) {
        await walk(tx as unknown as postgres.Sql, r.table, r.pred, [], async (table, pred) => {
          const res = await tx.unsafe(`delete from ${table} where ${pred}`);
          report.rows[table] = (report.rows[table] ?? 0) + (res.count ?? 0);
        }, new Set());
      }
      for (const t of touched) await tx.unsafe(`alter table ${t} enable trigger user`);
    });
  } catch (e) {
    if (!(e instanceof DryRunDone)) {
      report.errors.push(`database cleanup rolled back: ${(e as Error).message}`);
      report.rows = {};
      return report;
    }
  }

  // 4. Storage and auth users (only after the database transaction committed).
  if (confirm && ops) {
    try { if (storagePaths.length) await ops.removeStorageObjects(storagePaths); } catch (e) { report.errors.push(`storage removal: ${(e as Error).message}`); }
    for (const id of userIds) {
      try { await ops.deleteAuthUser(id); report.authUsers++; } catch (e) { report.errors.push(`auth user ${id}: ${(e as Error).message}`); }
    }
  } else {
    report.authUsers = userIds.length;
  }
  log(`cleanup ${confirm ? 'done' : 'plan'}: ${JSON.stringify({ roots: report.roots, storage: report.storageObjects, rows: report.rows })}`);
  return report;
}
