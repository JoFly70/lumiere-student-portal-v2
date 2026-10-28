/**
 * S22 journey steps. P0/P1 are preflight; J1-J23 mirror tests/s21-journey-first-student.test.ts (same ids, same
 * assertions, same numbers) but drive an app over HTTP as real synthetic users; J24-J29 are the S22 additions
 * (attachments in all 8 formats, rejected uploads, profile photo, cross-account storage isolation, memory
 * correction/retraction across a fresh login, conversation reopening).
 *
 * Steps never import server code and never take DB shortcuts except through ctx.ops (each use is named in the
 * step's detail as `privileged`). Programme maths asserted: 21 credits = 42 half-units = 16 core (32) + 5 elective (10),
 * with two 0.5-credit electives (1 half-unit each).
 */
import crypto from 'node:crypto';
import { Ctx } from './ctx';
import { attachmentFixtures, documentPdf, EXE_AS_PDF, JPEG_8X8, OVERSIZE_PHOTO, PNG_8X8, SVG_AS_PNG, TEXT_AS_DOCX, WEBP_8X8, sha256 } from './fixtures';
import { describeFailure, type HttpResult } from './http';
import { check, CheckError, eq, inSet, type Service } from './types';

export interface StepDef {
  id: string;
  title: string;
  uses: Service[];
  /** Step ids that must have PASSED; otherwise this step is SKIPPED. */
  requires?: string[];
  /** A failure aborts the run (remaining steps SKIPPED). */
  fatal?: boolean;
  preflight?: boolean;
  run: (c: Ctx) => Promise<void>;
}

const st = (res: HttpResult, want: number | number[], label: string): void => {
  const w = Array.isArray(want) ? want : [want];
  if (!w.includes(res.status)) throw new CheckError(describeFailure(res, `${label}: expected ${w.join('/')}`));
};
const isoDay = (offsetDays: number): string => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HS = (sid: string) => `/api/admin/students/${sid}/high-school`;
const HSE = (sid: string, e: string) => `${HS(sid)}/enrollments/${e}`;
const BILL = (sid: string) => `/api/admin/students/${sid}/billing`;
const CONV = '/api/assistant/conversations';
const MEM = '/api/assistant/memory';

const ELECTIVES = [
  { key: 'elective-art', title: 'Synthetic Art', halfUnits: 2 },
  { key: 'elective-music', title: 'Synthetic Music', halfUnits: 2 },
  { key: 'elective-coding', title: 'Synthetic Coding', halfUnits: 2 },
  { key: 'elective-drama', title: 'Synthetic Drama', halfUnits: 2 },
  { key: 'elective-half-a', title: 'Synthetic Seminar A (0.5 credit)', halfUnits: 1 },
  { key: 'elective-half-b', title: 'Synthetic Seminar B (0.5 credit)', halfUnits: 1 },
];

function studentBody(last: string, email: string) {
  return {
    status: 'active', first_name: 'S22 Synthetic', middle_name: null, last_name: last, preferred_name: null, dob: '2009-04-12', sex: null, nationality: ['FR'],
    gov_id_type: null, gov_id_number: null, photo_url: null, residency: 'us', hs_completion: false, hs_path: null, hs_country: null, hs_school: null, hs_year: null,
    hs_doc_url: null, email, phone_primary: '+15550001234', phone_secondary: null, whatsapp_primary: false, timezone: null,
    preferred_contact_channel: 'email', address_country: 'US', address_state: null, address_city: null, address_postal: null, address_line1: '1 Synthetic Way',
    address_line2: null, target_degree: null, target_major: null, start_term: null, prior_credits: false, prior_credits_est: null, prior_sources: [],
    transcripts_url: [], target_pace: null, marketing_opt_in: false, media_release: false, consent_signature: null,
  };
}

function b64(o: unknown): string { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
function forgeJwt(claims: Record<string, unknown>, secret = 's22-not-the-secret'): string {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64(claims);
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}

const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

// ── preflight ────────────────────────────────────────────────────────────────────────────────────────────────────

const P0: StepDef = {
  id: 'P0', title: 'preflight: the deployed app is wired to the staging Supabase project and reports healthy', uses: ['app', 'db'], fatal: true, preflight: true,
  async run(c) {
    const env = await c.http.app('GET', '/env.js');
    st(env, 200, 'GET /env.js');
    const url = /SUPABASE_URL:\s*'([^']*)'/.exec(env.text)?.[1] ?? '';
    const anon = /SUPABASE_ANON:\s*'([^']*)'/.exec(env.text)?.[1] ?? '';
    if (c.target.mode === 'hosted') {
      check(url, 'the app serves no SUPABASE_URL in /env.js (not configured?)');
      eq(new URL(url).hostname, `${c.target.ref}.supabase.co`, 'the deployed app points at a different Supabase project than S22_STAGING_PROJECT_REF');
      const h = await c.http.app('GET', '/health');
      st(h, 200, 'GET /health');
      eq(h.json?.status, 'ok', '/health status');
      eq(h.json?.checks?.database, 'ok', '/health database check');
      if (!c.state.anonKey) c.state.anonKey = anon;
    } else {
      c.skipCheck('app Supabase wiring + /health', 'local in-process target has no Supabase project');
    }
    const one = await c.ops.sql<{ ok: number }>('select 1 as ok');
    eq(one[0]?.ok, 1, 'privileged database connection');
    c.rec({ privileged: [c.ops.describe], appSupabaseHostMatchesGuard: c.target.mode === 'hosted', anonKeyAvailable: Boolean(c.state.anonKey) });
  },
};

const P1: StepDef = {
  id: 'P1', title: 'preflight: synthetic admin, staff and student B exist (service-role setup, labelled) and can sign in', uses: ['app', 'auth', 'db'], requires: ['P0'], fatal: true, preflight: true,
  async run(c) {
    for (const key of ['admin', 'staff', 'studentB'] as const) {
      const id = c.ids[key];
      const u = await c.ops.createAuthUser({ email: id.email, password: id.password, fullName: id.fullName, role: id.role, confirmed: true });
      id.userId = u.id;
      c.track('authUserIds', u.id);
    }
    await c.s('admin');
    await c.s('staff');
    await c.s('studentB');
    const created = await c.post('staff', '/api/students', studentBody('Student B', c.ids.studentB.email));
    st(created, 201, 'staff creates student B');
    c.state.bId = created.json.id;
    c.state.bCode = created.json.student_code;
    c.track('studentIds', c.state.bId);
    c.track('studentCodes', c.state.bCode);
    st(await c.post('admin', `/api/admin/students/${c.state.bId}/account/link`, { userId: c.ids.studentB.userId }), 200, 'admin links student B');
    c.rec({ privileged: ['service-role: create auth users admin/staff/studentB (+ users/profiles rows)'], actors: ['admin', 'staff', 'studentB'], studentBLinked: true });
  },
};

// ── J1-J3 invitation, signup gating, email verification ──────────────────────────────────────────────────────────

const J1: StepDef = {
  id: 'J1', title: 'admin issues an invitation; only the SHA-256 hash is stored; staff/students cannot issue', uses: ['app', 'db'], requires: ['P1'],
  async run(c) {
    const email = c.ids.studentA.email;
    const mixed = email.charAt(0).toUpperCase() + email.slice(1);
    c.state.inviteEmail = mixed;
    st(await c.post('staff', '/api/admin/invitations', { email: mixed }), 403, 'staff issues invitation');
    st(await c.post('studentB', '/api/admin/invitations', { email: mixed }), 403, 'student issues invitation');
    const res = await c.post('admin', '/api/admin/invitations', { email: mixed });
    st(res, [200, 201], 'admin issues invitation');
    const token = res.json.token as string;
    check(typeof token === 'string' && token.length > 20, 'invitation token missing');
    c.state.inviteToken = token;
    c.track('invitationIds', String(res.json.id));
    const [row] = await c.ops.sql<any>('select email, token_hash, role, consumed_at, claimed_at from account_invitations where email = $1', [email.toLowerCase()]);
    check(row, 'invitation row not found by lower-cased email');
    check(row.token_hash !== token, 'raw token stored');
    eq(row.token_hash, crypto.createHash('sha256').update(token).digest('hex'), 'stored hash is SHA-256 of the token');
    eq([row.role, row.consumed_at, row.claimed_at], ['student', null, null], 'fresh invitation state');
    c.rec({ staffIssue: 403, studentIssue: 403, adminIssue: res.status, hashOnly: true, emailNormalizedLowercase: true, privileged: ['database read of account_invitations'] });
  },
};

