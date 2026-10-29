/**
 * S10 staff pass: the staff surfaces share the Lumière vocabulary and structure.
 * Pure helpers + markup/source checks (the browser interaction test is
 * scripts/s10/staff-interaction-test.ts).
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { overdueByLabel, ticketStatusKey, initials, STAFF_QUEUES, staffQueueFilters } from "@/components/support/support-presentation";
import { creditRecordStanding, creditRecordStandingCounts, documentStatusKey } from "@/pages/admin-student-workspace-presentation";
import { profileDecisionCount } from "@/components/admin/student-profile-review-logic";
import { StaffTabList, StaffTabPanel, KpiTile } from "@/components/staff/staff-ui";

const read = (p: string) => readFileSync(p, "utf8");
const NOW = new Date("2026-10-26T15:00:00.000Z");

describe("ticket urgency and status vocabulary", () => {
  it("maps ticket statuses into the shared status language", () => {
    expect(ticketStatusKey("open")).toBe("submitted");
    expect(ticketStatusKey("in_progress")).toBe("progress");
    expect(ticketStatusKey("waiting_on_student")).toBe("notstarted");
    expect(ticketStatusKey("resolved")).toBe("applied");
  });
  it("says how far past the target an overdue ticket is, and nothing for others", () => {
    const base = { awaiting: "staff" as const, priority: "high" as const, is_overdue: true };
    expect(overdueByLabel({ ...base, awaiting_since: "2026-10-24T15:00:00.000Z" }, NOW)).toBe("1 day past the 1-day target");
    expect(overdueByLabel({ ...base, is_overdue: false, awaiting_since: "2026-10-24T15:00:00.000Z" }, NOW)).toBeNull();
    expect(overdueByLabel({ ...base, awaiting: "student", awaiting_since: "2026-10-01T15:00:00.000Z" }, NOW)).toBeNull();
  });
  it("every queue the desk offers has a filter and initials are stable", () => {
    for (const q of STAFF_QUEUES) expect(staffQueueFilters(q.key)).toBeTypeOf("object");
    expect(initials("Camille Moreau")).toBe("CM");
    expect(initials("  ")).toBe("?");
  });
});

describe("workspace vocabulary: records never read as official unless verified", () => {
  it("only a verified record is Verified; the rest wait for verification", () => {
    expect(creditRecordStanding("VERIFIED_APPLIED")).toMatchObject({ key: "verified", status: "official" });
    expect(creditRecordStanding("PENDING_VERIFICATION")).toMatchObject({ key: "waiting", label: "Waiting for verification" });
    expect(creditRecordStanding("reported")).toMatchObject({ key: "waiting" });
    expect(creditRecordStanding("not_accepted").status).toBe("attention");
    expect(creditRecordStandingCounts([{ status: "verified" }, { status: "pending" }, {}])).toEqual({ verified: 1, waiting: 2, not_accepted: 0 });
    expect(documentStatusKey("verified")).toBe("official");
    expect(documentStatusKey("pending")).toBe("submitted");
  });
  it("one decision count for the profile, derived from the same contacts rule", () => {
    expect(profileDecisionCount({ identity: { pendingCorrection: null }, contacts: [] })).toBe(0);
    expect(profileDecisionCount({ identity: { pendingCorrection: {} }, contacts: [] })).toBe(1);
  });
});

describe("tabs and tiles", () => {
  const tabs = [{ key: "a", label: "A" }, { key: "b", label: "B", count: 2, countLabel: "waiting" }];
  it("renders an ARIA tablist with one selected, roving tabindex and a labelled panel", () => {
    const html = renderToStaticMarkup(React.createElement(StaffTabList, { tabs, active: "b", onChange: () => {}, label: "Sections", idPrefix: "x" }));
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/id="x-tab-b"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="x-tab-b"/);
    expect(html).toContain('aria-controls="x-panel-a"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("waiting");
    const panel = renderToStaticMarkup(React.createElement(StaffTabPanel, { idPrefix: "x", tabKey: "a", active: false }, "inside"));
    expect(panel).toContain('role="tabpanel"');
    expect(panel).toContain("hidden");
    expect(panel).toContain("inside"); // content stays in the DOM so deep links and tests can reach it
  });
  it("a filter tile exposes its pressed state in text and aria", () => {
    const on = renderToStaticMarkup(React.createElement(KpiTile, { label: "Overdue", value: 3, pressed: true, onClick: () => {} }));
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain("Showing");
    expect(renderToStaticMarkup(React.createElement(KpiTile, { label: "Overdue", value: 3, pressed: false, onClick: () => {} }))).not.toContain("Showing");
  });
});

describe("structure", () => {
  it("the workspace has real tabs and no longer prints the end-of-profile seam or Jump to links", () => {
    const ws = read("client/src/pages/admin-student-workspace.tsx");
    const profile = read("client/src/components/admin/student-profile-review.tsx");
    expect(ws).toContain("StaffTabList");
    expect(ws).not.toContain("Jump to");
    expect(profile.toLowerCase()).not.toContain("end of profile");
    expect(profile).not.toContain("profile-end");
    expect(ws).toContain('"workspace-documents": "documents"'); // old anchors still deep-link
  });
  it("admins get a Students entry that opens the existing list route; staff keep Support only", () => {
    const sidebar = read("client/src/components/app-sidebar.tsx");
    expect(sidebar).toContain('title: "Students", url: ADMIN_STUDENTS_PATH');
    expect(sidebar).toMatch(/const staffMenuItems = \[\s*\{ title: "Support desk"/);
  });
  it("gold is never used for a verified status in the staff panel", () => {
    expect(read("client/src/components/admin/student-profile-review.tsx")).toContain('verified: "border-st-official bg-st-official');
  });
});
