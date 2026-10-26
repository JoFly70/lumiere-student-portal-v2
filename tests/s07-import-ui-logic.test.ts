import { describe, expect, it } from "vitest";
import type { RoadmapContent } from "@shared/student-roadmap-contract";
import { itemFacts, reportedHistoryLine } from "@/lib/admin-roadmap-logic";
import { convertWorkbookPair } from "../server/services/roadmap-import";
import { buildEphExecution, buildEphMaster } from "./fixtures/s07/builders";

describe("S07 staff review facts", () => {
  it("lists provenance, condition, registration, equivalency and gate for imported items; history is labelled as reported", async () => {
    const m = await buildEphMaster(1);
    const e = await buildEphExecution(1);
    const r = await convertWorkbookPair(m.buffer, e.buffer, { fileName: m.fileName, companionFileName: e.fileName });
    const content = r.content as RoadmapContent;
    const tax = itemFacts(content.items.find((i) => i.key === "acc-352")!);
    expect(tax.some((f) => f.startsWith("Condition:"))).toBe(true);
    expect(tax.some((f) => f.includes("conditional (not confirmed)"))).toBe(true);
    expect(tax.some((f) => f.startsWith("Source: master Accounting AOS"))).toBe(true);
    const tecep = itemFacts(content.items.find((i) => i.key === "psy-3500")!);
    expect(tecep.some((f) => f.includes("TESU Spring 2027") && f.includes("last exam 2027-01-31"))).toBe(true);
    const cap = itemFacts(content.items.find((i) => i.key === "bus-4210")!);
    expect(cap.some((f) => f.includes("evidence not documented"))).toBe(true);
    expect(cap.some((f) => f.startsWith("Degree and licensing"))).toBe(true);
    const baseline = content.reportedHistory.find((h) => h.kind === "credit_baseline")!;
    expect(reportedHistoryLine(baseline)).toMatch(/51 credits as reported/);
  });
});