const J2: StepDef = {
  id: 'J2', title: 'signup is invitation-gated and, with ENABLE_EMAIL_VERIFICATION=true, creates an UNCONFIRMED account with no session', uses: ['app', 'auth', 'db'], requires: ['J1'],
  async run(c) {
    const A = c.ids.studentA;
    const body = { email: c.state.inviteEmail, password: A.password, fullName: A.fullName };
    const noToken = await c.post(null, '/api/auth/signup', body);
    st(noToken, 403, 'signup without invitation');
    eq(noToken.json?.code, 'INVITATION_REQUIRED', 'code');
    const wrongEmail = await c.post(null, '/api/auth/signup', { ...body, email: A.email.replace('-a@', '-nobody@'), invitationToken: c.state.inviteToken });
    st(wrongEmail, 403, 'signup with another email');
    eq(wrongEmail.json?.code, 'INVITATION_INVALID', 'code');

    if (c.ops.injectNextSignupFailure) {
      c.ops.injectNextSignupFailure();
      st(await c.post(null, '/api/auth/signup', { ...body, invitationToken: c.state.inviteToken }), 400, 'signup with provider failure');
      const [inv] = await c.ops.sql<any>('select claimed_at, consumed_at from account_invitations where email = $1', [A.email.toLowerCase()]);
      eq([inv?.claimed_at, inv?.consumed_at], [null, null], 'a failed provider call releases the invitation');
      c.rec({ providerFailureReleasedInvitation: true });
    } else {
      c.skipCheck('provider failure releases the invitation', 'a real identity provider cannot be made to fail on demand; covered by the local rehearsal only');
    }

    const created = await c.post(null, '/api/auth/signup', { ...body, invitationToken: c.state.inviteToken });
    st(created, 200, 'signup');
    check(!created.json?.session, 'signup returned a session: the account was auto-confirmed. Set ENABLE_EMAIL_VERIFICATION=true on the staging app');
    const userId = created.json?.user?.id as string;
    check(UUID_RE.test(userId), 'signup returned no user id');
    A.userId = userId;
    c.track('authUserIds', userId);
    eq(await c.ops.isEmailConfirmed(userId, A.email), false, 'the new account must be unconfirmed');
    const [inv] = await c.ops.sql<any>('select consumed_at, consumed_by from account_invitations where email = $1', [A.email.toLowerCase()]);
    check(inv?.consumed_at, 'invitation not consumed');
    eq(String(inv.consumed_by), userId, 'consumed_by');
    const early = await c.auth.tryLogin(A);
    eq(early.status, 401, 'login before email verification');
    check(!early.session, 'a session was issued to an unconfirmed account');
    c.defer('J2', 'a consumed invitation cannot be reused', async () => {
      const reuse = await c.post(null, '/api/auth/signup', { ...body, invitationToken: c.state.inviteToken });
      st(reuse, 403, 'invitation reuse');
      eq(reuse.json?.code, 'INVITATION_INVALID', 'code');
    });
    c.rec({ noToken: 403, wrongEmail: 403, createdUnconfirmed: true, sessionReturned: false, loginBeforeVerification: 401, reuse: 'checked after the last step (signup limiter is 3 per hour)', privileged: ['database read of account_invitations', 'identity-provider admin read of email confirmation'] });
  },
};

const J3: StepDef = {
  id: 'J3', title: 'email verification: only a provider-confirmed email counts; unconfirmed/invalid links never report success', uses: ['app', 'auth'], requires: ['J2'],
  async run(c) {
    const url = '/api/auth/verify-email';
    const missing = await c.post(null, url, {});
    st(missing, 400, 'verify without credential');
    const wrongType = await c.post(null, url, { token_hash: 'abcdefgh12345678', type: 'recovery' });
    st(wrongType, 400, 'recovery type must not verify an email');
    const invalid = await c.post(null, url, { token_hash: 's22_not_a_real_token_hash', type: 'signup' });
    st(invalid, [400, 401], 'invalid token hash');
    eq(invalid.json?.verified, false, 'invalid hash verified flag');
    const bare = await c.post(null, url, { access_token: 'aaaa1111.bbbb2222.cccc3333' });
    st(bare, [400, 401], 'bare unconfirmed token');
    eq(bare.json?.verified, false, 'bare token verified flag');
    check(!(await c.ops.isEmailConfirmed(c.ids.studentA.userId!, c.ids.studentA.email)), 'invalid attempts confirmed the email');

    const tok = await c.ops.generateVerificationToken(c.ids.studentA.email);
    check(tok, 'could not obtain a verification token from the identity provider (admin generateLink)');
    let good: HttpResult | null = null;
    const tried: string[] = [];
    for (const type of ['email', 'signup']) {
      good = await c.post(null, url, { token_hash: tok.tokenHash, type });
      tried.push(`${type}:${good.status}`);
      if (good.json?.verified === true) break;
    }
    check(good && good.status === 200 && good.json?.verified === true, `a provider-issued token did not verify the email (${tried.join(', ')})`);
    check(!JSON.stringify(good.json).includes(tok.tokenHash), 'the credential was echoed in the response');
    eq(await c.ops.isEmailConfirmed(c.ids.studentA.userId!, c.ids.studentA.email), true, 'provider now reports the email confirmed');
    await c.s('studentA');
    c.rec({ missing: 400, wrongType: 400, invalidHash: invalid.status, bareToken: bare.status, confirmed: 200, credentialEchoed: false, loginAfterVerification: 200, verificationTypeAccepted: tried.at(-1), emailDelivery: 'NOT VERIFIED: the token comes from admin generateLink, no mail is read', privileged: ['identity-provider admin generateLink'] });
  },
};

// ── J4 session handling ──────────────────────────────────────────────────────────────────────────────────────────

const J4: StepDef = {
  id: 'J4', title: 'session handling: valid token works; expired-claim, tampered, forged-issuer, alg=none and absent tokens are 401; suspended account is refused', uses: ['app', 'auth', 'db'], requires: ['J3'],
  async run(c) {
    const A = c.ids.studentA;
    const sess = await c.s('studentA');
    const probe = (authorization?: string) => c.http.app('GET', '/api/student/billing', { headers: authorization ? { authorization } : {} });
    const valid = await probe(`Bearer ${sess.bearer}`);
    check(valid.status !== 401 && valid.status < 500, `valid token rejected or server error (${valid.status})`);
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: A.userId, userId: A.userId, email: A.email, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 };
    const iss = c.target.mode === 'hosted' ? `${c.target.supabaseUrl}/auth/v1` : 'lumiere-local';
    const last = sess.bearer.slice(-1);
    const tokens: Record<string, string | undefined> = {
      tampered: sess.bearer.slice(0, -1) + (last === 'A' ? 'B' : 'A'),
      expiredClaimUnknownKey: forgeJwt({ ...claims, iss, iat: now - 7200, exp: now - 3600 }),
      forgedIssuer: forgeJwt({ ...claims, iss: 'attacker' }),
      algNone: `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, iss })}.`,
      absent: undefined,
    };
    const statuses: Record<string, number> = {};
    for (const [k, t] of Object.entries(tokens)) {
      statuses[k] = (await probe(t ? `Bearer ${t}` : undefined)).status;
      eq(statuses[k], 401, `${k} token`);
    }
    await c.ops.setAccountStatus(A.userId!, 'inactive');
    let suspended: HttpResult;
    try { suspended = await probe(`Bearer ${sess.bearer}`); } finally { await c.ops.setAccountStatus(A.userId!, 'active'); }
    st(suspended, 403, 'suspended account');
    eq(suspended.json?.code, 'ACCOUNT_INACTIVE', 'suspended code');
    check((await probe(`Bearer ${sess.bearer}`)).status !== 403, 'reactivated account still refused');
    c.observe('naturalExpiry', 'NOT provable over HTTP: an expired-claim token signed with an unknown key is rejected, but the verifier cannot be shown to reject a correctly signed expired token');
    c.rec({ ...statuses, suspended: 403, reactivated: 'ok', privileged: ['database update of profiles.status (suspend / reactivate)'] });
  },
};

// ── J5-J7 student record, programme, plan ────────────────────────────────────────────────────────────────────────

const J5: StepDef = {
  id: 'J5', title: 'staff creates the student record; admin links the login (account linkage)', uses: ['app', 'db'], requires: ['J4'],
  async run(c) {
    const body = studentBody('Student A', c.ids.studentA.email);
    st(await c.post('studentA', '/api/students', body), 403, 'student creates a student record');
    const res = await c.post('staff', '/api/students', body);
    st(res, 201, 'staff creates student A');
    c.state.s1Id = res.json.id; c.state.s1Code = res.json.student_code;
    c.track('studentIds', c.state.s1Id); c.track('studentCodes', c.state.s1Code);
    st(await c.get('studentA', '/api/student/high-school'), 404, 'unlinked student');
    st(await c.post('admin', `/api/admin/students/${c.state.s1Id}/account/link`, { userId: c.ids.studentA.userId }), 200, 'link');
    c.rec({ created: 201, linked: true });
  },
};

const J6: StepDef = {
  id: 'J6', title: 'high-school enrollment + plan: 17 core courses = 16 core credits, 6 electives = 5 credits (incl. two 0.5-credit), total 21 credits = 42 half-units; admin publishes', uses: ['app', 'db'], requires: ['J5'],
  async run(c) {
    const sid = c.state.s1Id as string;
    let s = c.okJson(await c.post('staff', `${HS(sid)}/enrollments`, { templateKey: 'us-hs-diploma-21', templateVersion: 2, status: 'active' }), 'enroll');
    const eid = s.current.enrollment.id as string;
    c.state.eid = eid;
    s = c.okJson(await c.post('staff', `${HSE(sid, eid)}/roadmap/draft/from-template`, {}), 'draft');
    const draft = s.current.draft;
    const content = JSON.parse(JSON.stringify(draft.content));
    const core = content.courses.filter((x: any) => x.areaKey !== 'electives');
    eq(sum(core.map((x: any) => x.halfUnits)), 32, 'core half-units (16 credits)');
    for (const e of ELECTIVES) content.courses.push({ key: e.key, title: e.title, areaKey: 'electives', halfUnits: e.halfUnits, status: 'planned', replacesCourseKey: null, plannedStart: null, plannedEnd: null, tasks: [] });
    const task = (key: string, title: string) => ({ key, kind: 'lesson', title, dueDate: isoDay(60) });
    content.courses.find((x: any) => x.key === 'english-1').tasks = [task('lesson-1', 'Unit 1 lessons')];
    content.courses.find((x: any) => x.key === 'science-biology').tasks = [task('lab-1', 'Lab 1')];
    s = c.okJson(await c.put('staff', `${HSE(sid, eid)}/roadmap/draft`, { expectedDraftRevision: draft.draftRevision, content }), 'save draft');
    eq(sum(s.current.draft.content.courses.map((x: any) => x.halfUnits)), 42, 'plan half-units (21 credits)');
    const d2 = c.okJson(await c.get('staff', HS(sid)), 'staff state').current.draft;
    st(await c.post('staff', `${HSE(sid, eid)}/roadmap/publish`, { expectedDraftRevision: d2.draftRevision, expectedPublishedVersionId: null }), 403, 'staff publish');
    c.okJson(await c.post('admin', `${HSE(sid, eid)}/roadmap/publish`, { expectedDraftRevision: d2.draftRevision, expectedPublishedVersionId: null }), 'publish');
    const v = c.okJson(await c.get('studentA', '/api/student/high-school'), 'student view');
    check(v.credits.requiredHalfUnits === 42 && v.credits.earnedHalfUnits === 0, `student credits ${JSON.stringify(v.credits).slice(0, 200)}`);
    eq(v.credits.core.requiredHalfUnits, 32, 'student core required');
    eq(v.credits.elective.requiredHalfUnits, 10, 'student elective required');
    const programs = c.okJson(await c.get('studentA', '/api/student/programs'), 'programs');
    eq(programs.programs.filter((p: any) => p.kind === 'high_school').length, 1, 'one high-school programme');
    c.rec({ coreCourses: core.length, coreHalfUnits: 32, electiveCourses: 6, electiveHalfUnits: 10, totalHalfUnits: 42, totalCredits: 21, highSchoolProgramRecognised: true });
  },
};

