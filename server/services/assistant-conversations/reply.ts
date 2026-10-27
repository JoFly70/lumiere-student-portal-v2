/**
 * Reply orchestration seam. Today it delegates to the S20 academic assistant (curated local answers /
 * optional live model). Later stages (private retrieval, memory) replace or wrap this function through the
 * router's injectable `generateReply`. It only ever sees the current message and at most 6 recent turns.
 */
import { answerMessage, type AssistantDeps, type HistoryTurn } from '../academic-assistant/service';
import { PgBudgetStore } from '../academic-assistant/budget';

export const MAX_RECENT_TURNS = 6;

export interface GenerateReplyArgs {
  user: { id: string; role: string };
  conversationId: string;
  message: string;
  language: 'en' | 'fr';
  recentTurns: HistoryTurn[];
}
export interface GeneratedReply {
  content: string;
  mode: 'local' | 'live';
  sources: Array<{ title: string; url: string; verifiedAt: string | null }>;
  links: Array<{ label: string; path: string }>;
  notice: string | null;
  privateRefs: Array<{ kind: string; title: string; path: string }>;
}
export type GenerateReplyFn = (args: GenerateReplyArgs) => Promise<GeneratedReply>;

let defaultDeps: AssistantDeps | null = null;

export async function generateReply(args: GenerateReplyArgs, deps?: AssistantDeps): Promise<GeneratedReply> {
  const d = deps ?? (defaultDeps ??= { budget: new PgBudgetStore() });
  const out = await answerMessage(
    args.user,
    { message: args.message, language: args.language, history: args.recentTurns.slice(-MAX_RECENT_TURNS) },
    d,
  );
  return { content: out.reply, mode: out.mode, sources: out.sources, links: out.links, notice: out.notice ?? null, privateRefs: [] };
}
