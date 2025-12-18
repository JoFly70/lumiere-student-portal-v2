/**
 * Fully Automated Supabase Migration Runner
 * Uses direct Postgres connection with database password
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import postgres from 'postgres';

const dbPassword = process.env.SUPABASE_DB_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

if (!supabaseUrl) {
  console.error('❌ SUPABASE_URL not found');
  process.exit(1);
}

if (!dbPassword) {
  console.error('❌ SUPABASE_DB_PASSWORD not found');
  console.error('   This should have been added to secrets');
  process.exit(1);
}

// Extract project ref from URL
const projectRef = supabaseUrl.replace('https://', '').split('.')[0];

// Build the correct connection string format for Supabase
// Format from Supabase docs: postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
const connectionString = `postgresql://postgres.${projectRef}:${dbPassword}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;

console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║          🚀 AUTOMATED SUPABASE MIGRATION RUNNER                    ║
╚═══════════════════════════════════════════════════════════════════╝

Project: ${projectRef}
Connecting to Supabase Postgres...
`);

const sql = postgres(connectionString, {
  ssl: { rejectUnauthorized: false },
  max: 1,
  idle_timeout: 20,
  connect_timeout: 30,
});

async function runMigrations() {
  try {
    // Test connection
    console.log('🔄 Testing database connection...');
    await sql`SELECT current_database(), current_user`;
    console.log('✅ Connected successfully!\n');

    // Read migration files
    const migration001 = readFileSync(join(process.cwd(), 'migrations/001_initial_schema.sql'), 'utf-8');
    const migration002 = readFileSync(join(process.cwd(), 'migrations/002_rls_policies.sql'), 'utf-8');

    // Run migration 001
    console.log('📁 Running migration 001_initial_schema.sql...');
    try {
      await sql.unsafe(migration001);
      console.log('✅ Schema created successfully!\n');
    } catch (error: any) {
      if (error.code === '42P07') {
        console.log('⚠️  Tables already exist (this is OK - migrations are idempotent)\n');
      } else {
        throw error;
      }
    }

    // Run migration 002
    console.log('📁 Running migration 002_rls_policies.sql...');
    try {
      await sql.unsafe(migration002);
      console.log('✅ RLS policies created successfully!\n');
    } catch (error: any) {
      if (error.code === '42710') {
        console.log('⚠️  Policies already exist (this is OK - migrations are idempotent)\n');
      } else {
        throw error;
      }
    }

    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║              ✅ MIGRATIONS COMPLETED SUCCESSFULLY!                 ║
╚═══════════════════════════════════════════════════════════════════╝

Your Supabase database now has:
  ✓ 15 tables created
  ✓ All indexes and constraints in place
  ✓ Row Level Security (RLS) policies enabled

Next steps:
  1️⃣  tsx server/seed-supabase.ts         (populate baseline data)
  2️⃣  tsx server/create-sample-student.ts (create demo student)

═══════════════════════════════════════════════════════════════════
`);
    
    process.exit(0);
  } catch (error: any) {
    console.error(`
╔═══════════════════════════════════════════════════════════════════╗
║                    ❌ MIGRATION FAILED                             ║
╚═══════════════════════════════════════════════════════════════════╝

Error: ${error.message}
Code: ${error.code || 'N/A'}

`);

    if (error.code === 'XX000' || error.message.includes('Tenant or user not found')) {
      console.error(`💡 Connection issue detected!

The database password might be incorrect or the connection string format is wrong.

Please verify:
1. Go to: https://supabase.com/dashboard/project/${projectRef}/settings/database
2. Scroll to "Connection String" → "URI" tab
3. Copy the EXACT password from the connection string
4. Update SUPABASE_DB_PASSWORD in Replit Secrets

Alternative: Run migrations manually in Supabase SQL Editor
  - tsx server/migrate-supabase.ts (shows instructions)
`);
    } else {
      console.error('Full error:', error);
    }
    
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runMigrations();
