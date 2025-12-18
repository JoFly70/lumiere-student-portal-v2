import fs from 'node:fs';
import path from 'node:path';
import { db } from './lib/db';
import * as schema from '@shared/schema';

async function bulkImport() {
  console.log('📦 Starting bulk import...\n');

  // Get provider IDs
  const providers = await db.select().from(schema.providers);
  const providerMap = Object.fromEntries(providers.map(p => [p.key, p.id]));

  // Get requirement IDs
  const requirements = await db.select().from(schema.requirements);
  const reqMap = Object.fromEntries(requirements.map(r => [r.code, r.id]));

  // 1. Import Sophia courses
  console.log('📚 Importing Sophia courses from JSON...');
  const sophiaPath = path.join(process.cwd(), 'server/data/sophia_courses.json');
  const sophiaCourses = JSON.parse(fs.readFileSync(sophiaPath, 'utf8'));

  const sophiaInserts = sophiaCourses.map((course: any, idx: number) => ({
    providerId: providerMap['sophia'],
    code: `SOPHIA_${idx + 1}`,
    title: course.title,
    credits: course.credit_value || 3,
    level: course.level === 'unknown' ? 'lower' : course.level,
    active: true,
    meta: {
      url: course.url,
      subject: course.subject,
      creditType: course.credit_type,
      hasLab: course.has_lab || false,
      featured: isHighValueCourse(course.title, course.subject)
    }
  }));

  await db.insert(schema.coursesCatalog).values(sophiaInserts).onConflictDoNothing();
  console.log(`   ✓ Imported ${sophiaInserts.length} Sophia courses`);

  // 2. Import Study.com courses
  console.log('📚 Importing Study.com courses from JSON...');
  const studyPath = path.join(process.cwd(), 'server/data/study_clean.json');
  const studyCourses = JSON.parse(fs.readFileSync(studyPath, 'utf8'));

  const studyInserts = studyCourses.map((course: any, idx: number) => ({
    providerId: providerMap['study_com'],
    code: `STUDY_${idx + 1}`,
    title: course.title,
    credits: course.credit_value || 3,
    level: course.level === 'unknown' ? 'lower' : course.level,
    active: true,
    meta: {
      url: course.url,
      subject: course.subject,
      creditType: course.credit_type,
      hasLab: course.has_lab || false,
      featured: isHighValueCourse(course.title, course.subject)
    }
  }));

  await db.insert(schema.coursesCatalog).values(studyInserts).onConflictDoNothing();
  console.log(`   ✓ Imported ${studyInserts.length} Study.com courses`);

  // 3. Create additional articulation mappings based on patterns
  console.log('\n🔗 Creating additional articulation mappings...');
  const allCourses = await db.select().from(schema.coursesCatalog);

  const articulationRules: Array<{
    requirement: string;
    titlePatterns: string[];
    subjectPatterns?: string[];
    priority: number;
  }> = [
    // GEC-WRITING
    {
      requirement: 'GEC-WRITING',
      titlePatterns: ['English Composition', 'Composition I', 'Composition II', 'Writing', 'Workplace Writing'],
      priority: 10
    },
    // GEC-QUANT
    {
      requirement: 'GEC-QUANT',
      titlePatterns: ['Algebra', 'Statistics', 'Calculus', 'Precalculus', 'Mathematics', 'Quantitative'],
      subjectPatterns: ['Math'],
      priority: 10
    },
    // GEC-SCIENCE
    {
      requirement: 'GEC-SCIENCE',
      titlePatterns: ['Biology', 'Chemistry', 'Physics', 'Environmental Science', 'Lab'],
      subjectPatterns: ['Science'],
      priority: 9
    },
    // GEC-CIVIC
    {
      requirement: 'GEC-CIVIC',
      titlePatterns: ['Sociology', 'Psychology', 'History', 'Political Science', 'Anthropology', 'Criminology'],
      subjectPatterns: ['Social Science'],
      priority: 9
    },
    // GEC-HUMANITIES
    {
      requirement: 'GEC-HUMANITIES',
      titlePatterns: ['Philosophy', 'Ethics', 'Art History', 'Religion', 'Literature', 'Humanities', 'Greek Philosophers', 'Critical Thinking'],
      subjectPatterns: ['Humanities'],
      priority: 9
    },
    // MAJOR-CORE (Business concentration)
    {
      requirement: 'MAJOR-CORE',
      titlePatterns: ['Business', 'Management', 'Marketing', 'Accounting', 'Finance', 'Economics', 'Organizational'],
      subjectPatterns: ['Business'],
      priority: 8
    }
  ];

  const newArticulations: Array<{
    fromCourseId: string;
    toRequirementId: string;
    priority: number;
    notes: string;
  }> = [];

  for (const rule of articulationRules) {
    const requirementId = reqMap[rule.requirement];
    if (!requirementId) continue;

    const matchingCourses = allCourses.filter(course => {
      const titleMatch = rule.titlePatterns.some(pattern => 
        course.title.toLowerCase().includes(pattern.toLowerCase())
      );
      
      const subjectMatch = !rule.subjectPatterns || rule.subjectPatterns.some(pattern =>
        (course.meta as any)?.subject?.toLowerCase().includes(pattern.toLowerCase())
      );

      return titleMatch || subjectMatch;
    });

    for (const course of matchingCourses) {
      newArticulations.push({
        fromCourseId: course.id,
        toRequirementId: requirementId,
        priority: rule.priority,
        notes: `Auto-mapped via pattern matching (bulk import)`
      });
    }
  }

  if (newArticulations.length > 0) {
    await db.insert(schema.articulations).values(newArticulations).onConflictDoNothing();
    console.log(`   ✓ Created ${newArticulations.length} new articulation mappings`);
  }

  console.log('\n✅ Bulk import complete!\n');
  console.log('Summary:');
  console.log(`  - ${sophiaInserts.length} Sophia courses imported`);
  console.log(`  - ${studyInserts.length} Study.com courses imported`);
  console.log(`  - ${newArticulations.length} articulations created`);
  console.log(`  - Total courses in catalog: ${allCourses.length + sophiaInserts.length + studyInserts.length}`);

  process.exit(0);
}

function isHighValueCourse(title: string, subject: string): boolean {
  const highValueKeywords = [
    'English Composition',
    'College Algebra',
    'Statistics',
    'Introduction to Sociology',
    'Introduction to Psychology',
    'Business Communication',
    'Financial Accounting',
    'Principles of Management',
    'Principles of Marketing',
    'Chemistry',
    'Biology',
    'Ethics',
    'Philosophy'
  ];

  return highValueKeywords.some(keyword => 
    title.toLowerCase().includes(keyword.toLowerCase())
  );
}

bulkImport().catch((error) => {
  console.error('❌ Bulk import failed:', error);
  process.exit(1);
});
