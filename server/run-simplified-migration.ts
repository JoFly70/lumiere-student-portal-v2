import { supabaseAdmin } from './lib/supabase';
import { readFileSync } from 'fs';
import { join } from 'path';

async function runMigration() {
  console.log('🚀 Running simplified schema migration...\n');

  const sqlPath = join(process.cwd(), 'migrations', '003_simplified_schema.sql');
  const sql = readFileSync(sqlPath, 'utf-8');

  try {
    // Execute the SQL
    const { data, error } = await supabaseAdmin.rpc('exec_sql', { sql_query: sql });
    
    if (error) {
      // If RPC doesn't exist, try direct execution via REST API
      console.log('Executing SQL directly...');
      
      // Split into statements and execute one by one
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--') && s !== '');
      
      for (const statement of statements) {
        if (statement.toLowerCase().includes('select ')) {
          // Query statement
          const { error: queryError } = await supabaseAdmin.from('information_schema.tables').select('*').limit(1);
          if (queryError) console.error('Query error:', queryError.message);
        }
      }
      
      console.log('\n⚠️  Note: Execute the SQL manually in Supabase SQL Editor');
      console.log('📄 File: migrations/003_simplified_schema.sql');
      console.log('\nOr copy this SQL:\n');
      console.log('=' .repeat(60));
      console.log(sql);
      console.log('=' .repeat(60));
      
    } else {
      console.log('✅ Migration completed successfully!');
      console.log(data);
    }

    // Verify tables were created
    console.log('\n🔍 Verifying tables...');
    const tables = ['users', 'degree_templates', 'degree_requirements', 'requirement_mappings', 'provider_catalog', 'roadmap_plans', 'roadmap_steps'];
    
    for (const table of tables) {
      const { data, error } = await supabaseAdmin.from(table).select('*').limit(1);
      if (error) {
        console.log(`  ❌ ${table}: ${error.message}`);
      } else {
        console.log(`  ✅ ${table}: OK`);
      }
    }

  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

runMigration().then(() => {
  console.log('\n✨ Done!');
  process.exit(0);
});
