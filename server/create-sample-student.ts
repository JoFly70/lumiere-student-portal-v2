import { db } from './lib/db';
import * as schema from '@shared/schema';
import { eq } from 'drizzle-orm';
import { supabaseAdmin, isSupabaseConfigured } from './lib/supabase';

async function createSampleStudent() {
  console.log('👤 Creating sample student with enrollments...\n');

  const demoEmail = 'demo@student.lumiere.app';
  const demoPassword = 'demo123';
  const demoName = 'Alex Johnson';

  // 1. Create Supabase Auth user if Supabase is configured
  let authUserId: string | undefined;
  
  if (isSupabaseConfigured) {
    console.log('Creating Supabase Auth user...');
    
    // Try to create user, but don't fail if already exists
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: demoEmail,
      password: demoPassword,
      email_confirm: true,
    });

    if (authError) {
      if (authError.message.includes('already registered')) {
        console.log('   ℹ️  Auth user already exists, fetching...');
        // Get existing user
        const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
        const existingUser = users?.find(u => u.email === demoEmail);
        if (existingUser) {
          authUserId = existingUser.id;
          console.log(`   ✓ Found existing auth user: ${authUserId}`);
        }
      } else {
        console.error('   ❌ Failed to create auth user:', authError.message);
      }
    } else if (authData.user) {
      authUserId = authData.user.id;
      console.log(`   ✓ Created auth user: ${authUserId}`);
    }
  }

  // 2. Create database user
  console.log('Creating database user record...');
  const userValues = authUserId 
    ? { id: authUserId, email: demoEmail, name: demoName, role: 'student' as const }
    : { email: demoEmail, name: demoName, role: 'student' as const };

  const [demoUser] = await db.insert(schema.users).values(userValues).onConflictDoNothing().returning();

  const userId = demoUser?.id || (await db.select().from(schema.users).where(eq(schema.users.email, demoEmail)).limit(1))[0]?.id;
  
  if (!userId) {
    console.error('❌ Could not find or create demo user');
    process.exit(1);
  }

  console.log(`   ✓ Created user: ${demoUser?.name || 'Alex Johnson (already exists)'}`);

  // Create profile
  await db.insert(schema.profiles).values({
    userId,
    timezone: 'America/New_York',
    status: 'active'
  }).onConflictDoNothing();

  // 2. Get BLS program and create plan
  const [blsProgram] = await db.select().from(schema.programs).limit(1);
  
  const [plan] = await db.insert(schema.plans).values({
    userId,
    programId: blsProgram.id,
    catalogYear: 2024
  }).onConflictDoNothing().returning();

  const planId = plan?.id || (await db.select().from(schema.plans).where(eq(schema.plans.userId, userId)).limit(1))[0]?.id;
  console.log('   ✓ Created degree plan');

  // 3. Get requirements and providers
  const requirements = await db.select().from(schema.requirements).where(eq(schema.requirements.programId, blsProgram.id));
  const reqMap = Object.fromEntries(requirements.map(r => [r.code, r]));

  const providers = await db.select().from(schema.providers);
  const providerMap = Object.fromEntries(providers.map(p => [p.key, p.id]));

  // 4. Get some featured courses
  const sophiaCourses = await db.select()
    .from(schema.coursesCatalog)
    .where(eq(schema.coursesCatalog.providerId, providerMap['sophia']))
    .limit(20);

  const studyCourses = await db.select()
    .from(schema.coursesCatalog)
    .where(eq(schema.coursesCatalog.providerId, providerMap['study_com']))
    .limit(10);

  // 5. Create enrollments (simulating progress through Phase 1)
  console.log('\nCreating course enrollments...');
  
  const completedEnrollments = [
    // Sophia courses (completed)
    ...sophiaCourses.slice(0, 12).map((course, idx) => ({
      userId,
      providerId: course.providerId,
      courseId: course.id,
      title: course.title,
      credits: course.credits,
      status: 'completed' as const,
      completedAt: new Date(2024, 0, 1 + idx * 7) // Stagger completion dates
    })),
    // Study.com courses (some completed, some in progress)
    ...studyCourses.slice(0, 6).map((course, idx) => ({
      userId,
      providerId: course.providerId,
      courseId: course.id,
      title: course.title,
      credits: course.credits,
      status: idx < 4 ? 'completed' as const : 'in_progress' as const,
      completedAt: idx < 4 ? new Date(2024, 2, 1 + idx * 7) : undefined
    })),
    // Todo courses
    ...sophiaCourses.slice(12, 15).map(course => ({
      userId,
      providerId: course.providerId,
      courseId: course.id,
      title: course.title,
      credits: course.credits,
      status: 'todo' as const
    }))
  ];

  await db.insert(schema.enrollments).values(completedEnrollments).onConflictDoNothing();
  console.log(`   ✓ Created ${completedEnrollments.length} enrollments`);

  // 6. Initialize plan requirements
  console.log('\nInitializing plan requirements tracking...');
  const planReqs = requirements.map(req => ({
    planId,
    requirementId: req.id,
    status: 'pending',
    satisfiedCredits: 0,
    detail: {}
  }));

  await db.insert(schema.planRequirements).values(planReqs).onConflictDoNothing();
  console.log(`   ✓ Initialized ${planReqs.length} requirement trackers`);

  // 7. Calculate metrics
  console.log('\nCalculating progress metrics...');
  
  const completedCredits = completedEnrollments
    .filter(e => e.status === 'completed')
    .reduce((sum, e) => sum + e.credits, 0);

  const inProgressCredits = completedEnrollments
    .filter(e => e.status === 'in_progress')
    .reduce((sum, e) => sum + e.credits, 0);

  const totalCredits = completedCredits;
  const pctComplete = Math.round((totalCredits / 120) * 100);

  await db.insert(schema.metrics).values({
    userId,
    planId,
    creditsTotal: totalCredits,
    creditsPhase1: totalCredits, // All transfer credits for now
    creditsResidency: 0,
    creditsUl: 0,
    pctComplete
  }).onConflictDoNothing();

  console.log(`   ✓ Progress: ${totalCredits} credits completed (${pctComplete}%)`);

  console.log('\n✅ Sample student created successfully!\n');
  console.log('Student Details:');
  console.log(`  - Email: ${demoEmail}`);
  console.log(`  - Password: ${demoPassword}`);
  console.log(`  - Name: ${demoName}`);
  console.log(`  - Program: ${blsProgram.title}`);
  console.log(`  - Completed: ${completedCredits} credits`);
  console.log(`  - In Progress: ${inProgressCredits} credits`);
  console.log(`  - Overall Progress: ${pctComplete}%`);
  console.log(`\n💡 Login with demo credentials to view the dashboard!`);

  process.exit(0);
}

createSampleStudent().catch((error) => {
  console.error('❌ Failed to create sample student:', error);
  process.exit(1);
});
