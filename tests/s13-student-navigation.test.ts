import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterStudentNav, programAccess, studentLandingPath } from "../client/src/lib/student-programs";
import type { StudentProgramsView } from "../shared/high-school-contract";

const read = (p: string) => readFileSync(p, "utf8");
const prog = (...kinds: Array<"high_school" | "university_degree">): StudentProgramsView => ({
  programs: kinds.map((kind, i) => ({ kind, id: String(i), title: kind, status: "active", current: true })),
});
const NAV = ["/high-school", "/flight-deck", "/roadmap", "/profile", "/documents", "/billing", "/support"].map((url) => ({ url }));
const urls = (a: ReturnType<typeof programAccess>) => filterStudentNav(NAV, a).map((i) => i.url);

describe("program access", () => {
  it("classifies the payload", () => {
    expect(programAccess(prog("high_school"))).toEqual({ hasHighSchool: true, highSchoolOnly: true });
    expect(programAccess(prog("university_degree"))).toEqual({ hasHighSchool: false, highSchoolOnly: false });
    expect(programAccess(prog("high_school", "university_degree"))).toEqual({ hasHighSchool: true, highSchoolOnly: false });
    expect(programAccess(prog())).toEqual({ hasHighSchool: false, highSchoolOnly: false });
    expect(programAccess(undefined)).toEqual({ hasHighSchool: false, highSchoolOnly: false });
  });
});

describe("landing", () => {
  it("high-school-only students land on /high-school; everyone else (and failures) on /flight-deck", () => {
    expect(studentLandingPath(programAccess(prog("high_school")))).toBe("/high-school");
    expect(studentLandingPath(programAccess(prog("high_school", "university_degree")))).toBe("/flight-deck");
    expect(studentLandingPath(programAccess(prog("university_degree")))).toBe("/flight-deck");
    expect(studentLandingPath(programAccess(undefined))).toBe("/flight-deck");
  });
  it("RoleLanding waits for the programs lookup before redirecting", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain("useStudentPrograms(isStudent)");
    expect(app).toContain("if (programs.isLoading)");
    expect(app).toContain("studentLandingPath(programs)");
    expect(app).toContain("<UniversityOnly><FlightDeck /></UniversityOnly>");
    expect(app).toContain("<UniversityOnly><Roadmap /></UniversityOnly>");
    expect(read("client/src/pages/login.tsx")).not.toContain("'/flight-deck'");
  });
});

describe("navigation matrix", () => {
  it("university-only student: no High School entry, everything else as before", () => {
    expect(urls(programAccess(prog("university_degree")))).toEqual(["/flight-deck", "/roadmap", "/profile", "/documents", "/billing", "/support"]);
  });
  it("both programs: High School appears alongside the university entries", () => {
    expect(urls(programAccess(prog("high_school", "university_degree")))).toEqual(NAV.map((i) => i.url));
  });
  it("high-school-only: High School first, no Flight Deck or Roadmap, Profile/Documents/Support kept", () => {
    const u = urls(programAccess(prog("high_school")));
    expect(u[0]).toBe("/high-school");
    expect(u).not.toContain("/flight-deck");
    expect(u).not.toContain("/roadmap");
    for (const keep of ["/profile", "/documents", "/support"]) expect(u).toContain(keep);
  });
  it("sidebar and mobile bar both use the filter; the theme toggle is 44px", () => {
    const sidebar = read("client/src/components/app-sidebar.tsx");
    const shell = read("client/src/components/student-shell.tsx");
    expect(sidebar).toContain('url: "/high-school"');
    expect(sidebar).toContain("filterStudentNav(studentJourneyItems, programs)");
    expect(shell).toContain('url: "/high-school"');
    expect(shell).toContain("filterStudentNav(BAR_ITEMS, programs)");
    expect(shell).toContain('<ThemeToggle className="h-11 w-11" />');
  });
  it("Billing stays: the page states honestly that billing is not connected", () => {
    expect(read("client/src/pages/billing.tsx")).toContain("Billing information is not connected yet");
  });
});
