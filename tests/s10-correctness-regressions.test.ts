/**
 * S10 correctness regressions: one test per verified finding of the independent review
 * (docs/recovery/s10-evidence/correctness-triage.md).
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SUPPORT_STATUS_LABEL, TICKET_STATUSES, awaitingFor, staffStatusLabel } from "../shared/support-contract";
import { STUDENT_STATUS_LABEL, assigneeSelectValue, staffQueueFilters, staffRowAge, studentStatusLabel } from "../client/src/components/support/support-presentation";
import { TicketRow } from "../client/src/components/support/staff-support-desk";
import { docStatusLabel, docTypeLabel } from "../client/src/lib/document-type-labels";
import { formatWorkspaceDateTime, workspaceProgressStatusLabel, workspaceToken } from "../client/src/pages/admin-student-workspace-presentation";
import { queryStaffQueue, staffStats, withOverdue } from "./helpers/support-queue-sim";
import { canonicalTicketDetails } from "./helpers/canonical-synthetic-student";
import { SUPPORT_NOW, toSummary } from "./helpers/support-ui-fixtures";
import { readFileSync } from "node:fs";

(globalThis as any).React = React; // components use the automatic JSX runtime in Vite; vitest renders them classic
const NOW = SUPPORT_NOW;
const ME = "advisor-1";

// The staff-side demo set used by the desk screenshots: t-2 is an old high-priority request.
const staffTickets = withOverdue(
  canonicalTicketDetails().map((d) => toSummary(d as any)).map((t) =>
    t.id === "t-2" ? { ...t, priority: "high" as const, created_at: "2026-10-24T09:00:00.000Z", awaiting_since: "2026-10-24T09:00:00.000Z" } : t),
  NOW,
);
const ids = (list: readonly { id: string }[]) => list.map((t) => t.id).sort();

describe("status vocabulary: one table, two audiences", () => {
  it("every internal status has a staff and a student label, and no screen prints the raw enum", () => {
    for (const s of TICKET_STATUSES) {
      expect(staffStatusLabel(s)).toBe(SUPPORT_STATUS_LABEL[s].staff);
      expect(studentStatusLabel(s)).toBe(SUPPORT_STATUS_LABEL[s].student);
      expect(STUDENT_STATUS_LABEL[s]).toBe(SUPPORT_STATUS_LABEL[s].student);
      expect(staffStatusLabel(s)).not.toMatch(/_/);
    }
  });
  it("the documented translation table matches the code", () => {
    const spec = readFileSync("docs/s08/S08-support-api-spec.md", "utf8");
    for (const s of TICKET_STATUSES) {
      const row = `| \`${s}\` | ${awaitingFor(s)} | ${SUPPORT_STATUS_LABEL[s].staff} | ${SUPPORT_STATUS_LABEL[s].student} |`;
      expect(spec, row).toContain(row);
    }
  });
});

describe("staff desk: filters, tiles, cards and details agree", () => {
  const stats = staffStats(staffTickets, NOW).stats;

  it("'Needs response' lists only tickets awaiting staff, never resolved or waiting-on-student ones", () => {
    const list = queryStaffQueue(staffTickets, new URLSearchParams(staffQueueFilters("needs") as any), NOW, ME);
    expect(list.every((t) => awaitingFor(t.status) === "staff")).toBe(true);
    expect(list.some((t) => t.status === "resolved" || t.status === "waiting_on_student")).toBe(false);
  });

  it("every tile number equals the length of the list it opens", () => {
    const count = (key: Parameters<typeof staffQueueFilters>[0]) =>
      queryStaffQueue(staffTickets, new URLSearchParams(staffQueueFilters(key) as any), NOW, ME).length;
    expect(count("needs")).toBe(stats.awaitingStaff);
    expect(count("waiting")).toBe(stats.awaitingStudent);
    expect(count("overdue")).toBe(stats.overdue);
    expect(count("unassigned")).toBe(stats.unassigned);
    expect(stats.overdue).toBeGreaterThan(0); // the screenshot set really contains an overdue ticket
  });

  it("an overdue ticket carries a visible, identifiable overdue indicator; a fresh one does not", () => {
    const overdue = staffTickets.find((t) => t.is_overdue)!;
    const fresh = staffTickets.find((t) => !t.is_overdue && t.status === "open")!;
    const html = (t: any) => renderToStaticMarkup(React.createElement(TicketRow, { ticket: t, selected: false, onSelect: () => {} }));
    expect(html(overdue)).toContain('data-testid="overdue-flag"');
    expect(html(overdue)).toContain("Overdue");
    expect(html(fresh)).not.toContain('data-testid="overdue-flag"');
    // Overdue means awaiting staff longer than the priority target; resolved tickets are never overdue.
    expect(staffTickets.filter((t) => t.status === "resolved").every((t) => !t.is_overdue)).toBe(true);
  });

  it("the card's assignee and the detail dropdown resolve the same person", () => {
    for (const t of canonicalTicketDetails()) {
      expect(assigneeSelectValue(t)).toBe(t.assignee?.id ?? "");
    }
    // Even when the API omits assigned_to, the dropdown must not claim "Unassigned".
    expect(assigneeSelectValue({ assignee: { id: "advisor-1" } })).toBe("advisor-1");
    expect(assigneeSelectValue({ assigned_to: null, assignee: null })).toBe("");
    const card = renderToStaticMarkup(React.createElement(TicketRow, { ticket: staffTickets[0] as any, selected: false, onSelect: () => {} }));
    expect(card).toContain("Assigned: Camille Moreau");
  });

  it("row age is honest: awaiting-staff, awaiting-student and resolved each say what the clock measures", () => {
    const byId = Object.fromEntries(staffTickets.map((t) => [t.id, t]));
    expect(staffRowAge(byId["t-2"] as any, NOW)).toBe("Waiting 2 days");
    expect(staffRowAge(byId["t-1"] as any, NOW)).toMatch(/^Asked /);
    const resolved = staffRowAge(byId["t-3"] as any, NOW);
    expect(resolved).toBe("Resolved 6 days ago"); // opened Oct 14, resolved Oct 20; NOT "1 day"
    expect(resolved).not.toMatch(/^1 day/);
  });

  it("the unassigned queue is the same population the unassigned tile counts (awaiting staff only)", () => {
    expect(staffQueueFilters("unassigned")).toEqual({ view: "active", awaiting: "staff", assignedTo: "unassigned" });
  });
});

describe("staff workspace: no raw system values", () => {
  it("maps enum tokens to readable labels", () => {
    expect(workspaceProgressStatusLabel("IN_PROGRESS")).toBe("In progress");
    expect(workspaceProgressStatusLabel(undefined)).toBe("Not yet reported");
    expect(workspaceToken("waiting_on_student")).toBe("Waiting on student");
    expect(staffStatusLabel("waiting_on_student")).toBe("Waiting on student");
    expect(docTypeLabel("hs_transcript")).toBe("High-school transcript");
    expect(docTypeLabel("id_gov")).toBe("Government-issued ID");
    expect(docTypeLabel("some_new_type")).toBe("Some new type");
    expect(docStatusLabel("resubmit_requested")).toBe("Resubmission requested");
    expect(docStatusLabel("pending")).toBe("Pending review");
  });
  it("formats ISO timestamps for people, in the viewer's time zone", () => {
    expect(formatWorkspaceDateTime("2026-10-25T09:00:00.000Z", "UTC")).toBe("Oct 25, 2026 · 9:00");
    expect(formatWorkspaceDateTime("2026-10-25T09:00:00.000Z", "America/Toronto")).toBe("Oct 25, 2026 · 5:00");
    expect(formatWorkspaceDateTime("2026-10-25T00:05:00.000Z", "UTC")).toBe("Oct 25, 2026 · 0:05");
    expect(formatWorkspaceDateTime(undefined)).toBeUndefined();
    expect(formatWorkspaceDateTime("not a date")).toBeUndefined();
  });
  it("the workspace page source no longer prints raw ISO or enum values", () => {
    const src = readFileSync("client/src/pages/admin-student-workspace.tsx", "utf8");
    expect(src).not.toContain("toISOString()");
    expect(src).not.toContain("{document.doc_type}");
    expect(src).not.toContain("{ticket.status}");
    expect(src).not.toContain("Fingerprint unavailable");
    expect(src).not.toContain("Uploaded {displayDate(document.uploaded_at)}");
  });
});

describe("shell label", () => {
  it("staff and coach get 'Staff Portal', not 'Student Portal'", () => {
    const sidebar = readFileSync("client/src/components/app-sidebar.tsx", "utf8");
    expect(sidebar).toContain('isStudent ? "Student Portal" : "Staff Portal"');
    expect(sidebar).not.toContain('"Admin Portal"');
  });
});

describe("dialogs: the footer is a sibling of the scroll region, not an overlay", () => {
  it("the shared dialog layout has exactly one scroll region and a non-sticky footer", () => {
    const ui = readFileSync("client/src/components/profile/profile-ui.tsx", "utf8");
    expect(ui).toContain('data-testid="dialog-body"');
    expect(ui).toMatch(/overflow-y-auto overscroll-contain px-6 py-3/);
    expect(ui).not.toContain("sticky bottom-0");
    for (const f of ["identity-section.tsx", "contacts-section.tsx"]) {
      const src = readFileSync(`client/src/components/profile/${f}`, "utf8");
      const body = src.indexOf("<DialogBody>");
      const end = src.indexOf("</DialogBody>");
      const footer = src.indexOf("<FormActions", end);
      expect(body, f).toBeGreaterThan(0);
      expect(end, f).toBeGreaterThan(body);
      expect(footer, f).toBeGreaterThan(end); // the notice/error live inside the body, above the footer
    }
  });
});
