import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, setAuthToken, setCsrfToken } from '../client/src/lib/api';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

function response(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: vi.fn().mockImplementation(() =>
      body === undefined ? Promise.reject(new SyntaxError('no body')) : Promise.resolve(body),
    ),
  } as unknown as Response;
}

afterEach(() => {
  setAuthToken(null);
  setCsrfToken(null);
  vi.unstubAllGlobals();
});

describe('S03 client API helper', () => {
  it('resolves 204 responses without parsing a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(204));
    vi.stubGlobal('fetch', fetchMock);
    setAuthToken('tok');
    await expect(apiRequest('/api/documents/d1', { method: 'DELETE' })).resolves.toBeUndefined();
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer tok');
  });

  it('sends Authorization and CSRF on multipart uploads without forcing Content-Type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { photoUrl: 'x' }));
    vi.stubGlobal('fetch', fetchMock);
    setAuthToken('tok');
    setCsrfToken('csrf');
    const form = new FormData();
    form.append('photo', new Blob(['a'], { type: 'image/png' }), 'a.png');
    await apiRequest('/api/students/s1/photo', { method: 'POST', body: form });
    const init = fetchMock.mock.calls[0][1];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer tok');
    expect(headers.get('X-CSRF-Token')).toBe('csrf');
    expect(headers.has('Content-Type')).toBe(false);
    expect(init.body).toBe(form);
  });
});

describe('S03 client route wiring (static)', () => {
  it('uploads avatar photos through the authenticated helper with field "photo"', () => {
    const src = read('client/src/components/profile-avatar-upload.tsx');
    expect(src).toContain("from '@/lib/api'");
    expect(src).toContain("formData.append('photo', file)");
    expect(src).toMatch(/apiRequest<[^>]*>\(\s*`\/api\/students\/\$\{encodeURIComponent\(studentId\)\}\/photo`/);
    expect(src).not.toMatch(/\bfetch\(/);
  });

  it('uses real contact routes with auth', () => {
    const src = read('client/src/pages/student-profile.tsx');
    expect(src).not.toContain('`/api/contacts/');
    expect(src).toContain("apiRequest('DELETE', `/api/students/contacts/${encodeURIComponent(contactId)}`)");
    expect(src).toContain('api.get<StudentContact[]>(`/api/students/${encodeURIComponent(studentId)}/contacts`)');
    expect(src).not.toMatch(/fetch\(`\/api\/students\/\$\{studentId\}\/contacts`\)/);
  });

  it('documents flow uses server response fields and sends metadata only', () => {
    const hook = read('client/src/hooks/use-documents.ts');
    const page = read('client/src/pages/documents.tsx');
    expect(hook).toContain('upload_url: string;');
    expect(hook).toContain('storage_path: string;');
    expect(hook).not.toMatch(/uploadUrl|storagePath|publicUrl/);
    expect(hook).toContain('`/api/documents/${encodeURIComponent(documentId)}`');
    expect(hook).toMatch(/headers\.Authorization = `Bearer \$\{token\}`/);

    const createInput = hook.slice(hook.indexOf('export interface CreateDocumentInput'));
    const body = createInput.slice(0, createInput.indexOf('}'));
    for (const forbidden of ['status', 'verified', 'url:', 'visibility', 'admin_notes', 'soft_deleted']) {
      expect(body).not.toContain(forbidden);
    }

    expect(page).toContain('uploadUrlData.upload_url');
    expect(page).toContain('storage_path: uploadUrlData.storage_path');
    expect(page).not.toMatch(/status: 'pending'|\.url\b/);
    expect(page).toContain('fetchDocumentWithDownloadUrl(doc.id)');
  });
});
