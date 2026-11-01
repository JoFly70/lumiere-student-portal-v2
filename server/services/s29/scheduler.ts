/**
 * S29 — durable scheduler.
 *
 * Production runs on Replit Autoscale: instances start on traffic, may be several, and scale to zero when idle, so
 * an in-process timer alone is not a schedule. The job state therefore lives in Postgres (s29_jobs) and a job runs
 * only when its interval has elapsed since its last start AND it holds a short lease (UPDATE ... RETURNING), so:
 *   - restarts and deployments lose nothing (the next tick picks up from the stored state);
 *   - concurrent instances never run the same job twice;
 *   - work is caught up on the next tick after an idle period.
 * Ticks come from (1) a 60 s timer while an instance is alive, (2) incoming requests (throttled, after the response),
 * and (3) POST /api/ops/scheduler/tick with the S29_CRON_SECRET header, for an external pinger (a Replit Scheduled
 * Deployment or any cron) so reminders flow even with no traffic. The Diagnostics Studio shows the last successful
 * run of every job and flags a job as stalled when it misses three intervals.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { JobView } from "@shared/s29-contract";
import { logger } from "../../lib/logger";
import { errorCode, iso, rows, s29Schema, type Tx } from "./db";
import { computeAttention } from "./rules";
import { loadSettings, syncAttention } from "./attention-store";
import { runConcierge } from "./concierge";
import { deliverDue, enqueue, type Deliver } from "./outbox";
import { autoResolveQuiet, incidentsToAlert, markAlerted, recordIncident } from "./incidents";

export interface JobDef { readonly name: string; readonly intervalSeconds: number; readonly run: (db: Tx, now: Date) => Promise<Record<string, unknown>> }

const OWNER = `${process.pid}-${randomUUID().slice(0, 8)}`;
const LEASE_SECONDS = 240;

export function defaultJobs(deliver?: Deliver): JobDef[] {
  return [
    {
      name: "rules.sync", intervalSeconds: 600,
      run: async (db, now) => {
        const settings = await loadSettings(db);
        const { items, facts, truncated } = await computeAttention(db, now, settings, true);
        const sync = await syncAttention(db, items, now);
        const concierge = await runConcierge(db, items, facts, settings, now);
        return { ...sync, truncated, concierge };
      },
    },
    { name: "outbox.deliver", intervalSeconds: 60, run: async (db, now) => ({ ...(await deliverDue(db, now, deliver)) }) },
    {
      name: "ops.watch", intervalSeconds: 300,
      run: async (db, now) => {
        // Stalled jobs -> incidents.
        const stalled = rows(await db.execute(sql`SELECT name FROM s29_jobs WHERE name <> 'ops.watch' AND (last_success_at IS NULL OR last_success_at < now() - (interval_seconds * 3) * interval '1 second') AND last_started_at IS NOT NULL`));
        for (const s of stalled) await recordIncident(db, { subsystem: `job:${String(s.name)}`, category: "job.stalled", severity: "warning" }, now.getTime());
        // Alerts to administrators (deduplicated per incident per 6 h; acknowledged incidents are never re-alerted).
        const alerts = await incidentsToAlert(db);
        let sent = 0;
        if (alerts.length) {
          const admins = rows(await db.execute(sql`SELECT u.id, u.email, l.language FROM users u LEFT JOIN user_language_preference l ON l.user_id = u.id WHERE u.role = 'admin' ORDER BY u.created_at LIMIT 5`));
          for (const inc of alerts) {
            const window = Math.floor(now.getTime() / (6 * 3_600_000));
            for (const a of admins) {
              const res = await enqueue(db, {
                dedupeKey: `ops.alert:${inc.fingerprint}:${window}:${String(a.id)}`, audience: "staff", template: "ops.alert", source: "ops",
                params: { subsystem: inc.subsystem, category: inc.category, severity: inc.severity, occurrences: inc.occurrences, since: inc.firstSeenAt.slice(0, 16).replace("T", " ") + " UTC" },
                staff: { userId: String(a.id), email: a.email ? String(a.email) : null, language: a.language === "fr" ? "fr" : "en" }, now,
              });
              if (res.created) sent += 1;
            }
            await markAlerted(db, inc.id);
          }
        }
        const resolved = await autoResolveQuiet(db);
        return { stalled: stalled.length, alerts: alerts.length, alertMessages: sent, autoResolved: resolved };
      },
    },
  ];
}

let lastTickAt: string | null = null;
let lastTickOutcome: string = "never";
export function schedulerState(): { lastTickAt: string | null; lastTickOutcome: string; owner: string } {
  return { lastTickAt, lastTickOutcome, owner: OWNER };
}

let running = false;
/** Runs every due job once. Safe to call concurrently (in-process guard + DB leases). */
export async function tick(db: Tx, now: Date = new Date(), jobs: JobDef[] = defaultJobs()): Promise<Record<string, unknown>> {
  if (running) return { skipped: "already_running" };
  running = true;
  lastTickAt = now.toISOString();
  const results: Record<string, unknown> = {};
  try {
    const schema = await s29Schema(db, now.getTime());
    if (!schema.present) { lastTickOutcome = "schema_missing"; return { skipped: "schema_missing", missing: schema.missing }; }
    for (const job of jobs) {
      await db.execute(sql`INSERT INTO s29_jobs (name, interval_seconds) VALUES (${job.name}, ${job.intervalSeconds}) ON CONFLICT (name) DO UPDATE SET interval_seconds = EXCLUDED.interval_seconds WHERE s29_jobs.interval_seconds <> EXCLUDED.interval_seconds`);
      const leased = rows(await db.execute(sql`UPDATE s29_jobs SET lease_owner = ${OWNER}, lease_until = ${new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString()}::timestamptz, last_started_at = ${now.toISOString()}::timestamptz, runs = runs + 1, updated_at = now()
          WHERE name = ${job.name} AND (lease_until IS NULL OR lease_until < ${now.toISOString()}::timestamptz)
            AND (last_started_at IS NULL OR last_started_at <= ${now.toISOString()}::timestamptz - (interval_seconds * interval '1 second') + interval '5 seconds')
          RETURNING name`));
      if (!leased.length) continue;
      const started = Date.now();
      try {
        const out = await job.run(db, now);
        await db.execute(sql`UPDATE s29_jobs SET last_success_at = now(), last_error = NULL, consecutive_failures = 0, last_duration_ms = ${Date.now() - started}, last_result = ${JSON.stringify(out)}::jsonb, lease_until = NULL, updated_at = now() WHERE name = ${job.name}`);
        results[job.name] = out;
      } catch (error) {
        const code = errorCode(error);
        logger.warn("S29 job failed", { job: job.name, code });
        await Promise.resolve(db.execute(sql`UPDATE s29_jobs SET last_error = ${code.slice(0, 200)}, failures = failures + 1, consecutive_failures = consecutive_failures + 1, last_duration_ms = ${Date.now() - started}, lease_until = NULL, updated_at = now() WHERE name = ${job.name}`)).catch(() => undefined);
        await recordIncident(db, { subsystem: `job:${job.name}`, category: "job.failed", severity: "warning" }).catch(() => undefined);
        results[job.name] = { error: code };
      }
    }
    lastTickOutcome = "ok";
    return results;
  } catch (error) {
    lastTickOutcome = `error:${errorCode(error)}`;
    logger.warn("S29 scheduler tick failed", { code: errorCode(error) });
    return { error: errorCode(error) };
  } finally {
    running = false;
  }
}

