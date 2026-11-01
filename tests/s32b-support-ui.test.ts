/**
 * S32-B support desk: translation, honest recovery text, coach tile, status history, refresh cadence.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ApiError } from "../client/src/lib/api";
import { I18nProvider, translate, type Language } from "../client/src/i18n";
import { overdueByLabel, staffRowAge } from "../client/src/components/support/support-presentation";
import { StatusHistory, TicketRow, recoveryText, tilesFor } from "../client/src/components/support/staff-support-desk";
import { STAFF_QUEUE_REFRESH_MS, STAFF_STATS_REFRESH_MS } from "../client/src/hooks/use-tickets";
import { SUPPORT_NOW } from "./helpers/support-ui-fixtures";
import { s32StaffSupportEn, s32StaffSupportFr } from "../client/src/i18n/modules/s32-staff-support";

(globalThis as any).React = React;
const NOW = SUPPORT_NOW;
const wrap = (lang: Language, node: React.ReactElement) => renderToStaticMarkup(React.createElement(I18nProvider, { initialLanguage: lang }, node));

const ticket: any = {
  id: "t-1", ticket_number: "LUM-00001", subject: "Plan question", reporter_name: "Ada Student", category: "academic", topic: "roadmap_question",
  status: "open", priority: "medium", awaiting: "staff", awaiting_since: "2026-10-24T12:00:00.000Z", created_at: "2026-10-24T12:00:00.000Z",
  is_overdue: true, assignee: null,
};

describe("staff support desk is bilingual", () => {
  it("renders a ticket row in French without English chrome", () => {
    const html = wrap("fr", React.createElement(TicketRow, { ticket, selected: false, onSelect: () => {} }));
    expect(html).toContain("En retard");
    expect(html).toContain("Non attribuée");
    expect(html).toContain("Nouvelle");
    expect(html).not.toContain("Unassigned");
    expect(html).not.toContain("Overdue");
  });
  it("keeps the English wording and test ids in English", () => {
    const html = wrap("en", React.createElement(TicketRow, { ticket, selected: false, onSelect: () => {} }));
    expect(html).toContain("Unassigned");
    expect(html).toContain('data-testid="overdue-flag"');
  });
  it("age and overdue text follow the language", () => {
    expect(staffRowAge(ticket, NOW, "fr")).toMatch(/^En attente depuis /);
    expect(staffRowAge(ticket, NOW, "en")).toMatch(/^Waiting /);
    expect(overdueByLabel(ticket, NOW, "fr")).toMatch(/de plus que l'objectif de 2 jour/);
  });
  it("every key the desk module defines has a different French value", () => {
    for (const k of Object.keys(s32StaffSupportEn) as (keyof typeof s32StaffSupportEn)[]) {
      expect(s32StaffSupportFr[k], k).not.toBe(s32StaffSupportEn[k]);
    }
  });
  it("the desk and the elective page contain no hard-coded user-facing English left behind", () => {
    const desk = readFileSync("client/src/components/support/staff-support-desk.tsx", "utf8");
    expect(desk).toContain("useT");
    for (const literal of [">Support desk<", "Search by subject", "Select a request<", "Back to queue<", ">Internal note<", ">Reply<"]) expect(desk).not.toContain(literal);
    const page = readFileSync("client/src/pages/admin-elective-requests.tsx", "utf8");
    expect(page).toContain("useT");
    expect(page).not.toMatch(/>Control Center</);
  });
});

describe("recovery messages never show raw server text", () => {
  const t = (lang: Language) => (key: any, vars?: any) => translate(lang, key, vars);
  it("maps each failure class to a translated sentence", () => {
    const raw = "duplicate key value violates unique constraint";
    const cases: [unknown, string][] = [
      [new ApiError(raw, 500), "s32sup.err.server"],
      [new ApiError(raw, 403), "s32sup.err.denied"],
      [new ApiError(raw, 404), "s32sup.err.notFound"],
      [new ApiError(raw, 409), "s32sup.err.conflict"],
      [new ApiError(raw, 400), "s32sup.err.invalid"],
      [new TypeError("Failed to fetch"), "s32sup.err.network"],
      [new Error(raw), "s32sup.err.generic"],
    ];
    for (const lang of ["en", "fr"] as const) {
      for (const [err, key] of cases) {
        const text = recoveryText(t(lang), err);
        expect(text).toBe(translate(lang, key));
        expect(text).not.toContain("duplicate key");
        expect(text).not.toContain("Failed to fetch");
      }
    }
  });
});

describe("queue tiles and refresh", () => {
  it("hides the always-zero Unassigned tile for coaches, keeps it for admin and staff", () => {
    expect(tilesFor(true).map((x) => x.queue)).toContain("unassigned");
    expect(tilesFor(false).map((x) => x.queue)).not.toContain("unassigned");
  });
  it("refreshes lightly while the tab is visible (queue 2 min, counters 5 min, open ticket on focus)", () => {
    expect(STAFF_QUEUE_REFRESH_MS).toBe(120_000);
    expect(STAFF_STATS_REFRESH_MS).toBe(300_000);
    const desk = readFileSync("client/src/components/support/staff-support-desk.tsx", "utf8");
    expect(desk).toContain("useTickets(filters, { refetchInterval: STAFF_QUEUE_REFRESH_MS })");
    expect(desk).toContain("useTicketStats(true, { refetchInterval: STAFF_STATS_REFRESH_MS })");
    expect(desk).toContain("useTicket(ticketId, { refreshOnFocus: true })");
    const hook = readFileSync("client/src/hooks/use-tickets.ts", "utf8");
    expect(hook).toContain("refetchIntervalInBackground: false");
  });
});

describe("status history", () => {
  const history: any[] = [
    { id: "h2", old_status: "open", new_status: "in_progress", created_at: "2026-10-25T10:00:00.000Z", changed_by: "u-1" },
    { id: "h1", old_status: null, new_status: "open", created_at: "2026-10-24T10:00:00.000Z" },
  ];
  it("renders oldest first, with the changer's name when known, in French too", () => {
    const staff: any[] = [{ id: "u-1", name: "Sam Staff", role: "staff" }];
    const en = wrap("en", React.createElement(StatusHistory, { history, staff }));
    expect(en).toContain('data-testid="ticket-status-history"');
    expect(en.indexOf("Ticket created as New")).toBeLessThan(en.indexOf("New → In progress"));
    expect(en).toContain("by Sam Staff");
    const fr = wrap("fr", React.createElement(StatusHistory, { history, staff }));
    expect(fr).toContain("Historique des statuts");
    expect(fr).toContain("Nouvelle → En cours");
    expect(fr).toContain("par Sam Staff");
  });
  it("renders nothing when there is no history", () => {
    expect(wrap("en", React.createElement(StatusHistory, { history: [], staff: [] }))).toBe("");
  });
});
