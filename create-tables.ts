import { supabaseAdmin, isSupabaseConfigured } from './server/lib/supabase';

async function createTables() {
  console.log('🔧 Creating Supabase tables...\n');
  
  if (!isSupabaseConfigured) {
    console.log('❌ Supabase not configured');
    process.exit(1);
  }

  const sqlStatements = [
    // Create users table
    `CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );`,
    
    `CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);`,
    
    // Create profiles table
    `CREATE TABLE IF NOT EXISTS profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      timezone TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(user_id)
    );`,
    
    // Create providers table
    `CREATE TABLE IF NOT EXISTS providers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );`,
    
    // Create requirements table
    `CREATE TABLE IF NOT EXISTS requirements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      area TEXT NOT NULL,
      min_credits INTEGER NOT NULL,
      max_credits INTEGER,
      is_upper_level BOOLEAN NOT NULL DEFAULT FALSE,
      sequence INTEGER NOT NULL DEFAULT 0,
      meta JSONB DEFAULT '{}'
    );`,
    
    `CREATE INDEX IF NOT EXISTS requirements_program_id_idx ON requirements(program_id);`,
    
    // Create plans table
    `CREATE TABLE IF NOT EXISTS plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      program_id UUID NOT NULL REFERENCES programs(id),
      catalog_year INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      locked_at TIMESTAMP
    );`,
    
    `CREATE INDEX IF NOT EXISTS plans_user_id_idx ON plans(user_id);`,
  ];

  // Execute each SQL statement
  for (let i = 0; i < sqlStatements.length; i++) {
    const sql = sqlStatements[i];
    try {
      // Use raw SQL query through pg connection
      const { error } = await supabaseAdmin.rpc('exec', { sql_query: sql });
      if (error) {
        console.log(`Statement ${i + 1}: Will try alternate method...`);
      }
    } catch (e) {
      // Silently continue - table might already exist
    }
  }

  // Now verify tables exist by trying to query them
  console.log('\n✅ Verifying tables...\n');
  
  const tables = ['users', 'profiles', 'providers', 'requirements', 'plans'];
  let allGood = true;
  
  for (const table of tables) {
    const { error } = await supabaseAdmin
      .from(table)
      .select('*')
      .limit(0);
    
    if (error) {
      console.log(`❌ ${table}: ${error.message}`);
      allGood = false;
    } else {
      console.log(`✅ ${table}`);
    }
  }
  
  if (!allGood) {
    console.log('\n⚠️  Some tables are missing.');
    console.log('\nPlease run this SQL in your Supabase SQL Editor:');
    console.log('https://supabase.com/dashboard/project/_/sql/new\n');
    console.log('Copy and paste the contents of: migrations/001_initial_schema.sql\n');
  } else {
    console.log('\n🎉 All tables created successfully!');
  }
}

createTables().catch(console.error);
