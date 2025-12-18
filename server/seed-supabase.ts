import { supabaseAdmin } from './lib/supabase';

async function seedSupabase() {
  console.log('🌱 Seeding Supabase database...');

  // Create providers
  const { data: providers, error: providersError } = await supabaseAdmin
    .from('providers')
    .upsert([
      { key: 'sophia', name: 'Sophia Learning' },
      { key: 'study_com', name: 'Study.com' },
      { key: 'ace', name: 'ACE Credit' },
      { key: 'umpi', name: 'UMPI' },
    ], { onConflict: 'key', ignoreDuplicates: false })
    .select();

  if (providersError) {
    console.error('Error creating providers:', providersError);
    throw providersError;
  }

  const sophiaProvider = providers.find((p: any) => p.key === 'sophia')!;
  const studyDotComProvider = providers.find((p: any) => p.key === 'study_com')!;
  const aceProvider = providers.find((p: any) => p.key === 'ace')!;
  const umpiProvider = providers.find((p: any) => p.key === 'umpi')!;

  console.log('✓ Created providers:', providers.length);

  // Create BLS program - check if exists first
  let { data: existingPrograms } = await supabaseAdmin
    .from('programs')
    .select()
    .eq('title', 'Bachelor of Liberal Studies')
    .eq('catalog_year', 2024);

  let blsProgram;
  if (existingPrograms && existingPrograms.length > 0) {
    blsProgram = existingPrograms[0];
    console.log('✓ BLS program already exists:', blsProgram.id);
  } else {
    const { data: programs, error: programsError } = await supabaseAdmin
      .from('programs')
      .insert([{
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
      }])
      .select();

    if (programsError) {
      console.error('Error creating programs:', programsError);
      throw programsError;
    }

    blsProgram = programs![0];
    console.log('✓ Created BLS program:', blsProgram.id);
  }

  // Create distribution requirements - check if exist first
  const requirementsToInsert = [
    {
      program_id: blsProgram.id,
      code: 'GEC-WRITING',
      title: 'General Education - Writing',
      area: 'general_education',
      min_credits: 6,
      max_credits: 6,
      sequence: 1,
    },
      {
        program_id: blsProgram.id,
        code: 'GEC-QUANT',
        title: 'General Education - Quantitative',
        area: 'general_education',
        min_credits: 3,
        max_credits: 3,
        sequence: 2,
      },
      {
        program_id: blsProgram.id,
        code: 'GEC-SCIENCE',
        title: 'General Education - Science with Lab',
        area: 'general_education',
        min_credits: 7,
        max_credits: 7,
        sequence: 3,
      },
      {
        program_id: blsProgram.id,
        code: 'GEC-CIVIC',
        title: 'General Education - Civic/Social',
        area: 'general_education',
        min_credits: 3,
        max_credits: 3,
        sequence: 4,
      },
      {
        program_id: blsProgram.id,
        code: 'GEC-HUMANITIES',
        title: 'General Education - Humanities',
        area: 'general_education',
        min_credits: 6,
        max_credits: 6,
        sequence: 5,
      },
      {
        program_id: blsProgram.id,
        code: 'MAJOR-CORE',
        title: 'Major Core Requirements',
        area: 'major',
        min_credits: 36,
        max_credits: 48,
        sequence: 6,
      },
      {
        program_id: blsProgram.id,
        code: 'ELECTIVES',
        title: 'General Electives',
        area: 'electives',
        min_credits: 24,
        max_credits: null,
        sequence: 7,
      },
  ];

  let { data: existingReqs } = await supabaseAdmin
    .from('requirements')
    .select()
    .eq('program_id', blsProgram.id);

  let requirements;
  if (existingReqs && existingReqs.length >= 7) {
    requirements = existingReqs;
    console.log('✓ Requirements already exist:', requirements.length);
  } else {
    const { data: reqsData, error: requirementsError } = await supabaseAdmin
      .from('requirements')
      .insert(requirementsToInsert)
      .select();

    if (requirementsError) {
      console.error('Error creating requirements:', requirementsError);
      throw requirementsError;
    }

    requirements = reqsData;
    console.log('✓ Created requirements:', requirements.length);
  }

  // Create course catalog (30 baseline courses)
  const courses = [
    // Sophia courses
    { provider_id: sophiaProvider.id, code: 'SOC-1010', title: 'Introduction to Sociology', credits: 3, level: 'lower', active: true },
    { provider_id: sophiaProvider.id, code: 'ENG-1010', title: 'English Composition I', credits: 3, level: 'lower', active: true },
    { provider_id: sophiaProvider.id, code: 'MAT-1100', title: 'College Algebra', credits: 3, level: 'lower', active: true },
    { provider_id: sophiaProvider.id, code: 'PSY-1010', title: 'Introduction to Psychology', credits: 3, level: 'lower', active: true },
    { provider_id: sophiaProvider.id, code: 'HIS-1010', title: 'US History I', credits: 3, level: 'lower', active: true },
    { provider_id: sophiaProvider.id, code: 'ENG-1020', title: 'English Composition II', credits: 3, level: 'lower', active: true },
    { provider_id: sophiaProvider.id, code: 'ENV-1010', title: 'Environmental Science', credits: 3, level: 'lower', active: true },
    { provider_id: sophiaProvider.id, code: 'PHI-1010', title: 'Introduction to Philosophy', credits: 3, level: 'lower', active: true },
    { provider_id: sophiaProvider.id, code: 'ART-1010', title: 'Visual Communications', credits: 3, level: 'lower', active: true },
    { provider_id: sophiaProvider.id, code: 'HUM-1010', title: 'Introduction to Humanities', credits: 3, level: 'lower', active: true },
    
    // Study.com courses
    { provider_id: studyDotComProvider.id, code: 'BUS-2010', title: 'Business Communications', credits: 3, level: 'lower', active: true },
    { provider_id: studyDotComProvider.id, code: 'ACC-2010', title: 'Financial Accounting', credits: 3, level: 'lower', active: true },
    { provider_id: studyDotComProvider.id, code: 'MGT-2010', title: 'Principles of Management', credits: 3, level: 'lower', active: true },
    { provider_id: studyDotComProvider.id, code: 'MKT-2010', title: 'Principles of Marketing', credits: 3, level: 'lower', active: true },
    { provider_id: studyDotComProvider.id, code: 'ECO-2010', title: 'Microeconomics', credits: 3, level: 'lower', active: true },
    { provider_id: studyDotComProvider.id, code: 'ECO-2020', title: 'Macroeconomics', credits: 3, level: 'lower', active: true },
    { provider_id: studyDotComProvider.id, code: 'BUS-2030', title: 'Business Statistics', credits: 3, level: 'lower', active: true },
    { provider_id: studyDotComProvider.id, code: 'BUS-2040', title: 'Business Law', credits: 3, level: 'lower', active: true },
    { provider_id: studyDotComProvider.id, code: 'BIO-1010', title: 'Introduction to Biology', credits: 3, level: 'lower', active: true },
    { provider_id: studyDotComProvider.id, code: 'BIO-1011', title: 'Biology Lab', credits: 1, level: 'lower', active: true },
    
    // ACE courses
    { provider_id: aceProvider.id, code: 'IT-1010', title: 'Introduction to IT', credits: 3, level: 'lower', active: true },
    { provider_id: aceProvider.id, code: 'COM-1010', title: 'Public Speaking', credits: 3, level: 'lower', active: true },
    { provider_id: aceProvider.id, code: 'STA-2010', title: 'Statistics', credits: 3, level: 'lower', active: true },
    
    // UMPI residency courses
    { provider_id: umpiProvider.id, code: 'BUS-3010', title: 'Business Ethics', credits: 3, level: 'upper', active: true },
    { provider_id: umpiProvider.id, code: 'BUS-3020', title: 'Project Management', credits: 3, level: 'upper', active: true },
    { provider_id: umpiProvider.id, code: 'BUS-4010', title: 'Strategic Management', credits: 3, level: 'upper', active: true },
    { provider_id: umpiProvider.id, code: 'BUS-4020', title: 'Operations Management', credits: 3, level: 'upper', active: true },
    { provider_id: umpiProvider.id, code: 'BUS-4900', title: 'Business Capstone', credits: 3, level: 'upper', active: true },
    { provider_id: umpiProvider.id, code: 'GEN-4010', title: 'Professional Writing', credits: 3, level: 'upper', active: true },
    { provider_id: umpiProvider.id, code: 'GEN-4020', title: 'Research Methods', credits: 3, level: 'upper', active: true },
  ];

  // Check if courses already exist (upsert requires unique constraints which may not exist)
  let coursesData = courses;
  const courseCodes = courses.map((c: any) => c.code);
  let { data: existingCourses } = await supabaseAdmin
    .from('courses_catalog')
    .select()
    .in('code', courseCodes);

  if (!existingCourses || existingCourses.length < courses.length / 2) {
    const { data: insertedCourses, error: coursesError } = await supabaseAdmin
      .from('courses_catalog')
      .insert(courses)
      .select();

    if (coursesError && coursesError.code !== '23505') { // Ignore unique constraint violations
      console.error('Error creating courses:', coursesError);
      throw coursesError;
    }

    // Re-fetch to get all courses including duplicates
    const { data: allCourses } = await supabaseAdmin
      .from('courses_catalog')
      .select()
      .in('code', courseCodes);

    coursesData = allCourses || insertedCourses;
    console.log('✓ Created courses:', coursesData?.length || 0);
  } else {
    coursesData = existingCourses;
    console.log('✓ Courses already exist:', coursesData.length);
  }

  // Create articulations (course-to-requirement mappings)
  const gecWritingReq = requirements.find((r: any) => r.code === 'GEC-WRITING')!;
  const gecQuantReq = requirements.find((r: any) => r.code === 'GEC-QUANT')!;
  const gecScienceReq = requirements.find((r: any) => r.code === 'GEC-SCIENCE')!;
  const gecCivicReq = requirements.find((r: any) => r.code === 'GEC-CIVIC')!;
  const gecHumanitiesReq = requirements.find((r: any) => r.code === 'GEC-HUMANITIES')!;
  const majorCoreReq = requirements.find((r: any) => r.code === 'MAJOR-CORE')!;
  const electivesReq = requirements.find((r: any) => r.code === 'ELECTIVES')!;

  const engComp1 = coursesData.find((c: any) => c.code === 'ENG-1010')!;
  const engComp2 = coursesData.find((c: any) => c.code === 'ENG-1020')!;
  const collegeAlgebra = coursesData.find((c: any) => c.code === 'MAT-1100')!;
  const envScience = coursesData.find((c: any) => c.code === 'ENV-1010')!;
  const introBio = coursesData.find((c: any) => c.code === 'BIO-1010')!;
  const bioLab = coursesData.find((c: any) => c.code === 'BIO-1011')!;
  const introSoc = coursesData.find((c: any) => c.code === 'SOC-1010')!;
  const introPhi = coursesData.find((c: any) => c.code === 'PHI-1010')!;
  const introHum = coursesData.find((c: any) => c.code === 'HUM-1010')!;
  const visualComm = coursesData.find((c: any) => c.code === 'ART-1010')!;
  const busComm = coursesData.find((c: any) => c.code === 'BUS-2010')!;
  const busStats = coursesData.find((c: any) => c.code === 'BUS-2030')!;

  const articulations = [
    // Writing requirement
    { from_course_id: engComp1.id, to_requirement_id: gecWritingReq.id, priority: 1 },
    { from_course_id: engComp2.id, to_requirement_id: gecWritingReq.id, priority: 1 },
    
    // Quantitative requirement
    { from_course_id: collegeAlgebra.id, to_requirement_id: gecQuantReq.id, priority: 1 },
    { from_course_id: busStats.id, to_requirement_id: gecQuantReq.id, priority: 2 },
    
    // Science with lab
    { from_course_id: envScience.id, to_requirement_id: gecScienceReq.id, priority: 1 },
    { from_course_id: introBio.id, to_requirement_id: gecScienceReq.id, priority: 2 },
    { from_course_id: bioLab.id, to_requirement_id: gecScienceReq.id, priority: 2 },
    
    // Civic/Social
    { from_course_id: introSoc.id, to_requirement_id: gecCivicReq.id, priority: 1 },
    
    // Humanities
    { from_course_id: introPhi.id, to_requirement_id: gecHumanitiesReq.id, priority: 1 },
    { from_course_id: introHum.id, to_requirement_id: gecHumanitiesReq.id, priority: 2 },
    { from_course_id: visualComm.id, to_requirement_id: gecHumanitiesReq.id, priority: 3 },
    
    // Major core (business courses)
    { from_course_id: busComm.id, to_requirement_id: majorCoreReq.id, priority: 1 },
  ];

  // Check if articulations exist
  let { data: existingArts } = await supabaseAdmin
    .from('articulations')
    .select()
    .in('requirement_id', requirements.map((r: any) => r.id));

  let articulationsData;
  if (existingArts && existingArts.length >= articulations.length) {
    articulationsData = existingArts;
    console.log('✓ Articulations already exist:', articulationsData.length);
  } else {
    const { data: insertedArts, error: articulationsError } = await supabaseAdmin
      .from('articulations')
      .insert(articulations)
      .select();

    if (articulationsError && articulationsError.code !== '23505') { // Ignore unique constraint violations
      console.error('Error creating articulations:', articulationsError);
      throw articulationsError;
    }

    articulationsData = insertedArts;
    console.log('✓ Created articulations:', articulationsData?.length || 0);
  }

  console.log('✅ Supabase seeding complete!');
  console.log(`   - ${providers.length} providers`);
  console.log(`   - 1 program (BLS)`);
  console.log(`   - ${requirements.length} requirements`);
  console.log(`   - ${coursesData.length} courses`);
  console.log(`   - ${articulationsData.length} articulations`);
}

seedSupabase()
  .then(() => {
    console.log('Seed completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
