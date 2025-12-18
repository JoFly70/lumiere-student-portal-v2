import { supabaseAdmin } from './lib/supabase';

async function verifyUser() {
  const authUserId = 'fcad952c-adb6-45fb-8ea8-9ee1356a80dd';
  
  console.log('Checking for demo user in Supabase...\n');
  
  // Check all users with this ID (should be only 1)
  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', authUserId);
  
  console.log('All users with ID:', users);
  console.log('Error:', error);
  console.log('Count:', users?.length);
  
  // Also check by email
  const { data: usersByEmail } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', 'demo@student.lumiere.app');
  
  console.log('\nAll users with email demo@student.lumiere.app:', usersByEmail);
  console.log('Count:', usersByEmail?.length);
  
  // Test the exact query from /api/me
  console.log('\nTesting exact /api/me query with .single()...');
  const { data: singleUser, error: singleError } = await supabaseAdmin
    .from('users')
    .select('id, email, name, role')
    .eq('id', authUserId)
    .single();
  
  console.log('Single result:', singleUser);
  console.log('Single error:', singleError);
}

verifyUser().catch(console.error);
