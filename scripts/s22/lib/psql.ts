/**
 * Thin psql runner shared by the S22 bootstrap and verifier. Credentials travel only in the child's
 * environment (libpq PG* variables), never in argv, so they cannot show up in a process list or log.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact } from './staging-guard';

export type PgEnv = Record<string, string>;

/** Splits a postgres:// URL into libpq environment variables. */
export function pgEnvFromUrl(databaseUrl: string): PgEnv {
  const u = new URL(databaseUrl);
  const local = ['127.0.0.1', 'localhost', '::1'].includes(u.hostname);
  const env: PgEnv = {
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username || 'postgres'),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '') || 'postgres'),
    PGSSLMODE: local ? 'disable' : 'require',
    PGCONNECT_TIMEOUT: '20',
    PGAPPNAME: 'lumiere-s22',
  };
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  return env;
}

function childEnv(pg: PgEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^PG/.test(k) || k === 'DATABASE_URL' || k === 'SUPABASE_SERVICE_KEY' || k === 'DATABASE_URL_STAGING') continue;
    base[k] = v;
  }
  return { ...base, ...pg, PGCLIENTENCODING: 'UTF8' };
}

export interface PsqlResult { rc: number; ms: number; error: string; stdout: string; }

function firstError(stderr: string): string {
  const line = stderr.split('\n').find((l) => /ERROR|FATAL|could not|connection/i.test(l)) ?? stderr.split('\n').find((l) => l.trim()) ?? '';
  return redact(line).slice(0, 200);
}

function psql(pg: PgEnv, args: string[], input?: string): PsqlResult {
  const t0 = process.hrtime.bigint();
  const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], {
    env: childEnv(pg), encoding: 'utf8', input, timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const rc = r.status ?? (r.error ? 127 : 1);
  return { rc, ms, error: rc === 0 ? '' : firstError(r.stderr || String(r.error ?? '')), stdout: r.stdout ?? '' };
}

/** One file, one transaction (--single-transaction), stop on first error. */
export function applyFile(pg: PgEnv, file: string): PsqlResult {
  return psql(pg, ['--single-transaction', '-o', os.devNull, '-f', file]);
}

export function runCommand(pg: PgEnv, sql: string): PsqlResult {
  return psql(pg, ['-o', os.devNull, '-c', sql]);
}

/** Runs a SELECT-only file inside BEGIN READ ONLY ... ROLLBACK and returns the CSV result. */
export function queryReadOnly(pg: PgEnv, file: string): PsqlResult {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's22ro-'));
  const wrapper = path.join(dir, 'ro.sql');
  fs.writeFileSync(wrapper, `BEGIN TRANSACTION READ ONLY;\n\\i '${file.replace(/'/g, "''")}'\nROLLBACK;\n`);
  try {
    return psql(pg, ['--csv', '-f', wrapper]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Minimal RFC 4180 CSV parser (psql --csv output). Returns rows of the FIRST result set. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
