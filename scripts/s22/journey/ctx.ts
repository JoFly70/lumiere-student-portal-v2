/**
 * Journey context: everything a step needs (target-bound HTTP, privileged ops, sessions, shared state), plus the
 * per-step recording surface (detail, skipped checks, observations) and a manifest of everything the run creates
 * (so --cleanup removes exactly those rows/objects).
 */
import { randomUUID } from 'node:crypto';
import { Http, describeFailure, type HttpResult, type ReqInit } from './http';
import {
  CheckError, check,
  type ActorKey, type Caps, type Identity, type Ops, type Session, type Sessions, type Target,
} from './types';
import type { Fixture } from './fixtures';

export interface Manifest {
  runId: string;
  authUserIds: string[];
  studentIds: string[];
  studentCodes: string[];
  invitationIds: string[];
  documentIds: string[];
  storagePaths: string[];
  emails: string[];
}

export interface StepScratch {
  detail: Record<string, unknown>;
  skippedChecks: { check: string; reason: string }[];
  observations: Record<string, unknown>;
}

const SESSION_MAX_AGE_MS = 40 * 60_000; // Supabase access tokens and CSRF tokens both last 1 hour

export class Ctx {
  readonly state: Record<string, any> = {};
  readonly sessions_: Partial<Record<ActorKey, Session>> = {};
  readonly manifest: Manifest;
  scratch: StepScratch = { detail: {}, skippedChecks: [], observations: {} };
  private readonly deferred: { stepId: string; name: string; fn: () => Promise<void> }[] = [];

  constructor(
    readonly target: Target,
    readonly runId: string,
    readonly http: Http,
    readonly ops: Ops,
    readonly auth: Sessions,
    readonly caps: Caps,
    readonly ids: Record<ActorKey, Identity>,
    /** Hook for the runner to persist the manifest as it grows (hosted runs). */
    private readonly onManifestChange: (m: Manifest) => void = () => {},
  ) {
    this.manifest = { runId, authUserIds: [], studentIds: [], studentCodes: [], invitationIds: [], documentIds: [], storagePaths: [], emails: Object.values(ids).map((i) => i.email) };
  }

  // ── recording ─────────────────────────────────────────────────────────────────────────────────────────────────
  rec(values: Record<string, unknown>): void { this.scratch.detail = { ...this.scratch.detail, ...values }; }
  skipCheck(name: string, reason: string): void { this.scratch.skippedChecks.push({ check: name, reason }); }
  observe(key: string, value: unknown): void { this.scratch.observations[key] = value; }
  defer(stepId: string, name: string, fn: () => Promise<void>): void { this.deferred.push({ stepId, name, fn }); }
  takeDeferred() { const d = [...this.deferred]; this.deferred.length = 0; return d; }
  track<K extends keyof Omit<Manifest, 'runId' | 'emails'>>(kind: K, value: string): void {
    if (value && !this.manifest[kind].includes(value)) { this.manifest[kind].push(value); this.onManifestChange(this.manifest); }
  }

  // ── sessions ──────────────────────────────────────────────────────────────────────────────────────────────────
  /** A live session for the actor (logs in on first use and when the token is about to age out). */
  async s(key: ActorKey, opts: { force?: boolean } = {}): Promise<Session> {
    const cur = this.sessions_[key];
    if (cur && !opts.force && Date.now() - cur.issuedAt < SESSION_MAX_AGE_MS) return cur;
    const r = await this.auth.tryLogin(this.ids[key]);
    if (!r.session) throw new CheckError(`login as ${key} failed with status ${r.status}`);
    this.sessions_[key] = r.session;
    this.ids[key].userId = r.session.userId;
    return r.session;
  }

  private async withSession(key: ActorKey | null, init: ReqInit = {}): Promise<ReqInit> {
    return key ? { ...init, session: await this.s(key) } : { ...init, session: null };
  }
  async get(key: ActorKey | null, path: string, init: ReqInit = {}): Promise<HttpResult> { return this.http.app('GET', path, await this.withSession(key, init)); }
  async post(key: ActorKey | null, path: string, json?: unknown, init: ReqInit = {}): Promise<HttpResult> { return this.http.app('POST', path, await this.withSession(key, { ...init, json })); }
  async put(key: ActorKey | null, path: string, json?: unknown, init: ReqInit = {}): Promise<HttpResult> { return this.http.app('PUT', path, await this.withSession(key, { ...init, json })); }
  async del(key: ActorKey | null, path: string, init: ReqInit = {}): Promise<HttpResult> { return this.http.app('DELETE', path, await this.withSession(key, init)); }
  async form(key: ActorKey | null, path: string, form: FormData): Promise<HttpResult> { return this.http.app('POST', path, await this.withSession(key, { form })); }

