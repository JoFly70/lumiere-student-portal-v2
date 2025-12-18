import { db } from './lib/db';
import * as schema from '@shared/schema';

async function seed() {
  console.log('🌱 Seeding database...');

  // Create providers
  const [sophiaProvider, studyDotComProvider, aceProvider, umpiProvider] = await db.insert(schema.providers).values([
    { key: 'sophia', name: 'Sophia Learning' },
    { key: 'study_com', name: 'Study.com' },
    { key: 'ace', name: 'ACE Credit' },
    { key: 'umpi', name: 'UMPI' },
  ]).returning();

  console.log('✓ Created providers');

  // Create BLS program
  const [blsProgram] = await db.insert(schema.programs).values({
    title: 'Bachelor of Liberal Studies',
    catalogYear: 2024,
    residencyRequired: 30,
    ulRequired: 24,
    totalRequired: 120,
    rules: {
      minResidencyCredits: 30,
      minUpperLevelCredits: 24,
      minTotalCredits: 120,
      phase1MaxCredits: 90,
    },
  }).returning();

  console.log('✓ Created BLS program');

  // Create distribution requirements
  const requirements = await db.insert(schema.requirements).values([
    {
      programId: blsProgram.id,
      code: 'GEC-WRITING',
      title: 'General Education - Writing',
      area: 'general_education',
      minCredits: 6,
      maxCredits: 6,
      sequence: 1,
    },
    {
      programId: blsProgram.id,
      code: 'GEC-QUANT',
      title: 'General Education - Quantitative',
      area: 'general_education',
      minCredits: 3,
      maxCredits: 3,
      sequence: 2,
    },
    {
      programId: blsProgram.id,
      code: 'GEC-SCIENCE',
      title: 'General Education - Science with Lab',
      area: 'general_education',
      minCredits: 7,
      maxCredits: 7,
      sequence: 3,
    },
    {
      programId: blsProgram.id,
      code: 'GEC-CIVIC',
      title: 'General Education - Civic/Social',
      area: 'general_education',
      minCredits: 3,
      maxCredits: 3,
      sequence: 4,
    },
    {
      programId: blsProgram.id,
      code: 'GEC-HUMANITIES',
      title: 'General Education - Humanities',
      area: 'general_education',
      minCredits: 6,
      maxCredits: 6,
      sequence: 5,
    },
    {
      programId: blsProgram.id,
      code: 'MAJOR-CORE',
      title: 'Major Core Requirements',
      area: 'major',
      minCredits: 36,
      maxCredits: 48,
      sequence: 6,
    },
    {
      programId: blsProgram.id,
      code: 'ELECTIVES',
      title: 'General Electives',
      area: 'electives',
      minCredits: 24,
      maxCredits: null,
      sequence: 7,
    },
  ]).returning();

  console.log('✓ Created requirements');

  // Create course catalog (30 high-yield transfer courses)
  const courses = await db.insert(schema.coursesCatalog).values([
    // Sophia courses
    { providerId: sophiaProvider.id, code: 'SOC-1010', title: 'Introduction to Sociology', credits: 3, level: 'lower', active: true },
    { providerId: sophiaProvider.id, code: 'ENG-1010', title: 'English Composition I', credits: 3, level: 'lower', active: true },
    { providerId: sophiaProvider.id, code: 'MAT-1100', title: 'College Algebra', credits: 3, level: 'lower', active: true },
    { providerId: sophiaProvider.id, code: 'PSY-1010', title: 'Introduction to Psychology', credits: 3, level: 'lower', active: true },
    { providerId: sophiaProvider.id, code: 'HIS-1010', title: 'US History I', credits: 3, level: 'lower', active: true },
    { providerId: sophiaProvider.id, code: 'ENG-1020', title: 'English Composition II', credits: 3, level: 'lower', active: true },
    { providerId: sophiaProvider.id, code: 'ENV-1010', title: 'Environmental Science', credits: 3, level: 'lower', active: true },
    { providerId: sophiaProvider.id, code: 'PHI-1010', title: 'Introduction to Philosophy', credits: 3, level: 'lower', active: true },
    { providerId: sophiaProvider.id, code: 'ART-1010', title: 'Visual Communications', credits: 3, level: 'lower', active: true },
    { providerId: sophiaProvider.id, code: 'HUM-1010', title: 'Introduction to Humanities', credits: 3, level: 'lower', active: true },
    
    // Study.com courses
    { providerId: studyDotComProvider.id, code: 'BUS-2010', title: 'Business Communications', credits: 3, level: 'lower', active: true },
    { providerId: studyDotComProvider.id, code: 'ACC-2010', title: 'Financial Accounting', credits: 3, level: 'lower', active: true },
    { providerId: studyDotComProvider.id, code: 'MGT-2010', title: 'Principles of Management', credits: 3, level: 'lower', active: true },
    { providerId: studyDotComProvider.id, code: 'MKT-2010', title: 'Principles of Marketing', credits: 3, level: 'lower', active: true },
    { providerId: studyDotComProvider.id, code: 'ECO-2010', title: 'Microeconomics', credits: 3, level: 'lower', active: true },
    { providerId: studyDotComProvider.id, code: 'ECO-2020', title: 'Macroeconomics', credits: 3, level: 'lower', active: true },
    { providerId: studyDotComProvider.id, code: 'BUS-2030', title: 'Business Statistics', credits: 3, level: 'lower', active: true },
    { providerId: studyDotComProvider.id, code: 'BUS-2040', title: 'Business Law', credits: 3, level: 'lower', active: true },
    { providerId: studyDotComProvider.id, code: 'ACC-2020', title: 'Managerial Accounting', credits: 3, level: 'lower', active: true },
    { providerId: studyDotComProvider.id, code: 'FIN-2010', title: 'Introduction to Finance', credits: 3, level: 'lower', active: true },
    
    // ACE courses
    { providerId: aceProvider.id, code: 'BIO-1010', title: 'Introduction to Biology with Lab', credits: 4, level: 'lower', active: true },
    { providerId: aceProvider.id, code: 'CHE-1010', title: 'Introduction to Chemistry with Lab', credits: 4, level: 'lower', active: true },
    { providerId: aceProvider.id, code: 'SPA-1010', title: 'Spanish I', credits: 3, level: 'lower', active: true },
    { providerId: aceProvider.id, code: 'SPA-1020', title: 'Spanish II', credits: 3, level: 'lower', active: true },
    { providerId: aceProvider.id, code: 'COM-1010', title: 'Public Speaking', credits: 3, level: 'lower', active: true },
    
    // UMPI residency courses (upper-level)
    { providerId: umpiProvider.id, code: 'BUS-3300', title: 'Organizational Behavior', credits: 3, level: 'upper', active: true },
    { providerId: umpiProvider.id, code: 'BUS-4400', title: 'Strategic Management', credits: 3, level: 'upper', active: true },
    { providerId: umpiProvider.id, code: 'BUS-4100', title: 'Business Ethics', credits: 3, level: 'upper', active: true },
    { providerId: umpiProvider.id, code: 'BUS-4200', title: 'Capstone Project', credits: 3, level: 'upper', active: true },
    { providerId: umpiProvider.id, code: 'BUS-3100', title: 'Human Resource Management', credits: 3, level: 'upper', active: true },
  ]).returning();

  console.log('✓ Created 30 courses in catalog');

  // Create articulations (map courses to requirements)
  // Writing requirement
  await db.insert(schema.articulations).values([
    { fromCourseId: courses.find(c => c.code === 'ENG-1010')!.id, toRequirementId: requirements.find(r => r.code === 'GEC-WRITING')!.id, priority: 1 },
    { fromCourseId: courses.find(c => c.code === 'ENG-1020')!.id, toRequirementId: requirements.find(r => r.code === 'GEC-WRITING')!.id, priority: 2 },
  ]);

  // Quantitative requirement
  await db.insert(schema.articulations).values([
    { fromCourseId: courses.find(c => c.code === 'MAT-1100')!.id, toRequirementId: requirements.find(r => r.code === 'GEC-QUANT')!.id, priority: 1 },
    { fromCourseId: courses.find(c => c.code === 'BUS-2030')!.id, toRequirementId: requirements.find(r => r.code === 'GEC-QUANT')!.id, priority: 2 },
  ]);

  // Science with Lab requirement
  await db.insert(schema.articulations).values([
    { fromCourseId: courses.find(c => c.code === 'BIO-1010')!.id, toRequirementId: requirements.find(r => r.code === 'GEC-SCIENCE')!.id, priority: 1 },
    { fromCourseId: courses.find(c => c.code === 'CHE-1010')!.id, toRequirementId: requirements.find(r => r.code === 'GEC-SCIENCE')!.id, priority: 2 },
    { fromCourseId: courses.find(c => c.code === 'ENV-1010')!.id, toRequirementId: requirements.find(r => r.code === 'GEC-SCIENCE')!.id, priority: 3 },
  ]);

  // Civic/Social requirement
  await db.insert(schema.articulations).values([
    { fromCourseId: courses.find(c => c.code === 'SOC-1010')!.id, toRequirementId: requirements.find(r => r.code === 'GEC-CIVIC')!.id, priority: 1 },
    { fromCourseId: courses.find(c => c.code === 'PSY-1010')!.id, toRequirementId: requirements.find(r => r.code === 'GEC-CIVIC')!.id, priority: 2 },
    { fromCourseId: courses.find(c => c.code === 'HIS-1010')!.id, toRequirementId: requirements.find(r => r.code === 'GEC-CIVIC')!.id, priority: 3 },
  ]);

  // Humanities requirement
  await db.insert(schema.articulations).values([
    { fromCourseId: courses.find(c => c.code === 'PHI-1010')!.id, toRequirementId: requirements.find(r => r.code === 'GEC-HUMANITIES')!.id, priority: 1 },
    { fromCourseId: courses.find(c => c.code === 'ART-1010')!.id, toRequirementId: requirements.find(r => r.code === 'GEC-HUMANITIES')!.id, priority: 2 },
    { fromCourseId: courses.find(c => c.code === 'HUM-1010')!.id, toRequirementId: requirements.find(r => r.code === 'GEC-HUMANITIES')!.id, priority: 3 },
  ]);

  // Major core requirements
  await db.insert(schema.articulations).values([
    { fromCourseId: courses.find(c => c.code === 'BUS-2010')!.id, toRequirementId: requirements.find(r => r.code === 'MAJOR-CORE')!.id, priority: 1 },
    { fromCourseId: courses.find(c => c.code === 'ACC-2010')!.id, toRequirementId: requirements.find(r => r.code === 'MAJOR-CORE')!.id, priority: 2 },
    { fromCourseId: courses.find(c => c.code === 'MGT-2010')!.id, toRequirementId: requirements.find(r => r.code === 'MAJOR-CORE')!.id, priority: 3 },
    { fromCourseId: courses.find(c => c.code === 'MKT-2010')!.id, toRequirementId: requirements.find(r => r.code === 'MAJOR-CORE')!.id, priority: 4 },
    { fromCourseId: courses.find(c => c.code === 'ECO-2010')!.id, toRequirementId: requirements.find(r => r.code === 'MAJOR-CORE')!.id, priority: 5 },
    { fromCourseId: courses.find(c => c.code === 'ECO-2020')!.id, toRequirementId: requirements.find(r => r.code === 'MAJOR-CORE')!.id, priority: 6 },
    { fromCourseId: courses.find(c => c.code === 'BUS-2040')!.id, toRequirementId: requirements.find(r => r.code === 'MAJOR-CORE')!.id, priority: 7 },
    { fromCourseId: courses.find(c => c.code === 'ACC-2020')!.id, toRequirementId: requirements.find(r => r.code === 'MAJOR-CORE')!.id, priority: 8 },
    { fromCourseId: courses.find(c => c.code === 'FIN-2010')!.id, toRequirementId: requirements.find(r => r.code === 'MAJOR-CORE')!.id, priority: 9 },
    // UMPI upper-level courses also count toward major
    { fromCourseId: courses.find(c => c.code === 'BUS-3300')!.id, toRequirementId: requirements.find(r => r.code === 'MAJOR-CORE')!.id, priority: 10 },
    { fromCourseId: courses.find(c => c.code === 'BUS-4400')!.id, toRequirementId: requirements.find(r => r.code === 'MAJOR-CORE')!.id, priority: 11 },
    { fromCourseId: courses.find(c => c.code === 'BUS-4100')!.id, toRequirementId: requirements.find(r => r.code === 'MAJOR-CORE')!.id, priority: 12 },
    { fromCourseId: courses.find(c => c.code === 'BUS-4200')!.id, toRequirementId: requirements.find(r => r.code === 'MAJOR-CORE')!.id, priority: 13 },
    { fromCourseId: courses.find(c => c.code === 'BUS-3100')!.id, toRequirementId: requirements.find(r => r.code === 'MAJOR-CORE')!.id, priority: 14 },
  ]);

  console.log('✓ Created articulations');

  console.log('✅ Seed completed successfully!');
  process.exit(0);
}

seed().catch((error) => {
  console.error('❌ Seed failed:', error);
  process.exit(1);
});
