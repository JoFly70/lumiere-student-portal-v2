import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewPanel } from "../client/src/pages/admin-student-roadmap";
import { convertWorkbookPair } from "../server/services/roadmap-import";
import { reviewRoadmapPlan } from "../shared/student-roadmap-plan-review";
import { validateRoadmapContent } from "../shared/student-roadmap-validation";
import type { AdminRoadmapDraftView, RoadmapException } from "../shared/student-roadmap-contract";
import { buildEphExecution, buildEphMaster } from "./fixtures/s07/builders";

// the client JSX uses the automatic runtime (Vite); vitest's transform here is classic, so provide React globally
Object.assign(globalThis, { React });

async function draftFromFixture(): Promise<AdminRoadmapDraftView> {
  const m = await buildEphMaster(1);
  const e = await buildEphExecution(1);
  const conv = await convertWorkbookPair(m.buffer, e.buffer, { fileName: m.fileName, companionFileName: e.fileName });
  const content = conv.content!;
  const seen = new Set<string>();
  const exceptions: RoadmapException[] = [];
  for (const x of [...conv.exceptions, ...validateRoadmapContent(content), ...reviewRoadmapPlan(content, { today: "2026-10-26", foundation: null, progressKeys: new Map() })]) {
    if (seen.has(x.key)) continue;
    seen.add(x.key);
    exceptions.push(x);
  }
  return { content, exceptions, acknowledgements: [] } as unknown as AdminRoadmapDraftView;
}

const props = (draft: AdminRoadmapDraftView, selected = new Set<string>()) => ({
  draft,
  acked: new Set<string>(),
  selectedKeys: selected,
  setSelectedKeys: () => undefined,
  ackNote: "",
  setAckNote: () => undefined,
  busy: null,
  onAcknowledge: () => undefined,
});

describe("staff review panel (server-rendered markup)", () => {
  it("shows grouped findings with counts, category headings and reachable sources; every warning key is represented once", async () => {
    const draft = await draftFromFixture();
    const html = renderToStaticMarkup(createElement(ReviewPanel, props(draft)));
    const warnings = draft.exceptions.filter((e) => e.severity === "warning");
    expect(html).toContain("Review findings");
    expect(html).toContain("By issue type");
    expect(html).toContain("By course");
    expect(html).toContain("Academic uncertainty");
    expect(html).toMatch(/×\d+/);
    expect(html).toContain("Warnings — acknowledge before publishing");
    expect(html).toContain(`${warnings.length} of ${warnings.length} findings open`);
    // one checkbox per group, far fewer than warnings
    const checkboxes = (html.match(/role="checkbox"/g) ?? []).length;
    expect(checkboxes).toBeGreaterThan(0);
    expect(checkboxes).toBeLessThan(warnings.length / 2);
    // source evidence is in the markup (inside <details>), per member
    for (const w of warnings.slice(0, 5)) {
      const loc = w.ref.itemKey ?? w.ref.path ?? w.ref.sheet;
      expect(html).toContain(String(loc));
    }
    expect(html).toContain("Acknowledge selected (0 findings)");
  });

  it("selecting findings shows the finding count (all members of a group are submitted)", async () => {
    const draft = await draftFromFixture();
    const keys = new Set(draft.exceptions.filter((e) => e.severity === "warning").map((e) => e.key));
    const html = renderToStaticMarkup(createElement(ReviewPanel, props(draft, keys)));
    expect(html).toContain(`Acknowledge selected (${keys.size} findings)`);
  });

  it("a clean draft says so and has no acknowledge controls", () => {
    const draft = { content: { items: [] }, exceptions: [], acknowledgements: [] } as unknown as AdminRoadmapDraftView;
    const html = renderToStaticMarkup(createElement(ReviewPanel, props(draft)));
    expect(html).toContain("No exceptions. Everything converted cleanly.");
    expect(html).not.toContain("Acknowledge selected");
  });
});