const J7: StepDef = {
  id: 'J7', title: 'academic projection before any evidence: nothing official, nothing invented (no graduation date, no earned credit)', uses: ['app', 'db'], requires: ['J6'],
  async run(c) {
    const p = c.okJson(await c.get('studentA', '/api/student/academic-projection'), 'projection');
    eq(p.dataState, 'plan_published', 'dataState');
    eq(p.program.kind, 'high_school', 'programme kind');
    eq([p.credits.total.requiredHalfUnits, p.credits.total.officialHalfUnits, p.credits.total.officialPercent, p.credits.total.remainingHalfUnits], [42, 0, 0, 42], 'total credits');
    eq([p.credits.core.requiredHalfUnits, p.credits.elective.requiredHalfUnits], [32, 10], 'core/elective required');
    eq(p.program.targetCompletionDate, null, 'target completion date');
    check(!/graduat\w* (date|on)\b/i.test(JSON.stringify(p)), 'a graduation date was invented');
    c.rec({ required: 42, official: 0, targetCompletionDate: null });
  },
};

const J8: StepDef = {
  id: 'J8', title: 'student reports progress: submitted -> awaiting_school, started -> in_progress, untouched -> planned; none of it is official credit', uses: ['app', 'db'], requires: ['J7'],
  async run(c) {
    c.okJson(await c.post('studentA', '/api/student/high-school/progress', { courseKey: 'english-1', taskKey: 'lesson-1', status: 'submitted', expectedRevision: 0 }), 'report submitted');
    c.okJson(await c.post('studentA', '/api/student/high-school/progress', { courseKey: 'science-biology', taskKey: 'lab-1', status: 'in_progress', expectedRevision: 0 }), 'report in progress');
    const p = c.okJson(await c.get('studentA', '/api/student/academic-projection'), 'projection');
    const course = (k: string) => p.subjects.flatMap((s: any) => s.courses).find((x: any) => x.key === k);
    check(course('english-1')?.status === 'awaiting_school' && course('english-1')?.basis === 'awaiting_school', 'english-1 not awaiting_school');
    check(course('science-biology')?.status === 'in_progress' && course('science-biology')?.basis === 'in_progress', 'science-biology not in_progress');
    eq(course('english-2')?.basis, 'planned', 'untouched course');
    const t = p.credits.total;
    eq(t.officialHalfUnits, 0, 'official');
    eq(t.awaitingSchoolHalfUnits, course('english-1').halfUnits, 'awaiting');
    eq(t.inProgressHalfUnits, course('science-biology').halfUnits, 'in progress');
    check(t.officialHalfUnits + t.awaitingSchoolHalfUnits + t.inProgressHalfUnits + t.plannedHalfUnits <= 42, 'buckets exceed the programme');
    c.rec({ official: t.officialHalfUnits, awaiting: t.awaitingSchoolHalfUnits, inProgress: t.inProgressHalfUnits, planned: t.plannedHalfUnits });
  },
};

// ── J9 documents ─────────────────────────────────────────────────────────────────────────────────────────────────

const J9: StepDef = {
  id: 'J9', title: 'document upload (real signed upload) -> staff rejection with a student-visible reason (internal note hidden) -> student resubmission -> staff verification', uses: ['app', 'db', 'storage'], requires: ['J8'],
  async run(c) {
    const sid = c.state.s1Id as string;
    const first = await c.uploadDocument('studentA', sid, 'hs_transcript', 'school-record-v1.pdf', documentPdf(`v1-${c.runId}`));
    eq([first.status, first.verified], ['pending', false], 'fresh document');
    c.state.docRejectedId = first.id;
    st(await c.post('studentA', `/api/documents/${first.id}/reject`, { student_message: 'x' }), 403, 'student rejects');
    st(await c.post('staff', `/api/documents/${first.id}/reject`, { admin_notes: 'no reason' }), 400, 'reject without a student message');
    const rej = await c.post('staff', `/api/documents/${first.id}/reject`, { student_message: 'The scan is cut off; please upload the full page.', admin_notes: 'INTERNAL-S22: suspicious crop' });
    st(rej, 200, 'reject');
    eq(rej.json.status, 'rejected', 'status');
    const list = await c.get('studentA', `/api/documents/student/${sid}`);
    st(list, 200, 'student lists documents');
    check(list.text.includes('The scan is cut off'), 'student message not visible');
    check(!list.text.includes('INTERNAL-S22'), 'internal note leaked to the student');
    const second = await c.uploadDocument('studentA', sid, 'hs_transcript', 'school-record-v2.pdf', documentPdf(`v2-${c.runId}`));
    check(second.id !== first.id, 'resubmission reused the rejected row');
    c.state.docVerifiedId = second.id;
    st(await c.post('staff', `${HSE(sid, c.state.eid)}/results/course`, { courseKey: 'english-1', outcome: 'completed', evidenceDocumentId: first.id }), 422, 'rejected document as evidence');
    const ver = await c.post('staff', `/api/documents/${second.id}/verify`, { admin_notes: 'ok' });
    st(ver, 200, 'verify');
    eq([ver.json.status, ver.json.verified], ['verified', true], 'verified');
    const [row] = await c.ops.sql<any>('select status from student_documents where id::text = $1', [first.id]);
    eq(row?.status, 'rejected', 'rejected row unchanged');
    c.rec({ uploaded: 201, realSignedUpload: true, rejectedWithStudentMessage: true, internalNoteHiddenFromStudent: true, rejectedAsEvidence: 422, resubmitted: 201, verified: true, privileged: ['database read of student_documents.status'] });
  },
};

const J10: StepDef = {
  id: 'J10', title: 'official results from verified evidence: english-1 (2 half-units) + a 0.5-credit elective (1 half-unit) = 3 half-units; buckets stay distinct', uses: ['app', 'db'], requires: ['J9'],
  async run(c) {
    const sid = c.state.s1Id as string; const eid = c.state.eid as string;
    const r1 = c.okJson(await c.post('staff', `${HSE(sid, eid)}/results/course`, { courseKey: 'english-1', outcome: 'completed', evidenceDocumentId: c.state.docVerifiedId }), 'english-1');
    eq(r1.current.credits.earnedHalfUnits, 2, 'earned after english-1');
    const r2 = c.okJson(await c.post('staff', `${HSE(sid, eid)}/results/course`, { courseKey: 'elective-half-a', outcome: 'completed', evidenceDocumentId: c.state.docVerifiedId }), 'half elective');
    eq([r2.current.credits.earnedHalfUnits, r2.current.credits.remainingHalfUnits], [3, 39], 'earned/remaining after the half-credit elective');
    const p = c.okJson(await c.get('studentA', '/api/student/academic-projection'), 'projection');
    const t = p.credits.total;
    eq([t.officialHalfUnits, t.remainingHalfUnits, t.awaitingSchoolHalfUnits], [3, 39, 0], 'projection totals (english-1 moved from awaiting to official)');
    eq([p.credits.core.officialHalfUnits, p.credits.elective.officialHalfUnits], [2, 1], 'core/elective official');
    check(Math.abs(t.officialPercent - (3 / 42) * 100) < 0.5, `officialPercent ${t.officialPercent}`);
    const courses = p.subjects.flatMap((s: any) => s.courses);
    eq(courses.find((x: any) => x.key === 'science-biology').basis, 'in_progress', 'biology basis');
    eq(courses.find((x: any) => x.key === 'english-1').basis, 'official', 'english-1 basis');
    const state = c.okJson(await c.get('staff', HS(sid)), 'staff state');
    eq(state.current.graduation.status, 'in_progress', 'graduation status');
    check(state.current.graduation.blockers.length > 0, 'graduation has no blockers');
    c.rec({ officialHalfUnits: 3, officialCredits: 1.5, remainingHalfUnits: 39, graduation: 'in_progress', targetCompletionDate: p.program.targetCompletionDate });
  },
};

// ── J11 isolation ────────────────────────────────────────────────────────────────────────────────────────────────

