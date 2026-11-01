/**
 * S29 — Owner Operations & Diagnostics Studio (admin only).
 *
 * States are evidence-based:
 *   live            the running production process demonstrably uses it (recent successful real activity)
 *   healthy         the probe succeeded now, but no recent production usage was observed
 *   degraded        partially working (slow, retries, per-instance fallback, stale job)
 *   failed          the probe failed
 *   not_configured  the required configuration is absent
 *   unknown         no evidence either way (never shown as success)
 * Every probe is read-only, bounded by a timeout and returns short evidence lines without secrets, tokens,
 * message bodies, file names or student data. A menu entry or code file is never evidence.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { DiagnosticCheckKey, DiagnosticCheckResult, DiagnosticsView, FeatureReadinessView, HealthState, ReleaseView, SubsystemView } from "@shared/s29-contract";
import { emailTransportConfigured } from "../../lib/email";
import { getRateLimitBackend } from "../../lib/rate-limit-store";
import { getAuditFailureStats } from "../../lib/audit";
import { loadAssistantConfig } from "../academic-assistant/config";
import { currentMonth, usdToMicro } from "../academic-assistant/budget";
import { errorCode, iso, rows, s29Schema, type Tx } from "./db";
import { listIncidents } from "./incidents";
import { readJobs, schedulerState } from "./scheduler";

const PROBE_MS = 3500;
const RELEASE_BRANCH_MARKER = "https://raw.githubusercontent.com/JoFly70/lumiere-student-portal-v2/claude/s26-owner-and-first-student-finish/release/S26_RELEASE_SHA";
const LIVE_URL = "https://lumiere-student-portal-v-2.replit.app";
const CUSTOM_DOMAIN = "lumiereportal.app";
const STARTED_AT = new Date().toISOString();

export function timeout<T>(p: PromiseLike<T>, ms = PROBE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "PROBE_TIMEOUT" })), ms);
    Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function probe(key: string, fn: () => Promise<{ state: HealthState; evidence: string[] }>): Promise<SubsystemView> {
  const started = Date.now();
  try {
    const out = await timeout(fn());
    return { key, state: out.state, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, evidence: out.evidence.slice(0, 6) };
  } catch (error) {
    return { key, state: "failed", checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, evidence: [`probe error: ${errorCode(error)}`] };
  }
}

// ── release ──────────────────────────────────────────────────────────────────

export function readRunningRelease(cwd = process.cwd()): { sha: string | null; writtenAt: string | null } {
  try {
    const file = join(cwd, "release.json");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const sha = typeof raw?.sha === "string" && /^[0-9a-f]{7,40}$/.test(raw.sha) ? raw.sha : null;
    return { sha, writtenAt: statSync(file).mtime.toISOString() };
  } catch {
    return { sha: null, writtenAt: null };
  }
}

let markerCache: { at: number; sha: string | null } | null = null;
export async function fetchMarker(fetchImpl: typeof fetch = fetch, nowMs = Date.now()): Promise<{ sha: string | null; checkedAt: string | null }> {
  if (markerCache && nowMs - markerCache.at < 300_000) return { sha: markerCache.sha, checkedAt: new Date(markerCache.at).toISOString() };
  try {
    const res = await fetchImpl(RELEASE_BRANCH_MARKER, { signal: AbortSignal.timeout(PROBE_MS) });
    const text = res.ok ? (await res.text()).trim() : "";
    const sha = /^[0-9a-f]{40}$/.test(text) ? text : null;
    markerCache = { at: nowMs, sha };
    return { sha, checkedAt: new Date(nowMs).toISOString() };
  } catch {
    return { sha: null, checkedAt: null };
  }
}

async function customDomainState(runningSha: string | null, fetchImpl: typeof fetch = fetch): Promise<ReleaseView["customDomain"]> {
  try {
    const res = await fetchImpl(`https://${CUSTOM_DOMAIN}/health`, { signal: AbortSignal.timeout(PROBE_MS), redirect: "manual" });
    const body = await res.json().catch(() => null) as { release?: unknown } | null;
    if (res.ok && body && typeof body.release === "string") {
      if (runningSha && body.release === runningSha) return { host: CUSTOM_DOMAIN, state: "live", evidence: `HTTPS answered /health with this release (${body.release.slice(0, 7)})` };
      return { host: CUSTOM_DOMAIN, state: "degraded", evidence: `HTTPS answered, but /health reports release ${String(body.release).slice(0, 7)} (not this deployment)` };
    }
    return { host: CUSTOM_DOMAIN, state: "degraded", evidence: `HTTPS answered with status ${res.status}; it does not serve this application's /health (still attached elsewhere)` };
  } catch (error) {
    return { host: CUSTOM_DOMAIN, state: "unknown", evidence: `not reachable from the server (${errorCode(error)})` };
  }
}

export async function releaseView(fetchImpl: typeof fetch = fetch): Promise<ReleaseView> {
  const running = readRunningRelease();
  const [marker, domain] = await Promise.all([fetchMarker(fetchImpl), customDomainState(running.sha, fetchImpl)]);
  return {
    appUrl: process.env.APP_URL || LIVE_URL, environment: process.env.NODE_ENV ?? "unknown",
    runningSha: running.sha, markerSha: marker.sha, markerCheckedAt: marker.checkedAt,
    isApprovedReleaseLive: running.sha && marker.sha ? running.sha === marker.sha : null,
    processStartedAt: STARTED_AT, releaseFileWrittenAt: running.writtenAt, customDomain: domain,
  };
}

// ── subsystems ───────────────────────────────────────────────────────────────

async function supabase() {
  const mod = await import("../../lib/supabase");
  return mod;
}

export async function collectSubsystems(db: Tx, now: Date): Promise<SubsystemView[]> {
  const schema = await s29Schema(db).catch(() => ({ present: false, missing: ["(unreachable)"] }));
  const s29 = schema.present;
  const jobs = s29 ? await readJobs(db, now).catch(() => []) : [];
  const job = (n: string) => jobs.find((j) => j.name === n);
  const list: Array<Promise<SubsystemView>> = [
    probe("api", async () => ({ state: "live", evidence: [`process up ${Math.round(process.uptime() / 60)} min`, `node ${process.version}`] })),
    probe("database", async () => {
      const t = Date.now();
      await db.execute(sql`SELECT 1`);
      const ms = Date.now() - t;
      return { state: ms > 1500 ? "degraded" : "live", evidence: [`SELECT 1 in ${ms} ms`, `pool cap ${process.env.DB_POOL_MAX ?? "driver default (10)"}`] };
    }),
    probe("auth", async () => {
      const { supabaseAdmin, isSupabaseConfigured } = await supabase();
      if (!isSupabaseConfigured) return { state: "not_configured", evidence: ["SUPABASE_URL / service key not set"] };
      const { error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
      return error ? { state: "failed", evidence: [`auth admin API error ${error.status ?? ""}`] } : { state: "healthy", evidence: ["auth admin API answered"] };
    }),
    probe("email", async () => {
      if (!emailTransportConfigured()) return { state: "not_configured", evidence: ["EMAIL_ENABLED, EMAIL_FROM or RESEND_API_KEY missing; invitations offer copy-link only"] };
      if (!s29) return { state: "unknown", evidence: ["configured; no delivery history yet (S29 schema not applied)"] };
      const r = rows(await db.execute(sql`SELECT max(sent_at) FILTER (WHERE email_state = 'accepted') AS last_ok, count(*) FILTER (WHERE email_state = 'failed' AND updated_at > now() - interval '24 hours')::int AS failed24 FROM s29_notifications`))[0] ?? {};
      const lastOk = iso(r.last_ok);
      const failed = Number(r.failed24 ?? 0);
      if (failed > 0 && !lastOk) return { state: "failed", evidence: [`${failed} failed in 24 h`, "no message accepted yet"] };
      if (lastOk && Date.now() - Date.parse(lastOk) < 7 * 86_400_000) return { state: failed ? "degraded" : "live", evidence: [`last provider acceptance ${lastOk}`, `${failed} failed in 24 h`] };
      return { state: "healthy", evidence: ["configured", lastOk ? `last provider acceptance ${lastOk}` : "no message accepted yet"] };
    }),
    probe("storage", async () => {
      const { supabaseAdmin, isSupabaseConfigured } = await supabase();
      if (!isSupabaseConfigured) return { state: "not_configured", evidence: ["Supabase not configured"] };
      const { data, error } = await supabaseAdmin.storage.getBucket("student-documents");
      if (error || !data) return { state: "failed", evidence: ["bucket student-documents not readable"] };
      return { state: data.public ? "degraded" : "healthy", evidence: [data.public ? "bucket is PUBLIC (should be private)" : "private bucket student-documents present"] };
    }),
    probe("support", async () => {
      const r = rows(await db.execute(sql`SELECT count(*) FILTER (WHERE status IN ('open','in_progress','waiting_on_student'))::int AS active, max(updated_at) AS last FROM support_tickets`))[0] ?? {};
      return { state: iso(r.last) ? "live" : "healthy", evidence: [`${Number(r.active ?? 0)} active tickets`, iso(r.last) ? `last activity ${iso(r.last)}` : "no tickets yet"] };
    }),
    probe("billing", async () => {
      const r = rows(await db.execute(sql`SELECT (SELECT count(*)::int FROM student_billing_obligations) AS obligations, (SELECT count(*)::int FROM student_billing_installments) AS installments`))[0] ?? {};
      return { state: "healthy", evidence: [`${Number(r.obligations ?? 0)} obligations, ${Number(r.installments ?? 0)} instalments recorded`] };
    }),
    probe("academic", async () => {
      const r = rows(await db.execute(sql`SELECT (SELECT count(*)::int FROM hs_enrollments) AS hs, (SELECT count(*)::int FROM student_roadmap_plans WHERE published_version_id IS NOT NULL) AS degree, (SELECT max(updated_at) FROM hs_task_progress) AS last`))[0] ?? {};
      return { state: iso(r.last) ? "live" : "healthy", evidence: [`${Number(r.hs ?? 0)} high-school enrolments, ${Number(r.degree ?? 0)} published degree roadmaps`, iso(r.last) ? `last progress logged ${iso(r.last)}` : "no progress logged yet"] };
    }),
    probe("notifications", async () => {
      if (!s29) return { state: "not_configured", evidence: [`S29 schema not applied (missing ${schema.missing.length} tables)`] };
      const r = rows(await db.execute(sql`SELECT count(*) FILTER (WHERE email_state IN ('queued','attempted'))::int AS pending, count(*) FILTER (WHERE email_state = 'failed')::int AS failed, count(*)::int AS total, min(next_attempt_at) FILTER (WHERE email_state IN ('queued','attempted')) AS oldest_due FROM s29_notifications`))[0] ?? {};
      const oldest = iso(r.oldest_due);
      const stuck = oldest ? Date.now() - Date.parse(oldest) > 30 * 60_000 : false;
      const d = job("outbox.deliver");
      return { state: stuck || d?.state === "failed" ? "degraded" : Number(r.total ?? 0) > 0 ? "live" : "healthy",
        evidence: [`${Number(r.total ?? 0)} notifications, ${Number(r.pending ?? 0)} pending, ${Number(r.failed ?? 0)} failed`, stuck ? `oldest due since ${oldest}` : "no stalled delivery", `delivery job: ${d?.state ?? "unknown"}`] };
    }),
    probe("scheduler", async () => {
      if (!s29) return { state: "not_configured", evidence: ["S29 schema not applied"] };
      const st = schedulerState();
      const worst: HealthState = jobs.some((j) => j.state === "failed") ? "failed" : jobs.some((j) => j.state === "degraded") ? "degraded" : jobs.every((j) => j.state === "unknown") ? "unknown" : "live";
      return { state: worst, evidence: [...jobs.map((j) => `${j.name}: last success ${j.lastSuccessAt ?? "never"}`), `this instance last tick ${st.lastTickAt ?? "never"} (${st.lastTickOutcome})`, process.env.S29_CRON_SECRET ? "external tick endpoint enabled" : "external tick endpoint disabled (S29_CRON_SECRET not set)"] };
    }),
    probe("ai", async () => {
      const cfg = loadAssistantConfig();
      if (!cfg.hasApiKey) return { state: "not_configured", evidence: ["META_MODEL_API_KEY not set"] };
      if (!cfg.liveEnabled) return { state: "not_configured", evidence: ["SPARK_ASSISTANT_ENABLED is not true"] };
      const month = currentMonth(now);
      const r = rows(await db.execute(sql`SELECT cost_micro_usd, requests FROM assistant_usage_monthly WHERE month = ${month}`))[0];
      const spent = Number(r?.cost_micro_usd ?? 0);
      const cap = usdToMicro(cfg.monthlyBudgetUsd);
      const share = cap ? spent / cap : 0;
      return { state: share >= 1 ? "degraded" : r ? "live" : "healthy", evidence: [`model ${cfg.model}`, `budget used ${(share * 100).toFixed(0)}% of $${cfg.monthlyBudgetUsd}`, `${Number(r?.requests ?? 0)} requests this month`, `live roles: ${[...cfg.liveRoles].join(", ") || "none"}`] };
    }),
    probe("rate_limit", async () => {
      const backend = getRateLimitBackend();
      return backend === "redis" ? { state: "healthy", evidence: ["Redis-backed (shared across instances)"] } : { state: "degraded", evidence: ["in-memory per instance (REDIS_URL not set)"] };
    }),
    probe("audit", async () => {
      const stats = getAuditFailureStats() as unknown as { total?: number; byEventType?: Record<string, number> };
      const failures = Number(stats.total ?? 0);
      const r = rows(await db.execute(sql`SELECT max(created_at) AS last FROM audit_logs`))[0] ?? {};
      return { state: failures > 0 ? "degraded" : iso(r.last) ? "live" : "healthy", evidence: [`${failures} audit write failures in this process`, iso(r.last) ? `last audit event ${iso(r.last)}` : "no audit events yet"] };
    }),
    probe("imports", async () => {
      if (!s29) return { state: "not_configured", evidence: ["S29 schema not applied"] };
      const r = rows(await db.execute(sql`SELECT count(*)::int AS batches, max(committed_at) AS last FROM s29_import_batches`))[0] ?? {};
      return { state: iso(r.last) ? "live" : "healthy", evidence: [`${Number(r.batches ?? 0)} import batches`, iso(r.last) ? `last commit ${iso(r.last)}` : "nothing committed yet"] };
    }),
    probe("calendar", async () => {
      if (!s29) return { state: "not_configured", evidence: ["S29 schema not applied"] };
      const r = rows(await db.execute(sql`SELECT (SELECT count(*)::int FROM s29_calendar_events) AS events, (SELECT count(*)::int FROM s29_calendar_tokens WHERE revoked_at IS NULL) AS tokens, (SELECT max(last_used_at) FROM s29_calendar_tokens) AS used`))[0] ?? {};
      return { state: iso(r.used) ? "live" : "healthy", evidence: [`${Number(r.events ?? 0)} calendar events, ${Number(r.tokens ?? 0)} active subscriptions`, iso(r.used) ? `feed last used ${iso(r.used)}` : "no subscription used yet"] };
    }),
  ];
  return Promise.all(list);
}

export function featureMatrix(subs: readonly SubsystemView[], jobs: Awaited<ReturnType<typeof readJobs>>, extra: { conciergeEnabled: boolean; studentAssistant: "guide" }): FeatureReadinessView[] {
  const s = (k: string) => subs.find((x) => x.key === k);
  const st = (k: string): HealthState => s(k)?.state ?? "unknown";
  const worst = (...states: HealthState[]): HealthState => {
    const order: HealthState[] = ["failed", "not_configured", "degraded", "unknown", "healthy", "live"];
    return order.find((o) => states.includes(o)) ?? "unknown";
  };
  const job = (n: string) => jobs.find((j) => j.name === n);
  const ev = (...k: string[]) => k.flatMap((x) => (s(x)?.evidence ?? []).slice(0, 2).map((e) => `${x}: ${e}`));
  return [
    { key: "login", state: worst(st("auth"), st("database")), evidence: [...ev("auth", "database"), `invitation email: ${st("email")}`] },
    { key: "flight_deck_roadmap", state: worst(st("academic"), st("database")), evidence: ev("academic") },
    { key: "support", state: st("support"), evidence: ev("support") },
    { key: "documents", state: worst(st("storage"), st("database")), evidence: ev("storage") },
    { key: "billing", state: st("billing"), evidence: ev("billing") },
    { key: "owner_ai", state: st("ai"), evidence: ev("ai") },
    { key: "student_assistant", state: "live", evidence: ["built-in program guide (not live AI, by policy)"] },
    { key: "concierge", state: !extra.conciergeEnabled ? "not_configured" : job("rules.sync")?.state ?? "unknown", evidence: [`concierge ${extra.conciergeEnabled ? "enabled" : "disabled in settings"}`, `rules job last success ${job("rules.sync")?.lastSuccessAt ?? "never"}`] },
    { key: "notification_center", state: worst(st("notifications"), job("outbox.deliver")?.state ?? "unknown"), evidence: [...ev("notifications"), `email: ${st("email")}`] },
    { key: "academic_imports", state: st("imports"), evidence: ev("imports") },
    { key: "calendar", state: st("calendar"), evidence: ev("calendar") },
    { key: "fleet_ai", state: st("notifications") === "not_configured" ? "not_configured" : job("rules.sync")?.lastSuccessAt ? (st("ai") === "live" ? "live" : "healthy") : "unknown", evidence: ["deterministic answers from the Needs Attention store", `optional AI narrative: ${st("ai")}`] },
  ];
}

export async function buildDiagnostics(db: Tx, now: Date, conciergeEnabled: boolean): Promise<DiagnosticsView> {
  const [release, subsystems] = await Promise.all([releaseView(), collectSubsystems(db, now)]);
  const s29 = (await s29Schema(db).catch(() => ({ present: false }))).present;
  const jobs = s29 ? await readJobs(db, now).catch(() => []) : [];
  const incidents = s29 ? await listIncidents(db, { limit: 50 }).catch(() => []) : [];
  const features = featureMatrix(subsystems, jobs, { conciergeEnabled, studentAssistant: "guide" });
  const failing = subsystems.filter((x) => x.state === "failed").length;
  const degraded = subsystems.filter((x) => x.state === "degraded").length;
  const openIncidents = incidents.filter((i) => i.status === "open").length;
  const critical = incidents.some((i) => i.status === "open" && i.severity === "critical");
  const state: HealthState = failing || critical ? "failed" : degraded || openIncidents ? "degraded" : release.isApprovedReleaseLive === false ? "degraded" : "healthy";
  const headline = failing ? `${failing} subsystem(s) failing` : critical ? "A critical incident is open" : release.isApprovedReleaseLive === false ? "The live version differs from the approved release" : degraded ? `${degraded} subsystem(s) degraded` : openIncidents ? `${openIncidents} open incident(s)` : "All probed subsystems answered";
  return { generatedAt: now.toISOString(), summary: { state, headline, openIncidents, failingSubsystems: failing }, release, subsystems, features, jobs, incidents };
}

// ── one-click checks (read-only) ─────────────────────────────────────────────

type Step = DiagnosticCheckResult["steps"][number];

export async function runCheck(db: Tx, key: DiagnosticCheckKey, actor: { id: string }, now: Date): Promise<DiagnosticCheckResult> {
  const started = Date.now();
  const steps: Step[] = [];
  const step = async (label: string, fn: () => Promise<string>) => {
    try { steps.push({ label, ok: true, detail: await timeout(fn()) }); return true; }
    catch (error) { steps.push({ label, ok: false, detail: `failed: ${errorCode(error)}` }); return false; }
  };
  let conclusion = "";
  let nextAction: string | null = null;
  switch (key) {
    case "programs_page": {
      const a = await step("Database reachable", async () => { await db.execute(sql`SELECT 1`); return "SELECT 1 ok"; });
      const b = await step("degree_programs table readable", async () => `${Number(rows(await db.execute(sql`SELECT count(*)::int AS n FROM degree_programs`))[0]?.n ?? 0)} programs`);
      const c = await step("Supabase REST answers for degree_programs", async () => { const { supabaseAdmin } = await supabase(); const { error, count } = await supabaseAdmin.from("degree_programs").select("id", { count: "exact", head: true }); if (error) throw Object.assign(new Error("rest"), { code: error.code }); return `${count ?? 0} rows visible to the API`; });
      conclusion = a && b && c ? "The Programs data path works; a failing page is then a client or auth problem (check the browser console and the correlation id)." : !a ? "The database is unreachable." : !b ? "The degree_programs table is missing or unreadable." : "The Supabase REST API cannot read degree_programs (service key or schema cache).";
      nextAction = a && b && c ? null : !a ? "Check DATABASE_URL and the pooler (15 clients)." : !b ? "Apply the degree programs migration through the release runner." : "Check SUPABASE_SERVICE_KEY and reload the PostgREST schema cache.";
      break;
    }
    case "profile_access": {
      const a = await step("Your account row is readable", async () => { const r = rows(await db.execute(sql`SELECT role FROM users WHERE id = ${actor.id}`))[0]; if (!r) throw Object.assign(new Error("missing"), { code: "NO_ROW" }); return `role ${String(r.role)}`; });
      const b = await step("Supabase Auth returns your identity", async () => { const { supabaseAdmin } = await supabase(); const { data, error } = await supabaseAdmin.auth.admin.getUserById(actor.id); if (error || !data?.user) throw Object.assign(new Error("auth"), { code: error?.status ? `AUTH_${error.status}` : "NO_USER" }); return "identity found (email not shown)"; });
      conclusion = a && b ? "An authenticated account can retrieve its authorized profile." : "Profile retrieval failed at the step marked above.";
      nextAction = a && b ? null : "Check that public.users and auth.users share the same id for this account (S22 account gate).";
      break;
    }
    case "document_storage": {
      const a = await step("Private bucket exists", async () => { const { supabaseAdmin } = await supabase(); const { data, error } = await supabaseAdmin.storage.getBucket("student-documents"); if (error || !data) throw Object.assign(new Error("bucket"), { code: "NO_BUCKET" }); return data.public ? "bucket is PUBLIC" : "private"; });
      const b = await step("Bucket can be listed (names not shown)", async () => { const { supabaseAdmin } = await supabase(); const { data, error } = await supabaseAdmin.storage.from("student-documents").list("", { limit: 1 }); if (error) throw Object.assign(new Error("list"), { code: "LIST_FAILED" }); return `${data?.length ?? 0} entry visible at the root`; });
      conclusion = a && b ? "Document storage is configured and accessible." : "Document storage is not fully accessible.";
      nextAction = a && b ? null : "Run the S25 storage bucket step or check the service key's storage permissions.";
      break;
    }
    case "support_academic_apis": {
      const a = await step("Support tickets query", async () => `${Number(rows(await db.execute(sql`SELECT count(*)::int AS n FROM support_tickets`))[0]?.n ?? 0)} tickets`);
      const b = await step("High-school enrolments query", async () => `${Number(rows(await db.execute(sql`SELECT count(*)::int AS n FROM hs_enrollments`))[0]?.n ?? 0)} enrolments`);
      const c = await step("Degree roadmap plans query", async () => `${Number(rows(await db.execute(sql`SELECT count(*)::int AS n FROM student_roadmap_plans`))[0]?.n ?? 0)} plans`);
      const d = await step("Program journey tables", async () => `${Number(rows(await db.execute(sql`SELECT count(*)::int AS n FROM orientation_sessions`))[0]?.n ?? 0)} sessions`);
      conclusion = a && b && c && d ? "Support and academic data sources respond." : "At least one support or academic data source failed (see steps).";
      nextAction = a && b && c && d ? null : "Open the incident explorer for the matching subsystem.";
      break;
    }
    case "email": {
      const configured = emailTransportConfigured();
      steps.push({ label: "Transport configured (EMAIL_ENABLED, EMAIL_FROM, RESEND_API_KEY)", ok: configured, detail: configured ? "all three present" : "missing (values never shown)" });
      const schema = await s29Schema(db);
      if (schema.present) {
        const r = rows(await db.execute(sql`SELECT max(sent_at) AS last_ok, count(*) FILTER (WHERE email_state = 'failed')::int AS failed, count(*) FILTER (WHERE email_state = 'not_configured')::int AS nc FROM s29_notifications WHERE created_at > now() - interval '30 days'`))[0] ?? {};
        steps.push({ label: "Provider accepted a message in the last 30 days", ok: iso(r.last_ok) ? true : configured ? null : false, detail: iso(r.last_ok) ? `last ${iso(r.last_ok)}` : "no accepted message yet" });
        steps.push({ label: "Failures in the last 30 days", ok: Number(r.failed ?? 0) === 0, detail: `${Number(r.failed ?? 0)} failed, ${Number(r.nc ?? 0)} not configured` });
      }
      conclusion = !configured ? "Outbound email is not configured: notifications stay in the in-portal inbox." : steps.some((x) => x.ok === false) ? "Email is configured but recent deliveries failed." : steps.some((x) => x.ok === null) ? "Email is configured; no delivery has been observed yet (unverified)." : "Outbound email is configured and the provider has accepted messages.";
      nextAction = !configured ? "Add EMAIL_ENABLED=true, EMAIL_FROM (verified domain) and RESEND_API_KEY to the deployment secrets and republish." : steps.some((x) => x.ok === false) ? "Check the sender domain in Resend, then retry failed notifications." : null;
      break;
    }
    case "scheduler": {
      const schema = await s29Schema(db);
      steps.push({ label: "S29 tables present", ok: schema.present, detail: schema.present ? "yes" : `missing: ${schema.missing.join(", ")}` });
      if (schema.present) {
        for (const j of await readJobs(db, now)) steps.push({ label: `Job ${j.name}`, ok: j.state === "healthy" || j.state === "live" ? true : j.state === "unknown" ? null : false, detail: `last success ${j.lastSuccessAt ?? "never"}, ${j.consecutiveFailures} consecutive failures${j.lastError ? `, last error ${j.lastError}` : ""}` });
      }
      const st = schedulerState();
      steps.push({ label: "This instance", ok: st.lastTickAt ? true : null, detail: `last tick ${st.lastTickAt ?? "never"} (${st.lastTickOutcome})` });
      steps.push({ label: "External tick endpoint", ok: process.env.S29_CRON_SECRET ? true : null, detail: process.env.S29_CRON_SECRET ? "enabled" : "S29_CRON_SECRET not set: jobs run only when the site receives traffic" });
      conclusion = steps.some((x) => x.ok === false) ? "The scheduler is not processing every job on time." : steps.every((x) => x.ok) ? "The scheduler is processing jobs." : "The scheduler runs, but part of it is unverified (see steps).";
      nextAction = steps.some((x) => x.ok === false) ? "Run the scheduler now and look at the job's last error; check the external pinger." : null;
      break;
    }
    case "schema": {
      const required = ["students", "users", "audit_logs", "support_tickets", "student_documents", "hs_enrollments", "student_roadmap_plans", "student_billing_obligations", "student_agreements", "student_checkpoints", "orientation_sessions", "student_staff_notes", "assistant_usage_monthly", "user_language_preference"];
      const found = new Set(rows(await db.execute(sql`SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN (${sql.join(required.map((t) => sql`${t}`), sql`, `)})`)).map((r) => String(r.relname)));
      const missing = required.filter((t) => !found.has(t));
      steps.push({ label: "Core and S27 tables", ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(", ")}` : `${required.length} present` });
      const s29 = await s29Schema(db);
      steps.push({ label: "S29 tables", ok: s29.present, detail: s29.present ? "11 present" : `missing: ${s29.missing.join(", ")}` });
      const enums = Number(rows(await db.execute(sql`SELECT count(*)::int AS n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'audit_event_type' AND e.enumlabel LIKE 's29.%'`))[0]?.n ?? 0);
      steps.push({ label: "S29 audit event types", ok: enums >= 12, detail: `${enums} of 12` });
      conclusion = steps.every((x) => x.ok) ? "Migrations and required schema objects are present." : "Some schema objects are missing (see steps).";
      nextAction = steps.every((x) => x.ok) ? null : "Start the release runner; its schema steps apply pending additive migrations with a backup.";
      break;
    }
    case "release": {
      const rel = await releaseView();
      steps.push({ label: "Running release (release.json)", ok: rel.runningSha ? true : false, detail: rel.runningSha ?? "no release.json" });
      steps.push({ label: "Approved release marker (GitHub)", ok: rel.markerSha ? true : null, detail: rel.markerSha ?? "could not fetch the marker" });
      steps.push({ label: "Running = approved", ok: rel.isApprovedReleaseLive, detail: rel.isApprovedReleaseLive === null ? "cannot compare" : rel.isApprovedReleaseLive ? "match" : "different" });
      conclusion = rel.isApprovedReleaseLive ? "The live release is the approved version." : rel.isApprovedReleaseLive === false ? "The live release is not the approved version yet (publish pending or a rollback)." : "The release could not be verified.";
      nextAction = rel.isApprovedReleaseLive === false ? "Wait for the runner's 'ready to publish', then republish the deployment." : null;
      break;
    }
  }
  const state: HealthState = steps.some((x) => x.ok === false) ? "failed" : steps.some((x) => x.ok === null) ? "unknown" : "healthy";
  return { key, state, ranAt: now.toISOString(), durationMs: Date.now() - started, steps, conclusion, nextAction };
}
