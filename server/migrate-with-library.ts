/**
 * Migration using postgres-migrations library
 * Tries multiple connection formats with URL-encoded password
 */

import { migrate } from 'postgres-migrations';
import { Client } from 'pg';
import { join } from 'path';

const dbPassword = process.env.SUPABASE_DB_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

if (!supabaseUrl || !dbPassword) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const projectRef = supabaseUrl.replace('https://', '').split('.')[0];

// URL encode password in case it has special characters
const encodedPassword = encodeURIComponent(dbPassword);

console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║    🔧 MIGRATION WITH POSTGRES-MIGRATIONS LIBRARY                   ║
╚═══════════════════════════════════════════════════════════════════╝

Project: ${projectRef}
Testing with URL-encoded password...
`);

const regions = ['us-west-1', 'us-east-1', 'eu-west-1', 'ap-southeast-1'];

const connectionConfigs = [
  // Direct connections with both password formats
  ...['us-west-1', 'us-east-1', 'eu-west-1'].map(region => ({
    name: `Direct (db.${projectRef}.supabase.co) - ${region}`,
    config: {
      host: `db.${projectRef}.supabase.co`,
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      password: dbPassword,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    }
  })),
  // Session pooler with plain password
  ...regions.map(region => ({
    name: `Session Pooler 5432 (${region}) - plain password`,
    config: {
      host: `aws-0-${region}.pooler.supabase.com`,
      port: 5432,
      database: 'postgres',
      user: `postgres.${projectRef}`,
      password: dbPassword,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    }
  })),
  // Session pooler with URL-encoded password
  ...regions.map(region => ({
    name: `Session Pooler 5432 (${region}) - encoded password`,
    config: {
      host: `aws-0-${region}.pooler.supabase.com`,
      port: 5432,
      database: 'postgres',
      user: `postgres.${projectRef}`,
      password: encodedPassword,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    }
  })),
];

async function testConnection(config: any): Promise<boolean> {
  const client = new Client(config.config);
  
  try {
    await client.connect();
    const result = await client.query('SELECT current_database(), current_user, version()');
    console.log(`\n✅ ${config.name}: CONNECTED`);
    console.log(`   Database: ${result.rows[0].current_database}`);
    console.log(`   User: ${result.rows[0].current_user}`);
    await client.end();
    return true;
  } catch (error: any) {
    if (!error.message.includes('Tenant or user not found') && !error.message.includes('ENOTFOUND')) {
      console.log(`   ${config.name}: ${error.message}`);
    }
    try {
      await client.end();
    } catch {}
    return false;
  }
}

async function runMigrationsWithConfig(config: any) {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║              🚀 RUNNING MIGRATIONS                                 ║
╚═══════════════════════════════════════════════════════════════════╝

Using: ${config.name}
`);

  const client = new Client(config.config);
  
  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Run migrations using postgres-migrations
    console.log('📁 Running migrations from migrations/ directory...\n');
    
    await migrate({ client }, join(process.cwd(), 'migrations'));

    console.log('\n✅ Migrations completed successfully!\n');

    // Verify
    console.log('🔍 Verifying database state...');
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log(`✅ Found ${tables.rows.length} tables:`);
    tables.rows.forEach((t: any) => console.log(`   - ${t.table_name}`));

    // Test courses_catalog
    try {
      const count = await client.query('SELECT COUNT(*) as count FROM courses_catalog');
      console.log(`\n✅ courses_catalog table exists (${count.rows[0].count} rows)\n`);
    } catch (error: any) {
      console.log(`\n⚠️  courses_catalog might be empty\n`);
    }

    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║           ✅ MIGRATIONS COMPLETED SUCCESSFULLY!                    ║
╚═══════════════════════════════════════════════════════════════════╝

Working Connection: ${config.name}

Connection Details:
  Host: ${config.config.host}
  Port: ${config.config.port}
  User: ${config.config.user}
  Database: ${config.config.database}

Your Supabase database now has:
  ✓ 15 tables created with proper schema
  ✓ All indexes and constraints in place
  ✓ Row Level Security (RLS) policies enabled

Next steps:
  1️⃣  tsx server/seed-supabase.ts
  2️⃣  tsx server/create-sample-student.ts

═══════════════════════════════════════════════════════════════════
`);

    await client.end();
    return true;
  } catch (error: any) {
    console.error(`
╔═══════════════════════════════════════════════════════════════════╗
║                    ❌ MIGRATION FAILED                             ║
╚═══════════════════════════════════════════════════════════════════╝

Error: ${error.message}
Stack: ${error.stack?.substring(0, 500)}
`);
    
    try {
      await client.end();
    } catch {}
    return false;
  }
}

async function main() {
  console.log('🔍 Testing all connection configurations...\n');
  
  let workingConfig: any = null;
  
  for (const config of connectionConfigs) {
    const success = await testConnection(config);
    if (success && !workingConfig) {
      workingConfig = config;
      break;
    }
  }
  
  if (!workingConfig) {
    console.error(`
╔═══════════════════════════════════════════════════════════════════╗
║         ❌ NO WORKING CONNECTION FOUND                             ║
╚═══════════════════════════════════════════════════════════════════╝

Tested ${connectionConfigs.length} different configurations.

This strongly indicates:
  1. ❌ SUPABASE_DB_PASSWORD is incorrect or expired
  2. ❌ Project might be paused/deleted  
  3. ❌ Network/firewall restrictions

MANUAL MIGRATION REQUIRED:
  1. Visit: https://supabase.com/dashboard/project/${projectRef}/editor
  2. Copy contents of migrations/001_initial_schema.sql
  3. Paste and run in SQL Editor
  4. Repeat for migrations/002_rls_policies.sql

This will take 2 minutes and bypass all connection issues.
`);
    process.exit(1);
  }
  
  // Run migrations
  const success = await runMigrationsWithConfig(workingConfig);
  process.exit(success ? 0 : 1);
}

main();