const J11: StepDef = {
  id: 'J11', title: "access isolation: student B cannot read or change student A's projection, documents, billing, tickets or staff surfaces", uses: ['app', 'db'], requires: ['J10'],
  async run(c) {
    const sid = c.state.s1Id as string;
    st(await c.get('studentB', '/api/student/academic-projection'), 404, 'B projection (B has no programme)');
    st(await c.get('studentB', `/api/student/academic-projection?studentId=${sid}`), 400, 'projection with studentId');
    st(await c.get('studentB', `/api/student/billing?studentId=${sid}`), 400, 'billing with studentId');
    st(await c.get('studentB', `/api/documents/student/${sid}`), 403, 'A documents list');
    check((await c.get('studentB', `/api/documents/${c.state.docVerifiedId}`)).status >= 403, 'A document readable by B');
    st(await c.get('studentB', HS(sid)), 403, 'staff HS surface');
    st(await c.get('studentB', BILL(sid)), 403, 'staff billing surface');
    st(await c.post('studentB', `${BILL(sid)}/obligation`, { agreedCents: 1, currency: 'USD' }), 403, 'B writes billing');
    const bBill = c.okJson(await c.get('studentB', '/api/student/billing'), 'B billing');
    eq(bBill.state, 'not_configured', "B's own billing");
    st(await c.get(null, '/api/student/billing'), 401, 'unauthenticated billing');
    c.rec({ projectionOfOther: 404, queryStudentId: 400, documents: 403, staffHs: 403, staffBilling: 403, bBilling: bBill.state });
  },
};

// ── J12 support ──────────────────────────────────────────────────────────────────────────────────────────────────

const J12: StepDef = {
  id: 'J12', title: 'support: ticket creation, staff reply, student reply with Idempotency-Key sent twice => exactly one comment; internal notes hidden', uses: ['app', 'db'], requires: ['J11'],
  async run(c) {
    const created = await c.post('studentA', '/api/tickets', { subject: 'Help with English 1', description: 'I am unsure how to approach the first English 1 unit.', topic: 'course_assistance' });
    st(created, 201, 'create ticket');
    const id = created.json.ticket.id as string;
    st(await c.post('staff', `/api/tickets/${id}/comments`, { content: 'Start with unit 1.', isInternal: false }), 201, 'staff reply');
    st(await c.post('staff', `/api/tickets/${id}/comments`, { content: 'INTERNAL-S22 behind pace', isInternal: true }), 201, 'internal note');
    const KEY = `s22-reply-${c.runId}-0123456789`;
    const reply = { content: 'Thanks, I started unit 1.' };
    const r1 = await c.post('studentA', `/api/tickets/${id}/comments`, reply, { headers: { 'Idempotency-Key': KEY } });
    const r2 = await c.post('studentA', `/api/tickets/${id}/comments`, reply, { headers: { 'Idempotency-Key': KEY } });
    st(r1, 201, 'first reply'); st(r2, 200, 'replayed reply');
    eq(r2.json.replayed, true, 'replayed flag');
    eq(r2.json.comment.id, r1.json.comment.id, 'same comment id');
    const detail = await c.get('studentA', `/api/tickets/${id}`);
    st(detail, 200, 'ticket detail');
    eq(detail.json.ticket.ticket_comments.filter((x: any) => x.content === reply.content).length, 1, 'exactly one student comment');
    check(!detail.text.includes('INTERNAL-S22'), 'internal note leaked');
    check(!(await c.get('studentB', '/api/tickets')).text.includes(id), "B's ticket list contains A's ticket");
    check((await c.get('studentB', `/api/tickets/${id}`)).status >= 403, 'B reads A ticket');
    c.rec({ created: 201, firstReply: 201, duplicateReply: 200, replayed: true, commentsWithText: 1, internalHidden: true });
  },
};

// ── J13-J15 billing ──────────────────────────────────────────────────────────────────────────────────────────────

const J13: StepDef = {
  id: 'J13', title: 'staff configure billing (obligation, discount, 4 installments); student sees exact integer-cent totals and no staff-only fields', uses: ['app', 'db'], requires: ['J12'],
  async run(c) {
    const sid = c.state.s1Id as string;
    eq(c.okJson(await c.get('studentA', '/api/student/billing'), 'billing before').state, 'not_configured', 'billing before configuration');
    const post = (p: string, b: object) => c.post('staff', `${BILL(sid)}/${p}`, b);
    c.okJson(await post('obligation', { agreedCents: 1_200_000, currency: 'usd', note: 'internal-note-S22' }), 'obligation');
    c.okJson(await post('discounts', { amountCents: 200_000, reason: 'Early enrollment INTERNAL' }), 'discount');
    c.okJson(await post('installments', { installments: [
      { dueDate: isoDay(14), amountCents: 250_000, label: 'Deposit' }, { dueDate: isoDay(45), amountCents: 250_000 },
      { dueDate: isoDay(75), amountCents: 250_000 }, { dueDate: isoDay(105), amountCents: 250_000 }] }), 'installments');
    const v = c.okJson(await c.get('studentA', '/api/student/billing'), 'billing after');
    eq([v.state, v.currency, v.agreedCents, v.discountCents, v.netObligationCents, v.paidCents, v.remainingCents],
      ['configured', 'USD', 1_200_000, 200_000, 1_000_000, 0, 1_000_000], 'student billing numbers');
    check(!/internal-note-S22|INTERNAL|confirmedBy|approvedBy/.test(JSON.stringify(v)), 'staff-only field visible to the student');
    st(await c.post('studentA', `${BILL(sid)}/obligation`, { agreedCents: 1, currency: 'USD' }), 403, 'student writes billing');
    c.rec({ net: v.netObligationCents, remaining: v.remainingCents, installments: v.installments?.length });
  },
};

const J14: StepDef = {
  id: 'J14', title: 'proof of payment (real signed upload): student-uploaded evidence never counts until staff confirm; confirming records an exact receipt', uses: ['app', 'db', 'storage'], requires: ['J13'],
  async run(c) {
    const sid = c.state.s1Id as string;
    const up = await c.uploadDocument('studentA', sid, 'other', 'proof-of-payment.pdf', documentPdf(`proof-${c.runId}`));
    const reg = c.okJson(await c.post('staff', `${BILL(sid)}/evidence`, { documentId: up.id }), 'register evidence');
    const evidenceId = reg.evidence.find((e: any) => e.documentId === up.id).id as string;
    c.state.evidenceId = evidenceId;
    const mid = c.okJson(await c.get('studentA', '/api/student/billing'), 'mid');
    eq([mid.evidenceAwaitingReview.length, mid.paidCents], [1, 0], 'before confirmation');
    const confirmBody = { amountCents: 300_000, receivedDate: isoDay(0), methodLabel: 'Bank transfer', reference: 'REF-S22' };
    const conf = c.okJson(await c.post('staff', `${BILL(sid)}/evidence/${evidenceId}/confirm`, confirmBody), 'confirm');
    c.state.receiptId = conf.receipts[0].id;
    const after = c.okJson(await c.get('studentA', '/api/student/billing'), 'after');
    eq([after.paidCents, after.remainingCents, after.evidenceAwaitingReview.length], [300_000, 700_000, 0], 'after confirmation');
    st(await c.post('staff', `${BILL(sid)}/evidence/${evidenceId}/confirm`, { amountCents: 300_000, receivedDate: isoDay(0), methodLabel: 'Bank transfer' }), 409, 'second confirm');
    check(!JSON.stringify(after).includes('REF-S22'), 'staff reference leaked to the student');
    c.rec({ awaitingBeforeConfirm: 1, paidBefore: 0, paidAfter: 300_000, remainingAfter: 700_000, secondConfirm: 409, realSignedUpload: true });
  },
};

const J15: StepDef = {
  id: 'J15', title: 'correction: void the receipt (reason required) -> totals revert, evidence returns to review; same evidence backs ONE new receipt, never two', uses: ['app', 'db'], requires: ['J14'],
  async run(c) {
    const sid = c.state.s1Id as string; const evidenceId = c.state.evidenceId as string; const receiptId = c.state.receiptId as string;
    const voidUrl = `${BILL(sid)}/receipts/${receiptId}/void`;
    st(await c.post('staff', voidUrl, {}), 400, 'void without reason');
    st(await c.post('studentA', voidUrl, { reason: 'x' }), 403, 'student voids');
    const voided = c.okJson(await c.post('staff', voidUrl, { reason: 'Entered against the wrong amount' }), 'void');
    check(voided.voidedReceipts[0]?.id === receiptId && voided.voidedReceipts[0]?.amountCents === 300_000, 'voided receipt not listed');
    st(await c.post('staff', voidUrl, { reason: 'again' }), 409, 'second void');
    const reverted = c.okJson(await c.get('studentA', '/api/student/billing'), 'reverted');
    eq([reverted.paidCents, reverted.remainingCents, reverted.evidenceAwaitingReview.length], [0, 1_000_000, 1], 'after void');
    check(!/wrong amount|voided/i.test(JSON.stringify(reverted)), 'void reason leaked to the student');
    const body = { amountCents: 250_000, receivedDate: isoDay(0), methodLabel: 'Bank transfer' };
    st(await c.post('staff', `${BILL(sid)}/evidence/${evidenceId}/confirm`, body), 200, 'new receipt');
    st(await c.post('staff', `${BILL(sid)}/evidence/${evidenceId}/confirm`, body), 409, 'duplicate new receipt');
    const [cnt] = await c.ops.sql<any>('select count(*) filter (where voided_at is null)::int a, count(*) filter (where voided_at is not null)::int v from student_billing_receipts where evidence_id::text = $1', [evidenceId]);
    eq([cnt?.a, cnt?.v], [1, 1], 'active/voided receipts on the evidence');
    const final = c.okJson(await c.get('studentA', '/api/student/billing'), 'final');
    eq([final.paidCents, final.remainingCents], [250_000, 750_000], 'final totals');
    check(Number.isInteger(final.paidCents) && Number.isInteger(final.remainingCents), 'non-integer cents');
    c.rec({ voidWithoutReason: 400, afterVoidPaid: 0, evidenceBackInReview: true, newReceiptPaid: 250_000, activeReceiptsOnEvidence: 1, voidedHistory: 1, privileged: ['database read of student_billing_receipts'] });
  },
};

