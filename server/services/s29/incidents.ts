/**
 * S29 — bounded operational incidents (Diagnostics Studio, explorer + alerts).
 *
 * recordIncident() folds repeated failures into ONE row per fingerprint (subsystem + category), counting
 * occurrences. It stores only: subsystem, category, severity, counts, timestamps, the last request id, and a
 * curated likely cause / next action. Never messages, query strings, tokens, bodies or student data.
 * Writes are best-effort and throttled in memory (one DB write per fingerprint per 30 s) so an error storm
 * cannot overload the database; the in-memory counter keeps the occurrences honest between writes.
 */
import { sql } from "drizzle-orm";
import type { IncidentView } from "@shared/s29-contract";
import { iso, isoReq, rows, str, type SqlExecutor } from "./db";

export interface IncidentInput {
  readonly subsystem: string;
  readonly category: string;
  readonly severity: "info" | "warning" | "critical";
  readonly requestId?: string | null;
  readonly likelyCause?: string | null;
  readonly nextAction?: string | null;
}

/** Curated guidance per category (evidence-based wording only). */
export const INCIDENT_GUIDE: Record<string, { cause: string; action: string }> = {
  "db.unavailable": { cause: "The database refused or dropped connections (pool exhaustion or provider maintenance).", action: "Check DB_POOL_MAX and the Supabase session pooler (15 clients); retry the Programs diagnostic." },
  "db.schema_missing": { cause: "A required table is missing: a release schema step has not been applied.", action: "Run the release runner so the schema step applies the pending additive migration." },
  "http.5xx": { cause: "A request failed with a server error.", action: "Open the correlation id in the Replit logs; run the matching one-click check." },
  "job.failed": { cause: "A scheduled job threw an error.", action: "Open Jobs for the last error code; run the scheduler check." },
  "job.stalled": { cause: "A scheduled job has not succeeded within three intervals.", action: "Confirm the deployment is receiving traffic or that the external cron calls /api/ops/scheduler/tick." },
  "email.failed": { cause: "The email provider rejected or did not answer after retries.", action: "Check RESEND_API_KEY and the EMAIL_FROM domain verification, then retry from Notifications." },
  "email.not_configured": { cause: "Email transport is not configured (EMAIL_ENABLED, EMAIL_FROM, RESEND_API_KEY).", action: "Add the three production secrets; messages stay in the in-portal inbox meanwhile." },
  "ai.provider_error": { cause: "The AI provider call failed.", action: "Check META_MODEL_API_KEY and the monthly AI budget; deterministic answers remain available." },
};

const lastWrite = new Map<string, { at: number; pending: number }>();
const THROTTLE_MS = 30_000;

export function fingerprintFor(i: Pick<IncidentInput, "subsystem" | "category">): string {
  return `${i.subsystem}:${i.category}`.slice(0, 160);
}

export async function recordIncident(db: SqlExecutor, input: IncidentInput, nowMs = Date.now()): Promise<boolean> {
  const fp = fingerprintFor(input);
  const slot = lastWrite.get(fp);
  if (slot && nowMs - slot.at < THROTTLE_MS) { slot.pending += 1; return false; }
  const add = 1 + (slot?.pending ?? 0);
  lastWrite.set(fp, { at: nowMs, pending: 0 });
  if (lastWrite.size > 500) lastWrite.clear();
  const guide = INCIDENT_GUIDE[input.category];
  const reqId = input.requestId ? String(input.requestId).replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 80) : null;
  await db.execute(sql`INSERT INTO s29_incidents (fingerprint, subsystem, category, severity, occurrences, last_request_id, likely_cause, next_action)
    VALUES (${fp}, ${input.subsystem.slice(0, 40)}, ${input.category.slice(0, 60)}, ${input.severity}, ${add}, ${reqId}, ${(input.likelyCause ?? guide?.cause ?? null)?.slice(0, 300) ?? null}, ${(input.nextAction ?? guide?.action ?? null)?.slice(0, 300) ?? null})
    ON CONFLICT (fingerprint) DO UPDATE SET occurrences = s29_incidents.occurrences + ${add}, last_seen_at = now(), last_request_id = COALESCE(EXCLUDED.last_request_id, s29_incidents.last_request_id),
      severity = CASE WHEN EXCLUDED.severity = 'critical' OR s29_incidents.severity = 'critical' THEN 'critical' WHEN EXCLUDED.severity = 'warning' OR s29_incidents.severity = 'warning' THEN 'warning' ELSE 'info' END,
      status = CASE WHEN s29_incidents.status = 'resolved' THEN 'open' ELSE s29_incidents.status END,
      resolved_at = CASE WHEN s29_incidents.status = 'resolved' THEN NULL ELSE s29_incidents.resolved_at END,
      alerted_at = CASE WHEN s29_incidents.status = 'resolved' THEN NULL ELSE s29_incidents.alerted_at END`);
  return true;
}

