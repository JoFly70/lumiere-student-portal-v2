/**
 * S10 — audit write failures are logged AND counted, and never throw to the caller.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ mode: "ok" as "ok" | "error" | "throw" }));
vi.mock("../server/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: {
    from: () => ({
      insert: () => ({
        setHeader: async () => {
          if (state.mode === "throw") throw new Error("network down");
          return { error: state.mode === "error" ? { message: "invalid input value for enum audit_event_type" } : null };
        },
      }),
    }),
  },
}));
const logged = vi.hoisted(() => ({ errors: [] as unknown[][] }));
vi.mock("../server/lib/logger", () => ({
  logger: { error: (...a: unknown[]) => logged.errors.push(a), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { createAuditLog, getAuditFailureStats, resetAuditFailureStats } from "../server/lib/audit";

const entry = { eventType: "support.ticket_created" as const, actionDescription: "x" };

describe("audit failure observability", () => {
  beforeEach(() => {
    state.mode = "ok";
    logged.errors.length = 0;
    resetAuditFailureStats();
  });

  it("a successful write counts nothing", async () => {
    await createAuditLog(entry);
    expect(getAuditFailureStats().total).toBe(0);
  });

  it("a rejected insert (e.g. enum value missing) is logged and counted per event type, without throwing", async () => {
    state.mode = "error";
    await expect(createAuditLog(entry)).resolves.toBeUndefined();
    await createAuditLog({ ...entry, eventType: "roadmap.published" });
    const stats = getAuditFailureStats();
    expect(stats.total).toBe(2);
    expect(stats.byEventType).toEqual({ "support.ticket_created": 1, "roadmap.published": 1 });
    expect(stats.last?.eventType).toBe("roadmap.published");
    expect(stats.last?.message).toMatch(/enum/);
    expect(logged.errors.length).toBe(2);
  });

  it("a thrown transport error is logged and counted without throwing", async () => {
    state.mode = "throw";
    await expect(createAuditLog(entry)).resolves.toBeUndefined();
    expect(getAuditFailureStats()).toMatchObject({ total: 1, byEventType: { "support.ticket_created": 1 } });
  });

  it("stats are a snapshot (callers cannot mutate internal state)", async () => {
    state.mode = "error";
    await createAuditLog(entry);
    const snap = getAuditFailureStats();
    snap.byEventType["support.ticket_created"] = 99;
    expect(getAuditFailureStats().byEventType["support.ticket_created"]).toBe(1);
  });
});