export async function readJobs(db: Tx, now: Date = new Date()): Promise<JobView[]> {
  const known = new Map(defaultJobs().map((j) => [j.name, j.intervalSeconds] as const));
  const stored = new Map(rows(await db.execute(sql`SELECT * FROM s29_jobs ORDER BY name`)).map((r) => [String(r.name), r] as const));
  return [...known.entries()].map(([name, interval]) => {
    const r = stored.get(name);
    const lastSuccess = r ? iso(r.last_success_at) : null;
    const consecutive = r ? Number(r.consecutive_failures) : 0;
    const age = lastSuccess ? (now.getTime() - Date.parse(lastSuccess)) / 1000 : Infinity;
    const state: JobView["state"] = !r || !r.last_started_at ? "unknown" : consecutive >= 3 ? "failed" : age > interval * 3 ? "degraded" : consecutive > 0 ? "degraded" : "healthy";
    return {
      name, intervalSeconds: interval, lastStartedAt: r ? iso(r.last_started_at) : null, lastSuccessAt: lastSuccess, lastError: r?.last_error ? String(r.last_error) : null,
      consecutiveFailures: consecutive, runs: r ? Number(r.runs) : 0, state,
    };
  });
}

// ── process wiring ───────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;
let lastKick = 0;

async function defaultDb(): Promise<Tx> {
  const { db } = await import("../../lib/db");
  return db as unknown as Tx;
}

/** Starts the in-process 60 s timer (unref'd: it never keeps a process alive). Disabled with S29_SCHEDULER=off. */
export function startScheduler(): void {
  if (timer || process.env.S29_SCHEDULER === "off" || !process.env.DATABASE_URL) return;
  timer = setInterval(() => { void defaultDb().then((db) => tick(db)).catch(() => undefined); }, 60_000);
  timer.unref();
  setTimeout(() => { void defaultDb().then((db) => tick(db)).catch(() => undefined); }, 15_000).unref();
}

/** Request-driven catch-up (Autoscale): at most once a minute per instance, after the response has been sent. */
export function kickFromRequest(): void {
  if (process.env.S29_SCHEDULER === "off" || !process.env.DATABASE_URL) return;
  const now = Date.now();
  if (now - lastKick < 60_000) return;
  lastKick = now;
  setImmediate(() => { void defaultDb().then((db) => tick(db)).catch(() => undefined); });
}
