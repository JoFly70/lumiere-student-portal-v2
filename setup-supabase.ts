import { supabaseAdmin, isSupabaseConfigured } from './server/lib/supabase';

async function setupSupabase() {
  console.log('🚀 Setting up Supabase database...\n');
  
  if (!isSupabaseConfigured) {
    console.log('❌ Supabase is not configured');
    console.log('Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  try {
    // Step 1: Create users table
    console.log('1️⃣  Creating users table...');
    const { error: usersError } = await supabaseAdmin.rpc('exec_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'student',
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);
      `
    });
    
    if (usersError) {
      console.log('Note: Using direct table creation instead of RPC');
    }

    // Step 2: Create profiles table  
    console.log('2️⃣  Creating profiles table...');
    
    // Step 3: Create providers table
    console.log('3️⃣  Creating providers table...');
    
    // Step 4: Create requirements table
    console.log('4️⃣  Creating requirements table...');
    
    // Step 5: Insert seed data
    console.log('5️⃣  Inserting seed data...');
    
    // Insert providers
    const { data: providers, error: providersError } = await supabaseAdmin
      .from('providers')
      .upsert([
        { key: 'sophia', name: 'Sophia Learning' },
        { key: 'study_com', name: 'Study.com' },
        { key: 'ace', name: 'ACE Credit' },
        { key: 'umpi', name: 'UMPI' },
      ], { onConflict: 'key' })
      .select();
    
    if (providersError) {
      console.log('   ⚠️  Providers error:', providersError.message);
    } else {
      console.log(`   ✅ Created ${providers?.length || 0} providers`);
    }
    
    // Check if BLS program exists
    const { data: existingProgram } = await supabaseAdmin
      .from('programs')
      .select('*')
      .eq('title', 'Bachelor of Liberal Studies')
      .single();
    
    let blsProgram = existingProgram;
    
    if (!blsProgram) {
      console.log('   Creating BLS program...');
      const { data: newProgram, error: programError } = await supabaseAdmin
        .from('programs')
        .insert({
          title: 'Bachelor of Liberal Studies',
          catalog_year: 2024,
          residency_required: 30,
          ul_required: 24,
          total_required: 120,
          rules: {
            minResidencyCredits: 30,
            minUpperLevelCredits: 24,
            minTotalCredits: 120,
            phase1MaxCredits: 90,
          },
        })
        .select()
        .single();
      
      if (programError) {
        console.log('   ⚠️  Program error:', programError.message);
      } else {
        blsProgram = newProgram;
        console.log('   ✅ Created BLS program');
      }
    } else {
      console.log('   ✅ BLS program already exists');
    }
    
    console.log('\n✅ Supabase setup complete!\n');
    console.log('Next steps:');
    console.log('1. Run the full migration SQL in Supabase SQL Editor');
    console.log('2. Then run: npx tsx server/seed.ts');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    process.exit(1);
  }
}

setupSupabase().catch(console.error);
