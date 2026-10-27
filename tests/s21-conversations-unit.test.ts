import { describe, expect, it } from 'vitest';
import { canonicalJson, computeMessageHash, verifyConversation, GENESIS_HASH } from '../server/services/assistant-conversations/integrity';
import { generateReply } from '../server/services/assistant-conversations/reply';
import { MemoryBudgetStore } from '../server/services/academic-assistant/budget';

describe('S21 conversation integrity (pure)', () => {
  it('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [2, { x: 2, y: 1 }] }, b: 1 }));
  });
  const base = { conversationId: 'c', seq: 1, role: 'student', author: 'u', content: 'hi', language: 'en', mode: null, sources: [], links: [], privateRefs: [], notice: null, attachmentDocumentIds: ['b', 'a'], createdAt: '2026-01-01T00:00:00.000000Z', prevHash: GENESIS_HASH };
  it('hash covers every field and sorts attachment ids', () => {
    const h = computeMessageHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeMessageHash({ ...base, attachmentDocumentIds: ['a', 'b'] })).toBe(h);
    for (const patch of [{ content: 'ho' }, { seq: 2 }, { author: 'v' }, { language: 'fr' }, { notice: 'n' }, { createdAt: '2026-01-01T00:00:00.000001Z' }, { attachmentDocumentIds: ['a'] }, { mode: 'live' }]) {
      expect(computeMessageHash({ ...base, ...patch } as any)).not.toBe(h);
    }
  });
  it('verifier accepts an intact chain and flags an empty-vs-checkpoint truncation', () => {
    const hash = computeMessageHash(base);
    const row = { id: 'm1', seq: 1, role: 'student', authorUserId: 'u', ownerUserId: 'u', content: 'hi', language: 'en', mode: null, sources: [], links: [], privateRefs: [], notice: null, replyToMessageId: null, attachmentDocumentIds: ['a', 'b'], createdAt: base.createdAt, prevHash: GENESIS_HASH, hash };
    expect(verifyConversation({ conversationId: 'c', ownerUserId: 'u', messages: [row], checkpoints: [] }).ok).toBe(true);
    expect(verifyConversation({ conversationId: 'c', ownerUserId: 'u', messages: [], checkpoints: [{ seq: 1, hash }] }).problems[0].kind).toBe('truncated');
  });
});

describe('S21 default generateReply', () => {
  it('delegates to the S20 assistant (local mode, privateRefs empty)', async () => {
    const out = await generateReply(
      { user: { id: 'u', role: 'student' }, conversationId: 'c', message: 'How do roadmaps work?', language: 'en', recentTurns: [] },
      { budget: new MemoryBudgetStore() },
    );
    expect(out.mode).toBe('local');
    expect(out.privateRefs).toEqual([]);
    expect(out.content.length).toBeGreaterThan(0);
  });
});
