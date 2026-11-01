/**
 * S29 — persisted Needs Attention queue.
 *
 * syncAttention() upserts the rules engine's current candidates into s29_attention_items:
 *   - new candidate                 -> open, detected_at = now
 *   - still present                 -> last_seen_at = now (detected_at kept: "when the issue arose / was first seen")
 *   - dismissed + same fingerprint  -> stays dismissed (until the snooze ends)
 *   - dismissed + facts changed     -> reopened
 *   - resolved by staff             -> stays resolved until the facts change (then reopened)
 *   - open but no longer produced   -> resolved automatically ("condition_cleared"), kept as history
 * Staff actions (dismiss / resolve / reopen) are audited by the route with identifiers only.
 */
import { sql } from "drizzle-orm";
import type { AttentionActionInput, AttentionItemView, AttentionQueueView, ConciergeSettings } from "@shared/s29-contract";
import { DEFAULT_CONCIERGE_SETTINGS, conciergeSettingsSchema } from "@shared/s29-contract";
import { rows, iso, isoReq, str, S29Error, type SqlExecutor, type Tx } from "./db";
import type { AttentionCandidate } from "./rules";

export async function loadSettings(db: SqlExecutor): Promise<ConciergeSettings> {
  try {
    const r = rows(await db.execute(sql`SELECT value FROM s29_settings WHERE key = 'concierge'`))[0];
    if (!r) return DEFAULT_CONCIERGE_SETTINGS;
    const parsed = conciergeSettingsSchema.safeParse({ ...DEFAULT_CONCIERGE_SETTINGS, ...(r.value as object) });
    return parsed.success ? parsed.data : DEFAULT_CONCIERGE_SETTINGS;
  } catch {
    return DEFAULT_CONCIERGE_SETTINGS;
  }
}

export async function saveSettings(db: SqlExecutor, value: ConciergeSettings, by: string): Promise<ConciergeSettings> {
  await db.execute(sql`INSERT INTO s29_settings (key, value, updated_by, updated_at) VALUES ('concierge', ${JSON.stringify(value)}::jsonb, ${by}, now())
                       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`);
  return value;
}

export interface SyncResult { readonly opened: number; readonly reopened: number; readonly cleared: number; readonly seen: number }

