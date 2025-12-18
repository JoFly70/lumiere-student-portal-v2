import { supabaseAdmin, isSupabaseConfigured } from './lib/supabase';

async function fixDemoStudent() {
  console.log('🔧 Fixing demo student in Supabase...\n');

  if (!isSupabaseConfigured) {
    console.error('❌ Supabase is not configured. Cannot proceed.');
    process.exit(1);
  }

  const demoEmail = 'demo@student.lumiere.app';
  const demoPassword = 'demo123';
  const demoName = 'Alex Johnson';
  const authUserId = 'fcad952c-adb6-45fb-8ea8-9ee1356a80dd';

  try {
    // 1. Verify auth user exists
    console.log('1. Checking Supabase Auth user...');
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    const authUser = users?.find(u => u.email === demoEmail);
    
    if (!authUser) {
      console.error(`❌ Auth user not found for ${demoEmail}`);
      process.exit(1);
    }
    
    console.log(`   ✓ Auth user found: ${authUser.id}`);
    
    if (authUser.id !== authUserId) {
      console.warn(`   ⚠️  Auth ID mismatch! Expected: ${authUserId}, Found: ${authUser.id}`);
    }

    // 2. Check if user exists in database
    console.log('\n2. Checking users table...');
    const { data: existingUser, error: checkError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    if (existingUser) {
      console.log(`   ✓ User already exists in database: ${existingUser.email}`);
    } else {
      console.log('   ℹ️  User not found in database, creating...');
      
      // Delete any user with the same email but different ID
      const { error: deleteError } = await supabaseAdmin
        .from('users')
        .delete()
        .eq('email', demoEmail);
      
      if (deleteError && !deleteError.message.includes('0 rows')) {
        console.warn(`   ⚠️  Error deleting old user: ${deleteError.message}`);
      }

      // Create user record
      const { data: newUser, error: insertError } = await supabaseAdmin
        .from('users')
        .insert({
          id: authUser.id,
          email: demoEmail,
          name: demoName,
          role: 'student'
        })
        .select()
        .single();

      if (insertError) {
        console.error(`   ❌ Failed to create user: ${insertError.message}`);
        process.exit(1);
      }

      console.log(`   ✓ Created user in database: ${newUser.id}`);
    }

    // 3. Check/create profile
    console.log('\n3. Checking profile...');
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (existingProfile) {
      console.log(`   ✓ Profile already exists`);
    } else {
      console.log('   ℹ️  Profile not found, creating...');
      
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
          user_id: authUser.id,
          timezone: 'America/New_York',
          status: 'active'
        });

      if (profileError) {
        console.error(`   ❌ Failed to create profile: ${profileError.message}`);
        process.exit(1);
      }

      console.log(`   ✓ Created profile`);
    }

    // 4. Check/create plan
    console.log('\n4. Checking plan...');
    
    // First, get a program
    const { data: programs } = await supabaseAdmin
      .from('programs')
      .select('*')
      .limit(1);

    if (!programs || programs.length === 0) {
      console.error('   ❌ No programs found in database');
      process.exit(1);
    }

    const program = programs[0];
    console.log(`   ℹ️  Using program: ${program.title}`);

    const { data: existingPlan } = await supabaseAdmin
      .from('plans')
      .select('*')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (existingPlan) {
      console.log(`   ✓ Plan already exists`);
    } else {
      console.log('   ℹ️  Plan not found, creating...');
      
      const { data: newPlan, error: planError } = await supabaseAdmin
        .from('plans')
        .insert({
          user_id: authUser.id,
          program_id: program.id,
          catalog_year: 2024
        })
        .select()
        .single();

      if (planError) {
        console.error(`   ❌ Failed to create plan: ${planError.message}`);
        process.exit(1);
      }

      console.log(`   ✓ Created plan: ${newPlan.id}`);
    }

    // 5. Check metrics (optional - /api/me handles missing metrics)
    console.log('\n5. Checking metrics...');
    const { data: existingMetrics } = await supabaseAdmin
      .from('metrics')
      .select('*')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (existingMetrics) {
      console.log(`   ✓ Metrics already exist: ${existingMetrics.credits_total} credits`);
    } else {
      console.log('   ℹ️  Metrics not found, will skip (endpoint handles missing metrics)');
    }

    console.log('\n✅ Demo student setup complete!\n');
    
    // DEBUG: Test the exact same query that /api/me uses
    console.log('DEBUG: Testing exact /api/me query...');
    const { data: testUser, error: testError } = await supabaseAdmin
      .from('users')
      .select('id, email, name, role')
      .eq('id', authUser.id)
      .single();
    
    console.log('  Query result:', testUser);
    console.log('  Query error:', testError);
    
    console.log('\nTesting login and /api/me...');

    // Test login
    const loginResponse = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: demoEmail, password: demoPassword })
    });

    if (!loginResponse.ok) {
      console.error(`❌ Login failed: ${loginResponse.status}`);
      process.exit(1);
    }

    const loginData = await loginResponse.json();
    console.log(`   ✓ Login successful`);

    // Test /api/me
    const meResponse = await fetch('http://localhost:5000/api/me', {
      headers: { 'Authorization': `Bearer ${loginData.session.access_token}` }
    });

    if (!meResponse.ok) {
      console.error(`❌ /api/me failed: ${meResponse.status}`);
      const errorData = await meResponse.json();
      console.error(`   Error: ${JSON.stringify(errorData)}`);
      process.exit(1);
    }

    const meData = await meResponse.json();
    console.log(`   ✓ /api/me successful`);
    console.log(`\nUser Profile:`, JSON.stringify(meData, null, 2));

    console.log('\n🎉 All tests passed!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixDemoStudent();