  /** Body of a 2xx response; throws a redacted failure otherwise. */
  okJson(res: HttpResult, label: string): any {
    if (res.status >= 300) throw new CheckError(describeFailure(res, `${label} failed`));
    return res.json;
  }

  // ── uploads (the real three-step flows) ───────────────────────────────────────────────────────────────────────
  /** Documents page flow: upload-url -> PUT to the signed URL -> record. Returns the stored document row. */
  async uploadDocument(key: ActorKey, studentId: string, docType: string, fileName: string, bytes: Buffer, mime = 'application/pdf'): Promise<any> {
    const up = await this.post(key, `/api/documents/student/${studentId}/upload-url`, { doc_type: docType, file_name: fileName, file_size: bytes.length, mime_type: mime });
    const target = this.okJson(up, 'documents upload-url');
    check(typeof target.upload_url === 'string' && typeof target.storage_path === 'string', 'upload-url response lacks upload_url/storage_path');
    this.http.assertExternalAllowed(target.upload_url);
    const put = await this.http.external('PUT', target.upload_url, { headers: { 'content-type': mime, 'x-upsert': 'false' }, body: new Uint8Array(bytes) });
    if (!put.ok) throw new CheckError(describeFailure(put, 'signed upload PUT'));
    this.track('storagePaths', target.storage_path);
    const rec = await this.post(key, `/api/documents/student/${studentId}`, { doc_type: docType, file_name: fileName, storage_path: target.storage_path });
    if (rec.status !== 201) throw new CheckError(describeFailure(rec, 'document record'));
    this.track('documentIds', String(rec.json.id));
    return { ...rec.json, storage_path: target.storage_path };
  }

  /** Chat attachment flow: attachments/upload-url -> PUT -> finalize. Does not throw on policy rejections. */
  async chatUpload(key: ActorKey, f: { fileName: string; mimeType: string; bytes: Buffer }): Promise<{ upStatus: number; upBody: any; put?: HttpResult; fin?: HttpResult; storagePath?: string }> {
    const up = await this.post(key, '/api/student/attachments/upload-url', { fileName: f.fileName, sizeBytes: f.bytes.length, mimeType: f.mimeType });
    if (up.status !== 200) return { upStatus: up.status, upBody: up.json };
    const t = up.json;
    check(typeof t.uploadUrl === 'string' && typeof t.storagePath === 'string', 'attachments upload-url response lacks uploadUrl/storagePath');
    this.http.assertExternalAllowed(t.uploadUrl);
    this.track('storagePaths', t.storagePath);
    const put = await this.http.external('PUT', t.uploadUrl, { headers: { 'content-type': f.mimeType, 'x-upsert': 'false' }, body: new Uint8Array(f.bytes) });
    if (!put.ok) throw new CheckError(describeFailure(put, 'signed upload PUT'));
    const fin = await this.post(key, '/api/student/attachments/finalize', { storagePath: t.storagePath, fileName: f.fileName });
    if (fin.json?.document?.id) this.track('documentIds', String(fin.json.document.id));
    return { upStatus: up.status, upBody: t, put, fin, storagePath: t.storagePath };
  }

  /** GET /api/documents/:id then fetch the signed URL the app returned; returns the bytes. */
  async downloadDocument(key: ActorKey, documentId: string): Promise<{ bytes: Buffer; meta: any }> {
    const r = await this.get(key, `/api/documents/${documentId}`);
    const meta = this.okJson(r, `document ${documentId}`);
    check(typeof meta.download_url === 'string', 'document response has no download_url');
    const blob = await this.http.external('GET', meta.download_url);
    if (!blob.ok) throw new CheckError(describeFailure(blob, 'signed download'));
    return { bytes: blob.bytes, meta };
  }

  newId(): string { return randomUUID(); }
}

export type { Fixture };
