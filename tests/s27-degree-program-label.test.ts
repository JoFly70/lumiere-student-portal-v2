import { describe, expect, it } from "vitest";
import { degreeProgramLabel } from "../server/routes/admin-students-directory";
import { buildControlCenter, type ControlCenterFacts } from "../server/services/program-journey/control-center";
import { shortProgram } from "../client/src/components/admin/directory/directory-data";

describe("S27-OWNER-005 degree program shown in staff lists", () => {
  it("labels a degree program with its credits, and without when the version has no total", () => {
    expect(degreeProgramLabel("Bachelor of Science in Business Administration", 120)).toBe("Bachelor of Science in Business Administration · 120 credits");
    expect(degreeProgramLabel("Bachelor of Arts", null)).toBe("Bachelor of Arts");
    // the directory row splits "title · credits" into two lines
    expect(shortProgram(degreeProgramLabel("Bachelor of Science in Business Administration", 120)).split(" · ")).toEqual(["Bachelor of Science in Business Administration", "120 credits"]);
  });
  it("Control Center row for a degree student is 'degree', not 'No program yet'", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    const facts: ControlCenterFacts = {
      students: [{ id: "a1", code: "DEMO-S27-P9", name: "Avery Synthetic-A", preferredName: "DEMO Avery", userId: "ua" }],
      enrollments: [], progress: [], awards: [], results: [], agreements: [], pendingDocuments: [], evidenceAwaiting: [], billing: [],
      receiptsThisMonth: [], tickets: [], sessionRequests: [], degrees: [{ studentId: "a1" }], truncated: false,
    };
    const row = buildControlCenter(facts, now).students[0]!;
    expect(row.program).toBe("degree");
    expect(row.status.label).not.toBe("No program yet");
    expect(row.creditsRequired).toBeNull();
    const none = buildControlCenter({ ...facts, degrees: [] }, now).students[0]!;
    expect(none.program).toBe("none");
    expect(none.status.label).toBe("No program yet");
  });
});
