import { describe, expect, it } from "vitest";
import { DEFAULT_CONCIERGE_SETTINGS, DIAGNOSTIC_CHECKS, EMAIL_STATES, HEALTH_STATES, type DiagnosticsView } from "../shared/s29-contract";
import { s29OpsEn, s29OpsFr } from "../client/src/i18n/modules/s29-ops";
import {
  canRetry, checkQuestionKey, draftChanged, emailPresentation, featureLabelKey, formatDuration, formatInterval, formatRelativeAge, groupEmailCounts,
  healthPresentation, incidentActions, parseDraft, releaseVerdict, shortError, shortSha, sortBySeverity, suppressedReasonKey, summarize, toDraft,
  EMAIL_OVERVIEW_ORDER,
} from "../client/src/lib/s29-ops-presentation";

const hasKey = (k: string) => k in s29OpsEn;

describe("S29 ops presentation: health states", () => {
  it("every state has a tone, icon and an existing label key; failed is never green", () => {
    for (const s of HEALTH_STATES) {
      const p = healthPresentation(s);
      expect(hasKey(p.labelKey)).toBe(true);
      expect(p.icon).toBeTruthy();
    }
    expect(healthPresentation("failed").tone).toBe("crit");
    expect(healthPresentation("healthy").tone).toBe("ok");
    expect(healthPresentation("not_configured").tone).toBe("wait");
  });
  it("unknown values from a newer server read as unknown, never healthy", () => {
    expect(healthPresentation("mystery").tone).toBe("plan");
    expect(featureLabelKey("unknown")).toBe("s29.ops.feature.unverified");
    expect(featureLabelKey("mystery")).toBe("s29.ops.feature.unverified");
    expect(featureLabelKey("healthy")).toBe("s29.ops.state.healthy");
  });
  it("sorts most severe first", () => {
    const items = HEALTH_STATES.map((state) => ({ key: state, state }));
    expect(sortBySeverity([...items].reverse()).map((i) => i.state)).toEqual(["failed", "degraded", "unknown", "not_configured", "healthy", "live"]);
  });
});

function view(partial: Partial<DiagnosticsView> & { state?: "healthy" | "live" | "degraded" | "failed" | "unknown" | "not_configured" } = {}): Pick<DiagnosticsView, "summary" | "subsystems" | "incidents"> {
  return {
    summary: { state: partial.state ?? "healthy", headline: "x", openIncidents: 0, failingSubsystems: 0, ...(partial.summary ?? {}) },
    subsystems: partial.subsystems ?? [],
    incidents: partial.incidents ?? [],
  };
}
const sub = (key: string, state: DiagnosticsView["subsystems"][number]["state"]) => ({ key, state, checkedAt: "2026-11-01T10:00:00Z", latencyMs: null, evidence: [] });

describe("S29 ops presentation: summary is never greener than the evidence", () => {
  it("all healthy -> healthy headline", () => {
    const s = summarize(view({ subsystems: [sub("database", "healthy")] }));
    expect(s.state).toBe("healthy");
    expect(s.headlineKey).toBe("s29.ops.head.healthy");
  });
  it("healthy server summary with a degraded subsystem is shown as degraded", () => {
    expect(summarize(view({ subsystems: [sub("email", "degraded")] })).state).toBe("degraded");
  });
  it("a failed subsystem forces failed even if the server says healthy", () => {
    expect(summarize(view({ subsystems: [sub("database", "failed")] })).state).toBe("failed");
  });
  it("healthy with unverified or unconfigured parts uses the partial wording", () => {
    const s = summarize(view({ subsystems: [sub("database", "healthy"), sub("ai", "unknown"), sub("email", "not_configured")] }));
    expect(s.headlineKey).toBe("s29.ops.head.partial");
    expect(s.unverified).toBe(1);
    expect(s.notConfigured).toBe(1);
  });
  it("an open incident downgrades a healthy summary", () => {
    const inc = { id: "1", fingerprint: "f", subsystem: "api", category: "c", severity: "warning", firstSeenAt: "", lastSeenAt: "", occurrences: 1, lastRequestId: null, status: "open", likelyCause: null, nextAction: null, acknowledgedBy: null } as const;
    expect(summarize(view({ incidents: [inc] })).state).toBe("degraded");
  });
  it("every headline key exists", () => {
    for (const st of HEALTH_STATES) expect(hasKey(summarize(view({ state: st })).headlineKey)).toBe(true);
  });
});

