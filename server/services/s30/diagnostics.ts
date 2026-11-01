/**
 * S30 — Operations diagnostics: one admin view of subsystem health (database, S30 schema, events, exceptions,
 * notifications + email transport, the Proactive Concierge sweep, imports, calendar, AI and audit writes).
 * Read-only, bounded queries; never prints secrets (only whether something is configured).
 */
import { sql } from "drizzle-orm";
import type { DiagnosticCheck, DiagnosticStatus, DiagnosticsView } from "@shared/s30-contract";
import { emailTransportConfigured } from "../../lib/email";
import { getAuditFailureStats } from "../../lib/audit";
import { loadAssistantConfig } from "../academic-assistant/config";
import { currentMonth } from "../academic-assistant/budget";
import { CONCIERGE_RUN } from "./concierge";
import { readRun, rows, type SqlExecutor } from "./ops";

export const S30_TABLES = ["ops_events", "ops_exception_states", "ops_notifications", "ops_runs", "academic_import_mappings", "academic_import_batches",
  "academic_import_rows", "academic_reported_records", "calendar_events", "calendar_subscriptions"] as const;
const SWEEP_STALE_MS = 45 * 60_000;

const worst = (list: readonly DiagnosticStatus[]): DiagnosticStatus =>
  list.includes("error") ? "error" : list.includes("warning") ? "warning" : list.every((s) => s === "off") ? "off" : "ok";

