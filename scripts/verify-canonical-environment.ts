/**
 * Canonical Environment Verification — fail-closed identity guard.
 *
 * Prints no secrets. Verifies canonical Supabase project identity and key
 * shapes only. Exits nonzero on mismatch.
 *
 * Usage: npx tsx scripts/verify-canonical-environment.ts
 */

import { readFileSync } from 'fs';

const CANONICAL = 'rheronevecsffaejteoj';
const CANONICAL_URL = `https://${CANONICAL}.supabase.co`;

function loadEnv(): void {
  try {
    const content = readFileSync('.env', 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const i = trimmed.indexOf('=');
      if (i > 0 && !process.env[trimmed.slice(0, i)]) {
        process.env[trimmed.slice(0, i)] = trimmed.slice(i + 1).trim();
      }
    }
  } catch {
    // .env not required if env vars are set externally
  }
}

loadEnv();

const checks: Array<[string, boolean]> = [
  ['DATABASE_URL targets canonical project', (process.env.DATABASE_URL ?? '').includes(CANONICAL)],
  ['SUPABASE_URL is canonical', process.env.SUPABASE_URL === CANONICAL_URL],
  ['VITE_SUPABASE_URL is canonical', process.env.VITE_SUPABASE_URL === CANONICAL_URL],
  ['SUPABASE_SERVICE_KEY has sb_secret_ prefix', (process.env.SUPABASE_SERVICE_KEY ?? '').startsWith('sb_secret_')],
  ['SUPABASE_ANON_KEY has sb_publishable_ prefix', (process.env.SUPABASE_ANON_KEY ?? '').startsWith('sb_publishable_')],
  ['VITE_SUPABASE_ANON_KEY has sb_publishable_ prefix', (process.env.VITE_SUPABASE_ANON_KEY ?? '').startsWith('sb_publishable_')],
];

let allPass = true;
for (const [label, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) allPass = false;
}

if (!allPass) {
  console.error('\nCanonical environment verification FAILED — aborting before any DB mutation.');
  process.exit(1);
}

console.log('\nCanonical environment verification PASS.');