describe("S29 ops presentation: release verdict never infers success", () => {
  it("live only when both SHAs are known, equal and the server agrees", () => {
    expect(releaseVerdict({ runningSha: "abc1234def", markerSha: "ABC1234DEF", isApprovedReleaseLive: true })).toBe("live");
  });
  it("differs when SHAs differ, even if the flag says true", () => {
    expect(releaseVerdict({ runningSha: "aaa", markerSha: "bbb", isApprovedReleaseLive: true })).toBe("differs");
    expect(releaseVerdict({ runningSha: "aaa", markerSha: "bbb", isApprovedReleaseLive: false })).toBe("differs");
  });
  it("unverified when the marker is missing or the flag is null; a true flag without SHAs is not trusted", () => {
    expect(releaseVerdict({ runningSha: "aaa", markerSha: null, isApprovedReleaseLive: null })).toBe("unverified");
    expect(releaseVerdict({ runningSha: null, markerSha: null, isApprovedReleaseLive: true })).toBe("unverified");
    expect(releaseVerdict({ runningSha: "aaa", markerSha: "aaa", isApprovedReleaseLive: null })).toBe("unverified");
  });
  it("shortens SHAs to 7 characters", () => {
    expect(shortSha("0123456789abcdef")).toBe("0123456");
    expect(shortSha(null)).toBeNull();
    expect(shortSha("  ")).toBeNull();
  });
});

describe("S29 ops presentation: time and numbers", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  it("formats relative ages in both languages and returns null for missing/invalid input", () => {
    expect(formatRelativeAge("2026-11-01T11:55:00Z", now, "en")).toBe("5 minutes ago");
    expect(formatRelativeAge("2026-10-29T12:00:00Z", now, "fr")).toMatch(/il y a 3 jours/);
    expect(formatRelativeAge("2026-11-01T11:59:50Z", now, "en")).toBe("now");
    expect(formatRelativeAge(null, now, "en")).toBeNull();
    expect(formatRelativeAge("garbage", now, "en")).toBeNull();
  });
  it("formats intervals and durations", () => {
    expect(formatInterval(30)).toBe("30 s");
    expect(formatInterval(300)).toBe("5 min");
    expect(formatInterval(7200)).toBe("2 h");
    expect(formatInterval(0)).toBe("—");
    expect(formatDuration(240)).toBe("240 ms");
    expect(formatDuration(1520)).toBe("1.5 s");
  });
});

describe("S29 ops presentation: checks and incidents", () => {
  it("every check has a question key in EN and FR", () => {
    for (const k of DIAGNOSTIC_CHECKS) {
      const key = checkQuestionKey(k);
      expect(key).toBe(`s29.ops.check.${k}`);
      expect(s29OpsFr[key]).toBeTruthy();
    }
    expect(s29OpsEn["s29.ops.check.programs_page"]).toBe("Why can't the Programs page load?");
  });
  it("incident actions follow the status", () => {
    expect(incidentActions("open")).toEqual(["acknowledge", "resolve"]);
    expect(incidentActions("acknowledged")).toEqual(["resolve"]);
    expect(incidentActions("resolved")).toEqual(["reopen"]);
  });
});

