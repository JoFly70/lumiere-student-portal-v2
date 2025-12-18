/**
 * Run migrations using Supabase REST API instead of direct PostgreSQL
 * This bypasses connection string issues
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { supabaseAdmin } from './lib/supabase';

async function runMigrationsViaAPI() {
  console.log('🚀 Running migrations via Supabase Admin API...\n');

  try {
    // Read migration files
    const migration001 = readFileSync(join(process.cwd(), 'migrations/001_initial_schema.sql'), 'utf-8');
    const migration002 = readFileSync(join(process.cwd(), 'migrations/002_rls_policies.sql'), 'utf-8');

    console.log('📁 Executing migration 001_initial_schema.sql...');
    
    // Split migration into individual statements (rough approach)
    const statements001 = migration001
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (let i = 0; i < statements001.length; i++) {
      const stmt = statements001[i] + ';';
      if (stmt.length < 10) continue; // Skip empty statements
      
      try {
        const { error } = await supabaseAdmin.rpc('exec_sql', { sql_string: stmt });
        if (error && !error.message.includes('already exists')) {
          console.log(`   ⚠️  Statement ${i + 1}: ${error.message.substring(0, 80)}`);
        }
      } catch (err: any) {
        if (!err.message?.includes('already exists')) {
          console.log(`   ⚠️  Statement ${i + 1}: ${err.message?.substring(0, 80)}`);
        }
      }
    }
    
    console.log('✅ Schema migration completed (or already exists)\n');

    console.log('📁 Executing migration 002_rls_policies.sql...');
    
    const statements002 = migration002
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (let i = 0; i < statements002.length; i++) {
      const stmt = statements002[i] + ';';
      if (stmt.length < 10) continue;
      
      try {
        const { error } = await supabaseAdmin.rpc('exec_sql', { sql_string: stmt });
        if (error && !error.message.includes('already exists')) {
          console.log(`   ⚠️  Policy ${i + 1}: ${error.message.substring(0, 80)}`);
        }
      } catch (err: any) {
        if (!err.message?.includes('already exists')) {
          console.log(`   ⚠️  Policy ${i + 1}: ${err.message?.substring(0, 80)}`);
        }
      }
    }
    
    console.log('✅ RLS policies completed (or already exist)\n');

    // Verify tables
    console.log('🔍 Verifying tables...');
    const { data, error } = await supabaseAdmin
      .from('courses_catalog')
      .select('count')
      .limit(1);

    if (error) {
      console.log('❌ Verification failed:', error.message);
      console.log('\n💡 Migrations may need to be run manually via Supabase SQL Editor');
      process.exit(1);
    }

    console.log('✅ Tables verified successfully!\n');
    console.log('🎉 All migrations completed!\n');

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigrationsViaAPI();
