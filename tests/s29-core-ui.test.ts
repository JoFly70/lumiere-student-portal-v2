/** S29 core UI helpers: Needs attention filtering/sorting, i18n coverage of every rules-engine kind and action. */
import { describe, expect, it } from "vitest";
import { filterAndSortAttention } from "../client/src/components/s29/core/needs-attention";
import { en } from "../client/src/i18n/en";
import { fr } from "../client/src/i18n/fr";
import { ATTENTION_KINDS, ATTENTION_WORKFLOWS, NOTIFICATION_CATEGORIES, type AttentionItemView } from "../shared/s29-contract";

const item = (o: Partial<AttentionItemView>): AttentionItemView => ({
  key: "k", kind: "inactive", workflow: "academic", priority: "high", status: "open", studentId: "s", studentName: "A B", studentCode: null, isDemo: false,
  title: "", detail: "", reason: { rule: "", facts: {} }, arisenAt: "2026-11-01T00:00:00.000Z", detectedAt: "2026-11-02T00:00:00.000Z", lastSeenAt: "", action: "contact_student",
  href: "/", resolvedAt: null, resolvedBy: null, resolution: null, snoozedUntil: null, ...o,
});

describe("S29 Needs attention helpers", () => {
  const items = [
    item({ key: "a", priority: "normal", arisenAt: "2026-10-01T00:00:00.000Z" }),
    item({ key: "b", priority: "urgent", arisenAt: "2026-11-05T00:00:00.000Z" }),
    item({ key: "c", priority: "high", isDemo: true }),
    item({ key: "d", priority: "high", status: "dismissed", workflow: "billing" }),
  ];
  const base = { workflow: "all" as const, priority: "all" as const, demo: false, dismissed: false, sort: "priority" as const };
  it("hides demo and dismissed by default, sorts by priority", () => {
    expect(filterAndSortAttention(items, base).map((i) => i.key)).toEqual(["b", "a"]);
  });
  it("filters by workflow / priority and shows demo + dismissed on request", () => {
    expect(filterAndSortAttention(items, { ...base, demo: true, dismissed: true }).map((i) => i.key)).toEqual(["b", "c", "d", "a"]);
    expect(filterAndSortAttention(items, { ...base, dismissed: true, workflow: "billing" }).map((i) => i.key)).toEqual(["d"]);
    expect(filterAndSortAttention(items, { ...base, priority: "normal" }).map((i) => i.key)).toEqual(["a"]);
  });
  it("sorts oldest / newest by when the issue arose", () => {
    expect(filterAndSortAttention(items, { ...base, sort: "oldest" }).map((i) => i.key)).toEqual(["a", "b"]);
    expect(filterAndSortAttention(items, { ...base, sort: "newest" }).map((i) => i.key)).toEqual(["b", "a"]);
  });
});

describe("S29 i18n coverage", () => {
  const actions = ["review_documents", "review_payment", "follow_up_payment", "record_payment", "check_deadline", "contact_student", "review_scores", "record_school_result", "decide_elective", "confirm_session", "reply_support", "complete_checkpoint", "prepare_checkpoint", "prepare_session", "verify_results", "check_delivery"];
  it("every kind, action, workflow and category has EN and FR text", () => {
    const keys = [...ATTENTION_KINDS.map((k) => `s29.core.kind.${k}`), ...actions.map((a) => `s29.core.action.${a}`), ...ATTENTION_WORKFLOWS.map((w) => `s29.core.attn.wf.${w}`), ...NOTIFICATION_CATEGORIES.map((c) => `s29.core.cat.${c}`)];
    for (const k of keys) {
      expect((en as Record<string, string>)[k], k).toBeTruthy();
      expect((fr as Record<string, string>)[k], k).toBeTruthy();
    }
  });
});
