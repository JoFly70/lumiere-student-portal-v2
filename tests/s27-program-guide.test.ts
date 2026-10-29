import { describe, expect, it } from "vitest";
import { KNOWLEDGE } from "../server/data/academic-assistant/knowledge";
import { searchKnowledge } from "../server/services/academic-assistant/retrieval";
import { withProgramGuide } from "../server/services/owner-assistant/service";

const GUIDE_IDS = ["awarding-school-diploma-structure", "awarding-school-transfer-minimum", "awarding-school-course-names", "awarding-school-electives-prerequisites", "awarding-school-graded-work"];

describe("S27 program guide (catalog facts, school never named)", () => {
  it("adds the catalog entries in EN and FR with generic wording and no source link", () => {
    const entries = KNOWLEDGE.filter((e) => GUIDE_IDS.includes(e.id));
    expect(entries).toHaveLength(5);
    for (const e of entries) {
      expect(e.institution).toBe("Awarding school");
      expect(e.sources ?? []).toHaveLength(0);
      expect(e.text.en.length).toBeGreaterThan(80);
      expect(e.text.fr.length).toBeGreaterThan(80);
      expect(`${e.text.en} ${e.text.fr}`).not.toMatch(/https?:\/\//); // no source host: it would identify the school
    }
  });
  it("retrieval finds them for catalog questions", () => {
    expect(searchKnowledge("How many exams does English 1 have?", 3).map((h) => h.entry.id)).toContain("awarding-school-graded-work");
    expect(searchKnowledge("Consumer Math on my old transcript", 3).map((h) => h.entry.id)).toContain("awarding-school-course-names");
    expect(searchKnowledge("Combien de crédits dois-je faire avec l'école ?", 3).map((h) => h.entry.id)).toContain("awarding-school-transfer-minimum");
  });
  it("Owner AI gets them as citable guide records after the student's records, without links", () => {
    const base = [{ ref: "R1", kind: "student" as const, label: "Student file", path: "/admin/students/x", text: "Student X." }];
    const out = withProgramGuide(base, "How many exams does English 1 have?");
    expect(out[0]).toEqual(base[0]);
    const guide = out.slice(1);
    expect(guide.length).toBeGreaterThan(0);
    expect(guide.every((r, i) => r.kind === "guide" && r.ref === `R${i + 2}` && r.path === "" && r.label.startsWith("Lumière program guide: "))).toBe(true);
    expect(guide.map((r) => r.text).join(" ")).toContain("10 exams");
  });
});