// ── J16-J23 (S21 surfaces) ───────────────────────────────────────────────────────────────────────────────────────

const J16: StepDef = {
  id: 'J16', title: "first-login welcome is server-derived: 'first' once, then 'returning'; attention counts only real items (resubmitted rejection is not counted)", uses: ['app', 'db'], requires: ['J15'],
  async run(c) {
    const w1 = c.okJson(await c.get('studentA', '/api/student/welcome'), 'welcome');
    eq(w1.kind, 'first', 'first welcome');
    eq(w1.firstName, 'S22 Synthetic', 'first name');
    st(await c.post('studentA', '/api/student/welcome/seen'), 204, 'welcome/seen');
    const w2 = c.okJson(await c.get('studentA', '/api/student/welcome'), 'welcome 2');
    eq(w2.kind, 'returning', 'returning welcome');
    eq(w2.attention.count, 0, 'attention count');
    st(await c.get('staff', '/api/student/welcome'), 403, 'staff welcome');
    c.rec({ first: w1.kind, afterSeen: w2.kind, attention: w2.attention.count, staff: 403 });
  },
};

const J17: StepDef = {
  id: 'J17', title: 'student opens Lumière Guide and starts a conversation; the student message and local reply are stored with a hash chain', uses: ['app', 'db'], requires: ['J16'],
  async run(c) {
    const created = await c.post('studentA', CONV, { clientRequestId: c.newId(), title: 'University plans' });
    st(created, 201, 'create conversation');
    const convId = created.json.conversation.id as string;
    c.state.convId = convId;
    const rid = c.newId();
    const send = () => c.post('studentA', `${CONV}/${convId}/messages`, { clientRequestId: rid, message: 'I want to study communications after high school. How does transfer credit work?', language: 'en' });
    const r1 = await send();
    st(r1, 200, 'send');
    eq(r1.json.assistantMessage.mode, 'local', 'reply mode (students are never live-eligible)');
    const r2 = await send();
    eq(r2.json.replayed, true, 'retry replayed');
    eq(r2.json.assistantMessage.id, r1.json.assistantMessage.id, 'same assistant message');
    const [cnt] = await c.ops.sql<any>('select count(*)::int n from assistant_messages where conversation_id::text = $1', [convId]);
    eq(cnt?.n, 2, 'stored messages');
    const integ = c.okJson(await c.get('studentA', `${CONV}/${convId}/integrity`), 'integrity');
    check(integ.ok === true && integ.checked === 2, `integrity ${JSON.stringify(integ)}`);
    c.rec({ created: 201, storedMessages: 2, retryReplayed: true, integrityOk: true, mode: 'local', privileged: ['database count of assistant_messages'] });
  },
};

const J18: StepDef = {
  id: 'J18', title: "student attaches an existing Document (their verified transcript) to a message; another student's document is refused", uses: ['app', 'db', 'storage'], requires: ['J17'],
  async run(c) {
    const bDoc = await c.uploadDocument('studentB', c.state.bId, 'hs_transcript', 'other.pdf', documentPdf(`b-${c.runId}`));
    c.state.bDocId = bDoc.id;
    const convId = c.state.convId as string;
    const refused = await c.post('studentA', `${CONV}/${convId}/messages`, { clientRequestId: c.newId(), message: 'Here is a file', language: 'en', attachmentDocumentIds: [bDoc.id] });
    st(refused, 422, "attaching another student's document");
    const res = await c.post('studentA', `${CONV}/${convId}/messages`, { clientRequestId: c.newId(), message: 'Here is my school record for reference.', language: 'en', attachmentDocumentIds: [c.state.docVerifiedId] });
    st(res, 200, 'attach own document');
    eq(res.json.studentMessage.attachments.map((a: any) => a.documentId), [c.state.docVerifiedId], 'attachment ids');
    c.rec({ foreignDocument: 422, attached: true });
  },
};

const J19: StepDef = {
  id: 'J19', title: 'logout + return (real logout, fresh login): the conversation list, history, attachment reference and integrity are intact', uses: ['app', 'db', 'auth'], requires: ['J18'],
  async run(c) {
    const old = await c.s('studentA');
    const out = await c.auth.logout(old);
    st({ status: out.status } as HttpResult, 200, 'logout');
    const oldAgain = await c.http.app('GET', CONV, { session: old });
    c.observe('oldTokenAfterLogoutStatus', oldAgain.status);
    const fresh = await c.s('studentA', { force: true });
    const convId = c.state.convId as string;
    const list = c.okJson(await c.http.app('GET', CONV, { session: fresh }), 'list');
    eq(list.conversations[0].id, convId, 'newest conversation');
    const conv = c.okJson(await c.get('studentA', `${CONV}/${convId}`), 'conversation');
    eq(conv.messages.map((m: any) => m.role), ['student', 'assistant', 'student', 'assistant'], 'roles');
    eq(conv.messages[2].attachments[0].documentId, c.state.docVerifiedId, 'attachment kept');
    const integ = c.okJson(await c.get('studentA', `${CONV}/${convId}/integrity`), 'integrity');
    check(integ.ok === true && integ.checked === 4, `integrity ${JSON.stringify(integ)}`);
    c.rec({ resumed: true, messages: 4, attachmentKept: true, integrityOk: true, oldTokenAfterLogout: oldAgain.status });
  },
};

const J20: StepDef = {
  id: 'J20', title: "memory: the stated goal is remembered as student-reported with a source link; a later 'which universities did we discuss?' cites the earlier discussion; no official record changes", uses: ['app', 'db'], requires: ['J19'],
  async run(c) {
    const count = async () => (await c.ops.sql<any>('select count(*)::int n from student_hs_course_results').catch(() => [{ n: -1 }]))[0]!.n;
    const before = await count();
    const mem = c.okJson(await c.get('studentA', MEM), 'memory');
    const major = mem.items.find((i: any) => i.category === 'intended_major');
    check(major, `no intended_major memory: ${JSON.stringify(mem.items).slice(0, 300)}`);
    eq(major.basis, 'student_reported', 'memory basis');
    check(String(major.statement).toLowerCase().includes('communications'), 'memory statement');
    c.state.majorMemoryId = major.id;
    const c2 = c.okJson(await c.post('studentA', CONV, { clientRequestId: c.newId() }), 'conv2');
    const ask = c.okJson(await c.post('studentA', `${CONV}/${c2.conversation.id}/messages`, { clientRequestId: c.newId(), message: 'Which universities did we discuss for communications?', language: 'en' }), 'ask');
    const refs = ask.assistantMessage.privateRefs as { kind: string; path: string }[];
    check(refs.length > 0, `no private references: ${String(ask.assistantMessage.content).slice(0, 200)}`);
    check(refs.some((r) => r.kind === 'memory' || r.path.includes(`conversation=${c.state.convId}`)), 'reply does not cite the earlier discussion');
    eq(await count(), before, 'official course results table unchanged');
    const p = c.okJson(await c.get('studentA', '/api/student/academic-projection'), 'projection');
    eq(p.credits.total.officialHalfUnits, 3, 'official half-units unchanged');
    c.rec({ memoryCategory: major.category, basis: major.basis, privateRefs: refs.length, officialHalfUnitsUnchanged: 3, privileged: ['database count of student_hs_course_results'] });
  },
};

const J21: StepDef = {
  id: 'J21', title: 'global search: student finds own course, document, conversation and Billing; staff search returns students only', uses: ['app', 'db'], requires: ['J20'],
  async run(c) {
    const q = (text: string, who: 'studentA' | 'staff' | 'studentB') => c.get(who, `/api/search?q=${encodeURIComponent(text)}`);
    const conv = c.okJson(await q('communications', 'studentA'), 'search conversation');
    check(conv.results.some((x: any) => x.type === 'conversation' || x.type === 'memory'), 'no conversation/memory hit');
    check(c.okJson(await q('school-record', 'studentA'), 'search document').results.some((x: any) => x.type === 'document'), 'no document hit');
    check(c.okJson(await q('payment', 'studentA'), 'search billing').results.some((x: any) => x.path === '/billing'), 'no billing hit');
    const staff = c.okJson(await q('Synthetic', 'staff'), 'staff search');
    check(staff.results.length > 0 && staff.results.every((x: any) => x.type === 'student'), 'staff search is not students-only');
    check(!/communications/i.test(JSON.stringify(staff.results)), 'staff search exposes conversation content');
    c.rec({ conversationHit: true, documentHit: true, billingHit: true, staffOnlyStudents: true });
  },
};