export async function syncAttention(db: Tx, candidates: readonly AttentionCandidate[], now: Date): Promise<SyncResult> {
  const nowIso = now.toISOString();
  return db.transaction(async (tx) => {
    // One sync at a time across instances; a concurrent caller skips instead of deadlocking.
    const locked = rows(await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext('s29_attention_sync')) AS ok`))[0]?.ok === true;
    if (!locked) return { opened: 0, reopened: 0, cleared: 0, seen: 0 };
    const existing = new Map(rows(await tx.execute(sql`SELECT key, status, fingerprint, snoozed_until, resolved_by FROM s29_attention_items WHERE status <> 'resolved' OR updated_at >= now() - interval '90 days' ORDER BY key`))
      .map((r) => [String(r.key), r] as const));
    let opened = 0;
    let reopened = 0;
    const present = new Set<string>();
    for (const c of candidates) {
      present.add(c.key);
      const prev = existing.get(c.key);
      const reasonJson = JSON.stringify(c.reason);
      if (!prev) {
        await tx.execute(sql`INSERT INTO s29_attention_items (key, kind, workflow, priority, status, student_id, is_demo, title, detail, reason, fingerprint, action, href, arisen_at, detected_at, last_seen_at)
          VALUES (${c.key}, ${c.kind}, ${c.workflow}, ${c.priority}, 'open', ${c.studentId}, ${c.isDemo}, ${c.title.slice(0, 200)}, ${c.detail.slice(0, 400)}, ${reasonJson}::jsonb, ${c.fingerprint}, ${c.action}, ${c.href.slice(0, 300)}, ${c.arisenAt}::timestamptz, ${nowIso}::timestamptz, ${nowIso}::timestamptz)
          ON CONFLICT (key) DO NOTHING`);
        opened += 1;
        continue;
      }
      const status = String(prev.status);
      const changed = String(prev.fingerprint) !== c.fingerprint;
      const snoozeOver = prev.snoozed_until ? Date.parse(String(iso(prev.snoozed_until))) <= now.getTime() : false;
      // An auto-cleared item that comes back reopens. A staff resolution or dismissal holds until the facts change (or the snooze ends).
      const reopen = (status === "resolved" && (String(prev.resolved_by) === "system" || changed)) || (status === "dismissed" && (changed || snoozeOver));
      if (reopen) reopened += 1;
      await tx.execute(sql`UPDATE s29_attention_items SET kind = ${c.kind}, workflow = ${c.workflow}, priority = ${c.priority}, title = ${c.title.slice(0, 200)}, detail = ${c.detail.slice(0, 400)},
          reason = ${reasonJson}::jsonb, fingerprint = ${c.fingerprint}, action = ${c.action}, href = ${c.href.slice(0, 300)}, arisen_at = ${c.arisenAt}::timestamptz, is_demo = ${c.isDemo},
          last_seen_at = ${nowIso}::timestamptz, updated_at = now()
          ${reopen ? sql`, status = 'open', detected_at = ${nowIso}::timestamptz, resolved_at = NULL, resolved_by = NULL, resolution = NULL, snoozed_until = NULL` : sql``}
        WHERE key = ${c.key}`);
    }
    let cleared = 0;
    for (const [key, prev] of existing) {
      if (present.has(key) || String(prev.status) !== "open") continue;
      await tx.execute(sql`UPDATE s29_attention_items SET status = 'resolved', resolved_at = ${nowIso}::timestamptz, resolved_by = 'system', resolution = 'condition_cleared', updated_at = now() WHERE key = ${key} AND status = 'open'`);
      cleared += 1;
    }
    return { opened, reopened, cleared, seen: candidates.length };
  });
}

function toView(r: Record<string, unknown>, names: Map<string, { name: string; code: string | null }>): AttentionItemView {
  const sid = str(r.student_id);
  const who = sid ? names.get(sid) : undefined;
  return {
    key: String(r.key), kind: r.kind as AttentionItemView["kind"], workflow: r.workflow as AttentionItemView["workflow"], priority: r.priority as AttentionItemView["priority"],
    status: r.status as AttentionItemView["status"], studentId: sid, studentName: who?.name ?? null, studentCode: who?.code ?? null, isDemo: r.is_demo === true,
    title: String(r.title), detail: String(r.detail), reason: (r.reason as AttentionItemView["reason"]) ?? { rule: "", facts: {} },
    arisenAt: iso(r.arisen_at), detectedAt: isoReq(r.detected_at), lastSeenAt: isoReq(r.last_seen_at), action: String(r.action), href: String(r.href),
    resolvedAt: iso(r.resolved_at), resolvedBy: str(r.resolved_by), resolution: str(r.resolution), snoozedUntil: iso(r.snoozed_until),
  };
}

async function studentNames(db: SqlExecutor, ids: readonly string[]): Promise<Map<string, { name: string; code: string | null }>> {
  if (!ids.length) return new Map();
  const IN = sql.join(ids.map((i) => sql`${i}`), sql`, `);
  return new Map(rows(await db.execute(sql`SELECT id, first_name, last_name, student_code FROM students WHERE id IN (${IN})`))
    .map((r) => [String(r.id), { name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(), code: str(r.student_code) }] as const));
}

export async function readAttentionQueue(db: SqlExecutor, now: Date, lastSyncAt: string | null, truncatedIn = false): Promise<AttentionQueueView> {
  let truncated = truncatedIn;
  const [openOnly, dismissedOnly, closed] = await Promise.all([
    db.execute(sql`SELECT * FROM s29_attention_items WHERE status = 'open' ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, arisen_at NULLS LAST, key LIMIT 501`),
    db.execute(sql`SELECT * FROM s29_attention_items WHERE status = 'dismissed' ORDER BY updated_at DESC LIMIT 100`),
    db.execute(sql`SELECT * FROM s29_attention_items WHERE status = 'resolved' AND resolved_at >= ${new Date(now.getTime() - 14 * 86_400_000).toISOString()}::timestamptz ORDER BY resolved_at DESC LIMIT 40`),
  ]);
  const openRows = rows(openOnly);
  if (openRows.length > 500) { truncated = true; openRows.length = 500; }
  const open = [...openRows, ...rows(dismissedOnly)];
  const all = [...open, ...rows(closed)];
  const names = await studentNames(db, [...new Set(all.map((r) => str(r.student_id)).filter((x): x is string => !!x))]);
  const items = open.map((r) => toView(r, names));
  const recentlyClosed = rows(closed).map((r) => toView(r, names));
  // Dismissed items appear in the list (labelled) so they can be reopened; the counts only include open real items.
  const real = items.filter((i) => !i.isDemo && i.status === "open");
  const weekEnd = now.getTime() + 7 * 86_400_000;
  const dueThisWeek = real.filter((i) => {
    const due = typeof i.reason.facts.dueOn === "string" ? Date.parse(String(i.reason.facts.dueOn)) : typeof i.reason.facts.slotAt === "string" ? Date.parse(String(i.reason.facts.slotAt)) : NaN;
    return Number.isFinite(due) && due <= weekEnd;
  }).length;
  const closed7d = recentlyClosed.filter((i) => !i.isDemo && i.resolvedAt && Date.parse(i.resolvedAt) >= now.getTime() - 7 * 86_400_000).length;
  return {
    generatedAt: now.toISOString(), source: "store", items, recentlyClosed,
    counts: { open: real.length, urgent: real.filter((i) => i.priority === "urgent").length, high: real.filter((i) => i.priority === "high").length, dueThisWeek, closed7d },
    lastSyncAt, truncated,
  };
}

/** Live fallback (S29 schema not applied yet): the same candidates, not persisted. */
export function liveAttentionQueue(candidates: readonly AttentionCandidate[], now: Date, truncated: boolean): AttentionQueueView {
  const nowIso = now.toISOString();
  const items: AttentionItemView[] = candidates.map((c) => ({
    key: c.key, kind: c.kind, workflow: c.workflow, priority: c.priority, status: "open", studentId: c.studentId, studentName: c.studentName, studentCode: c.studentCode, isDemo: c.isDemo,
    title: c.title, detail: c.detail, reason: c.reason, arisenAt: c.arisenAt, detectedAt: nowIso, lastSeenAt: nowIso, action: c.action, href: c.href,
    resolvedAt: null, resolvedBy: null, resolution: null, snoozedUntil: null,
  }));
  const real = items.filter((i) => !i.isDemo);
  return { generatedAt: nowIso, source: "live", items, recentlyClosed: [], counts: { open: real.length, urgent: real.filter((i) => i.priority === "urgent").length, high: real.filter((i) => i.priority === "high").length, dueThisWeek: 0, closed7d: 0 }, lastSyncAt: null, truncated };
}

export async function actOnAttention(db: SqlExecutor, key: string, input: AttentionActionInput, actorId: string, now: Date): Promise<{ before: string; after: string }> {
  const prev = rows(await db.execute(sql`SELECT status FROM s29_attention_items WHERE key = ${key}`))[0];
  if (!prev) throw new S29Error(404, "S29_NOT_FOUND", "Attention item not found");
  const before = String(prev.status);
  const note = input.note?.slice(0, 500) ?? null;
  if (input.action === "dismiss") {
    const until = input.snoozeDays ? new Date(now.getTime() + input.snoozeDays * 86_400_000).toISOString() : null;
    await db.execute(sql`UPDATE s29_attention_items SET status = 'dismissed', snoozed_until = ${until}::timestamptz, resolved_at = ${now.toISOString()}::timestamptz, resolved_by = ${actorId}, resolution = ${note ?? "dismissed"}, updated_at = now() WHERE key = ${key}`);
    return { before, after: "dismissed" };
  }
  if (input.action === "resolve") {
    await db.execute(sql`UPDATE s29_attention_items SET status = 'resolved', snoozed_until = NULL, resolved_at = ${now.toISOString()}::timestamptz, resolved_by = ${actorId}, resolution = ${note ?? "resolved"}, updated_at = now() WHERE key = ${key}`);
    return { before, after: "resolved" };
  }
  await db.execute(sql`UPDATE s29_attention_items SET status = 'open', snoozed_until = NULL, resolved_at = NULL, resolved_by = NULL, resolution = NULL, detected_at = ${now.toISOString()}::timestamptz, updated_at = now() WHERE key = ${key}`);
  return { before, after: "open" };
}
