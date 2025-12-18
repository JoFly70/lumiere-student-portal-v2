import { supabaseAdmin } from './lib/supabase';

async function testSimplifiedSchema() {
  console.log('\n🔍 Testing Simplified Schema Setup...\n');

  const tables = [
    'users',
    'degree_templates',
    'degree_requirements',
    'requirement_mappings',
    'provider_catalog',
    'roadmap_plans',
    'roadmap_steps'
  ];

  let allTablesExist = true;

  for (const table of tables) {
    try {
      const { data, error, count } = await supabaseAdmin
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.log(`  ❌ ${table}: ${error.message}`);
        allTablesExist = false;
      } else {
        console.log(`  ✅ ${table}: OK (${count || 0} rows)`);
      }
    } catch (err) {
      console.log(`  ❌ ${table}: ${err}`);
      allTablesExist = false;
    }
  }

  if (allTablesExist) {
    console.log('\n✨ All tables exist! Testing data...\n');

    // Check for demo degree template
    const { data: template } = await supabaseAdmin
      .from('degree_templates')
      .select('*')
      .eq('degree_name', 'BA Liberal Studies (Demo)')
      .single();

    if (template) {
      console.log('  ✅ Demo degree template found');
      console.log(`     ID: ${template.id}`);
      console.log(`     Name: ${template.degree_name}`);
      console.log(`     Total Credits: ${template.total_credits}`);
    } else {
      console.log('  ❌ Demo degree template not found');
    }

    // Check for demo student
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', 'demo@student.lumiere.college')
      .single();

    if (user) {
      console.log('\n  ✅ Demo student found');
      console.log(`     ID: ${user.id}`);
      console.log(`     Email: ${user.email}`);
      console.log(`     Name: ${user.name}`);
    } else {
      console.log('\n  ❌ Demo student not found');
    }

    // Check for requirements
    const { data: requirements, count: reqCount } = await supabaseAdmin
      .from('degree_requirements')
      .select('*', { count: 'exact' })
      .eq('template_id', template?.id || '');

    console.log(`\n  ${requirements && requirements.length > 0 ? '✅' : '❌'} Requirements: ${reqCount || 0} areas`);
    if (requirements && requirements.length > 0) {
      requirements.slice(0, 3).forEach((req: any) => {
        console.log(`     - ${req.area_code}: ${req.area_name} (${req.required_credits} credits)`);
      });
    }

    // Check for provider catalog
    const { count: catalogCount } = await supabaseAdmin
      .from('provider_catalog')
      .select('*', { count: 'exact', head: true });

    console.log(`\n  ${catalogCount && catalogCount > 0 ? '✅' : '❌'} Provider catalog: ${catalogCount || 0} courses`);

    console.log('\n✅ Schema is ready! You can now test the generate-plan API.');
    console.log('\n📝 Next step: Test the API with:');
    console.log(`   tsx server/test-generate-plan.ts`);
  } else {
    console.log('\n⚠️  Some tables are missing.');
    console.log('📋 Please run the SQL in Supabase SQL Editor:');
    console.log('   File: migrations/003_simplified_schema.sql');
  }
}

testSimplifiedSchema().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
