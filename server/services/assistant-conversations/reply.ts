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

// ---- S21 integration: private (local-only) context ------------------------------------------------------------
// The public answer above never sees private data. Private items (the student's own memory, earlier messages,
// indexed documents, academic records) are retrieved under the owner boundary and appended as a separate,
// clearly labelled "From your records" section with deep links. Nothing here is sent to any provider.

export interface PrivateItemLike {
  kind: string; title: string; snippet: string; path: string; label?: string;
}
export type RetrievePrivateFn = (args: { ownerUserId: string; query: string; language: 'en' | 'fr'; limit?: number }) => Promise<{ items: PrivateItemLike[] }>;

export const MAX_PRIVATE_ITEMS = 3;

const PRIVATE_T = {
  en: { head: 'From your records (private, not sent to any AI model):', support: 'If this does not answer your question, your Lumière team can help: open a Support request.', supportLabel: 'Contact Support' },
  fr: { head: 'Dans votre dossier (privé, jamais envoyé à un modèle d’IA) :', support: 'Si cela ne répond pas à votre question, votre équipe Lumière peut vous aider : ouvrez une demande de soutien.', supportLabel: 'Contacter le soutien' },
} as const;

export function composeWithPrivateContext(base: GeneratedReply, items: PrivateItemLike[], language: 'en' | 'fr', conversationId: string): GeneratedReply {
  const t = PRIVATE_T[language];
  // The current conversation's turns are already in context; do not cite the conversation to itself.
  const own = items.filter((i) => !(i.kind === 'message' && i.path.includes(`conversation=${conversationId}`))).slice(0, MAX_PRIVATE_ITEMS);
  let content = base.content;
  const links = [...base.links];
  if (own.length > 0) {
    const lines = own.map((i) => `- ${i.label ? `${i.label}: ` : ''}${i.title}${i.snippet ? ` — ${i.snippet.replace(/\s+/g, ' ').slice(0, 220)}` : ''}`);
    content += `\n\n${t.head}\n${lines.join('\n')}`;
  } else if (base.sources.length === 0) {
    // No grounded public or private source: offer the Support pathway instead of guessing.
    content += `\n\n${t.support}`;
    if (!links.some((l) => l.path === '/support')) links.push({ label: t.supportLabel, path: '/support' });
  }
  return { ...base, content, links, privateRefs: own.map((i) => ({ kind: i.kind, title: i.title, path: i.path })) };
}

export function createIntegratedGenerateReply(deps: { retrievePrivate: RetrievePrivateFn; base?: GenerateReplyFn; logger?: { warn: (m: string, meta?: unknown) => void } }): GenerateReplyFn {
  const base = deps.base ?? ((a: GenerateReplyArgs) => generateReply(a));
  return async (args) => {
    const reply = await base(args);
    let items: PrivateItemLike[] = [];
    try {
      items = (await deps.retrievePrivate({ ownerUserId: args.user.id, query: args.message, language: args.language, limit: MAX_PRIVATE_ITEMS + 2 })).items;
    } catch (err) {
      deps.logger?.warn('Private retrieval failed; replying without it', { error: (err as Error).message });
    }
    return composeWithPrivateContext(reply, items, args.language, args.conversationId);
  };
}