export function resetIncidentThrottle(): void { lastWrite.clear(); }

const view = (r: Record<string, unknown>): IncidentView => ({
  id: String(r.id), fingerprint: String(r.fingerprint), subsystem: String(r.subsystem), category: String(r.category), severity: r.severity as IncidentView["severity"],
  firstSeenAt: isoReq(r.first_seen_at), lastSeenAt: isoReq(r.last_seen_at), occurrences: Number(r.occurrences), lastRequestId: str(r.last_request_id),
  status: r.status as IncidentView["status"], likelyCause: str(r.likely_cause), nextAction: str(r.next_action), acknowledgedBy: str(r.acknowledged_by),
});

export async function listIncidents(db: SqlExecutor, q: { search?: string; status?: string; limit?: number } = {}): Promise<IncidentView[]> {
  const lim = Math.min(Math.max(q.limit ?? 100, 1), 200);
  const term = q.search ? `%${q.search.replace(/[%_\\]/g, " ").slice(0, 60)}%` : null;
  return rows(await db.execute(sql`SELECT * FROM s29_incidents WHERE TRUE
      ${q.status ? sql`AND status = ${q.status}` : sql``}
      ${term ? sql`AND (subsystem ILIKE ${term} OR category ILIKE ${term} OR last_request_id ILIKE ${term})` : sql``}
    ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, last_seen_at DESC LIMIT ${lim}`)).map(view);
}

export async function updateIncident(db: SqlExecutor, id: string, action: "acknowledge" | "resolve" | "reopen", by: string): Promise<IncidentView | null> {
  const set = action === "acknowledge" ? sql`status = 'acknowledged', acknowledged_by = ${by}, acknowledged_at = now()`
    : action === "resolve" ? sql`status = 'resolved', resolved_at = now()`
    : sql`status = 'open', resolved_at = NULL, alerted_at = NULL`;
  const r = rows(await db.execute(sql`UPDATE s29_incidents SET ${set} WHERE id = ${id}::uuid RETURNING *`))[0];
  return r ? view(r) : null;
}

/** Auto-resolve incidents not seen for 24 h (the problem stopped). */
export async function autoResolveQuiet(db: SqlExecutor): Promise<number> {
  return rows(await db.execute(sql`UPDATE s29_incidents SET status = 'resolved', resolved_at = now() WHERE status <> 'resolved' AND last_seen_at < now() - interval '24 hours' RETURNING id`)).length;
}

export async function incidentsToAlert(db: SqlExecutor): Promise<IncidentView[]> {
  // Threshold: critical once, warning after 3 occurrences; never re-alert an acknowledged incident; at most once per 6 h.
  return rows(await db.execute(sql`SELECT * FROM s29_incidents WHERE status = 'open' AND (severity = 'critical' OR (severity = 'warning' AND occurrences >= 3))
      AND (alerted_at IS NULL OR alerted_at < now() - interval '6 hours') ORDER BY last_seen_at DESC LIMIT 10`)).map(view);
}

export async function markAlerted(db: SqlExecutor, id: string): Promise<void> {
  await db.execute(sql`UPDATE s29_incidents SET alerted_at = now() WHERE id = ${id}::uuid`);
}

export { iso };
