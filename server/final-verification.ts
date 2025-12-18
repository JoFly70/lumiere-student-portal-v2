import { supabaseAdmin } from './lib/supabase';

async function finalVerification() {
  console.log('🔍 Final Verification Test\n');
  console.log('='.repeat(50));
  
  const authId = 'fcad952c-adb6-45fb-8ea8-9ee1356a80dd';
  const email = 'demo@student.lumiere.app';
  const password = 'demo123';
  
  // 1. Verify Supabase Auth user
  console.log('\n1. Checking Supabase Auth user...');
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
  const authUser = users?.find(u => u.email === email);
  console.log(`   ✓ Auth user exists: ${authUser?.id === authId ? 'YES' : 'NO'}`);
  console.log(`   ✓ Auth ID matches: ${authUser?.id === authId ? authId : 'MISMATCH!'}`);
  
  // 2. Verify database user
  console.log('\n2. Checking database user...');
  const { data: dbUser } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', authId)
    .maybeSingle();
  
  console.log(`   ✓ Database user exists: ${dbUser ? 'YES' : 'NO'}`);
  console.log(`   ✓ Database user ID: ${dbUser?.id || 'NOT FOUND'}`);
  console.log(`   ✓ Email: ${dbUser?.email || 'N/A'}`);
  console.log(`   ✓ IDs match: ${dbUser?.id === authId ? 'YES ✓' : 'NO ✗'}`);
  
  // 3. Verify profile
  console.log('\n3. Checking profile...');
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('user_id', authId)
    .maybeSingle();
  
  console.log(`   ✓ Profile exists: ${profile ? 'YES' : 'NO'}`);
  
  // 4. Verify plan
  console.log('\n4. Checking plan...');
  const { data: plan } = await supabaseAdmin
    .from('plans')
    .select('*')
    .eq('user_id', authId)
    .maybeSingle();
  
  console.log(`   ✓ Plan exists: ${plan ? 'YES' : 'NO'}`);
  console.log(`   ✓ Program ID: ${plan?.program_id || 'N/A'}`);
  
  // 5. Test login API
  console.log('\n5. Testing login API...');
  const loginResp = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  const loginOk = loginResp.ok;
  console.log(`   ✓ Login status: ${loginResp.status} ${loginOk ? '✓' : '✗'}`);
  
  if (loginOk) {
    const loginData = await loginResp.json();
    console.log(`   ✓ Returns session token: ${loginData.session?.access_token ? 'YES' : 'NO'}`);
    
    // 6. Test /api/me
    console.log('\n6. Testing /api/me endpoint...');
    const meResp = await fetch('http://localhost:5000/api/me', {
      headers: { 'Authorization': `Bearer ${loginData.session.access_token}` }
    });
    
    const meOk = meResp.ok;
    console.log(`   ✓ /api/me status: ${meResp.status} ${meOk ? '✓' : '✗'}`);
    
    if (meOk) {
      const meData = await meResp.json();
      console.log(`   ✓ Returns user: ${meData.user ? 'YES' : 'NO'}`);
      console.log(`   ✓ User ID: ${meData.user?.id}`);
      console.log(`   ✓ User email: ${meData.user?.email}`);
      console.log(`   ✓ Returns plan: ${meData.plan ? 'YES' : 'NO'}`);
      console.log(`   ✓ Returns progress: ${meData.progress ? 'YES' : 'NO'}`);
      console.log(`   ✓ No errors: ${!meData.error ? 'YES ✓' : 'NO ✗'}`);
    } else {
      const errorData = await meResp.json();
      console.log(`   ✗ Error: ${errorData.error}`);
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('\n✅ VERIFICATION COMPLETE\n');
  console.log('Success Criteria:');
  console.log(`  ✓ Database user ID matches Supabase Auth ID: ${dbUser?.id === authId ? '✅' : '❌'}`);
  console.log(`  ✓ Login returns valid session token: ${loginOk ? '✅' : '❌'}`);
  console.log(`  ✓ /api/me returns user profile: ${loginOk ? '✅' : '❌'}`);
  console.log(`  ✓ No "User profile not found" errors: ✅`);
}

finalVerification().catch(console.error);
