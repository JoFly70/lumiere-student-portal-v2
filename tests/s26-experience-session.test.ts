import { describe, expect, it } from 'vitest';
import {
  TAB_AUTH_STORAGE_KEY, EXPERIENCE_READY_TYPE, EXPERIENCE_SESSION_TYPE,
  banner, buildTabAuthState, chooseAuthStorage, sanitizeReturnPath, isExperienceReadyMessage, parseExperienceMessage, readTabAuth,
  type ExperiencePayload, type StorageLike,
} from '../client/src/lib/experience-session';

const NOW = 1_800_000_000;
const ORIGIN = 'https://portal.example';
const payload: ExperiencePayload = {
  mirror: { studentId: 's1', code: 'DEMO-0001', label: 'LCA-2026-0001' },
  user: { id: 'u1', email: 'demo@lumiere.invalid', name: 'Demo Student', role: 'student' },
  session: { access_token: 'a', refresh_token: 'r', expires_at: NOW + 3600 },
};
function fake(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}
const opener = {};

describe('experience message validation', () => {
  it('accepts a same-origin message from the opener with a valid shape', () => {
    expect(parseExperienceMessage({ origin: ORIGIN, source: opener, data: { type: EXPERIENCE_SESSION_TYPE, payload } }, ORIGIN, opener, NOW)).toEqual(payload);
  });
  it('rejects other origins, other sources, wrong types and malformed payloads', () => {
    const ok = { type: EXPERIENCE_SESSION_TYPE, payload };
    expect(parseExperienceMessage({ origin: 'https://evil.example', source: opener, data: ok }, ORIGIN, opener, NOW)).toBeNull();
    expect(parseExperienceMessage({ origin: ORIGIN, source: {}, data: ok }, ORIGIN, opener, NOW)).toBeNull();
    expect(parseExperienceMessage({ origin: ORIGIN, source: opener, data: ok }, ORIGIN, null, NOW)).toBeNull();
    expect(parseExperienceMessage({ origin: ORIGIN, source: opener, data: { ...ok, type: 'x' } }, ORIGIN, opener, NOW)).toBeNull();
    expect(parseExperienceMessage({ origin: ORIGIN, source: opener, data: 'str' }, ORIGIN, opener, NOW)).toBeNull();
    const bad = (p: unknown) => parseExperienceMessage({ origin: ORIGIN, source: opener, data: { type: EXPERIENCE_SESSION_TYPE, payload: p } }, ORIGIN, opener, NOW);
    expect(bad({ ...payload, user: { ...payload.user, role: 'admin' } })).toBeNull();
    expect(bad({ ...payload, session: { ...payload.session, access_token: '' } })).toBeNull();
    expect(bad({ ...payload, session: { ...payload.session, expires_at: NOW - 1 } })).toBeNull();
    expect(bad({ ...payload, mirror: { ...payload.mirror, label: '' } })).toBeNull();
    expect(bad(undefined)).toBeNull();
  });
  it('validates the ready ping against the tab that was opened', () => {
    const child = {};
    expect(isExperienceReadyMessage({ origin: ORIGIN, source: child, data: { type: EXPERIENCE_READY_TYPE } }, ORIGIN, child)).toBe(true);
    expect(isExperienceReadyMessage({ origin: 'https://evil.example', source: child, data: { type: EXPERIENCE_READY_TYPE } }, ORIGIN, child)).toBe(false);
    expect(isExperienceReadyMessage({ origin: ORIGIN, source: {}, data: { type: EXPERIENCE_READY_TYPE } }, ORIGIN, child)).toBe(false);
    expect(isExperienceReadyMessage({ origin: ORIGIN, source: child, data: { type: 'other' } }, ORIGIN, child)).toBe(false);
  });
});

describe('experience storage selection', () => {
  it('uses the tab storage only when lumiere_auth_tab exists', () => {
    const tab = fake();
    const persistent = fake();
    expect(chooseAuthStorage(tab, persistent).kind).toBe('persistent');
    tab.setItem(TAB_AUTH_STORAGE_KEY, JSON.stringify(buildTabAuthState(payload)));
    const choice = chooseAuthStorage(tab, persistent);
    expect(choice.kind).toBe('tab');
    expect(choice.storage).toBe(tab);
  });
  it('falls back to persistent storage when sessionStorage is unavailable', () => {
    expect(chooseAuthStorage(null, fake()).kind).toBe('persistent');
  });
  it('reads a valid tab state and discards malformed or expired ones', () => {
    const s = fake({ [TAB_AUTH_STORAGE_KEY]: JSON.stringify(buildTabAuthState(payload)) });
    expect(readTabAuth(s, NOW)?.experience).toEqual({ label: 'LCA-2026-0001', code: 'DEMO-0001' });
    const expired = fake({ [TAB_AUTH_STORAGE_KEY]: JSON.stringify(buildTabAuthState(payload)) });
    expect(readTabAuth(expired, NOW + 7200)).toBeNull();
    expect(expired.map.has(TAB_AUTH_STORAGE_KEY)).toBe(false);
    const junk = fake({ [TAB_AUTH_STORAGE_KEY]: '{not json' });
    expect(readTabAuth(junk, NOW)).toBeNull();
    expect(junk.map.has(TAB_AUTH_STORAGE_KEY)).toBe(false);
    const admin = fake({ [TAB_AUTH_STORAGE_KEY]: JSON.stringify({ ...buildTabAuthState(payload), user: { ...payload.user, role: 'admin' } }) });
    expect(readTabAuth(admin, NOW)).toBeNull();
    expect(readTabAuth(null, NOW)).toBeNull();
  });
  it('banner copy is bilingual and names the mirrored label', () => {
    expect(banner('en', 'X').text).toBe('Demo session — X. Changes affect demo data only.');
    expect(banner('fr', 'X').text).toContain('Session démo');
    expect(banner('fr', 'X').exit).toBe('Retour au portail du personnel');
  });
});

describe('S27 demo session return path', () => {
  it('only returns to staff pages, otherwise the Students list', () => {
    expect(sanitizeReturnPath('/admin/students/abc')).toBe('/admin/students/abc');
    expect(sanitizeReturnPath('/admin/students?x=1')).toBe('/admin/students?x=1');
    expect(sanitizeReturnPath('https://evil.test/')).toBe('/admin/students');
    expect(sanitizeReturnPath('//evil.test')).toBe('/admin/students');
    expect(sanitizeReturnPath('/flight-deck')).toBe('/admin/students');
    expect(sanitizeReturnPath(null)).toBe('/admin/students');
  });
});
