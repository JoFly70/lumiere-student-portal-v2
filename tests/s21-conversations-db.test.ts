/**
 * S21 - assistant conversations against a REAL Postgres 16 (throwaway cluster, every repo migration applied).
 */
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedStudent, seedUser, startLocalPg, type LocalPg, type SeededUser,
} from './helpers/s05-local-pg';
import { createAssistantConversationsRouter } from '../server/routes/assistant-conversations';
import type { GenerateReplyFn } from '../server/services/assistant-conversations/reply';
import { createConversationService } from '../server/services/assistant-conversations/service';

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

describe.skipIf(!PG_BINARIES_AVAILABLE)('S21 assistant conversations (real Postgres)', () => {
  let pg: LocalPg;
  let client: postgres.Sql;
  let database: any;
  let alice: SeededUser, bob: SeededUser, admin: SeededUser, staff: SeededUser;
  let aliceDocs: string[] = [];
  let bobDoc = '';
  let aliceStaffOnlyDoc = '';
  let aliceDeletedDoc = '';
  let failReply = false;
  const replyCalls: Array<{ turns: number; message: string }> = [];
  const logs: any[] = [];

  const generateReply: GenerateReplyFn = async (a) => {
    replyCalls.push({ turns: a.recentTurns.length, message: a.message });
    if (failReply) throw new Error('provider down');
    return { content: `echo: ${a.message}`, mode: 'local', sources: [{ title: 'S', url: 'https://x.test', verifiedAt: null }], links: [{ label: 'Roadmap', path: '/roadmap' }], notice: null, privateRefs: [] };
  };

  function makeApp(extra: Parameters<typeof createAssistantConversationsRouter>[0] = {}) {
    const app = express();
    app.use(express.json());
    const service = createConversationService({
      database, generateReply, checkpointEvery: 4,
      logger: { info: (m: string, meta?: any) => logs.push({ m, ...meta }), warn: () => {}, error: () => {} } as any,
    });
    app.use('/c', createAssistantConversationsRouter({
      service, rateLimitPerMinute: 1000,
      auth: (req, res, next) => {
        const id = req.header('x-user');
        const u = [alice, bob, admin, staff].find((x) => x.id === id);
        if (!u) return res.status(401).json({ error: 'auth' });
        req.user = { id: u.id, email: u.email, role: u.role } as any;
        next();
      },
      csrf: (req, res, next) => (req.header('x-csrf-token') === 'ok' ? next() : res.status(403).json({ error: 'csrf' })),
      ...extra,
    }));
    return app;
  }
  const as = (app: express.Express, u: SeededUser) => ({
    get: (p: string) => request(app).get(`/c${p}`).set('x-user', u.id),
    post: (p: string, b?: any) => request(app).post(`/c${p}`).set('x-user', u.id).set('x-csrf-token', 'ok').send(b ?? {}),
    patch: (p: string, b?: any) => request(app).patch(`/c${p}`).set('x-user', u.id).set('x-csrf-token', 'ok').send(b ?? {}),
  });
  const newConv = async (app: express.Express, u: SeededUser, title?: string) =>
    (await as(app, u).post('/', { clientRequestId: randomUUID(), title })).body.conversation.id as string;
  const send = (app: express.Express, u: SeededUser, id: string, message: string, extra: any = {}) =>
    as(app, u).post(`/${id}/messages`, { clientRequestId: randomUUID(), message, language: 'en', ...extra });
  async function tamper(stmt: string) {
    await pg.sql(`ALTER TABLE assistant_messages DISABLE TRIGGER USER; ${stmt}; ALTER TABLE assistant_messages ENABLE TRIGGER USER;`);
  }
  const integrity = async (app: express.Express, u: SeededUser, id: string) => (await as(app, u).get(`/${id}/integrity`)).body;

  beforeAll(async () => {
    pg = await startLocalPg();
    client = postgres(pg.url, { max: 20, onnotice: () => {} });
    database = drizzle(client);
    alice = await seedUser(pg, 'student', 'alice');
    bob = await seedUser(pg, 'student', 'bob');
    admin = await seedUser(pg, 'admin');
    staff = await seedUser(pg, 'staff');
    const sa = await seedStudent(pg, { userId: alice.id });
    const sb = await seedStudent(pg, { userId: bob.id });
    await pg.sql('ALTER TABLE student_documents ADD COLUMN IF NOT EXISTS size_bytes bigint');
    const doc = async (studentId: string, name: string, extra = '', size = 1000) => {
      const [r] = await pg.client`
        INSERT INTO student_documents (student_id, doc_type, file_name, url, storage_path, size_bytes)
        VALUES (${studentId}, 'other', ${name}, 'u', ${`p/${randomUUID()}`}, ${size}) RETURNING id`;
      if (extra) await pg.sql(`UPDATE student_documents SET ${extra} WHERE id = '${r.id}'`);
      return r.id as string;
    };
    for (let i = 0; i < 6; i++) aliceDocs.push(await doc(sa.id, `a${i}.pdf`));
    bobDoc = await doc(sb.id, 'bob.pdf');
    aliceStaffOnlyDoc = await doc(sa.id, 'internal.pdf', "visibility = 'staff_only'");
    aliceDeletedDoc = await doc(sa.id, 'gone.pdf', 'soft_deleted = true');
  }, 300_000);

  afterAll(async () => {
    await client?.end({ timeout: 5 });
    await pg?.stop();
  });

  it('creates, appends, lists, resumes after "logout" with a fresh router, and is idempotent on create', async () => {
    const app1 = makeApp();
    const crid = randomUUID();
    const c1 = await as(app1, alice).post('/', { clientRequestId: crid, title: 'Transfer questions' });
    const c2 = await as(app1, alice).post('/', { clientRequestId: crid, title: 'ignored' });
    expect(c1.status).toBe(201);
    expect(c2.body.conversation.id).toBe(c1.body.conversation.id);
    const id = c1.body.conversation.id;
    const r = await send(app1, alice, id, 'How does the roadmap work?', { attachmentDocumentIds: [aliceDocs[0]] });
    expect(r.status).toBe(200);
    expect(r.body.replayed).toBe(false);
    expect(r.body.studentMessage).toMatchObject({ seq: 1, role: 'student', language: 'en' });
    expect(r.body.studentMessage.attachments[0]).toMatchObject({ documentId: aliceDocs[0], fileName: 'a0.pdf' });
    expect(r.body.assistantMessage).toMatchObject({ seq: 2, role: 'assistant', mode: 'local' });
    expect(r.body.assistantMessage.links[0].path).toBe('/roadmap');
    expect(r.body.studentMessage).not.toHaveProperty('replyToMessageId');

    const app2 = makeApp(); // new router instance == new session
    const list = await as(app2, alice).get('/');
    expect(list.body.conversations[0]).toMatchObject({ id, title: 'Transfer questions', archived: false, messageCount: 2 });
    expect(list.body.conversations[0].lastMessagePreview).toContain('echo:');
    const full = await as(app2, alice).get(`/${id}`);
    expect(full.body.messages.map((m: any) => m.seq)).toEqual([1, 2]);
    expect((await integrity(app2, alice, id))).toMatchObject({ ok: true, checked: 2, problems: [] });
  });

  it('validates input and requires csrf', async () => {
    const app = makeApp();
    const id = await newConv(app, alice);
    expect((await request(app).post(`/c/${id}/messages`).set('x-user', alice.id).send({})).status).toBe(403);
    expect((await as(app, alice).post(`/${id}/messages`, { clientRequestId: 'nope', message: 'x', language: 'en' })).status).toBe(400);
    expect((await as(app, alice).post(`/${id}/messages`, { clientRequestId: randomUUID(), message: 'x', language: 'de' })).status).toBe(400);
    expect((await as(app, alice).post(`/${id}/messages`, { clientRequestId: randomUUID(), message: 'x'.repeat(2001), language: 'en' })).status).toBe(400);
    expect((await as(app, alice).get('/search?q=a')).status).toBe(400);
    expect((await as(app, alice).get('/not-a-uuid')).status).toBe(404);
  });

  it('rename, archive keeps messages, unarchive, archived rejects new posts', async () => {
    const app = makeApp();
    const id = await newConv(app, alice, 'Old');
    await send(app, alice, id, 'one');
    expect((await as(app, alice).patch(`/${id}`, { title: 'Renamed' })).body.conversation.title).toBe('Renamed');
    expect((await as(app, alice).patch(`/${id}`, { title: '' })).status).toBe(400);
    logs.length = 0;
    const arch = await as(app, alice).post(`/${id}/archive`);
    expect(arch.body.conversation.archived).toBe(true);
    expect(logs.some((l) => l.m === 'assistant_integrity_checkpoint' && l.seq === 2)).toBe(true);
    expect((await as(app, alice).get('/')).body.conversations.find((c: any) => c.id === id)).toBeUndefined();
    expect((await as(app, alice).get('/?archived=true')).body.conversations.some((c: any) => c.id === id)).toBe(true);
    expect((await as(app, alice).get(`/${id}`)).body.messages).toHaveLength(2);
    const blocked = await send(app, alice, id, 'two');
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('archived');
    expect((await as(app, alice).post(`/${id}/unarchive`)).body.conversation.archived).toBe(false);
    expect((await send(app, alice, id, 'two')).status).toBe(200);
    const [{ n }] = await pg.sql(`SELECT count(*)::int AS n FROM assistant_audit_events WHERE conversation_id = '${id}' AND event_type IN ('conversation_renamed','conversation_archived','conversation_unarchived')`);
    expect(n).toBe(3);
  });

  it('searches the owner messages only (including archived)', async () => {
    const app = makeApp();
    const a = await newConv(app, alice, 'Searchable');
    const b = await newConv(app, bob, 'Bob chat');
    await send(app, alice, a, 'quantum chemistry prerequisites');
    await send(app, bob, b, 'quantum secrets of bob');
    await as(app, alice).post(`/${a}/archive`);
    const hits = (await as(app, alice).get('/search?q=quantum')).body.hits;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h: any) => h.conversationId === a)).toBe(true);
    expect(hits[0]).toMatchObject({ conversationTitle: 'Searchable' });
    expect(hits[0].snippet).toContain('quantum');
    expect(JSON.stringify(hits)).not.toContain('bob');
    expect((await as(app, bob).get('/search?q=chemistry')).body.hits).toEqual([]);
  });

  it('replay returns the same pair without new rows; a failed reply is retried with only the reply generated', async () => {
    const app = makeApp();
    const id = await newConv(app, alice);
    const body = { clientRequestId: randomUUID(), message: 'replay me', language: 'fr' };
    const first = await as(app, alice).post(`/${id}/messages`, body);
    const callsBefore = replyCalls.length;
    const again = await as(app, alice).post(`/${id}/messages`, body);
    expect(again.body.replayed).toBe(true);
    expect(again.body.studentMessage.id).toBe(first.body.studentMessage.id);
    expect(again.body.assistantMessage.id).toBe(first.body.assistantMessage.id);
    expect(replyCalls.length).toBe(callsBefore);
    expect((await pg.sql(`SELECT count(*)::int AS n FROM assistant_messages WHERE conversation_id = '${id}'`))[0].n).toBe(2);

    failReply = true;
    const body2 = { clientRequestId: randomUUID(), message: 'will fail', language: 'en' };
    const failed = await as(app, alice).post(`/${id}/messages`, body2);
    failReply = false;
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe('unavailable');
    expect((await pg.sql(`SELECT count(*)::int AS n FROM assistant_messages WHERE conversation_id = '${id}'`))[0].n).toBe(3);
    const retry = await as(app, alice).post(`/${id}/messages`, body2);
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(false);
    expect(retry.body.studentMessage.seq).toBe(3);
    expect(retry.body.assistantMessage.seq).toBe(4);
    expect((await pg.sql(`SELECT count(*)::int AS n FROM assistant_messages WHERE conversation_id = '${id}' AND role = 'student'`))[0].n).toBe(2);
    expect(await integrity(app, alice, id)).toMatchObject({ ok: true, checked: 4 });
  });

  it('passes at most 6 recent turns, from the database', async () => {
    const app = makeApp();
    const id = await newConv(app, alice);
    for (let i = 0; i < 6; i++) await send(app, alice, id, `turn ${i}`);
    expect(replyCalls[replyCalls.length - 1]).toMatchObject({ turns: 6, message: 'turn 5' });
  });

  it('afterStudentMessage hook runs once per new message and its failure does not break the post', async () => {
    const hook = vi.fn().mockRejectedValue(new Error('boom'));
    const app = makeApp({ service: undefined as any, database, generateReply, afterStudentMessage: hook });
    const id = await newConv(app, alice);
    const body = { clientRequestId: randomUUID(), message: 'hooked', language: 'en' };
    expect((await as(app, alice).post(`/${id}/messages`, body)).status).toBe(200);
    expect((await as(app, alice).post(`/${id}/messages`, body)).body.replayed).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0][0]).toMatchObject({ ownerUserId: alice.id, conversationId: id, content: 'hooked' });
  });

  it('10 concurrent posts get distinct consecutive seqs and a valid chain', async () => {
    const app = makeApp();
    const id = await newConv(app, alice);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => send(app, alice, id, `parallel ${i}`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const seqs = (await pg.sql(`SELECT seq FROM assistant_messages WHERE conversation_id = '${id}' ORDER BY seq`)).map((r) => r.seq);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await integrity(app, alice, id)).toMatchObject({ ok: true, checked: 20 });
    const [{ n }] = await pg.sql(`SELECT count(*)::int AS n FROM assistant_integrity_checkpoints WHERE conversation_id = '${id}'`);
    expect(n).toBe(5); // checkpointEvery = 4
  });

  it('concurrent duplicates of one clientRequestId create exactly one pair', async () => {
    const app = makeApp();
    const id = await newConv(app, alice);
    const body = { clientRequestId: randomUUID(), message: 'dup', language: 'en' };
    const rs = await Promise.all(Array.from({ length: 5 }, () => as(app, alice).post(`/${id}/messages`, body)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(new Set(rs.map((r) => r.body.assistantMessage.id)).size).toBe(1);
    expect((await pg.sql(`SELECT count(*)::int AS n FROM assistant_messages WHERE conversation_id = '${id}'`))[0].n).toBe(2);
  });

  it('isolates students: not-owner is 404 for read, post, rename, archive, integrity, attach and search', async () => {
    const app = makeApp();
    const a = await newConv(app, alice, 'Alice private');
    await send(app, alice, a, 'alice secret zebra');
    expect((await as(app, bob).get(`/${a}`)).status).toBe(404);
    expect((await send(app, bob, a, 'intrusion')).status).toBe(404);
    expect((await as(app, bob).patch(`/${a}`, { title: 'x' })).status).toBe(404);
    expect((await as(app, bob).post(`/${a}/archive`)).status).toBe(404);
    expect((await as(app, bob).get(`/${a}/integrity`)).status).toBe(404);
    expect((await as(app, staff).get(`/${a}`)).status).toBe(404);
    expect((await as(app, bob).get('/search?q=zebra')).body.hits).toEqual([]);
    expect((await as(app, bob).get('/')).body.conversations.some((c: any) => c.id === a)).toBe(false);
    expect((await pg.sql(`SELECT count(*)::int AS n FROM assistant_messages WHERE conversation_id = '${a}'`))[0].n).toBe(2);
    // admin: integrity report only
    expect((await as(app, admin).get(`/${a}/integrity`)).body).toMatchObject({ ok: true, checked: 2 });
    expect((await as(app, admin).get(`/${a}`)).status).toBe(404);
  });

  it('rejects attachments that are not the caller own, deleted, staff-only, too many or too large', async () => {
    const app = makeApp();
    const a = await newConv(app, alice);
    const b = await newConv(app, bob);
    const before = (await pg.sql('SELECT count(*)::int AS n FROM assistant_messages'))[0].n;
    for (const ids of [[bobDoc], [aliceStaffOnlyDoc], [aliceDeletedDoc], [randomUUID()]]) {
      const r = await send(app, alice, a, 'with doc', { attachmentDocumentIds: ids });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('attachment_rejected');
    }
    expect((await send(app, alice, a, 'six', { attachmentDocumentIds: aliceDocs.slice(0, 6) })).status).toBe(400);
    expect((await send(app, bob, b, 'steal', { attachmentDocumentIds: [aliceDocs[0]] })).status).toBe(422);
    await pg.sql(`UPDATE student_documents SET size_bytes = 30000000 WHERE id IN ('${aliceDocs[1]}','${aliceDocs[2]}')`);
    expect((await send(app, alice, a, 'big', { attachmentDocumentIds: [aliceDocs[1], aliceDocs[2]] })).status).toBe(422);
    expect((await pg.sql('SELECT count(*)::int AS n FROM assistant_messages'))[0].n).toBe(before); // nothing committed
    const ok = await send(app, alice, a, 'fine', { attachmentDocumentIds: [aliceDocs[1], aliceDocs[3]] });
    expect(ok.status).toBe(200);
    expect(ok.body.studentMessage.attachments).toHaveLength(2);
    expect(await integrity(app, alice, a)).toMatchObject({ ok: true });
  });

  describe('tamper detection and append-only', () => {
    async function seeded(n = 3) {
      const app = makeApp();
      const id = await newConv(app, alice);
      for (let i = 0; i < n; i++) await send(app, alice, id, `message ${i}`);
      expect(await integrity(app, alice, id)).toMatchObject({ ok: true, checked: n * 2 });
      return { app, id };
    }
    const kinds = (r: any) => r.problems.map((p: any) => `${p.seq}:${p.kind}`);

    it('blocks UPDATE and DELETE of messages through triggers', async () => {
      const { id } = await seeded(1);
      await expect(pg.sql(`UPDATE assistant_messages SET content = 'x' WHERE conversation_id = '${id}' AND seq = 1`)).rejects.toThrow(/append-only/);
      await expect(pg.sql(`UPDATE assistant_messages SET hash = '${'a'.repeat(64)}' WHERE conversation_id = '${id}' AND seq = 1`)).rejects.toThrow(/append-only/);
      await expect(pg.sql(`UPDATE assistant_messages SET seq = 9 WHERE conversation_id = '${id}' AND seq = 2`)).rejects.toThrow(/append-only/);
      await expect(pg.sql(`UPDATE assistant_messages SET author_user_id = 'x' WHERE conversation_id = '${id}' AND seq = 1`)).rejects.toThrow(/append-only/);
      await expect(pg.sql(`DELETE FROM assistant_messages WHERE conversation_id = '${id}'`)).rejects.toThrow(/append-only/);
      await expect(pg.sql(`DELETE FROM assistant_conversations WHERE id = '${id}'`)).rejects.toThrow(/archive/);
      await expect(pg.sql('TRUNCATE assistant_audit_events')).rejects.toThrow(/append-only/);
      await expect(pg.sql(`UPDATE assistant_audit_events SET event_type = 'x'`)).rejects.toThrow(/append-only/);
      await expect(pg.sql(`UPDATE assistant_integrity_checkpoints SET hash = '${'b'.repeat(64)}'`)).rejects.toThrow(/append-only/);
      await expect(pg.sql(`INSERT INTO assistant_messages (conversation_id, owner_user_id, seq, role, author_user_id, content, language, prev_hash, hash)
        VALUES ('${id}', '${alice.id}', 99, 'student', '${alice.id}', 'fork', 'en', '${'0'.repeat(64)}', '${'1'.repeat(64)}')`)).rejects.toThrow(/chain violation/);
      await expect(pg.sql(`INSERT INTO assistant_messages (conversation_id, owner_user_id, seq, role, author_user_id, content, language, prev_hash, hash)
        SELECT '${id}', '${alice.id}', 3, 'student', '${bob.id}', 'forged', 'en', hash, '${'1'.repeat(64)}' FROM assistant_messages WHERE conversation_id = '${id}' AND seq = 2`)).rejects.toThrow(/author/);
    });

    it('detects modified content', async () => {
      const { app, id } = await seeded();
      await tamper(`UPDATE assistant_messages SET content = 'rewritten' WHERE conversation_id = '${id}' AND seq = 3`);
      const r = await integrity(app, alice, id);
      expect(r.ok).toBe(false);
      expect(kinds(r)).toContain('3:hash_mismatch');
    });

    it('detects a wrong hash', async () => {
      const { app, id } = await seeded();
      await tamper(`UPDATE assistant_messages SET hash = '${'f'.repeat(64)}' WHERE conversation_id = '${id}' AND seq = 2`);
      const r = await integrity(app, alice, id);
      expect(kinds(r)).toContain('2:hash_mismatch');
      expect(kinds(r)).toContain('3:prev_hash_mismatch');
    });

    it('detects a deleted row (gap, broken chain, and checkpoint)', async () => {
      const { app, id } = await seeded(4); // 8 messages -> checkpoint at seq 4 and 8
      await tamper(`DELETE FROM assistant_messages WHERE conversation_id = '${id}' AND seq = 4`);
      const r = await integrity(app, alice, id);
      expect(r.ok).toBe(false);
      expect(kinds(r)).toEqual(expect.arrayContaining(['5:seq_gap', '5:prev_hash_mismatch', '4:checkpoint_mismatch']));
    });

    it('detects truncation of the tail via checkpoints', async () => {
      const { app, id } = await seeded(2); // 4 messages, checkpoint at 4
      await tamper(`DELETE FROM assistant_messages WHERE conversation_id = '${id}' AND seq = 4`);
      expect(kinds(await integrity(app, alice, id))).toContain('4:truncated');
    });

    it('detects reordered seq', async () => {
      const { app, id } = await seeded();
      await tamper(`UPDATE assistant_messages SET seq = 100 WHERE conversation_id = '${id}' AND seq = 3;
                    UPDATE assistant_messages SET seq = 3 WHERE conversation_id = '${id}' AND seq = 4;
                    UPDATE assistant_messages SET seq = 4 WHERE conversation_id = '${id}' AND seq = 100`);
      const r = await integrity(app, alice, id);
      expect(r.ok).toBe(false);
      expect(r.problems.some((p: any) => p.kind === 'hash_mismatch' || p.kind === 'prev_hash_mismatch' || p.kind === 'seq_reordered')).toBe(true);
    });

    it('detects an unauthorized author', async () => {
      const { app, id } = await seeded();
      await tamper(`UPDATE assistant_messages SET author_user_id = '${bob.id}' WHERE conversation_id = '${id}' AND seq = 1`);
      const r = await integrity(app, alice, id);
      expect(kinds(r)).toContain('1:unauthorized_author');
    });

    it('detects an attachment link that was removed', async () => {
      const app = makeApp();
      const id = await newConv(app, alice);
      await send(app, alice, id, 'with file', { attachmentDocumentIds: [aliceDocs[4]] });
      await pg.sql('ALTER TABLE assistant_message_attachments DISABLE TRIGGER USER');
      await pg.sql(`DELETE FROM assistant_message_attachments WHERE document_id = '${aliceDocs[4]}'`);
      await pg.sql('ALTER TABLE assistant_message_attachments ENABLE TRIGGER USER');
      expect(kinds(await integrity(app, alice, id))).toContain('1:hash_mismatch');
    });

    it('the out-of-database anchor (log line) catches a rewrite of both chain and checkpoints table', async () => {
      const { app, id } = await seeded(2);
      const anchor = logs.filter((l) => l.m === 'assistant_integrity_checkpoint' && l.conversationId === id).pop();
      expect(anchor).toBeTruthy();
      // attacker with superuser rewrites row AND recomputes nothing: simply replaces hash+checkpoint consistently
      const { verifyConversation } = await import('../server/services/assistant-conversations/integrity');
      const { loadForVerification } = await import('../server/services/assistant-conversations/store');
      const input = await loadForVerification(database, id);
      expect(verifyConversation({ ...input!, anchors: [{ seq: anchor.seq, hash: anchor.hash }] }).ok).toBe(true);
      expect(verifyConversation({ ...input!, anchors: [{ seq: anchor.seq, hash: 'e'.repeat(64) }] }).problems[0].kind).toBe('checkpoint_mismatch');
    });
  });

  it('assistant_purge_owner is the only deletion path: deletes the owner data and leaves a content-free tombstone', async () => {
    const app = makeApp();
    const carol = await seedUser(pg, 'student', 'carol');
    const id = await (async () => (await request(app).post('/c/').set('x-user', alice.id).set('x-csrf-token', 'ok').send({ clientRequestId: randomUUID() })).body.conversation.id)();
    void id;
    // carol is not registered in makeApp's auth, so drive the store through the service directly
    const svc = createConversationService({ database, generateReply, checkpointEvery: 4 });
    const conv = await svc.create(carol.id, randomUUID(), 'Carol private title');
    await svc.postMessage({ id: carol.id, role: 'student' }, conv.id, { clientRequestId: randomUUID(), message: 'sensitive carol words', language: 'en' });
    const [{ n }] = await pg.sql(`SELECT count(*)::int AS n FROM assistant_messages WHERE owner_user_id = '${carol.id}'`);
    expect(n).toBe(2);
    await expect(pg.sql(`SELECT assistant_purge_owner('${carol.id}', '')`)).rejects.toThrow(/reason/);
    const [res] = await pg.sql(`SELECT assistant_purge_owner('${carol.id}', 'erasure request #1') AS r`);
    expect(res.r).toEqual({ conversations: 1, messages: 2 });
    expect((await pg.sql(`SELECT count(*)::int AS n FROM assistant_messages WHERE owner_user_id = '${carol.id}'`))[0].n).toBe(0);
    const audit = await pg.sql(`SELECT * FROM assistant_audit_events WHERE owner_user_id = '${carol.id}'`);
    expect(audit).toHaveLength(1);
    expect(audit[0].event_type).toBe('owner_purged');
    expect(JSON.stringify(audit[0])).not.toMatch(/sensitive|Carol private/);
    // the purge flag does not leak: deletes are blocked again
    await expect(pg.sql(`DELETE FROM assistant_audit_events WHERE owner_user_id = '${carol.id}'`)).rejects.toThrow(/append-only/);
    // not callable by the API roles
    await expect(pg.sql(`SET ROLE authenticated; SELECT assistant_purge_owner('${alice.id}', 'x')`)).rejects.toThrow(/permission denied/);
    await pg.sql('RESET ROLE');
  });
});
