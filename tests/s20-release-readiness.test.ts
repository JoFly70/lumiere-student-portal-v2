/**
 * S20 release-readiness checks that need no database: migration chain shape, EN/FR parity for the journey's screens,
 * the verification-link routes, and the assistant's fail-closed defaults. DB-backed migration behaviour is in
 * scripts/s20/verify-migrations.ts; the end-to-end journey is tests/s20-journey-first-student.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { en } from "../client/src/i18n/en";
import { fr } from "../client/src/i18n/fr";
import { loadAssistantConfig } from "../server/services/academic-assistant/config";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIG = path.join(ROOT, "supabase/migrations");
const files = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const RELEASE = [
  "20261030100000_s18_billing_ledger.sql", "20261030100100_s18_billing_audit_event_types.sql", "20261030110000_s18_document_student_message.sql",
  "20261031100000_s19_ticket_comment_idempotency.sql", "20261031110000_s19_billing_corrections.sql",
];

describe("S20 migration chain", () => {
  it("timestamps are unique and strictly increasing", () => {
    const ts = files.map((f) => f.split("_")[0]!);
    expect(ts.every((t) => /^\d{14}$/.test(t))).toBe(true);
    expect(ts.every((t, i) => i === 0 || t > ts[i - 1]!)).toBe(true);
  });
  it("the five S18/S19 files are the latest pre-S20 migrations, in release order", () => {
    const pre = files.filter((f) => !/_s20_/.test(f));
    expect(pre.slice(-5)).toEqual(RELEASE);
  });
  it("every S20 migration sorts after the S19 corrections file, is additive and idempotent (no DROP TABLE/COLUMN, guarded DDL)", () => {
    for (const f of files.filter((x) => /_s20_/.test(x))) {
      expect(f > RELEASE[4]!).toBe(true);
      const sql = fs.readFileSync(path.join(MIG, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(sql).not.toMatch(/drop\s+(table|column|schema)/i);
      expect(sql).not.toMatch(/\btruncate\b|\bdelete\s+from\b/i);
      for (const m of sql.matchAll(/create\s+(unique\s+)?(table|index)\s+(?!if not exists)/gi)) throw new Error(`${f}: unguarded ${m[0]}`);
    }
  });
});

describe("S20 EN/FR parity for the first-student journey screens", () => {
  const PREFIXES = ["auth.", "nav.", "common.", "documents.", "support.", "billing.", "academic.", "flightDeck.", "assistant."];
  const E = en as Record<string, string>;
  const F = fr as Record<string, string>;
  const keys = Object.keys(E).filter((k) => PREFIXES.some((p) => k.startsWith(p)));
  const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  it("journey namespaces exist", () => expect(keys.length).toBeGreaterThan(150));
  it("every EN key in those namespaces has a non-empty FR value with the same {placeholders}", () => {
    const bad = keys.filter((k) => !F[k] || !F[k]!.trim() || JSON.stringify(params(E[k]!)) !== JSON.stringify(params(F[k]!)));
    expect(bad).toEqual([]);
  });
  it("FR has no keys in those namespaces that EN lacks", () => {
    expect(Object.keys(F).filter((k) => PREFIXES.some((p) => k.startsWith(p)) && !(k in E))).toEqual([]);
  });
  it("every translation key literally used by the verify / resend / login / billing / documents / support pages exists in EN and FR", () => {
    const pages = ["verify-email", "resend-verification", "login", "billing", "documents", "support", "high-school"].map((n) => path.join(ROOT, "client/src/pages", `${n}.tsx`));
    const used = new Set<string>();
    for (const p of pages) {
      if (!fs.existsSync(p)) continue;
      for (const m of fs.readFileSync(p, "utf8").matchAll(/\bt\(\s*["']([a-zA-Z][\w]*(?:\.[\w]+)+)["']/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(30);
    expect([...used].filter((k) => !(k in E) || !(k in F))).toEqual([]);
  });
});

describe("S20 verification links", () => {
  const app = fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8");
  it("both /auth/verify (Supabase redirect URL) and /verify-email are routed, and /resend-verification exists", () => {
    expect(app).toMatch(/path="\/auth\/verify"/);
    expect(app).toMatch(/path="\/verify-email"/);
    expect(app).toMatch(/path="\/resend-verification"/);
  });
});

describe("S20 assistant fails closed by default", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it("disabled, no key, USD 2 budget, students never eligible when nothing is configured", () => {
    delete process.env.SPARK_ASSISTANT_ENABLED; delete process.env.META_MODEL_API_KEY; delete process.env.SPARK_ASSISTANT_MONTHLY_BUDGET_USD; delete process.env.SPARK_ASSISTANT_LIVE_ROLES;
    const c = loadAssistantConfig();
    expect(c).toMatchObject({ liveEnabled: false, hasApiKey: false, monthlyBudgetUsd: 2 });
    expect(c.liveRoles.size).toBe(0);
  });
  it("only the literal string 'true' enables live inference; 'student' is never an eligible live role", () => {
    for (const v of ["1", "TRUE", "yes", "false", ""]) { process.env.SPARK_ASSISTANT_ENABLED = v; expect(loadAssistantConfig().liveEnabled).toBe(false); }
    process.env.SPARK_ASSISTANT_ENABLED = "true"; process.env.SPARK_ASSISTANT_LIVE_ROLES = "student,staff";
    const c = loadAssistantConfig();
    expect(c.liveEnabled).toBe(true);
    expect(c.liveRoles.has("student")).toBe(false);
  });
  it("the provider key is not part of the config object and not referenced from client code", () => {
    process.env.META_MODEL_API_KEY = "synthetic-key-123";
    expect(JSON.stringify(loadAssistantConfig())).not.toContain("synthetic-key-123");
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const hits = walk(path.join(ROOT, "client/src")).filter((f) => /\.(tsx?|css)$/.test(f) && fs.readFileSync(f, "utf8").includes("META_MODEL_API_KEY"));
    expect(hits).toEqual([]);
    expect(fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8")).not.toContain("META_MODEL");
  });
});