describe("S29 ops presentation: email states", () => {
  it("every state has labels and definitions, and the overview lists each exactly once", () => {
    for (const s of EMAIL_STATES) {
      const p = emailPresentation(s);
      expect(hasKey(p.labelKey) && hasKey(p.defKey)).toBe(true);
    }
    expect([...EMAIL_OVERVIEW_ORDER].sort()).toEqual([...EMAIL_STATES].sort());
  });
  it("accepted is described as accepted by the provider, not delivered", () => {
    expect(s29OpsEn["s29.ops.email.accepted.def"].toLowerCase()).toContain("provider");
    expect(s29OpsEn["s29.ops.email.accepted.def"].toLowerCase()).toContain("not proof");
    expect(s29OpsEn["s29.ops.email.accepted"]).not.toMatch(/deliver/i);
    expect(s29OpsFr["s29.ops.email.accepted.def"]).toMatch(/fournisseur/);
  });
  it("groups counts by what needs action", () => {
    const g = groupEmailCounts({ failed: 2, not_configured: 1, queued: 3, attempted: 1, accepted: 10, suppressed: 4, in_app_only: 5 });
    expect(g).toEqual({ attention: 3, pending: 4, done: 10, info: 9 });
  });
  it("explains suppressed reasons and falls back to null for unknown ones", () => {
    expect(suppressedReasonKey("synthetic_account")).toBe("s29.ops.suppressed.synthetic_account");
    expect(s29OpsEn["s29.ops.suppressed.synthetic_account"]).toContain("Never emailed");
    expect(suppressedReasonKey("something_new")).toBeNull();
    expect(suppressedReasonKey(null)).toBeNull();
  });
  it("retry only for failed / not_configured, never demo, admin only", () => {
    expect(canRetry({ emailState: "failed", isDemo: false }, true)).toBe(true);
    expect(canRetry({ emailState: "not_configured", isDemo: false }, true)).toBe(true);
    expect(canRetry({ emailState: "accepted", isDemo: false }, true)).toBe(false);
    expect(canRetry({ emailState: "failed", isDemo: true }, true)).toBe(false);
    expect(canRetry({ emailState: "failed", isDemo: false }, false)).toBe(false);
  });
  it("shortens long errors to one line", () => {
    expect(shortError(null)).toBeNull();
    expect(shortError("a\n\n b")).toBe("a b");
    expect(shortError("x".repeat(300))!.length).toBe(140);
  });
});

describe("S29 ops presentation: concierge draft", () => {
  it("round-trips the defaults and detects no change", () => {
    const d = toDraft(DEFAULT_CONCIERGE_SETTINGS);
    const p = parseDraft(d);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.value).toEqual(DEFAULT_CONCIERGE_SETTINGS);
    expect(draftChanged(d, DEFAULT_CONCIERGE_SETTINGS)).toBe(false);
    expect(draftChanged({ ...d, maxPerWeek: "5" }, DEFAULT_CONCIERGE_SETTINGS)).toBe(true);
  });
  it("reports errors per field for out-of-range, blank and non-integer values", () => {
    const d = { ...toDraft(DEFAULT_CONCIERGE_SETTINGS), inactiveDays: "1", maxPerWeek: "", repeatAfterDays: "2.5", supportUnansweredHours: "abc" };
    const p = parseDraft(d);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(Object.keys(p.errors).sort()).toEqual(["inactiveDays", "maxPerWeek", "repeatAfterDays", "supportUnansweredHours"]);
  });
  it("accepts boundary values", () => {
    expect(parseDraft({ ...toDraft(DEFAULT_CONCIERGE_SETTINGS), inactiveDays: "3", maxPerWeek: "14", supportUnansweredHours: "168" }).ok).toBe(true);
    expect(parseDraft({ ...toDraft(DEFAULT_CONCIERGE_SETTINGS), maxPerWeek: "15" }).ok).toBe(false);
  });
});

describe("S29 ops strings", () => {
  it("French defines every key, differs from English, and uses vouvoiement (no informal 'tu')", () => {
    for (const k of Object.keys(s29OpsEn) as (keyof typeof s29OpsEn)[]) {
      expect(s29OpsFr[k], k).toBeTruthy();
      expect(s29OpsFr[k]).not.toMatch(/\b(tu|ton|ta|tes|toi)\b/i);
    }
    expect(s29OpsEn["s29.ops.title"]).not.toBe("Ops");
  });
  it("uses no raw colour values in the ops stylesheet", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../client/src/components/s29/ops/ops.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });
});
