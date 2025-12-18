/**
 * Exhaustive Region and Connection Format Tester
 * Tests ALL possible Supabase regions and connection formats
 */

import postgres from 'postgres';

const dbPassword = process.env.SUPABASE_DB_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

if (!supabaseUrl || !dbPassword) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const projectRef = supabaseUrl.replace('https://', '').split('.')[0];

console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║     🌍 EXHAUSTIVE REGION & CONNECTION FORMAT TEST                  ║
╚═══════════════════════════════════════════════════════════════════╝

Project: ${projectRef}
Testing ALL Supabase regions and formats...
`);

// All known Supabase regions as of 2025
const regions = [
  'us-west-1',
  'us-east-1',
  'eu-west-1',
  'eu-central-1',
  'ap-southeast-1',
  'ap-northeast-1',
  'ap-south-1',
  'sa-east-1',
];

const connectionTemplates = [
  // Session pooler (port 5432)
  (region: string) => ({
    name: `Session Pooler 5432 (${region})`,
    url: `postgresql://postgres.${projectRef}:${dbPassword}@aws-0-${region}.pooler.supabase.com:5432/postgres`,
    config: { ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 10 }
  }),
  // Transaction pooler (port 6543)
  (region: string) => ({
    name: `Transaction Pooler 6543 (${region})`,
    url: `postgresql://postgres.${projectRef}:${dbPassword}@aws-0-${region}.pooler.supabase.com:6543/postgres`,
    config: { ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 10, prepare: false }
  }),
];

// Also try direct connections with different formats
const directConnections = [
  {
    name: 'Direct (db.PROJECT_REF.supabase.co)',
    url: `postgresql://postgres:${dbPassword}@db.${projectRef}.supabase.co:5432/postgres`,
    config: { ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 10 }
  },
  {
    name: 'Direct (PROJECT_REF.supabase.co)',
    url: `postgresql://postgres:${dbPassword}@${projectRef}.supabase.co:5432/postgres`,
    config: { ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 10 }
  },
];

async function testConnection(format: any): Promise<boolean> {
  const sql = postgres(format.url, format.config);
  
  try {
    const result = await sql`SELECT current_database(), current_user, inet_server_addr() as server_ip`;
    console.log(`\n✅ SUCCESS: ${format.name}`);
    console.log(`   Database: ${result[0].current_database}`);
    console.log(`   User: ${result[0].current_user}`);
    console.log(`   Server IP: ${result[0].server_ip || 'N/A'}`);
    console.log(`   Connection: ${format.url.replace(dbPassword, '***')}\n`);
    await sql.end();
    
    // Save the working connection for later use
    console.log('🎉 WORKING CONNECTION FOUND!\n');
    return true;
  } catch (error: any) {
    // Only show errors that aren't the common "not found" ones (to reduce noise)
    if (!error.message.includes('Tenant or user not found') && !error.message.includes('ENOTFOUND')) {
      console.log(`   ${format.name}: ${error.message.substring(0, 60)}...`);
    }
    await sql.end({ timeout: 1 }).catch(() => {});
    return false;
  }
}

async function main() {
  console.log('Testing direct connections first...\n');
  
  for (const directConn of directConnections) {
    const success = await testConnection(directConn);
    if (success) {
      console.log('✨ Use this connection string format for migrations!');
      process.exit(0);
    }
  }
  
  console.log('\nDirect connections failed. Testing poolers across all regions...');
  console.log('(Only showing non-standard errors to reduce noise)\n');
  
  for (const region of regions) {
    for (const template of connectionTemplates) {
      const format = template(region);
      const success = await testConnection(format);
      if (success) {
        console.log('✨ Use this connection string format for migrations!');
        process.exit(0);
      }
    }
  }
  
  console.error(`
╔═══════════════════════════════════════════════════════════════════╗
║        ❌ NO WORKING CONNECTION FOUND IN ANY REGION                ║
╚═══════════════════════════════════════════════════════════════════╝

Tested:
  - ${directConnections.length} direct connection formats
  - ${regions.length} regions × ${connectionTemplates.length} pooler types = ${regions.length * connectionTemplates.length} pooler connections
  - Total: ${directConnections.length + (regions.length * connectionTemplates.length)} connection attempts

This strongly suggests:
  1. ❌ SUPABASE_DB_PASSWORD is incorrect
  2. ❌ Project might be paused/deleted
  3. ❌ Database password needs to be reset

Please:
  1. Visit: https://supabase.com/dashboard/project/${projectRef}/settings/database
  2. Click "Reset database password"
  3. Copy the NEW password
  4. Update SUPABASE_DB_PASSWORD in Replit Secrets
  5. Run this script again

OR use the Supabase SQL Editor directly:
  → https://supabase.com/dashboard/project/${projectRef}/editor
`);
  
  process.exit(1);
}

main();
