import { supabaseAdmin, isSupabaseConfigured } from './lib/supabase';

console.log('Supabase Configuration:');
console.log('- Configured:', isSupabaseConfigured);
console.log('- URL:', process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'NOT SET');
console.log('- Service Key:', process.env.SUPABASE_SERVICE_KEY ? `${process.env.SUPABASE_SERVICE_KEY.substring(0, 20)}...` : 'NOT SET');

// Test query
async function testQuery() {
  const userId = 'fcad952c-adb6-45fb-8ea8-9ee1356a80dd';
  
  console.log('\nTesting query with user ID:', userId);
  
  const { data, error, count } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact' })
    .eq('id', userId);
  
  console.log('Result count:', count);
  console.log('Data:', data);
  console.log('Error:', error);
  
  // Also try listing ALL users
  const { data: allUsers, count: totalCount } = await supabaseAdmin
    .from('users')
    .select('id, email', { count: 'exact' });
  
  console.log('\nTotal users in database:', totalCount);
  console.log('All users:', allUsers);
}

testQuery().catch(console.error);