const J22: StepDef = {
  id: 'J22', title: "another student cannot list, read, post to, search or attach into student A's conversations, memory or documents", uses: ['app', 'db'], requires: ['J21'],
  async run(c) {
    const convId = c.state.convId as string;
    st(await c.get('studentB', `${CONV}/${convId}`), 404, 'B reads A conversation');
    st(await c.post('studentB', `${CONV}/${convId}/messages`, { clientRequestId: c.newId(), message: 'hi', language: 'en' }), 404, 'B posts to A conversation');
    eq(c.okJson(await c.get('studentB', CONV), 'B list').conversations, [], 'B conversation list');
    eq(c.okJson(await c.get('studentB', `${CONV}/search?q=communications`), 'B search').hits, [], 'B conversation search');
    eq(c.okJson(await c.get('studentB', MEM), 'B memory').items, [], 'B memory');
    check(!JSON.stringify(c.okJson(await c.get('studentB', '/api/search?q=communications'), 'B global').results).includes(convId), 'B global search leaks A conversation');
    const oc = c.okJson(await c.post('studentB', CONV, { clientRequestId: c.newId() }), 'B conversation');
    st(await c.post('studentB', `${CONV}/${oc.conversation.id}/messages`, { clientRequestId: c.newId(), message: 'x', language: 'en', attachmentDocumentIds: [c.state.docVerifiedId] }), 422, "B attaches A's document");
    st(await c.get('staff', `${CONV}/${convId}`), 404, 'staff read of a student conversation');
    c.rec({ read: 404, post: 404, list: 0, search: 0, memory: 0, attachForeignDoc: 422, staffRead: 404 });
  },
};

const J23: StepDef = {
  id: 'J23', title: 'tamper evidence: a direct SQL edit of a stored message (trigger bypassed by the table owner) is detected by the integrity check', uses: ['app', 'db'], requires: ['J22'],
  async run(c) {
    const convId = c.state.convId as string;
    check(UUID_RE.test(convId), 'conversation id is not a uuid');
    await c.ops.sqlTx([
      'alter table assistant_messages disable trigger user',
      `update assistant_messages set content = 'tampered' where conversation_id::text = '${convId}' and seq = 1`,
      'alter table assistant_messages enable trigger user',
    ]);
    const integ = c.okJson(await c.get('studentA', `${CONV}/${convId}/integrity`), 'integrity');
    eq(integ.ok, false, 'integrity after tamper');
    eq(integ.problems[0].seq, 1, 'first problem seq');
    c.rec({ detected: true, problem: integ.problems[0].kind, privileged: ['database UPDATE with user triggers disabled (table-owner role required), in one transaction'] });
  },
};

// ── J24-J29 (S22 additions) ──────────────────────────────────────────────────────────────────────────────────────

const J24: StepDef = {
  id: 'J24', title: 'attachments in all 8 formats (pdf, docx, xlsx, csv, txt, jpg, png, webp): uploaded through the app to Storage, retrieved by signed URL and byte-compared', uses: ['app', 'db', 'auth', 'storage'], requires: ['J23'],
  async run(c) {
    const tag = c.runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const fixtures = attachmentFixtures(tag);
    const before = c.okJson(await c.get('studentA', '/api/student/attachments/policy'), 'policy before');
    check(fixtures.every((f) => before.types.some((t: any) => t.ext === f.ext)), 'policy does not list all 8 formats');
    const stored: Record<string, { id: string; storagePath: string }> = {};
    const perFormat: Record<string, unknown> = {};
    for (const f of fixtures) {
      const r = await c.chatUpload('studentA', f);
      eq(r.upStatus, 200, `${f.ext} upload-url`);
      check(r.storagePath!.startsWith(`students/${c.state.s1Code}/chat_attachment/`), `${f.ext} storage path outside the student prefix`);
      st(r.fin!, 201, `${f.ext} finalize`);
      const d = r.fin!.json.document;
      eq([d.mimeType, d.sizeBytes, d.source, d.extractionStatus], [f.mimeType, f.bytes.length, 'chat', f.expectExtraction], `${f.ext} stored attributes`);
      const dl = await c.downloadDocument('studentA', d.id);
      eq([dl.bytes.length, sha256(dl.bytes)], [f.bytes.length, sha256(f.bytes)], `${f.ext} downloaded bytes differ from the uploaded bytes`);
      stored[f.ext] = { id: d.id, storagePath: r.storagePath! };
      perFormat[f.ext] = { bytes: f.bytes.length, sha256: sha256(f.bytes).slice(0, 12), extraction: d.extractionStatus, byteIdentical: true };
    }
    c.state.chatDocs = stored;
    c.state.fixtures = fixtures;
    const list = c.okJson(await c.get('studentA', '/api/student/attachments/documents'), 'documents list');
    for (const f of fixtures) check(list.documents.some((d: any) => d.id === stored[f.ext]!.id), `${f.ext} missing from the selectable documents`);
    const txt = fixtures.find((f) => f.ext === 'txt')!;
    const found = c.okJson(await c.get('studentA', `/api/search?q=${encodeURIComponent(txt.marker!)}`), 'search extracted text');
    check(found.results.some((x: any) => x.type === 'document'), 'extracted text of the txt attachment is not searchable');
    const after = c.okJson(await c.get('studentA', '/api/student/attachments/policy'), 'policy after');
    check(after.usedBytes - before.usedBytes >= sum(fixtures.map((f) => f.bytes.length)), 'usedBytes did not grow by the uploaded size');

    const conv = c.okJson(await c.post('studentA', CONV, { clientRequestId: c.newId(), title: 'S22 attachments' }), 'attachment conversation');
    c.state.attConvId = conv.conversation.id;
    const ids = (exts: string[]) => exts.map((e) => stored[e]!.id);
    const m1 = c.okJson(await c.post('studentA', `${CONV}/${conv.conversation.id}/messages`, { clientRequestId: c.newId(), message: 'Here are my notes and spreadsheets.', language: 'en', attachmentDocumentIds: ids(['pdf', 'docx', 'xlsx', 'csv', 'txt']) }), 'message with 5 attachments');
    // The API does not promise to echo attachments in selection order (observed: ordered by document id), so compare as sets.
    const sorted = (xs: string[]) => [...xs].sort();
    eq(sorted(m1.studentMessage.attachments.map((a: any) => a.documentId)), sorted(ids(['pdf', 'docx', 'xlsx', 'csv', 'txt'])), 'first message attachments');
    c.observe('attachmentOrderPreserved', JSON.stringify(m1.studentMessage.attachments.map((a: any) => a.documentId)) === JSON.stringify(ids(['pdf', 'docx', 'xlsx', 'csv', 'txt'])));
    const m2 = c.okJson(await c.post('studentA', `${CONV}/${conv.conversation.id}/messages`, { clientRequestId: c.newId(), message: 'And three pictures.', language: 'en', attachmentDocumentIds: ids(['jpg', 'png', 'webp']) }), 'message with 3 images');
    eq(m2.studentMessage.attachments.length, 3, 'second message attachments');
    const six = await c.post('studentA', `${CONV}/${conv.conversation.id}/messages`, { clientRequestId: c.newId(), message: 'Too many', language: 'en', attachmentDocumentIds: [...ids(['pdf', 'docx', 'xlsx', 'csv', 'txt', 'jpg'])] });
    st(six, [400, 422], 'more than 5 attachments in one message');
    c.rec({ formats: fixtures.length, perFormat, usedBytesGrowth: after.usedBytes - before.usedBytes, attachedInMessages: 8, sixAttachmentsRefused: six.status, extractedTextSearchable: true });
  },
};

