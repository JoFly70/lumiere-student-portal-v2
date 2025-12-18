import { supabaseAdmin } from './lib/supabase';

async function checkUserIds() {
  // Get auth user
  const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
  const authUser = authData?.users?.find((u: any) => u.email === 'demo@student.lumiere.app');
  console.log('\nAuth User ID:', authUser?.id);
  
  // Get database user
  const { data: dbUser } = await supabaseAdmin
    .from('users')
    .select('id, email, name')
    .eq('email', 'demo@student.lumiere.app')
    .single();
  console.log('DB User ID:', dbUser?.id);
  console.log('IDs Match:', authUser?.id === dbUser?.id);
  
  if (authUser?.id !== dbUser?.id) {
    console.log('\n⚠️  ID MISMATCH - Need to update database user ID');
    console.log('   Updating database user to match Auth ID...');
    
    // Update the database user ID to match the auth user ID
    const { error } = await supabaseAdmin
      .from('users')
      .update({ id: authUser?.id })
      .eq('email', 'demo@student.lumiere.app');
    
    if (error) {
      console.error('   Error:', error.message);
    } else {
      console.log('   ✓ User ID updated successfully');
    }
  } else {
    console.log('\n✓ IDs match - user profile is synced correctly');
  }
}

checkUserIds().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
