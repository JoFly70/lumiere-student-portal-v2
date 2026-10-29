import React from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { StaffFileHeader } from "../client/src/components/staff/staff-ui";
import { BillingSummaryCard } from "../client/src/components/admin/billing/billing-summary-card";
import { computeStaffBilling } from "../shared/billing-ledger";

const read = (p: string) => readFileSync(p, "utf8");
const wrap = (el: React.ReactElement) => renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, el));

describe("student file header", () => {
  const name = "DEMO-S26-FR Synthétique (NOT A REAL STUDENT)";
  const html = wrap(React.createElement(StaffFileHeader, { title: name, portrait: React.createElement("span", null, "P"), actions: React.createElement(React.Fragment, null, React.createElement("a", { href: "/a" }, "One"), React.createElement("a", { href: "/b" }, "Two")) }));
  it("gives the name the whole identity row and wraps by words", () => {
    expect(html).toContain(name);
    expect(html).toContain("break-word");
    expect(html).toContain("[word-break:normal]");
    expect(html.indexOf("text-page-title")).toBeLessThan(html.indexOf('data-testid="file-actions"'));
  });
  it("puts actions in their own toolbar that is a 2-column grid on phones and wraps on desktop", () => {
    expect(html).toContain('role="toolbar"');
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("sm:flex-wrap");
  });
  it("is used by both student file layouts", () => {
    expect(read("client/src/pages/admin-student-workspace.tsx")).toContain("<StaffFileHeader");
    expect(read("client/src/components/admin/student-file-hs.tsx")).toContain("<StaffFileHeader");
  });
});

describe("billing summary card", () => {
  it("shows agreed, adjustments, paid, remaining and a status pill", () => {
    const view = computeStaffBilling({
      obligation: { agreedCents: 1_200_000, currency: "USD", note: null },
      discounts: [{ id: "d", amountCents: 100_000, reason: "x", approvedBy: "u", approvedAt: "2026-09-01T00:00:00Z" }],
      installments: [],
      receipts: [{ id: "r", amountCents: 400_000, receivedDate: "2026-09-02", methodLabel: "Wire", reference: null, note: null, confirmedBy: "u", confirmedAt: "2026-09-02T00:00:00Z", evidenceId: null }],
      evidence: [],
    }, "2026-10-01");
    const html = wrap(React.createElement(BillingSummaryCard, { studentId: "s1", billing: view }));
    expect(html).toContain("$12,000.00");
    expect(html).toContain("$1,000.00");
    expect(html).toContain("$4,000.00");
    expect(html).toContain("$7,000.00");
    expect(html).toContain("Partially paid");
    expect(html).toContain('href="/admin/students/s1/billing"');
  });
  it("has an honest empty state with a link when nothing is set", () => {
    const html = wrap(React.createElement(BillingSummaryCard, { studentId: "s1", billing: undefined }));
    expect(html).toContain("No agreed amount yet");
    expect(html).toContain("Set up billing");
  });
});

describe("admin navigation and routes", () => {
  const sidebar = read("client/src/components/app-sidebar.tsx");
  const block = sidebar.slice(sidebar.indexOf("const adminMenuItems"), sidebar.indexOf("];", sidebar.indexOf("const adminMenuItems")));
  it("orders the admin sidebar: Control Center, Students, Support desk, Elective requests, Lumière AI, Administration", () => {
    const order = ["Control Center", "Students", "Support desk", "Elective requests", "Lumière AI", "Administration"].map((t) => block.indexOf(`title: "${t}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(block).toContain('url: "/admin/support-center"');
    expect(block).toContain('url: "/admin/elective-requests"');
  });
  it("registers /admin/elective-requests for admins only and links it from the Control Center tile", () => {
    const app = read("client/src/App.tsx");
    const route = app.slice(app.indexOf('path="/admin/elective-requests"'), app.indexOf("</Route>", app.indexOf('path="/admin/elective-requests"')));
    expect(route).toContain('requireRole="admin"');
    expect(read("client/src/components/admin/control/control-center.tsx")).toContain('href="/admin/elective-requests"');
  });
});
