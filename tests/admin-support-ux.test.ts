import { readFileSync } from "node:fs";
import React from "react";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { renderToStaticMarkup } from "react-dom/server";
import AdminSupportCenter from "../client/src/pages/admin-support-center";
import AdminAssistant from "../client/src/pages/admin-assistant";
import { supportSearchWithStudent, supportSearchWithTicket, supportStudentFromSearch, supportTicketFromSearch } from "../client/src/components/support/support-navigation";

function render(node: React.ReactElement, path = "/admin/support-center") {
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      React.createElement(Router, { ssrPath: path }, node),
    ),
  );
}

describe("admin student support navigation", () => {
  it("routes the control center to existing student and support workspaces", () => {
    const html = render(React.createElement(AdminSupportCenter));
    expect(html).toContain('href="/admin?tab=students"');
    expect(html).toContain('href="/support"');
    expect(html).toContain("Documents and evidence");
    expect(html).toContain("Read-only student preview");
    expect(html).toContain("Billing");
  });

  it("keeps Lumière AI truthful and non-interactive until safe grounding exists", () => {
    const html = render(React.createElement(AdminAssistant), "/admin/assistant?studentId=student-a");
    expect(html).toContain("The admin assistant is not available yet");
    expect(html).toContain("no student data has been loaded or sent");
    expect(html).not.toMatch(/<(form|input|textarea)\b/i);
  });

  it("preserves a selected student when adding or clearing a ticket deep link", () => {
    expect(supportTicketFromSearch("?studentId=student-a&ticket=ticket-1")).toBe("ticket-1");
    expect(supportStudentFromSearch("?studentId=student-a&ticket=ticket-1")).toBe("student-a");
    const withTicket = new URLSearchParams(supportSearchWithTicket("?studentId=student-a", "ticket-2"));
    expect(withTicket.get("studentId")).toBe("student-a");
    expect(withTicket.get("ticket")).toBe("ticket-2");
    const withoutTicket = new URLSearchParams(supportSearchWithTicket("?studentId=student-a&ticket=ticket-2", null));
    expect(withoutTicket.get("studentId")).toBe("student-a");
    expect(withoutTicket.has("ticket")).toBe(false);
    expect(new URLSearchParams(supportSearchWithStudent("?studentId=student-a&ticket=ticket-2", null)).get("ticket")).toBe("ticket-2");
  });

  it("keeps both new staff routes behind the admin role guard", () => {
    const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
    for (const path of ["/admin/support-center", "/admin/assistant"]) {
      const routeStart = app.indexOf(`<Route path="${path}">`);
      const nextRoute = app.indexOf("<Route path=", routeStart + 1);
      const route = app.slice(routeStart, nextRoute < 0 ? undefined : nextRoute);
      expect(route).toContain('<ProtectedRoute requireRole="admin">');
    }
  });
});
