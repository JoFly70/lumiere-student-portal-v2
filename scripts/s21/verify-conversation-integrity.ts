/**
 * Verify assistant conversation hash chains.
 *   npx tsx scripts/s21/verify-conversation-integrity.ts [conversationId] [--anchors <logfile>]
 * Reads DATABASE_URL. Exit code 0 = all chains intact, 1 = problems found, 2 = usage/runtime error.
 * --anchors: a log file containing `assistant_integrity_checkpoint` JSON lines (the out-of-database anchor);
 * their (conversationId, seq, hash) are compared with the database.
 */
import fs from 'node:fs';
import { db } from '../../server/lib/db';
import { listConversationIds, loadForVerification, type Database } from '../../server/services/assistant-conversations/store';
import { verifyConversation } from '../../server/services/assistant-conversations/integrity';

function parseAnchors(file: string): Map<string, Array<{ seq: number; hash: string }>> {
  const out = new Map<string, Array<{ seq: number; hash: string }>>();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const at = line.indexOf('{');
    if (at < 0 || !line.includes('assistant_integrity_checkpoint')) continue;
    try {
      const j = JSON.parse(line.slice(at));
      if (j.conversationId && Number.isInteger(j.seq) && typeof j.hash === 'string') {
        const list = out.get(j.conversationId) ?? [];
        list.push({ seq: j.seq, hash: j.hash });
        out.set(j.conversationId, list);
      }
    } catch { /* not a JSON log line */ }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const ai = args.indexOf('--anchors');
  let anchors = new Map<string, Array<{ seq: number; hash: string }>>();
  if (ai >= 0) { anchors = parseAnchors(args[ai + 1]); args.splice(ai, 2); }
  const database = db as unknown as Database;
  const ids = args[0] ? [args[0]] : await listConversationIds(database);
  let bad = 0, checked = 0;
  for (const id of ids) {
    const input = await loadForVerification(database, id);
    if (!input) { console.error(`NOT FOUND ${id}`); bad++; continue; }
    const report = verifyConversation({ ...input, anchors: anchors.get(id) });
    checked += report.checked;
    if (!report.ok) {
      bad++;
      for (const p of report.problems) console.error(`PROBLEM conversation=${id} seq=${p.seq} kind=${p.kind}${p.detail ? ` (${p.detail})` : ''}`);
    }
  }
  console.log(`conversations=${ids.length} messages=${checked} problems_in=${bad}`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