export async function computeDiagnostics(db: SqlExecutor, now: Date, release: string | null, deps: { exceptionsOpen?: () => Promise<number>; env?: NodeJS.ProcessEnv } = {}): Promise<DiagnosticsView> {
  const env = deps.env ?? process.env;
  const checks: DiagnosticCheck[] = [];
  const t0 = Date.now();
  let dbOk = true;
  try { await db.execute(sql`SELECT 1`); } catch { dbOk = false; }
  checks.push({ key: "database", status: dbOk ? "ok" : "error", code: dbOk ? "ok" : "unreachable", facts: { latencyMs: Date.now() - t0 } });
  if (!dbOk) return { generatedAt: now.toISOString(), release, overall: "error", checks };

  const present = new Set(rows(await db.execute(sql`SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN (${sql.join(S30_TABLES.map((t) => sql`${t}`), sql`, `)})`)).map((r) => String(r.relname)));
  const missing = S30_TABLES.filter((t) => !present.has(t));
  checks.push({ key: "schema", status: missing.length ? "error" : "ok", code: missing.length ? "s30_not_applied" : "ok", facts: { tables: present.size, expected: S30_TABLES.length, missing: missing.join(",") || null } });
  const have = (t: string) => present.has(t);

  if (have("ops_events")) {
    const [e] = rows(await db.execute(sql`SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS day, count(*)::int AS total, max(created_at) AS last FROM ops_events`));
    checks.push({ key: "events", status: "ok", code: "ok", facts: { last24h: Number(e?.day ?? 0), total: Number(e?.total ?? 0), lastAt: e?.last ? new Date(String(e.last)).toISOString() : null } });
  } else checks.push({ key: "events", status: "error", code: "s30_not_applied", facts: {} });

  try {
    const open = deps.exceptionsOpen ? await deps.exceptionsOpen() : null;
    const [st] = have("ops_exception_states") ? rows(await db.execute(sql`SELECT count(*) FILTER (WHERE state = 'acknowledged')::int AS ack, count(*) FILTER (WHERE state = 'snoozed' AND snoozed_until > now())::int AS snoozed FROM ops_exception_states`)) : [];
    checks.push({ key: "exceptions", status: "ok", code: "ok", facts: { open, acknowledged: Number(st?.ack ?? 0), snoozed: Number(st?.snoozed ?? 0) } });
  } catch {
    checks.push({ key: "exceptions", status: "error", code: "control_center_failed", facts: {} });
  }

  const emailOn = emailTransportConfigured(env);
  if (have("ops_notifications")) {
    const [n] = rows(await db.execute(sql`SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS day, count(*) FILTER (WHERE read_at IS NULL)::int AS unread,
        count(*) FILTER (WHERE email_status = 'failed' AND created_at > now() - interval '7 days')::int AS failed, count(*) FILTER (WHERE email_status = 'sent' AND created_at > now() - interval '7 days')::int AS sent FROM ops_notifications`));
    const failed = Number(n?.failed ?? 0);
    checks.push({ key: "notifications", status: failed > 0 ? "warning" : emailOn ? "ok" : "warning", code: failed > 0 ? "email_failures" : emailOn ? "ok" : "email_not_configured",
      facts: { last24h: Number(n?.day ?? 0), unread: Number(n?.unread ?? 0), emailSent7d: Number(n?.sent ?? 0), emailFailed7d: failed, emailTransport: emailOn } });
  } else checks.push({ key: "notifications", status: "error", code: "s30_not_applied", facts: { emailTransport: emailOn } });

  const run = await readRun(db, CONCIERGE_RUN);
  const off = env.S30_CONCIERGE === "off";
  const age = run?.finishedAt ? now.getTime() - Date.parse(run.finishedAt) : null;
  checks.push({
    key: "concierge",
    status: off ? "off" : !run ? "warning" : run.status === "error" ? "error" : age !== null && age > SWEEP_STALE_MS ? "warning" : "ok",
    code: off ? "disabled" : !run ? "never_ran" : run.status === "error" ? "last_run_failed" : age !== null && age > SWEEP_STALE_MS ? "sweep_stale" : "ok",
    facts: { lastFinishedAt: run?.finishedAt ?? null, lastStatus: run?.status ?? null, planned: Number(run?.detail?.planned ?? 0) || null, created: Number(run?.detail?.created ?? 0) || null },
  });

  if (have("academic_import_batches")) {
    const [i] = rows(await db.execute(sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('uploaded','validated','approved'))::int AS drafts,
        count(*) FILTER (WHERE status = 'committed')::int AS committed, count(*) FILTER (WHERE status = 'rolled_back')::int AS rolled_back, max(uploaded_at) AS last FROM academic_import_batches`));
    const [r] = rows(await db.execute(sql`SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'active' AND review_state = 'needs_review')::int AS review FROM academic_reported_records`));
    checks.push({ key: "imports", status: Number(r?.review ?? 0) > 0 ? "warning" : "ok", code: Number(r?.review ?? 0) > 0 ? "records_need_review" : "ok",
      facts: { batches: Number(i?.total ?? 0), drafts: Number(i?.drafts ?? 0), committed: Number(i?.committed ?? 0), rolledBack: Number(i?.rolled_back ?? 0), activeRecords: Number(r?.active ?? 0), needsReview: Number(r?.review ?? 0), lastUploadAt: i?.last ? new Date(String(i.last)).toISOString() : null } });
  } else checks.push({ key: "imports", status: "error", code: "s30_not_applied", facts: {} });

  if (have("calendar_events")) {
    const [c] = rows(await db.execute(sql`SELECT count(*) FILTER (WHERE status = 'scheduled' AND starts_at > now())::int AS upcoming, count(*)::int AS total FROM calendar_events`));
    const [s] = rows(await db.execute(sql`SELECT count(*) FILTER (WHERE revoked_at IS NULL)::int AS active, count(*) FILTER (WHERE revoked_at IS NULL AND last_used_at > now() - interval '7 days')::int AS used FROM calendar_subscriptions`));
    checks.push({ key: "calendar", status: "ok", code: "ok", facts: { scheduledUpcoming: Number(c?.upcoming ?? 0), scheduledTotal: Number(c?.total ?? 0), activeFeeds: Number(s?.active ?? 0), feedsUsed7d: Number(s?.used ?? 0) } });
  } else checks.push({ key: "calendar", status: "error", code: "s30_not_applied", facts: {} });

  const cfg = loadAssistantConfig();
  let spentUsd: number | null = null;
  try {
    const [b] = rows(await db.execute(sql`SELECT cost_micro_usd FROM assistant_usage_monthly WHERE month = ${currentMonth(now)} LIMIT 1`));
    spentUsd = b ? Math.round(Number(b.cost_micro_usd) / 10_000) / 100 : 0;
  } catch { spentUsd = null; }
  const aiLive = cfg.liveEnabled && cfg.hasApiKey;
  const share = spentUsd !== null && cfg.monthlyBudgetUsd > 0 ? spentUsd / cfg.monthlyBudgetUsd : null;
  checks.push({ key: "ai", status: !aiLive ? "off" : share !== null && share >= 0.9 ? "warning" : "ok", code: !cfg.liveEnabled ? "disabled" : !cfg.hasApiKey ? "not_configured" : share !== null && share >= 0.9 ? "budget_nearly_spent" : "ok",
    facts: { model: cfg.model, live: aiLive, liveRoles: [...cfg.liveRoles].join(","), monthlyBudgetUsd: cfg.monthlyBudgetUsd, spentThisMonthUsd: spentUsd, fleetPrivacy: "aggregates_only" } });

  const audit = getAuditFailureStats();
  checks.push({ key: "audit", status: audit.total > 0 ? "warning" : "ok", code: audit.total > 0 ? "write_failures" : "ok", facts: { failuresSinceStart: audit.total, lastFailureAt: audit.last?.at ?? null } });

  return { generatedAt: now.toISOString(), release, overall: worst(checks.map((c) => c.status).filter((s) => s !== "off")), checks };
}
