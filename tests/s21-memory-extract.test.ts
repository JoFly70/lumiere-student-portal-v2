import { describe, expect, it } from 'vitest';
import { extractMemoryCandidates, keyFor } from '../server/services/assistant-memory/extract';

const one = (t: string, l: 'en' | 'fr' = 'en') => extractMemoryCandidates(t, l);

describe('S21 memory extraction (deterministic EN/FR)', () => {
  it('captures an intended major in English', () => {
    const r = one('I want to study communications after high school.');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ category: 'intended_major', value: 'communications', statement: 'Intended major: communications' });
  });
  it('captures an intended major in French, stripping the article and accents', () => {
    const r = one('Je veux étudier les communications après le secondaire.', 'fr');
    const major = r.find((c) => c.category === 'intended_major')!;
    expect(major.value).toBe('communications');
    expect(major.statement).toBe('Domaine d’études visé : communications');
    expect(major.normalizedKey).toBe(keyFor('intended_major', 'Communications'));
  });
  it('does not take "in Canada" or "at McGill" as a major', () => {
    expect(one('I want to study in Canada.').some((c) => c.category === 'intended_major')).toBe(false);
    expect(one('I want to study at McGill.').some((c) => c.category === 'intended_major')).toBe(false);
    expect(one('Je veux étudier au Canada.', 'fr').some((c) => c.category === 'intended_major')).toBe(false);
  });
  it('captures education goals with a language-neutral key', () => {
    const en = one("I want to earn a bachelor's degree.")[0];
    const fr = one('Je souhaite obtenir un baccalauréat.', 'fr')[0];
    expect(en).toMatchObject({ category: 'education_goal', value: 'bachelor’s degree' });
    expect(fr.category).toBe('education_goal');
    expect(fr.value).toBe('baccalauréat');
    expect(fr.normalizedKey).toBe(en.normalizedKey);
    expect(one('I plan to complete my high school diploma.')[0].value).toBe('high school diploma');
  });
  it('captures preferred language, country and institution interest', () => {
    expect(one('Please answer in French.')[0]).toMatchObject({ category: 'preferred_language', value: 'French' });
    expect(one('Je préfère communiquer en anglais.', 'fr')[0]).toMatchObject({ category: 'preferred_language', value: 'anglais' });
    expect(one('I would like to study in Canada.')[0]).toMatchObject({ category: 'country_interest', value: 'Canada' });
    expect(one('Je veux étudier aux États-Unis.', 'fr').find((c) => c.category === 'country_interest')!.value).toBe('aux États-Unis');
    const inst = one("I'm interested in Thomas Edison State University and McGill.").filter((c) => c.category === 'institution_interest');
    expect(inst.map((c) => c.value).sort()).toEqual(['McGill University', 'Thomas Edison State University']);
  });
  it('captures priorities, schedule, preferences, pathways and open questions', () => {
    expect(one('My priority is to finish as quickly as possible.').find((c) => c.category === 'academic_priority')!.value).toBe('finish as quickly as possible');
    expect(one('I work full time and I can only study on weekends.').map((c) => c.category)).toEqual(['schedule_constraint', 'schedule_constraint']);
    expect(one('Je travaille à temps plein.', 'fr')[0].category).toBe('schedule_constraint');
    expect(one('I prefer self-paced online courses.')[0]).toMatchObject({ category: 'preference' });
    expect(one('I plan to transfer credits to a degree program.').some((c) => c.category === 'degree_pathway')).toBe(true);
    expect(one("I'm not sure which degree program accepts CLEP exams.")[0].category).toBe('open_question');
  });
  it('ignores questions, small talk, and text containing personal identifiers', () => {
    expect(one('Do I want to study communications?')).toEqual([]);
    expect(one('Hello, how are you?')).toEqual([]);
    expect(one('I want to study communications, my email is a@b.co')).toEqual([]);
    expect(one('My name is Sam and I want to study law')).toEqual([]);
    expect(one('')).toEqual([]);
  });
  it('never emits approved_plan (a student statement is not an approval)', () => {
    expect(one('My plan was approved by my advisor, I want to study law.').some((c) => c.category === 'approved_plan')).toBe(false);
  });
  it('keeps only the last single-valued goal in one message', () => {
    const r = one('I want to study law. Actually I want to study communications.');
    expect(r.filter((c) => c.category === 'intended_major').map((c) => c.value)).toEqual(['communications']);
  });
});
