import { describe, expect, it } from "vitest";
import { filterStudentNav } from "../client/src/lib/student-programs";

const items = [{ url: "/flight-deck" }, { url: "/high-school" }, { url: "/high-school/flight-deck" }, { url: "/roadmap" }];
const urls = (a: { hasHighSchool: boolean; highSchoolOnly: boolean }) => filterStudentNav(items, a).map((i) => i.url);

describe("S19: High School Flight Deck nav entry", () => {
  it("is shown only to students who hold both programs", () => {
    expect(urls({ hasHighSchool: true, highSchoolOnly: false })).toContain("/high-school/flight-deck");
    expect(urls({ hasHighSchool: true, highSchoolOnly: true })).not.toContain("/high-school/flight-deck");
    expect(urls({ hasHighSchool: false, highSchoolOnly: false })).not.toContain("/high-school/flight-deck");
  });
});