const J25: StepDef = {
  id: 'J25', title: 'rejected uploads are refused and leave nothing behind: executable renamed .pdf, oversize, mime mismatch, bad names, forged storage paths', uses: ['app', 'db', 'storage'], requires: ['J24'],
  async run(c) {
    const used = async () => c.okJson(await c.get('studentA', '/api/student/attachments/policy'), 'policy').usedBytes as number;
    const docCount = async () => (c.okJson(await c.get('studentA', '/api/student/attachments/documents'), 'documents').documents as any[]).length;
    const usedBefore = await used(); const docsBefore = await docCount();
    const results: Record<string, unknown> = {};

    const uploaded = async (label: string, f: { fileName: string; mimeType: string; bytes: Buffer }, codes: string[]) => {
      const r = await c.chatUpload('studentA', f);
      eq(r.upStatus, 200, `${label}: upload-url`);
      st(r.fin!, 415, `${label}: finalize`);
      inSet(r.fin!.json?.code, codes, `${label}: code`);
      const exists = await c.ops.storageObjectExists(r.storagePath!);
      if (exists === null) c.skipCheck(`${label}: object removed from Storage`, 'the privileged backend cannot list Storage');
      else eq(exists, false, `${label}: the rejected object must be deleted from Storage`);
      results[label] = { status: 415, code: r.fin!.json?.code, objectRemovedFromStorage: exists === null ? 'unknown' : !exists };
    };
    await uploaded('exe renamed .pdf', { fileName: 's22-report.pdf', mimeType: 'application/pdf', bytes: EXE_AS_PDF }, ['content_mismatch']);
    await uploaded('png bytes named .jpg', { fileName: 's22-picture.jpg', mimeType: 'image/jpeg', bytes: PNG_8X8 }, ['content_mismatch']);
    await uploaded('text bytes named .docx', { fileName: 's22-essay.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: TEXT_AS_DOCX }, ['content_mismatch', 'malformed']);

    const preflight = async (label: string, body: Record<string, unknown>, status: number, codes: string[]) => {
      const r = await c.post('studentA', '/api/student/attachments/upload-url', body);
      st(r, status, label);
      inSet(r.json?.code, codes, `${label}: code`);
      results[label] = { status: r.status, code: r.json?.code };
    };
    await preflight('oversize pdf (20 MB + 1)', { fileName: 's22-big.pdf', sizeBytes: 20 * 1024 * 1024 + 1, mimeType: 'application/pdf' }, 413, ['too_large']);
    await preflight('oversize image (10 MB + 1)', { fileName: 's22-big.png', sizeBytes: 10 * 1024 * 1024 + 1, mimeType: 'image/png' }, 413, ['too_large']);
    await preflight('mime mismatch (.pdf declared image/png)', { fileName: 's22-x.pdf', sizeBytes: 100, mimeType: 'image/png' }, 415, ['mime_mismatch']);
    await preflight('executable extension', { fileName: 's22-setup.exe', sizeBytes: 100, mimeType: 'application/x-msdownload' }, 415, ['unsupported_type']);
    await preflight('double extension', { fileName: 's22-invoice.exe.pdf', sizeBytes: 100, mimeType: 'application/pdf' }, 400, ['invalid_file_name']);
    await preflight('path traversal in name', { fileName: '../../etc/passwd.pdf', sizeBytes: 100, mimeType: 'application/pdf' }, 400, ['invalid_file_name']);
    await preflight('zero bytes', { fileName: 's22-empty.pdf', sizeBytes: 0, mimeType: 'application/pdf' }, 400, ['invalid_request', 'empty_file']);

    const fin = async (label: string, storagePath: string, status: number, codes: string[]) => {
      const r = await c.post('studentA', '/api/student/attachments/finalize', { storagePath, fileName: 's22-forged.pdf' });
      st(r, status, label);
      inSet(r.json?.code, codes, `${label}: code`);
      results[label] = { status: r.status, code: r.json?.code };
    };
    await fin("finalize with another student's storage path", `students/${c.state.bCode}/chat_attachment/${Date.now()}_forged.pdf`, 400, ['invalid_storage_path']);
    await fin('finalize a path that was never uploaded', `students/${c.state.s1Code}/chat_attachment/${Date.now()}_never_uploaded.pdf`, 400, ['not_uploaded']);
    await fin('finalize with a traversal path', `students/${c.state.s1Code}/chat_attachment/../${c.state.bCode}/x.pdf`, 400, ['invalid_storage_path']);

    const gen = await c.post('studentA', `/api/documents/student/${c.state.s1Id}/upload-url`, { doc_type: 'chat_attachment', file_name: 'x.pdf', file_size: 100, mime_type: 'application/pdf' });
    st(gen, 400, 'Documents route cannot mint chat_attachment rows');
    const genExe = await c.post('studentA', `/api/documents/student/${c.state.s1Id}/upload-url`, { doc_type: 'other', file_name: 'x.exe', file_size: 100, mime_type: 'application/x-msdownload' });
    st(genExe, 400, 'Documents route refuses an executable mime type');
    st(await c.http.app('POST', '/api/student/attachments/upload-url', { json: { fileName: 'a.pdf', sizeBytes: 10, mimeType: 'application/pdf' } }), 401, 'unauthenticated upload-url');
    st(await c.http.app('POST', '/api/student/attachments/upload-url', { session: await c.s('studentA'), noCsrf: true, json: { fileName: 'a.pdf', sizeBytes: 10, mimeType: 'application/pdf' } }), 403, 'upload-url without CSRF token');

    eq(await docCount(), docsBefore, 'rejected uploads must not create documents');
    eq(await used(), usedBefore, 'rejected uploads must not consume quota');
    c.rec({ rejections: Object.keys(results).length, results, documentsUnchanged: true, quotaUnchanged: true, documentsRouteHardened: true, unauthenticated: 401, missingCsrf: 403, privileged: ['Storage list (service role) to confirm rejected objects were deleted'] });
  },
};

const J26: StepDef = {
  id: 'J26', title: 'profile photo: upload (png), fetch by signed URL and byte-compare; replacement removes the old object; invalid/oversize/foreign uploads refused', uses: ['app', 'db', 'storage'], requires: ['J24'],
  async run(c) {
    const sid = c.state.s1Id as string;
    const photoForm = (bytes: Buffer, mime: string, name: string) => { const fd = new FormData(); fd.append('photo', new Blob([new Uint8Array(bytes)], { type: mime }), name); return fd; };
    const up = await c.form('studentA', `/api/students/${sid}/photo`, photoForm(PNG_8X8, 'image/png', 'avatar.png'));
    st(up, 200, 'photo upload');
    const url1 = up.json.photoUrl as string;
    check(typeof url1 === 'string' && url1.startsWith('http'), 'photoUrl is not a signed URL');
    const got1 = await c.http.external('GET', url1);
    st(got1, 200, 'fetch photo by signed URL');
    eq(sha256(got1.bytes), sha256(PNG_8X8), 'photo bytes (png)');
    c.state.photoPath = /student-documents\/(profile-photos\/[^?]+)/.exec(url1)?.[1] ?? null;
    check(c.state.photoPath, 'could not derive the photo storage path from the signed URL');
    c.track('storagePaths', c.state.photoPath);
    const me = c.okJson(await c.get('studentA', '/api/students/me'), 'students/me');
    check(typeof me.photo_url === 'string' && me.photo_url.startsWith('http'), '/api/students/me does not resolve the photo reference to a signed URL');
    eq(sha256((await c.http.external('GET', me.photo_url)).bytes), sha256(PNG_8X8), 'photo bytes via /api/students/me');
    eq(c.okJson(await c.get('studentA', '/api/student/welcome'), 'welcome').photo, true, 'welcome.photo');

    const up2 = await c.form('studentA', `/api/students/${sid}/photo`, photoForm(WEBP_8X8, 'image/webp', 'avatar.webp'));
    st(up2, 200, 'photo replacement');
    const got2 = await c.http.external('GET', up2.json.photoUrl);
    eq(sha256(got2.bytes), sha256(WEBP_8X8), 'replacement photo bytes (webp)');
    const oldGone = await c.http.external('GET', url1);
    check(oldGone.status !== 200, 'the replaced photo object is still downloadable');
    const jpg = await c.form('studentA', `/api/students/${sid}/photo`, photoForm(JPEG_8X8, 'image/jpeg', 'avatar.jpg'));
    st(jpg, 200, 'jpeg photo');
    eq(sha256((await c.http.external('GET', jpg.json.photoUrl)).bytes), sha256(JPEG_8X8), 'jpeg photo bytes');

    st(await c.form('studentA', `/api/students/${sid}/photo`, photoForm(SVG_AS_PNG, 'image/png', 'evil.png')), 400, 'svg declared png');
    st(await c.form('studentA', `/api/students/${sid}/photo`, photoForm(JPEG_8X8, 'image/png', 'lie.png')), 400, 'jpeg declared png');
    st(await c.form('studentA', `/api/students/${sid}/photo`, photoForm(OVERSIZE_PHOTO, 'image/png', 'big.png')), [400, 413], 'photo over 5 MB');
    st(await c.form('studentB', `/api/students/${sid}/photo`, photoForm(PNG_8X8, 'image/png', 'b.png')), 403, "B uploads A's photo");
    st(await c.http.app('POST', `/api/students/${sid}/photo`, { form: photoForm(PNG_8X8, 'image/png', 'anon.png') }), 401, 'unauthenticated photo upload');
    c.state.photoPath = /student-documents\/(profile-photos\/[^?]+)/.exec(jpg.json.photoUrl)?.[1] ?? c.state.photoPath;
    c.track('storagePaths', c.state.photoPath);
    c.rec({ pngByteIdentical: true, viaStudentsMe: true, welcomePhoto: true, replacementByteIdentical: true, oldObjectNotDownloadable: oldGone.status, jpegByteIdentical: true, rejected: { svgAsPng: 400, jpegAsPng: 400, oversize: 'refused', foreignUpload: 403, unauthenticated: 401 } });
  },
};

const J27: StepDef = {
  id: 'J27', title: "cross-account storage isolation: student B cannot obtain A's signed URLs, object paths, photo or storage objects (API and direct Storage)", uses: ['app', 'db', 'auth', 'storage'], requires: ['J26'],
  async run(c) {
    const sid = c.state.s1Id as string;
    const docs = c.state.chatDocs as Record<string, { id: string; storagePath: string }>;
    // control: A can download (so the negative checks below are not vacuous)
    const control = await c.downloadDocument('studentA', docs.pdf!.id);
    check(control.bytes.length > 0, 'control download failed');
    const checked: string[] = [];
    for (const [ext, d] of Object.entries(docs)) {
      const r = await c.get('studentB', `/api/documents/${d.id}`);
      check(r.status >= 403 && !r.text.includes('download_url') && !r.text.includes(d.storagePath), `B received ${ext} data (${r.status})`);
      checked.push(ext);
    }
    const vd = await c.get('studentB', `/api/documents/${c.state.docVerifiedId}`);
    check(vd.status >= 403 && !vd.text.includes('download_url'), "B received A's verified document");
    st(await c.get('studentB', `/api/documents/student/${sid}`), 403, "B lists A's documents");
    st(await c.get('studentB', `/api/students/${sid}`), 403, "B reads A's student record");
    st(await c.get('studentB', `/api/students/${sid}/profile`), 403, "B reads A's profile");
    const fin = await c.post('studentB', '/api/student/attachments/finalize', { storagePath: docs.pdf!.storagePath, fileName: 's22-synthetic-notes.pdf' });
    st(fin, 400, "B finalizes A's storage path");
    eq(fin.json?.code, 'invalid_storage_path', 'code');
    const conv = c.okJson(await c.post('studentB', CONV, { clientRequestId: c.newId() }), 'B conversation');
    st(await c.post('studentB', `${CONV}/${conv.conversation.id}/messages`, { clientRequestId: c.newId(), message: 'x', language: 'en', attachmentDocumentIds: [docs.png!.id] }), 422, "B attaches A's chat attachment");
    st(await c.get('studentB', `${CONV}/${c.state.attConvId}`), 404, "B reads A's attachment conversation");
    const bList = c.okJson(await c.get('studentB', '/api/student/attachments/documents'), 'B documents');
    check(!JSON.stringify(bList).includes(docs.pdf!.id), "A's attachment appears in B's selectable documents");

    const sb = c.target.mode === 'hosted' ? c.target.supabaseUrl : null;
    const anon = c.state.anonKey as string | undefined;
    if (c.caps.directStorage && sb && anon) {
      const bTok = (await c.s('studentB')).bearer;
      const aPaths = [...Object.values(docs).map((d) => d.storagePath), c.state.photoPath as string].filter(Boolean);
      const direct: Record<string, number[]> = { anonymousPublicUrl: [], studentBAuthenticatedObject: [], studentBAuthenticatedEndpoint: [] };
      for (const p of aPaths) {
        const a = await c.http.external('GET', `${sb}/storage/v1/object/public/student-documents/${p}`);
        const b = await c.http.external('GET', `${sb}/storage/v1/object/student-documents/${p}`, { headers: { apikey: anon, authorization: `Bearer ${bTok}` } });
        const d = await c.http.external('GET', `${sb}/storage/v1/object/authenticated/student-documents/${p}`, { headers: { apikey: anon, authorization: `Bearer ${bTok}` } });
        direct.anonymousPublicUrl!.push(a.status); direct.studentBAuthenticatedObject!.push(b.status); direct.studentBAuthenticatedEndpoint!.push(d.status);
        check(a.status !== 200 && b.status !== 200 && d.status !== 200, `direct Storage read of ${p} succeeded (public ${a.status}, object ${b.status}, authenticated ${d.status}): the bucket is not private`);
      }
      const list = await c.http.external('POST', `${sb}/storage/v1/object/list/student-documents`, { headers: { apikey: anon, authorization: `Bearer ${bTok}`, 'content-type': 'application/json' }, body: JSON.stringify({ prefix: `students/${c.state.s1Code}/chat_attachment`, limit: 100 }) });
      check(!list.ok || (Array.isArray(list.json) && list.json.length === 0), `student B listed A's storage prefix: ${list.text.slice(0, 120)}`);
      const probePath = `students/${c.state.s1Code}/chat_attachment/${Date.now()}_s22-b-write-probe.txt`;
      c.track('storagePaths', probePath);
      const write = await c.http.external('POST', `${sb}/storage/v1/object/student-documents/${probePath}`, { headers: { apikey: anon, authorization: `Bearer ${bTok}`, 'content-type': 'text/plain' }, body: 's22 isolation probe' });
      check(!write.ok, `student B wrote into A's storage prefix (${write.status})`);
      c.rec({ directStorageProbes: aPaths.length, direct, listPrefixByB: list.ok ? 'empty' : list.status, writeIntoPrefixByB: write.status });
    } else {
      c.skipCheck('direct Supabase Storage probes (anonymous public URL, B authenticated read/list/write)', 'needs the real project URL and anon key; only a hosted run can perform them');
    }
    c.rec({ documentsChecked: checked.length + 1, apiDenied: true, finalizeForeignPath: 400, attachForeign: 422, controlDownloadByA: control.bytes.length > 0 });
  },
};

const J28: StepDef = {
  id: 'J28', title: 'memory correction + retraction persist across a fresh login; superseded and retracted memory is not used or shown as active; B cannot touch A memory', uses: ['app', 'db', 'auth'], requires: ['J20'],
  async run(c) {
    const oldId = c.state.majorMemoryId as string;
    const corrected = await c.post('studentA', `${MEM}/${oldId}/correct`, { statement: 'I want to study journalism after high school.' });
    st(corrected, 200, 'correct');
    const newId = corrected.json.item.id as string;
    check(newId !== oldId, 'a correction must create a new version');
    eq(corrected.json.item.status, 'active', 'corrected item status');
    const list1 = c.okJson(await c.get('studentA', MEM), 'memory after correction').items as any[];
    eq(list1.find((i) => i.id === oldId)?.status, 'superseded', 'old version');
    eq(list1.find((i) => i.id === newId)?.status, 'active', 'new version');
    check((list1.find((i) => i.id === newId)?.sources ?? []).length > 0, 'corrected memory has no source');
    st(await c.post('studentB', `${MEM}/${newId}/correct`, { statement: 'tampered by B' }), 404, 'B corrects A memory');
    st(await c.post('studentB', `${MEM}/${newId}/retract`), 404, 'B retracts A memory');
    const retracted = await c.post('studentA', `${MEM}/${newId}/retract`);
    st(retracted, 200, 'retract');
    eq(retracted.json.item.status, 'retracted', 'retracted item status');
    st(await c.post('studentA', `${MEM}/${newId}/retract`), 200, 'retract is idempotent');

    const fresh = await c.auth.logout(await c.s('studentA'));
    st({ status: fresh.status } as HttpResult, 200, 'logout');
    await c.s('studentA', { force: true });
    const list2 = c.okJson(await c.get('studentA', MEM), 'memory after fresh login').items as any[];
    eq(list2.find((i) => i.id === oldId)?.status, 'superseded', 'old version after fresh login');
    eq(list2.find((i) => i.id === newId)?.status, 'retracted', 'new version after fresh login');
    check(!list2.some((i) => i.category === 'intended_major' && i.status === 'active'), 'a retracted/superseded major is shown as active');
    const c3 = c.okJson(await c.post('studentA', CONV, { clientRequestId: c.newId() }), 'conv');
    const ask = c.okJson(await c.post('studentA', `${CONV}/${c3.conversation.id}/messages`, { clientRequestId: c.newId(), message: 'Which universities did we discuss for communications?', language: 'en' }), 'ask');
    const refs = (ask.assistantMessage.privateRefs ?? []) as { path: string }[];
    check(!refs.some((r) => r.path.includes(`memory=${newId}`) || r.path.includes(`memory=${oldId}`)), 'a retracted or superseded memory was cited');
    const p = c.okJson(await c.get('studentA', '/api/student/academic-projection'), 'projection');
    eq(p.credits.total.officialHalfUnits, 3, 'official record unchanged');
    c.rec({ corrected: 200, versions: 'old superseded, new active -> retracted', persistedAcrossFreshLogin: true, retractedNotCited: true, foreignCorrect: 404, foreignRetract: 404, officialHalfUnitsUnchanged: 3 });
  },
};

const J29: StepDef = {
  id: 'J29', title: 'conversation reopening after logout/login: history, attachments, order and integrity intact; tampered conversation still flagged; chat continues on the same chain', uses: ['app', 'db', 'auth', 'storage'], requires: ['J24'],
  async run(c) {
    const old = await c.s('studentA');
    st({ status: (await c.auth.logout(old)).status } as HttpResult, 200, 'logout');
    const oldAgain = await c.http.app('GET', CONV, { session: old });
    c.observe('oldTokenAfterLogoutStatus', oldAgain.status);
    await c.s('studentA', { force: true });
    const attId = c.state.attConvId as string; const convId = c.state.convId as string;
    const list = c.okJson(await c.get('studentA', CONV), 'conversation list').conversations as any[];
    check(list.some((x) => x.id === attId) && list.some((x) => x.id === convId), 'conversations missing after login');
    const conv = c.okJson(await c.get('studentA', `${CONV}/${attId}`), 'attachment conversation');
    eq(conv.messages.map((m: any) => m.role), ['student', 'assistant', 'student', 'assistant'], 'roles');
    eq([conv.messages[0].attachments.length, conv.messages[2].attachments.length], [5, 3], 'attachments per message');
    const docs = c.state.chatDocs as Record<string, { id: string }>;
    eq(conv.messages[0].attachments.map((a: any) => a.documentId).sort(), ['pdf', 'docx', 'xlsx', 'csv', 'txt'].map((e) => docs[e]!.id).sort(), 'attachments of the first message');
    const pdf = (c.state.fixtures as any[]).find((f) => f.ext === 'pdf');
    const dl = await c.downloadDocument('studentA', docs.pdf!.id);
    eq(sha256(dl.bytes), sha256(pdf.bytes), 'attachment bytes after re-login');
    const integ = c.okJson(await c.get('studentA', `${CONV}/${attId}/integrity`), 'integrity');
    check(integ.ok === true && integ.checked === 4, `integrity ${JSON.stringify(integ)}`);
    const tampered = c.okJson(await c.get('studentA', `${CONV}/${convId}/integrity`), 'tampered integrity');
    eq(tampered.ok, false, 'tampered conversation still flagged');
    const cont = c.okJson(await c.post('studentA', `${CONV}/${attId}/messages`, { clientRequestId: c.newId(), message: 'Thanks, continuing after logging back in.', language: 'en' }), 'continue');
    eq(cont.studentMessage.seq, 5, 'continued sequence number');
    const integ2 = c.okJson(await c.get('studentA', `${CONV}/${attId}/integrity`), 'integrity after continue');
    check(integ2.ok === true && integ2.checked === 6, `integrity after continue ${JSON.stringify(integ2)}`);
    st(await c.get('studentB', `${CONV}/${attId}`), 404, 'B reads the conversation');
    const hits = c.okJson(await c.get('studentA', `${CONV}/search?q=pictures`), 'conversation search').hits as any[];
    check(hits.some((h) => h.conversationId === attId), 'conversation search does not find the reopened conversation');
    c.rec({ reopened: true, messages: 4, attachmentsPerMessage: [5, 3], bytesAfterRelogin: 'identical', integrityOk: true, tamperStillFlagged: true, continuedSeq: 5, integrityAfterContinue: 6, oldTokenAfterLogout: oldAgain.status });
  },
};

export const STEPS: StepDef[] = [P0, P1, J1, J2, J3, J4, J5, J6, J7, J8, J9, J10, J11, J12, J13, J14, J15, J16, J17, J18, J19, J20, J21, J22, J23, J24, J25, J26, J27, J28, J29];
