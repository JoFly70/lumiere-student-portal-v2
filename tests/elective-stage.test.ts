import { describe, expect, it } from "vitest";
import {
  NEXT_STAGES, STAGE_MARKER, buildStageNote, canMoveTo, decisionReply, deriveStage, parseElectiveRequest, parseStageNote, stageHistory, ticketStatusForStage,
  type StageNoteLike,
} from "../client/src/lib/elective-stage";
import { buildElectiveChangeTicket } from "../client/src/lib/elective-change";
import { substituteInDraft, substitutionStatus } from "../client/src/lib/elective-apply";
import type { HsRoadmapContent, StaffHighSchoolState } from "../shared/high-school-contract";

const note = (stage: Parameters<typeof buildStageNote>[0], at: string, reason = "", internal = true): StageNoteLike => ({ content: buildStageNote(stage, reason), is_internal: internal, created_at: at, author_name: "Admin" });

describe("elective stage derivation", () => {
  it("is 'requested' without any stage note", () => {
    expect(deriveStage([])).toBe("requested");
    expect(deriveStage([{ content: "Thanks, we will look.", is_internal: true, created_at: "2026-10-01T10:00:00Z" }])).toBe("requested");
  });
  it("uses the latest internal stage note, regardless of array order", () => {
    const comments = [note("school_pending", "2026-10-03T10:00:00Z"), note("lumiere_review", "2026-10-02T10:00:00Z"), note("approved", "2026-10-04T10:00:00Z", "Ref 42")];
    expect(deriveStage(comments)).toBe("approved");
    expect(deriveStage([...comments].reverse())).toBe("approved");
    expect(stageHistory(comments).map((h) => h.stage)).toEqual(["lumiere_review", "school_pending", "approved"]);
    expect(stageHistory(comments)[2]!.reason).toBe("Ref 42");
  });
  it("ignores public comments that imitate the marker (a student cannot move a request)", () => {
    expect(deriveStage([note("approved", "2026-10-02T10:00:00Z", "", false)])).toBe("requested");
  });
  it("round-trips the machine-readable first line and rejects unknown stages", () => {
    expect(buildStageNote("rejected", "Not offered this year").split("\n")[0]).toBe(`${STAGE_MARKER} rejected`);
    expect(parseStageNote(buildStageNote("rejected", " Not offered \n twice "))).toEqual({ stage: "rejected", reason: "Not offered \n twice" });
    expect(parseStageNote("[ELECTIVE-STAGE] teleported")).toBeNull();
    expect(parseStageNote("see [ELECTIVE-STAGE] approved")).toBeNull();
  });
  it("breaks timestamp ties by thread order", () => {
    expect(deriveStage([note("lumiere_review", "2026-10-02T10:00:00Z"), note("school_pending", "2026-10-02T10:00:00Z")])).toBe("school_pending");
  });
});

describe("elective stage rules", () => {
  it("follows Requested -> Lumière review -> School approval pending -> Approved/Rejected -> Applied", () => {
    expect(canMoveTo("requested", "lumiere_review")).toBe(true);
    expect(canMoveTo("requested", "approved")).toBe(false);
    expect(canMoveTo("lumiere_review", "school_pending")).toBe(true);
    expect(canMoveTo("school_pending", "approved")).toBe(true);
    expect(canMoveTo("school_pending", "rejected")).toBe(true);
    expect(canMoveTo("approved", "applied")).toBe(true);
    expect(canMoveTo("applied", "rejected")).toBe(false);
    expect(NEXT_STAGES.applied).toEqual([]);
  });
  it("resolves the ticket for rejected/applied and keeps it in progress otherwise", () => {
    expect(ticketStatusForStage("rejected")).toBe("resolved");
    expect(ticketStatusForStage("applied")).toBe("resolved");
    for (const s of ["requested", "lumiere_review", "school_pending", "approved"] as const) expect(ticketStatusForStage(s)).toBe("in_progress");
  });
  it("writes the decision to the student in English and French", () => {
    const approved = decisionReply("approved", { from: "Art", to: "Psychology" })!;
    expect(approved).toContain("approved");
    expect(approved).toContain("approuvée");
    const rejected = decisionReply("rejected", { from: "Art", to: "Psychology", reason: "Not offered" })!;
    expect(rejected).toContain("Reason: Not offered");
    expect(rejected).toContain("Motif : Not offered");
    expect(decisionReply("applied", { from: "Art", to: "Psychology" })).toContain("à jour");
    expect(decisionReply("lumiere_review", { from: "a", to: "b" })).toBeNull();
    expect(decisionReply("school_pending", { from: "a", to: "b" })).toBeNull();
  });
});

