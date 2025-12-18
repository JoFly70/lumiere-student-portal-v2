import { supabaseAdmin, isSupabaseConfigured } from './server/lib/supabase';

async function checkSupabase() {
  console.log('🔍 Checking Supabase connection...\n');
  
  if (!isSupabaseConfigured) {
    console.log('❌ Supabase is not configured');
    process.exit(1);
  }
  
  console.log('✅ Supabase is configured\n');
  
  // Check for existing tables
  const tables = ['programs', 'providers', 'profiles', 'requirements'];
  
  for (const table of tables) {
    try {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('*')
        .limit(1);
      
      if (error) {
        console.log(`❌ Table '${table}' does not exist or has error:`, error.message);
      } else {
        const { count } = await supabaseAdmin
          .from(table)
          .select('*', { count: 'exact', head: true });
        console.log(`✅ Table '${table}' exists with ${count || 0} rows`);
      }
    } catch (e) {
      console.log(`❌ Error checking table '${table}':`, e);
    }
  }
}

checkSupabase().catch(console.error);
