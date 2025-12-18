/**
 * Check if Supabase tables already exist from previous migration
 */

import { supabaseAdmin } from './lib/supabase';

async function checkTablesExist() {
  console.log('🔍 Checking if Supabase tables already exist...\n');

  try {
    // Try to query each critical table
    const tables = [
      'users',
      'profiles', 
      'programs',
      'requirements',
      'providers',
      'courses_catalog',
      'articulations',
      'plans',
      'enrollments'
    ];

    let existingTables = [];
    let missingTables = [];

    for (const table of tables) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('count')
        .limit(1);

      if (error) {
        missingTables.push(table);
        console.log(`❌ ${table}: Not found (${error.message.substring(0, 50)})`);
      } else {
        existingTables.push(table);
        console.log(`✅ ${table}: EXISTS`);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Existing tables: ${existingTables.length}/${tables.length}`);
    console.log(`   Missing tables: ${missingTables.length}/${tables.length}`);

    if (existingTables.length === tables.length) {
      console.log('\n🎉 All tables exist! Migrations were already completed.');
      console.log('✅ Ready to proceed with Phase 2: Seeding\n');
      process.exit(0);
    } else if (existingTables.length > 0) {
      console.log('\n⚠️  Partial migration detected.');
      console.log('   Some tables exist but not all. Manual cleanup may be needed.\n');
      process.exit(1);
    } else {
      console.log('\n❌ No tables found. Migrations need to be run.');
      console.log('   Proceed with manual migration via Supabase SQL Editor.\n');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('❌ Error checking tables:', error.message);
    process.exit(1);
  }
}

checkTablesExist();
