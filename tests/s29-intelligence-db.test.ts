/**
 * S29 Phase A on a REAL disposable PostgreSQL 16: migration shape, rules engine -> attention store, concierge
 * (dedupe, caps, French default), outbox delivery states, durable scheduler leases, events, Fleet AI privacy, and
 * the HTTP role / CSRF / cron-secret matrix. Synthetic data only; no email is ever sent (delivery is stubbed).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, type LocalPg } from "./helpers/s05-local-pg";
import { authHeader, bootHighSchoolApp, seedStaff, seedStudent, startHighSchoolPg, type HighSchoolApp } from "./helpers/s11-hs-stack";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const NOW = new Date("2026-11-11T12:00:00Z");
const MIGRATION = "supabase/migrations/20261106100000_s29_student_intelligence.sql";
const PILOT_DOMAIN = "lumiere-qa-mail.net"; // fictional, never contacted (delivery is stubbed)

describe.skipIf(!PG_BINARIES_AVAILABLE)("S29 intelligence & operations on real Postgres", () => {
  let pg: LocalPg;
  let hs: HighSchoolApp;
  let db: import("../server/services/s29/db").Tx;
  let app: import("express").Express;
  let csrf: (userId: string) => string;
  let real: Awaited<ReturnType<typeof seedStudent>>;
  let demo: Awaited<ReturnType<typeof seedStudent>>;
  let admin: Awaited<ReturnType<typeof seedStaff>>;
  let staff: Awaited<ReturnType<typeof seedStaff>>;
  let coach: Awaited<ReturnType<typeof seedStaff>>;
  const SECRET = "s29-test-secret-0123456789abcdef";

  beforeAll(async () => {
    pg = await startHighSchoolPg();
    hs = await bootHighSchoolApp(pg, { now: NOW.toISOString() });
    db = (await import("../server/lib/db")).db as never;
    csrf = (await import("../server/middleware/csrf")).generateCsrfToken;
    const { resetS29SchemaCache } = await import("../server/services/s29/db");
    resetS29SchemaCache();
    real = await seedStudent(pg, { name: "Pilot Realistic" });
    demo = await seedStudent(pg, { name: "Camille Demo" });
    // Real-looking (but fictional) address for the "real" student; the demo student keeps a DEMO preferred name.
    await pg.sql(`update users set email = 'pilot.one@${PILOT_DOMAIN}' where id = '${real.userId}'`);
    await pg.sql(`update students set email = 'pilot.one@${PILOT_DOMAIN}', timezone = 'Europe/Paris' where id = '${real.studentId}'`);
    await pg.sql(`update students set preferred_name = 'DEMO-S29-CAMILLE' where id = '${demo.studentId}'`);
    for (const s of [real, demo]) {
      // Signed 41 days ago: the language test (30 days after signing) is overdue -> deadline rule.
      await pg.sql(`insert into student_agreements (student_id, signed_on, activated_on) values ('${s.studentId}', '2026-10-01', '2026-10-05')`);
      await pg.sql(`insert into student_checkpoints (student_id, key, planned_on) values ('${s.studentId}', 'kickoff_call', '2026-11-01')`);
      await pg.sql(`insert into orientation_sessions (student_id, slot_at, status) values ('${s.studentId}', '2026-11-12T08:00:00Z', 'confirmed')`);
    }
    admin = await seedStaff(pg, "admin");
    staff = await seedStaff(pg, "staff");
    coach = await seedStaff(pg, "coach");
    const express = (await import("express")).default;
    const { createS29AdminRouter, createS29StudentRouter, createS29OpsRouter } = await import("../server/routes/s29");
    app = express();
    app.use(express.json());
    app.use("/api/admin/s29", createS29AdminRouter({ now: () => NOW, rateLimitStore: false }));
    app.use("/api/student/s29", createS29StudentRouter({}));
    app.use("/api/ops", createS29OpsRouter({ now: () => NOW, secret: () => SECRET }));
  }, 300_000);
  afterAll(async () => { await hs?.close(); await pg?.stop(); }, 60_000);

  it("migration: 11 tables with RLS and no client privileges, 12 audit types, constraints, idempotent re-apply", async () => {
    const t = await pg.sql(`select c.relname, c.relrowsecurity as rls from pg_class c where c.relnamespace='public'::regnamespace and c.relname like 's29\\_%' and c.relkind='r' order by 1`);
    expect(t.length).toBe(11);
    expect(t.every((r) => r.rls === true)).toBe(true);
    const roles = await pg.sql(`select rolname from pg_roles where rolname in ('anon','authenticated')`);
    for (const r of roles) for (const row of t) {
      const p = await pg.sql(`select has_table_privilege('${r.rolname}','public.${row.relname}','SELECT,INSERT,UPDATE,DELETE') as a`);
      expect(p[0]!.a).toBe(false);
    }
    const e = await pg.sql(`select count(*)::int as n from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='audit_event_type' and e.enumlabel like 's29.%'`);
    expect(e[0]!.n).toBe(12);
    await expect(pg.sql(`insert into s29_academic_records (student_id, course_code, claim_level, batch_id, source_file_name, source_row, row_fingerprint, imported_by) values ('${real.studentId}','X','institution_verified',gen_random_uuid(),'f',1,repeat('a',64),'x')`)).rejects.toThrow();
    await expect(pg.sql(`insert into s29_notifications (dedupe_key, audience, category, template, source, title, body, email_state) values ('k','student','support','t','s','t','b','delivered')`)).rejects.toThrow();
    await pg.sql(fs.readFileSync(MIGRATION, "utf8"));
  });

  it("rules engine: deadlines, checkpoints, orientation; demo labelled; store keeps first detection; dismiss holds until facts change; auto-resolve", async () => {
    const { computeAttention } = await import("../server/services/s29/rules");
    const { syncAttention, readAttentionQueue, actOnAttention } = await import("../server/services/s29/attention-store");
    const { DEFAULT_CONCIERGE_SETTINGS } = await import("../shared/s29-contract");
    const out = await computeAttention(db, NOW, DEFAULT_CONCIERGE_SETTINGS, true);
    const mine = out.items.filter((i) => i.studentId === real.studentId);
    expect(mine.map((i) => i.kind).sort()).toEqual(expect.arrayContaining(["checkpoint_missed", "deadline_soon", "orientation_upcoming", "payment_missing"]));
    const deadline = mine.find((i) => i.kind === "deadline_soon")!;
    expect(deadline).toMatchObject({ priority: "urgent", workflow: "documents", action: "check_deadline", isDemo: false });
    expect(deadline.reason.facts).toMatchObject({ deadline: "language_test", dueOn: "2026-10-31", daysLeft: -11 });
    expect(out.items.filter((i) => i.studentId === demo.studentId).every((i) => i.isDemo)).toBe(true);

    const first = await syncAttention(db, out.items, NOW);
    expect(first.opened).toBe(out.items.length);
    const later = new Date(NOW.getTime() + 600_000);
    const second = await syncAttention(db, out.items, later);
    expect(second).toMatchObject({ opened: 0, reopened: 0, cleared: 0 });
    const q = await readAttentionQueue(db, later, later.toISOString());
    const stored = q.items.find((i) => i.key === deadline.key)!;
    expect(stored.detectedAt).toBe(NOW.toISOString());
    expect(q.counts.open).toBe(q.items.filter((i) => !i.isDemo && i.status === "open").length);
    expect(q.items.some((i) => i.isDemo)).toBe(true);

    await actOnAttention(db, deadline.key, { action: "dismiss", note: "called the student" }, admin.userId, later);
    await syncAttention(db, out.items, later);
    expect((await readAttentionQueue(db, later, null)).items.find((i) => i.key === deadline.key)!.status).toBe("dismissed");
    // Same item with different facts -> reopened.
    const changed = out.items.map((i) => (i.key === deadline.key ? { ...i, fingerprint: "changed" } : i));
    expect((await syncAttention(db, changed, later)).reopened).toBe(1);
    // Condition gone -> auto-resolved, kept as history.
    const without = out.items.filter((i) => i.key !== deadline.key);
    expect((await syncAttention(db, without, later)).cleared).toBe(1);
    const after = await readAttentionQueue(db, later, null);
    expect(after.recentlyClosed.find((i) => i.key === deadline.key)).toMatchObject({ status: "resolved", resolvedBy: "system", resolution: "condition_cleared" });
    await syncAttention(db, out.items, later); // restore for later tests
  });

  it("concierge: French by default, deduplicated per window, weekly cap, never emails synthetic accounts", async () => {
    const { computeAttention } = await import("../server/services/s29/rules");
    const { runConcierge } = await import("../server/services/s29/concierge");
    const { DEFAULT_CONCIERGE_SETTINGS } = await import("../shared/s29-contract");
    const out = await computeAttention(db, NOW, DEFAULT_CONCIERGE_SETTINGS, true);
    const r1 = await runConcierge(db, out.items, out.facts, DEFAULT_CONCIERGE_SETTINGS, NOW);
    expect(r1.created).toBeGreaterThan(0);
    const r2 = await runConcierge(db, out.items, out.facts, DEFAULT_CONCIERGE_SETTINGS, new Date(NOW.getTime() + 3_600_000));
    expect(r2.created).toBe(0);
    const rows = await pg.sql(`select student_id, template, language, email_state, suppressed_reason, is_demo, title, body, next_attempt_at from s29_notifications where source='concierge' order by created_at`);
    const realRows = rows.filter((r) => r.student_id === real.studentId);
    const demoRows = rows.filter((r) => r.student_id === demo.studentId);
    expect(realRows.length).toBeLessThanOrEqual(DEFAULT_CONCIERGE_SETTINGS.maxPerWeek);
    expect(realRows.every((r) => r.language === "fr")).toBe(true);
    expect(realRows.map((r) => r.template)).toEqual(expect.arrayContaining(["concierge.deadline", "concierge.orientation"]));
    expect(realRows.find((r) => r.template === "concierge.deadline")!.title).toBe("Une échéance de votre dossier est passée");
    expect(demoRows.length).toBeGreaterThan(0);
    expect(demoRows.every((r) => r.email_state === "suppressed" && r.suppressed_reason === "synthetic_account" && r.is_demo === true)).toBe(true);
    // Only one reminder email per day by default: the others stay in the inbox (frequency_cap).
    expect(realRows.filter((r) => r.email_state === "queued").length).toBe(1);
    expect(realRows.filter((r) => r.suppressed_reason === "frequency_cap").length).toBe(realRows.length - 1);
    // Wording never claims official results or school approval.
    for (const r of rows) expect(`${r.title} ${r.body}`).not.toMatch(/approv|official|officiel|crédit accordé|credit awarded/i);
  });

  it("outbox: accepted / retry with backoff / failed after max / not configured; inbox and read state", async () => {
    const { enqueue, deliverDue, loadStudentRecipient, readInbox, markRead, MAX_ATTEMPTS } = await import("../server/services/s29/outbox");
    const rec = (await loadStudentRecipient(db, real.studentId))!;
    // Queued concierge email (quiet hours: 13:00 Paris -> not inside 21:00-08:00) is delivered now.
    const sent: string[] = [];
    const ok = await deliverDue(db, NOW, async (o) => { sent.push(o.to); expect(o.html).not.toMatch(/<script/i); return "sent"; });
    expect(ok.accepted).toBe(1);
    expect(sent).toEqual([`pilot.one@${PILOT_DOMAIN}`]);
    const fail = await enqueue(db, { dedupeKey: "test:fail", audience: "student", template: "support.reply", source: "event", params: { ticket: "LUM-00001" }, student: rec, now: NOW });
    expect(fail.emailState).toBe("queued");
    let t = NOW;
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const res = await deliverDue(db, t, async () => "failed");
      expect(res.claimed).toBe(1);
      const [row] = await pg.sql(`select email_state, attempts, next_attempt_at from s29_notifications where id='${fail.id}'`);
      expect(row!.attempts).toBe(i);
      if (i < MAX_ATTEMPTS) { expect(row!.email_state).toBe("attempted"); t = new Date(Date.parse(String(row!.next_attempt_at)) + 1000); }
      else expect(row!.email_state).toBe("failed");
    }
    const nc = await enqueue(db, { dedupeKey: "test:nc", audience: "student", template: "document.verified", source: "event", params: { docType: "transcript" }, student: rec, now: NOW });
    await deliverDue(db, NOW, async () => "not_configured");
    expect((await pg.sql(`select email_state from s29_notifications where id='${nc.id}'`))[0]!.email_state).toBe("not_configured");
    const inbox = await readInbox(db, real.userId);
    expect(inbox.items.length).toBeGreaterThanOrEqual(3);
    expect(inbox.unread).toBe(inbox.items.length);
    expect(await markRead(db, real.userId, [inbox.items[0]!.id])).toBe(1);
    expect(await markRead(db, demo.userId, [inbox.items[1]!.id])).toBe(0); // never someone else's
    expect((await readInbox(db, real.userId)).unread).toBe(inbox.items.length - 1);
  });

  it("review fixes: a re-claimed row cannot be finalised by the stale sender; stuck final attempts become failed", async () => {
    const { enqueue, deliverDue, loadStudentRecipient, MAX_ATTEMPTS } = await import("../server/services/s29/outbox");
    const rec = (await loadStudentRecipient(db, real.studentId))!;
    const n = await enqueue(db, { dedupeKey: "test:lease", audience: "student", template: "support.status", source: "event", params: { ticket: "LUM-00002", status: "open" }, student: rec, now: NOW });
    let inner: Promise<unknown> | null = null;
    // While the first sender is "slow", force its lease to look expired and let a second sender claim the row.
    await deliverDue(db, NOW, async () => {
      await pg.sql(`update s29_notifications set lease_until = now() - interval '1 minute' where id='${n.id}'`);
      inner = deliverDue(db, NOW, async () => "sent");
      await inner;
      return "failed"; // the stale sender's late outcome must be ignored
    });
    const [row] = await pg.sql(`select email_state, attempts from s29_notifications where id='${n.id}'`);
    expect(row).toMatchObject({ email_state: "accepted", attempts: 2 });
    await pg.sql(`update s29_notifications set email_state='attempted', attempts=${MAX_ATTEMPTS}, lease_until=now() - interval '1 minute', next_attempt_at=now() where id='${n.id}'`);
    await deliverDue(db, new Date(Date.now() + 1000), async () => "sent");
    expect((await pg.sql(`select email_state from s29_notifications where id='${n.id}'`))[0]!.email_state).toBe("failed");
  });

  it("review fixes: calendar feed tokens are redacted from log paths, URLs and Sentry transactions", async () => {
    const { safeLogPath } = await import("../server/services/s29/runtime");
    const { scrubSentryEvent, safeRequestContext } = await import("../server/lib/log-redaction");
    const tok = "A".repeat(43);
    expect(safeLogPath(`/api/calendar/feed/${tok}.ics`)).not.toContain(tok);
    expect(safeLogPath(`/api/calendar/feed/${tok}.ics/`)).not.toContain(tok);
    expect(safeRequestContext({ path: `/api/calendar/feed/${tok}.ics`, method: "GET" }).path).not.toContain(tok);
    const ev = scrubSentryEvent({ request: { url: `https://x.test/api/calendar/feed/${tok}.ics?a=1` }, transaction: `GET /api/calendar/feed/${tok}.ics` })!;
    expect(JSON.stringify(ev)).not.toContain(tok);
  });

  it("quiet hours defer a reminder email to the end of the window in the student's zone", async () => {
    const { afterQuietHours } = await import("../server/services/s29/outbox");
    const at = new Date("2026-11-11T21:30:00Z"); // 22:30 in Paris (UTC+1)
    const next = afterQuietHours(at, { enabled: true, start: "21:00", end: "08:00" }, "Europe/Paris");
    expect(next.toISOString()).toBe("2026-11-12T07:00:00.000Z");
    expect(afterQuietHours(new Date("2026-11-11T12:00:00Z"), { enabled: true, start: "21:00", end: "08:00" }, "Europe/Paris").toISOString()).toBe("2026-11-11T12:00:00.000Z");
  });

  it("events: idempotent by dedupe key; synthetic recipients never emailed", async () => {
    const { emitStudentEvent } = await import("../server/services/s29/events");
    expect(await emitStudentEvent({ studentId: real.studentId, template: "document.rejected", dedupeKey: "document.rejected:doc1:t1", params: { docType: "transcript" } }, { db, now: NOW })).toBe("queued");
    expect(await emitStudentEvent({ studentId: real.studentId, template: "document.rejected", dedupeKey: "document.rejected:doc1:t1", params: { docType: "transcript" } }, { db, now: NOW })).toBe("duplicate");
    expect(await emitStudentEvent({ studentId: demo.studentId, template: "roadmap.published", dedupeKey: "roadmap.published:v-demo" }, { db, now: NOW })).toBe("queued");
    const [d] = await pg.sql(`select email_state, suppressed_reason from s29_notifications where dedupe_key='roadmap.published:v-demo'`);
    expect(d).toMatchObject({ email_state: "suppressed", suppressed_reason: "synthetic_account" });
  });

  it("scheduler: DB leases make a job run once per interval across concurrent ticks; failures are recorded", async () => {
    const { tick, readJobs } = await import("../server/services/s29/scheduler");
    let runs = 0;
    const jobs = [{ name: "test.job", intervalSeconds: 60, run: async () => { runs += 1; return { ok: 1 }; } }, { name: "test.fail", intervalSeconds: 60, run: async () => { throw Object.assign(new Error("boom"), { code: "E_TEST" }); } }];
    await tick(db, NOW, jobs);
    await tick(db, new Date(NOW.getTime() + 10_000), jobs);
    expect(runs).toBe(1);
    await tick(db, new Date(NOW.getTime() + 61_000), jobs);
    expect(runs).toBe(2);
    const [f] = await pg.sql(`select consecutive_failures, last_error from s29_jobs where name='test.fail'`);
    expect(f).toMatchObject({ consecutive_failures: 2, last_error: "E_TEST" });
    const inc = await pg.sql(`select subsystem, category, occurrences from s29_incidents where subsystem='job:test.fail'`);
    expect(inc[0]).toMatchObject({ category: "job.failed" });
    await pg.sql(`delete from s29_jobs where name like 'test.%'`);
    // The default jobs run end to end against the real schema.
    const out = await tick(db, new Date(NOW.getTime() + 120_000));
    expect(Object.keys(out)).toEqual(expect.arrayContaining(["rules.sync", "outbox.deliver", "ops.watch"]));
    expect((await readJobs(db, new Date(NOW.getTime() + 121_000))).every((j) => j.lastSuccessAt)).toBe(true);
  });

  it("fleet copilot: deterministic, grounded references, drafts never sent, AI context carries no identifiers", async () => {
    const { answerFleet, aggregateContext, classifyIntent } = await import("../server/services/s29/fleet");
    const { readAttentionQueue } = await import("../server/services/s29/attention-store");
    const items = (await readAttentionQueue(db, NOW, null)).items;
    expect(classifyIntent("Prépare des messages de relance en français")).toBe("draft_followups");
    expect(classifyIntent("Which support cases have been waiting longest?")).toBe("support_waiting");
    const ans = await answerFleet({ question: "Prepare French follow-up messages for students with approaching deadlines", language: "fr", includeDemo: false }, items, { budget: { reserve: async () => true, settle: async () => undefined } as never, now: () => NOW });
    expect(ans.intent).toBe("draft_followups");
    expect(ans.references.every((r) => !r.isDemo && r.href.startsWith("/admin/"))).toBe(true);
    expect(ans.drafts.length).toBeGreaterThan(0);
    expect(ans.drafts[0]!.body).toMatch(/^Bonjour Pilot/);
    expect(ans.requiresHumanApproval).toBe(true);
    const ctx = aggregateContext(items, NOW);
    for (const s of [real, demo]) {
      expect(ctx).not.toContain(s.studentId);
      expect(ctx).not.toContain("Pilot");
      expect(ctx).not.toContain("Camille");
    }
    expect(ctx).not.toMatch(/S05-|@/);
  });

  it("HTTP: roles, CSRF, student scoping, cron secret", async () => {
    const staffAuth = authHeader(staff.token);
    expect((await request(app).get("/api/admin/s29/attention").set(staffAuth)).status).toBe(200);
    expect((await request(app).get("/api/admin/s29/attention").set(authHeader(coach.token))).status).toBe(403);
    expect((await request(app).get("/api/admin/s29/attention").set(authHeader(real.token))).status).toBe(403);
    expect((await request(app).get("/api/admin/s29/attention")).status).toBe(401);
    expect((await request(app).get("/api/admin/s29/diagnostics/incidents").set(staffAuth)).status).toBe(403);
    expect((await request(app).post("/api/admin/s29/fleet/ask").set(staffAuth).set("x-csrf-token", csrf(staff.userId)).send({ question: "today?", language: "en" })).status).toBe(403);
    const q = await request(app).get("/api/admin/s29/attention").set(staffAuth);
    const key = q.body.items.find((i: { isDemo: boolean }) => !i.isDemo).key as string;
    expect((await request(app).post(`/api/admin/s29/attention/${encodeURIComponent(key)}/action`).set(staffAuth).send({ action: "resolve" })).status).toBe(403);
    expect((await request(app).post(`/api/admin/s29/attention/${encodeURIComponent(key)}/action`).set(staffAuth).set("x-csrf-token", csrf(staff.userId)).send({ action: "resolve", note: "done" })).body).toMatchObject({ status: "resolved" });
    const fleet = await request(app).post("/api/admin/s29/fleet/ask").set(authHeader(admin.token)).set("x-csrf-token", csrf(admin.userId)).send({ question: "Which students need my attention today?", language: "en" });
    expect(fleet.status).toBe(200);
    expect(fleet.body.ai.mode).toBe("not_requested");

    const inbox = await request(app).get("/api/student/s29/notifications").set(authHeader(real.token));
    expect(inbox.status).toBe(200);
    expect(inbox.body.items.length).toBeGreaterThan(0);
    expect((await request(app).get("/api/student/s29/notifications?studentId=x").set(authHeader(real.token))).status).toBe(400);
    expect((await request(app).get("/api/student/s29/notifications").set(staffAuth)).status).toBe(403);
    const bad = await request(app).put("/api/student/s29/notifications/preferences").set(authHeader(real.token)).set("x-csrf-token", csrf(real.userId)).send({ email: {}, quietHours: { enabled: true, start: "21:00", end: "08:00" }, timeZone: "Mars/Olympus", maxRemindersPerDay: 1 });
    expect(bad.status).toBe(400);
    const { DEFAULT_PREFERENCES } = await import("../shared/s29-contract");
    const good = await request(app).put("/api/student/s29/notifications/preferences").set(authHeader(real.token)).set("x-csrf-token", csrf(real.userId)).send({ ...DEFAULT_PREFERENCES, email: { ...DEFAULT_PREFERENCES.email, billing: false }, timeZone: "America/Toronto" });
    expect(good.status).toBe(200);
    expect((await request(app).get("/api/student/s29/notifications/preferences").set(authHeader(real.token))).body).toMatchObject({ timeZone: "America/Toronto", email: { billing: false } });

    expect((await request(app).post("/api/ops/scheduler/tick")).status).toBe(401);
    const { cronSecretConfigured } = await import("../server/routes/s29");
    expect(cronSecretConfigured("short")).toBe(false);
    expect((await request(app).post("/api/ops/scheduler/tick").set("x-s29-cron-secret", "wrong")).status).toBe(401);
    const ok = await request(app).post("/api/ops/scheduler/tick").set("x-s29-cron-secret", SECRET);
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
  });
});
