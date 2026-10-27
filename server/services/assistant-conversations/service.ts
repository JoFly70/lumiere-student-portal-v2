import { logger as defaultLogger } from '../../lib/logger';
import { generateReply as defaultGenerateReply, type GenerateReplyFn } from './reply';
import * as store from './store';
import { ConversationError, type Database, type MessageRow, type ConversationRow, type Checkpoint } from './store';
import { verifyConversation, type VerifyReport } from './integrity';

export { ConversationError } from './store';

export interface AfterStudentMessageArgs {
  ownerUserId: string; conversationId: string; messageId: string; content: string; language: 'en' | 'fr';
}
export interface ConversationServiceOptions {
  database?: Database;
  generateReply?: GenerateReplyFn;
  /** Best-effort hook run after the student message commits (e.g. memory extraction). Never blocks/fails the post. */
  afterStudentMessage?: (args: AfterStudentMessageArgs) => Promise<void> | void;
  logger?: Pick<typeof defaultLogger, 'info' | 'warn' | 'error'>;
  checkpointEvery?: number;
}

export type PublicMessage = Omit<MessageRow, 'replyToMessageId'>;
const publicMessage = ({ replyToMessageId: _r, ...m }: MessageRow): PublicMessage => m;

async function lazyDb(): Promise<Database> {
  const { db } = await import('../../lib/db');
  return db as unknown as Database;
}

export function createConversationService(opts: ConversationServiceOptions = {}) {
  const log = opts.logger ?? defaultLogger;
  const generateReply = opts.generateReply ?? defaultGenerateReply;
  const checkpointEvery = opts.checkpointEvery ?? (Number(process.env.ASSISTANT_CHECKPOINT_EVERY) || 10);
  const getDb = async (): Promise<Database> => opts.database ?? lazyDb();

  /** Out-of-database anchor: structured log line (no content). */
  const anchor = (owner: string, cp: Checkpoint | null) => {
    if (cp) log.info('assistant_integrity_checkpoint', { event: 'assistant_integrity_checkpoint', conversationId: cp.conversationId, ownerUserId: owner, seq: cp.seq, hash: cp.hash });
  };

  return {
    async list(owner: string, archived: boolean, limit: number): Promise<ConversationRow[]> {
      return store.listConversations(await getDb(), owner, archived, limit);
    },
    async create(owner: string, clientRequestId: string, title?: string): Promise<ConversationRow> {
      return store.createConversation(await getDb(), owner, clientRequestId, title);
    },
    async get(owner: string, id: string): Promise<{ conversation: ConversationRow; messages: PublicMessage[] }> {
      const db = await getDb();
      const conversation = await store.getConversation(db, owner, id);
      if (!conversation) throw store.notFound();
      return { conversation, messages: (await store.getMessages(db, owner, id)).map(publicMessage) };
    },
    async rename(owner: string, id: string, title: string) {
      return store.renameConversation(await getDb(), owner, id, title);
    },
    async setArchived(owner: string, id: string, archived: boolean) {
      const r = await store.setArchived(await getDb(), owner, id, archived);
      anchor(owner, r.checkpoint);
      return r.conversation;
    },
    async search(owner: string, q: string) {
      return store.searchMessages(await getDb(), owner, q);
    },

    async postMessage(user: { id: string; role: string }, conversationId: string, input: {
      clientRequestId: string; message: string; language: 'en' | 'fr'; attachmentDocumentIds?: string[];
    }): Promise<{ studentMessage: PublicMessage; assistantMessage: PublicMessage; replayed: boolean }> {
      const db = await getDb();
      const owner = user.id;
      // 1. Student message (+ attachments + audit) commits on its own.
      const first = await store.appendStudentMessage(db, owner, conversationId, {
        clientRequestId: input.clientRequestId, content: input.message, language: input.language,
        attachmentDocumentIds: input.attachmentDocumentIds ?? [], checkpointEvery,
      });
      anchor(owner, first.checkpoint);
      if (first.existing && first.assistantMessage) {
        return { studentMessage: publicMessage(first.studentMessage), assistantMessage: publicMessage(first.assistantMessage), replayed: true };
      }
      const student = first.studentMessage;

      if (!first.existing && opts.afterStudentMessage) {
        try {
          await opts.afterStudentMessage({ ownerUserId: owner, conversationId, messageId: student.id, content: student.content, language: student.language });
        } catch (err) {
          log.warn('assistant afterStudentMessage hook failed', { error: (err as Error).message });
        }
      }

      // 2. Generate the reply (not inside any DB transaction). A failure leaves the student message in place;
      //    a retry with the same clientRequestId reaches this point again and generates only the missing reply.
      let reply;
      try {
        const turns = await store.recentTurns(db, owner, conversationId, student.seq, 6);
        reply = await generateReply({ user, conversationId, message: student.content, language: student.language, recentTurns: turns });
      } catch (err) {
        log.error('assistant reply generation failed', { error: (err as Error).message, conversationId });
        throw new ConversationError('unavailable', 'The assistant is unavailable right now. Please retry.', 503);
      }

      // 3. Append the reply in its own transaction (unique reply_to_message_id guards duplicates).
      const appended = await store.appendAssistantReply(db, owner, conversationId, student.id, {
        content: reply.content, language: student.language, mode: reply.mode, sources: reply.sources, links: reply.links,
        privateRefs: reply.privateRefs ?? [], notice: reply.notice ?? null, checkpointEvery,
      });
      anchor(owner, appended.checkpoint);
      return { studentMessage: publicMessage(student), assistantMessage: publicMessage(appended.assistantMessage), replayed: first.existing && !appended.created };
    },

    /** Owner (or admin: ownerFilter = undefined) integrity report. null = not found. */
    async integrity(conversationId: string, ownerFilter?: string): Promise<VerifyReport | null> {
      const input = await store.loadForVerification(await getDb(), conversationId, ownerFilter);
      return input ? verifyConversation(input) : null;
    },
  };
}
export type ConversationService = ReturnType<typeof createConversationService>;
