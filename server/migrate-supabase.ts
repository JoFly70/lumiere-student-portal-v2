/**
 * Supabase Migration Runner (Manual Approach)
 * 
 * Unfortunately, automated migrations via connection string don't work with Supabase's architecture.
 * This script provides clear manual instructions instead.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

if (!supabaseUrl) {
  console.error('❌ SUPABASE_URL not found');
  process.exit(1);
}

const projectRef = supabaseUrl.replace('https://', '').split('.')[0];

console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                   📋 MANUAL MIGRATION REQUIRED                     ║
╚═══════════════════════════════════════════════════════════════════╝

Automated migrations aren't supported due to Supabase's pooler architecture.
Please run migrations manually - it takes just 2 minutes:

┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Open Supabase SQL Editor                                │
└─────────────────────────────────────────────────────────────────┘

🌐 Go to: https://supabase.com/dashboard/project/${projectRef}/editor

┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Run Migration 001                                       │
└─────────────────────────────────────────────────────────────────┘

📄 File: migrations/001_initial_schema.sql

1. Open the file above in your editor
2. Copy ALL content (Cmd/Ctrl+A, Cmd/Ctrl+C)
3. Paste into Supabase SQL Editor
4. Click "Run" button
5. Wait for "Success. No rows returned" message

┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Run Migration 002                                       │
└─────────────────────────────────────────────────────────────────┘

📄 File: migrations/002_rls_policies.sql

1. Open the file above in your editor
2. Copy ALL content (Cmd/Ctrl+A, Cmd/Ctrl+C)
3. Paste into Supabase SQL Editor (clear previous content first)
4. Click "Run" button
5. Wait for "Success" message

┌─────────────────────────────────────────────────────────────────┐
│ ✅ After Migrations Complete                                     │
└─────────────────────────────────────────────────────────────────┘

Run these commands to populate your database:

   tsx server/seed-supabase.ts
   tsx server/create-sample-student.ts

═══════════════════════════════════════════════════════════════════

💡 TIP: The migrations are idempotent - safe to run multiple times.
    If you see "already exists" errors, that's normal!

═══════════════════════════════════════════════════════════════════
`);

// Show first few lines of each migration for reference
console.log('\n📄 Migration 001 Preview (first 10 lines):');
console.log('─'.repeat(70));
const migration001 = readFileSync(join(process.cwd(), 'migrations/001_initial_schema.sql'), 'utf-8');
const lines001 = migration001.split('\n').slice(0, 10);
lines001.forEach(line => console.log(line));
console.log('...\n');

console.log('📄 Migration 002 Preview (first 10 lines):');
console.log('─'.repeat(70));
const migration002 = readFileSync(join(process.cwd(), 'migrations/002_rls_policies.sql'), 'utf-8');
const lines002 = migration002.split('\n').slice(0, 10);
lines002.forEach(line => console.log(line));
console.log('...\n');

console.log('✨ Once migrations are done, come back here to continue setup!\n');
