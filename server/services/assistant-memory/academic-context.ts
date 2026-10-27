/**
 * The student's own academic context for retrieval and search, read through the EXISTING student-facing read
 * services (published roadmap view, high-school view). No credit maths here: only titles, codes and institutions.
 */
import { logger } from '../../lib/logger';

export type AcademicKind = 'roadmap' | 'objective' | 'course' | 'subject';
export interface AcademicDoc {
  kind: AcademicKind;
  id: string;
  title: string;
  subtitle: string | null;
  code: string | null;
  institution: string | null;
  /** Portal route. */
  path: '/roadmap' | '/high-school';
}

export interface AcademicDeps {
  getStudentId: (ownerUserId: string) => Promise<string | null>;
  roadmapView: (studentId: string) => Promise<any | null>;
  highSchoolView: (studentId: string) => Promise<any | null>;
}

export const defaultAcademicDeps: AcademicDeps = {
  getStudentId: async (userId) => (await (await import('../student-service')).getStudentByUserId(userId))?.id ?? null,
  roadmapView: async (id) => (await import('../student-roadmap-service.default')).defaultStudentRoadmapService.getStudentView(id),
  highSchoolView: async (id) => (await import('../high-school-service.default')).defaultHighSchoolService.getStudentView(id),
};

export function academicDocsFromViews(roadmap: any | null, hs: any | null): AcademicDoc[] {
  const out: AcademicDoc[] = [];
  if (roadmap?.state === 'PUBLISHED') {
    for (const o of roadmap.objectives ?? []) {
      out.push({ kind: 'objective', id: `objective:${o.key}`, title: String(o.title), subtitle: o.canonicalProgramName ?? o.credentialLabel ?? null, code: null, institution: o.institution ?? null, path: '/roadmap' });
    }
    for (const ph of roadmap.phases ?? []) {
      for (const it of ph.items ?? []) {
        out.push({
          kind: 'roadmap', id: `item:${it.key}`, title: String(it.title),
          subtitle: [ph.title, it.provider ?? it.institution].filter(Boolean).join(' · ') || null,
          code: it.code ?? null, institution: it.institution ?? it.provider ?? null, path: '/roadmap',
        });
      }
    }
  }
  if (hs) {
    for (const s of hs.subjects ?? []) {
      out.push({ kind: 'subject', id: `subject:${s.subject}`, title: String(s.label), subtitle: null, code: null, institution: null, path: '/high-school' });
      for (const c of s.courses ?? []) {
        out.push({ kind: 'course', id: `course:${c.key}`, title: String(c.title), subtitle: String(s.label), code: null, institution: hs.enrollment?.institutionDisclosed ? hs.enrollment.schoolDisplayName ?? null : null, path: '/high-school' });
      }
    }
  }
  return out;
}

/** Never throws: a missing roadmap / high-school enrollment simply contributes nothing. */
export async function loadAcademicDocs(ownerUserId: string, deps: AcademicDeps = defaultAcademicDeps): Promise<AcademicDoc[]> {
  let studentId: string | null = null;
  try { studentId = await deps.getStudentId(ownerUserId); } catch (e) { logger.debug('academic context: no student', { error: (e as Error).message }); }
  if (!studentId) return [];
  const [roadmap, hs] = await Promise.all([
    deps.roadmapView(studentId).catch(() => null),
    deps.highSchoolView(studentId).catch(() => null),
  ]);
  return academicDocsFromViews(roadmap, hs);
}
