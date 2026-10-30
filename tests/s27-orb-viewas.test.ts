import { describe, expect, it } from "vitest";
import { studentIdFromPath } from "../client/src/components/orb/staff-orb";
import { en } from "../client/src/i18n/en";
import { fr } from "../client/src/i18n/fr";

describe("S27 owner requests: orb + persistent View as student", () => {
  it("finds the student on student-file routes only", () => {
    expect(studentIdFromPath("/admin/students/abc")).toBe("abc");
    expect(studentIdFromPath("/admin/students/abc/billing")).toBe("abc");
    expect(studentIdFromPath("/admin/students")).toBeNull();
    expect(studentIdFromPath("/admin/support-center")).toBeNull();
  });
  it("has EN and FR labels", () => {
    expect((en as Record<string, string>)["orb.ask"]).toBe("Ask Lumière");
    expect((fr as Record<string, string>)["orb.ask"]).toBe("Demander à Lumière");
    expect((fr as Record<string, string>)["staff.viewAs"]).toBe("Voir comme l’élève");
  });
});