describe("elective request facts", () => {
  it("parses what the student request builder wrote", () => {
    const t = buildElectiveChangeTicket({ courseKey: "intro-psych", courseTitle: "Introduction to Psychology (PROPOSED)", alternate: "Art History", reason: "Schedule clash" });
    const f = parseElectiveRequest(t.subject, t.description);
    expect(f).toEqual({ courseTitle: "Introduction to Psychology (PROPOSED)", courseKey: "intro-psych", alternate: "Art History", reason: "Schedule clash" });
  });
  it("degrades gracefully when the description is unreadable", () => {
    const f = parseElectiveRequest("Elective change request: Art → Music", "free text");
    expect(f.courseKey).toBeNull();
    expect(f.alternate).toBe("Music");
    expect(f.courseTitle).toBe("Art");
  });
});

const content = (extra: Partial<HsRoadmapContent["courses"][number]>[] = []): HsRoadmapContent => ({
  areas: [{ key: "elective", label: "Electives", kind: "elective", requiredHalfUnits: 8 }],
  courses: [
    { key: "art", title: "Art", areaKey: "elective", halfUnits: 2, status: "planned", replacesCourseKey: null, plannedStart: "2026-11-01", plannedEnd: "2027-01-01", tasks: [] },
    ...extra.map((e, i) => ({ key: `x${i}`, title: "X", areaKey: "elective", halfUnits: 2, status: "planned" as const, replacesCourseKey: null, plannedStart: null, plannedEnd: null, tasks: [], ...e })),
  ],
  totalRequiredHalfUnits: 8,
} as unknown as HsRoadmapContent);
const state = (o: { published?: HsRoadmapContent; draft?: HsRoadmapContent }): StaffHighSchoolState => ({
  current: {
    enrollment: { id: "e1" },
    published: o.published ? { versionNumber: 3, versionId: "v3", content: o.published } : null,
    draft: o.draft ? { versionNumber: 4, draftRevision: 7, content: o.draft } : null,
  },
} as unknown as StaffHighSchoolState);

describe("applying a substitution without editing the published version", () => {
  it("offers a new draft when only a published version exists", () => {
    expect(substitutionStatus(state({ published: content() }), "art", "Music").kind).toBe("can_draft");
  });
  it("does not clobber an existing draft", () => {
    expect(substitutionStatus(state({ published: content(), draft: content() }), "art", "Music").kind).toBe("blocked");
  });
  it("detects the swap in a draft and in the published version", () => {
    const swapped = substituteInDraft(content(), "art", "Music");
    expect(substitutionStatus(state({ published: content(), draft: swapped }), "art", "Music").kind).toBe("draft");
    expect(substitutionStatus(state({ published: swapped }), "art", "music").kind).toBe("published");
  });
  it("keeps the replaced course (history) and copies area, credit and dates", () => {
    const next = substituteInDraft(content(), "art", "Music");
    const old = next.courses.find((c) => c.key === "art")!;
    const added = next.courses.find((c) => c.replacesCourseKey === "art")!;
    expect(old.status).toBe("replaced");
    expect(added).toMatchObject({ title: "Music", areaKey: "elective", halfUnits: 2, status: "planned", plannedStart: "2026-11-01", plannedEnd: "2027-01-01" });
  });
  it("refuses an unknown or already replaced course and a request without a course key", () => {
    expect(() => substituteInDraft(content(), "nope", "Music")).toThrow();
    expect(substitutionStatus(state({ published: content() }), null, "Music").kind).toBe("blocked");
    expect(substitutionStatus(state({ published: content() }), "nope", "Music").kind).toBe("blocked");
  });
});
