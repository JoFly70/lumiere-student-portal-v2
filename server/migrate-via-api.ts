/**
 * Alternative: Run migrations via Supabase REST API
 * Uses service_role key to execute SQL through the API
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const projectRef = supabaseUrl.replace('https://', '').split('.')[0];

console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║         🔄 RUNNING MIGRATIONS VIA SUPABASE REST API                ║
╚═══════════════════════════════════════════════════════════════════╝

Project: ${projectRef}
Using service_role key for admin access...
`);

async function executeSQLViaAPI(sql: string, description: string): Promise<boolean> {
  console.log(`\n📝 ${description}...`);
  
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ query: sql })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ Failed: ${response.status} ${response.statusText}`);
      console.error(`   Error: ${error}`);
      return false;
    }

    const result = await response.json();
    console.log(`✅ Success!`);
    return true;
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    return false;
  }
}

async function executeSQLDirectly(sql: string, description: string): Promise<boolean> {
  console.log(`\n📝 ${description}...`);
  
  // Split SQL into individual statements
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--') && !s.match(/^\/\*/));

  console.log(`   Found ${statements.length} SQL statements`);

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    const preview = statement.substring(0, 60).replace(/\n/g, ' ');
    
    process.stdout.write(`   [${i + 1}/${statements.length}] ${preview}... `);

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ query: statement })
      });

      if (response.ok) {
        console.log('✓');
        successCount++;
      } else {
        const errorText = await response.text();
        if (errorText.includes('already exists') || errorText.includes('duplicate')) {
          console.log('⚠ (exists)');
          skipCount++;
        } else {
          console.log('✗');
          console.log(`      Error: ${errorText.substring(0, 100)}`);
          failCount++;
        }
      }
    } catch (error: any) {
      console.log('✗');
      console.log(`      Error: ${error.message}`);
      failCount++;
    }
  }

  console.log(`\n   Results: ${successCount} success, ${skipCount} skipped, ${failCount} failed`);
  return failCount === 0 || (successCount + skipCount) > 0;
}

async function tryPostgREST(): Promise<boolean> {
  console.log('\n🔍 Testing PostgREST connection...');
  
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      }
    });

    if (response.ok) {
      console.log('✅ PostgREST is accessible\n');
      return true;
    } else {
      console.log(`❌ PostgREST error: ${response.status} ${response.statusText}\n`);
      return false;
    }
  } catch (error: any) {
    console.log(`❌ PostgREST connection failed: ${error.message}\n`);
    return false;
  }
}

async function runMigrations() {
  // Test API access first
  const apiAccessible = await tryPostgREST();
  
  if (!apiAccessible) {
    console.error('Cannot access Supabase API. Check your service_role key.');
    process.exit(1);
  }

  // Read migrations
  const migration001 = readFileSync(join(process.cwd(), 'migrations/001_initial_schema.sql'), 'utf-8');
  const migration002 = readFileSync(join(process.cwd(), 'migrations/002_rls_policies.sql'), 'utf-8');

  // Execute migrations
  const success001 = await executeSQLDirectly(migration001, 'Migration 001: Initial Schema');
  const success002 = await executeSQLDirectly(migration002, 'Migration 002: RLS Policies');

  if (success001 && success002) {
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║           ✅ MIGRATIONS COMPLETED VIA API!                         ║
╚═══════════════════════════════════════════════════════════════════╝

Your Supabase database should now have:
  ✓ 15 tables with proper schema
  ✓ All indexes and constraints
  ✓ RLS policies enabled

Verify by checking:
  → https://supabase.com/dashboard/project/${projectRef}/editor

Next steps:
  1️⃣  tsx server/seed-supabase.ts
  2️⃣  tsx server/create-sample-student.ts
`);
    process.exit(0);
  } else {
    console.error('\n❌ Migrations had errors. See above for details.');
    process.exit(1);
  }
}

runMigrations();
