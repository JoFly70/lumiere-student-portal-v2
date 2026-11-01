import { describe, expect, it } from "vitest";
import { s30OpsEn, s30OpsFr } from "../client/src/i18n/modules/s30-ops";
import { OPS_EVENT_KINDS, DIAGNOSTIC_SUBSYSTEMS, NOTIFICATION_KINDS } from "../shared/s30-contract";
import { QUEUE_KINDS } from "../shared/s27-contract";
import {
  diagCodeText, diagFactValue, eventKey, exceptionsInState, kindKey, lowestSeq, mergeEventPages, notificationText, relativeTime, shortSha, type TFn,
} from "../client/src/components/s30/operations/ops-helpers";

const lookup = (dict: Record<string, string>, extra: Record<string, string> = {}): TFn => (key, vars) => {
  const raw = dict[key] ?? extra[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (m, n: string) => (vars && n in vars ? String(vars[n]) : m));
};
const tEn = lookup(s30OpsEn as Record<string, string>, { "s30.cal.title.orientation": "Orientation session" });

describe("S30 ops i18n", () => {
  it("FR has the same keys and placeholders and differs from EN", () => {
    const en = s30OpsEn as Record<string, string>; const fr = s30OpsFr as Record<string, string>;
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of Object.keys(en)) { expect(ph(fr[k]!), k).toBe(ph(en[k]!)); expect(fr[k]!.trim(), k).not.toBe(""); }
    expect(Object.keys(en).filter((k) => en[k] === fr[k])).toEqual(["ops.diag.fact.total"]);
  });
  it("covers every kind, event, subsystem and notification kind", () => {
    for (const k of QUEUE_KINDS) expect(s30OpsEn, k).toHaveProperty([kindKey(k)]);
    for (const k of OPS_EVENT_KINDS) expect(s30OpsEn, k).toHaveProperty([eventKey(k)]);
    for (const k of DIAGNOSTIC_SUBSYSTEMS) expect(s30OpsEn, k).toHaveProperty([`ops.diag.name.${k}`]);
    for (const k of NOTIFICATION_KINDS) expect(s30OpsEn, k).toHaveProperty([`notif.${k}`]);
  });
  it("uses typographic apostrophes in French", () => {
    expect(Object.values(s30OpsFr).filter((v) => v.includes("'"))).toEqual([]);
  });
});

describe("ops helpers", () => {
  it("orders exceptions by severity within a state", () => {
    const mk = (id: string, severity: "critical" | "warning" | "info", state: "open" | "snoozed") => ({ id, severity, state }) as never;
    const out = exceptionsInState([mk("a", "info", "open"), mk("b", "critical", "open"), mk("c", "warning", "snoozed"), mk("d", "warning", "open")], "open");
    expect(out.map((e: { id: string }) => e.id)).toEqual(["b", "d", "a"]);
  });
  it("merges event pages without duplicates and finds the lowest seq", () => {
    const e = (seq: number) => ({ seq }) as never;
    const merged = mergeEventPages([[e(5), e(4)], [e(4), e(3)]]);
    expect(merged.map((x: { seq: number }) => x.seq)).toEqual([5, 4, 3]);
    expect(lowestSeq(merged)).toBe(3);
    expect(lowestSeq([])).toBeNull();
  });
  it("shortens release sha", () => {
    expect(shortSha("0123456789abcdef")).toBe("0123456");
    expect(shortSha(null)).toBeNull();
  });
  it("translates diagnostic codes with raw fallback and formats facts", () => {
    expect(diagCodeText(tEn, "sweep_stale")).toBe(s30OpsEn["ops.diag.code.sweep_stale"]);
    expect(diagCodeText(tEn, "brand_new_code")).toBe("brand_new_code");
    expect(diagFactValue(tEn, true, "en-US")).toBe("yes");
    expect(diagFactValue(tEn, null, "en-US")).toBe("—");
    expect(diagFactValue(tEn, 12345, "en-US")).toBe("12,345");
  });
  it("renders notification texts with params, titleKey and fallbacks", () => {
    expect(notificationText(tEn, { kind: "reminder.deadline", params: { date: "2026-11-20", title: "Essay" } }, "en-US")).toBe("Reminder: Essay is due November 20, 2026.");
    expect(notificationText(tEn, { kind: "reminder.appointment", params: { date: "2026-11-20", titleKey: "s30.cal.title.orientation", title: null } }, "en-US")).toContain("Orientation session");
    expect(notificationText(tEn, { kind: "reminder.appointment", params: { date: "2026-11-20", titleKey: "missing.key", title: "Fallback" } }, "en-US")).toContain("Fallback");
    expect(notificationText(tEn, { kind: "import.review_required", params: { records: 3, students: 2 } }, "en-US")).toContain("3 imported records");
    expect(notificationText(tEn, { kind: "calendar.event_changed", params: { date: "2026-11-20", change: "cancelled", title: "Call" } }, "en-US")).toContain("was cancelled");
  });
  it("gives relative time within a week", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    expect(relativeTime("2026-11-01T11:00:00Z", now, "en-US")).toMatch(/hour/);
    expect(relativeTime("2026-09-01T11:00:00Z", now, "en-US")).toMatch(/2026/);
  });
});
