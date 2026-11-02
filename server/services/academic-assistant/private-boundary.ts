/**
 * S34 (S33-01) provider privacy boundary for conversation history.
 *
 * A stored assistant message is what the STUDENT sees. It can contain private material that must never reach the
 * external model: deterministic record answers (credits, billing, tickets...) and the "From your records" appendix
 * (memory, earlier messages, document and course titles + snippets) added locally after the model answered.
 *
 * The primary rule is STRUCTURAL and does not depend on any heading text: an assistant turn is provider-visible only
 * when it was produced by the live model (`mode === 'live'`) and carries no private references. A live turn that does
 * carry private references had the appendix added locally; only the text before that appendix is model output, and it is
 * kept only when the appendix boundary can be located exactly. Anything else (local/knowledge-base answers, record answers,
 * legacy rows without metadata, an unlocatable boundary) is dropped together with the student question that produced it.
 * The heading strip is a second, defence-in-depth layer applied to every assistant turn that survives.
 */

/** Heads that start the locally composed private appendix (both languages, every version shipped). */
export const PRIVATE_APPENDIX_HEADS = {
  en: 'From your records (private, not sent to any AI model):',
  fr: 'Dans votre dossier (privé, jamais envoyé à un modèle d’IA) :',
} as const;

const HEAD_LIST: readonly string[] = Object.values(PRIVATE_APPENDIX_HEADS);

/** Index of the first private-appendix head in `content`, or -1. Matches both apostrophe forms for the FR head. */
export function privateAppendixIndex(content: string): number {
  const normalized = content.replace(/['‘]/g, '’');
  let best = -1;
  for (const h of HEAD_LIST) {
    const i = normalized.indexOf(h);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

/** Content before the first private-appendix head (trimmed). Returns the input unchanged when no head is present. */
export function stripPrivateAppendix(content: string): string {
  const i = privateAppendixIndex(content);
  return i < 0 ? content : content.slice(0, i).trimEnd();
}

/** What the conversation store returns for history. `mode`/`privateRefs` are the structural privacy signals. */
export interface StoredTurn {
  role: 'user' | 'assistant';
  content: string;
  mode?: 'local' | 'live' | null;
  privateRefs?: ReadonlyArray<unknown> | null;
}
export interface ProviderTurn { role: 'user' | 'assistant'; content: string }

/**
 * Project stored conversation turns onto the provider-safe history. Pure; fails closed.
 * `isRecordAnswer` is injected (the deterministic record-answer heads live in student-record.ts).
 */
export function providerSafeTurns(turns: readonly StoredTurn[], isRecordAnswer: (content: string) => boolean): ProviderTurn[] {
  const out: ProviderTurn[] = [];
  const dropPair = () => { if (out.length && out[out.length - 1]!.role === 'user') out.pop(); };
  for (const t of turns) {
    if (t.role === 'user') { out.push({ role: 'user', content: t.content }); continue; }
    // Assistant turn.
    if (t.mode !== 'live' || isRecordAnswer(t.content)) { dropPair(); continue; }
    let content = t.content;
    const hasPrivate = Array.isArray(t.privateRefs) && t.privateRefs.length > 0;
    if (hasPrivate) {
      const i = privateAppendixIndex(content);
      if (i < 0) { dropPair(); continue; } // private material present but boundary unknown: fail closed
      content = content.slice(0, i);
    }
    content = stripPrivateAppendix(content).trim();
    if (!content) { dropPair(); continue; }
    out.push({ role: 'assistant', content });
  }
  return out;
}
