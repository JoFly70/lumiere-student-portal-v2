import { readFileSync } from 'fs';
import postgres from 'postgres';

const envContent = readFileSync('.env', 'utf8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.substring(0, eqIdx);
  const val = trimmed.substring(eqIdx + 1);
  if (!process.env[key]) process.env[key] = val;
}

const url = process.env.DATABASE_URL!;
const ref = url.match(/postgres\.([a-z0-9]+)/)?.[1] ?? 'UNKNOWN';
if (ref !== 'rheronevecsffaejteoj') {
  console.error('STOP: wrong project');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

const migration = `
ALTER TABLE knowledge_verification_events
  ADD COLUMN IF NOT EXISTS seq BIGSERIAL NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_verif_events_cv_seq_idx
  ON knowledge_verification_events (claim_version_id, seq DESC);
`;

try {
  await sql.unsafe(migration);
  console.log('MIGRATION_APPLIED');
} catch (e: any) {
  console.error('MIGRATION_FAILED:', e.message);
  process.exit(1);
}
await sql.end();
