import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'server/services/assistant-memory');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => path.join(dir, f));
files.push(path.join(root, 'server/routes/assistant-memory.ts'));
const MEMORY_TABLES = new Set(['student_assistant_memory', 'assistant_memory_sources']);
const read = (f: string) => fs.readFileSync(f, 'utf8');

function tablesAfter(src: string, re: RegExp): string[] {
  return [...src.matchAll(re)].map((m) => m[1].toLowerCase());
}

describe('S21 memory never writes outside the memory tables', () => {
  it('every INSERT/UPDATE/DELETE in the memory module and route targets a memory table', () => {
    for (const f of files) {
      const src = read(f);
      const targets = [
        ...tablesAfter(src, /\bINSERT\s+INTO\s+(?:public\.)?([a-z_]+)/gi),
        ...tablesAfter(src, /\bUPDATE\s+(?:public\.)?([a-z_]+)\s+SET\b/gi),
        ...tablesAfter(src, /\bDELETE\s+FROM\s+(?:public\.)?([a-z_]+)/gi),
      ];
      for (const t of targets) expect(MEMORY_TABLES.has(t), `${path.basename(f)} writes ${t}`).toBe(true);
    }
  });

  it('the persistence file (store.ts) reads and writes only memory tables', () => {
    const src = read(path.join(dir, 'store.ts'));
    const referenced = tablesAfter(src, /\b(?:FROM|JOIN|INTO)\s+(?:public\.)?([a-z_]+)/g).filter((t) => !['sql', 'ts'].includes(t));
    expect(referenced.length).toBeGreaterThan(0);
    for (const t of referenced) expect(MEMORY_TABLES.has(t), `store.ts references ${t}`).toBe(true);
  });

  it('no write path mentions credit, verification, billing, acceptance or graduation tables', () => {
    for (const f of files.filter((x) => /store\.ts$|index\.ts$|assistant-memory\.ts$/.test(x))) {
      const sqlOnly = [...read(f).matchAll(/sql`([\s\S]*?)`/g)].map((m) => m[1]).join('\n');
      expect(sqlOnly).not.toMatch(/credit|verification|billing|receipt|installment|accept|graduat|decision|document|roadmap/i);
    }
  });

  it('retrieval and presenter only SELECT from foreign tables (no writes)', () => {
    for (const name of ['private-retrieval.ts', 'presenter.ts', 'academic-context.ts']) {
      const src = read(path.join(dir, name));
      expect(src).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i);
    }
    const gs = read(path.join(root, 'server/services/global-search/index.ts'));
    expect(gs).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i);
  });

  it('student-scoped queries always filter by the owner', () => {
    const src = read(path.join(dir, 'private-retrieval.ts'));
    expect(src).toMatch(/m\.owner_user_id = \$\{owner\}/);
    expect(src).toMatch(/s\.user_id::text = \$\{owner\}/);
    expect(src).toMatch(/visibility::text <> 'staff_only'/);
    expect(src).toMatch(/soft_deleted = false/);
  });
});
