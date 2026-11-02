import { describe, it, expect } from "vitest";
import type { ControlCenterFacts } from "../server/services/program-journey/control-center";
import { buildAttention, EMPTY_EXTRA } from "../server/services/s29/rules";
import { DEFAULT_CONCIERGE_SETTINGS, ATTENTION_KINDS } from "../shared/s29-contract";
import { canRoleOpen } from "../shared/staff-links";
import { en } from "../client/src/i18n/en";
import { fr } from "../client/src/i18n/fr";

// S34 (S33-05): an outstanding transcript request produces exactly one Needs Attention item per student.
const NOW = new Date("2026-11-11T12:00:00Z");
const cc: ControlCenterFacts = {
  students: [{ id: "hs1", code: "C1", name: "Diploma One", preferredName: null, userId: "u1" }],
  enrollments: [], progress: [], awards: [], results: [], agreements: [], pendingDocuments: [], evidenceAwaiting: [], billing: [],
  receiptsThisMonth: [], tickets: [], sessionRequests: [], truncated: false,
};
const pick = (transcriptRequests: Array<{ studentId: string; requestedAt: string }>) =>
  buildAttention(cc, { ...EMPTY_EXTRA, transcriptRequests }, DEFAULT_CONCIERGE_SETTINGS, NOW).items.filter((i) => i.kind === "transcript_requested");

describe("transcript_requested rule", () => {
  it("identifies the student, says what was requested, and deep-links to the Graduation tab", () => {
    const [item, ...rest] = pick([{ studentId: "hs1", requestedAt: "2026-11-10T09:00:00Z" }]);
    expect(rest).toEqual([]);
    expect(item).toMatchObject({
      key: "transcript_requested:hs1", studentId: "hs1", studentName: "Diploma One", workflow: "academic",
      action: "prepare_transcript", title: "Transcript requested", href: "/admin/students/hs1/high-school?tab=graduation", priority: "normal",
    });
    expect(canRoleOpen("staff", item!.href)).toBe(true);
    expect(canRoleOpen("student", item!.href)).toBe(false);
  });
  it("escalates after a week", () => {
    expect(pick([{ studentId: "hs1", requestedAt: "2026-11-01T09:00:00Z" }])[0]!.priority).toBe("high");
  });
  it("one item per student with a stable key, none once the status moved off 'requested'", () => {
    const a = pick([{ studentId: "hs1", requestedAt: "2026-11-10T09:00:00Z" }]);
    const b = pick([{ studentId: "hs1", requestedAt: "2026-11-10T09:00:00Z" }]);
    expect(a.map((i) => i.key)).toEqual(b.map((i) => i.key));
    expect(pick([])).toEqual([]);
  });
  it("ignores unknown students", () => {
    expect(pick([{ studentId: "ghost", requestedAt: "2026-11-10T09:00:00Z" }])).toEqual([]);
  });
  it("has EN/FR labels and an action text", () => {
    expect(ATTENTION_KINDS).toContain("transcript_requested");
    for (const k of ["s29.core.kind.transcript_requested", "s29.core.action.prepare_transcript"]) {
      expect((en as Record<string, string>)[k], k).toBeTruthy();
      expect((fr as Record<string, string>)[k], k).toBeTruthy();
    }
  });
});
