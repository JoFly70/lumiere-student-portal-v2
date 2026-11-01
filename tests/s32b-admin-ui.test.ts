/**
 * S32-B — Administration UI: audit viewer (SA-24), EN/FR parity of the admin module (SA-16),
 * add-student labels (SA-32 / SA-09), invitation delivery messages and per-row resend (SA-33), dead-code removal (SA-27).
 */
import fs from "node:fs";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { I18nProvider, translate } from "../client/src/i18n";
import { en } from "../client/src/i18n/en";
import { fr } from "../client/src/i18n/fr";
import { s32StaffAdminEn, s32StaffAdminFr } from "../client/src/i18n/modules/s32-staff-admin";
import { AuditLogsView, EMPTY_AUDIT_FILTERS, ADMIN_ERROR_KEY, type AuditLogEntry } from "../client/src/pages/admin";
import { deliveryMessage } from "../client/src/components/admin/invitations-api";

void React;
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const STUDENT = "11111111-1111-4111-8111-111111111111";
const logs: AuditLogEntry[] = [
  { id: "l1", event_type: "admin.bulk_operation", severity: "info", action_description: "verified document 99", created_at: "2026-03-05T10:00:00Z", actor_user_id: "abcdef12-0000-4000-8000-000000000000", actor_name: "Sue Staff", target_label: "Ada Lovelace · S-1", target_student_id: STUDENT },
  { id: "l2", event_type: "admin.role_changed", severity: "warning", action_description: "Changed user role from staff to coach", created_at: "2026-03-06T10:00:00Z", actor_user_id: "abcdef12-0000-4000-8000-000000000000", actor_name: "Olivia Owner", target_label: "Sam Second", target_student_id: null },
  { id: "l3", event_type: "system.error", severity: "error", action_description: "job failed", created_at: "2026-03-07T10:00:00Z", actor_user_id: null },
];
const noop = () => {};
const render = (lang: "en" | "fr", over: Partial<Parameters<typeof AuditLogsView>[0]> = {}) =>
  renderToStaticMarkup(createElement(Router, { ssrPath: "/admin" }, createElement(I18nProvider, { initialLanguage: lang },
    createElement(AuditLogsView, {
      logs, total: 60, offset: 25, pageSize: 25, draft: EMPTY_AUDIT_FILTERS, onDraft: noop, onApply: noop, onReset: noop,
      onPrev: noop, onNext: noop, isError: false, onRetry: noop, targetInvalid: false, ...over,
    }))));

describe("SA-24 audit viewer", () => {
  it("shows actor NAMES (not UUID fragments), the target, a student-file link, filters and paging", () => {
    const html = render("en");
    expect(html).toContain("Sue Staff");
    expect(html).toContain("Olivia Owner");
    expect(html).not.toContain("abcdef12");
    expect(html).toContain("Ada Lovelace · S-1");
    expect(html).toContain(`href="/admin/students/${STUDENT}"`);
    expect(html).toContain("Open student file");
    expect(html).toContain("System"); // no actor -> System, never an empty/odd fragment
    for (const id of ["audit-filter-event", "audit-filter-from", "audit-filter-to", "audit-filter-target", "audit-apply", "audit-reset", "audit-pager-prev", "audit-pager-next"]) {
      expect(html, id).toContain(`data-testid="${id}"`);
    }
    expect(html).toContain("Showing 26–28 of 60");
  });

  it("is fully French in FR (labels, severity, paging, link)", () => {
    const html = render("fr");
    expect(html).toContain("Journal d’audit");
    expect(html).toContain("Ouvrir le dossier de l’étudiant");
    expect(html).toContain("Auteur");
    expect(html).toContain("Cible");
    expect(html).toContain("Avertissement");
    expect(html).toContain("Appliquer les filtres");
    expect(html).toContain("Précédent");
    expect(html).not.toContain("Apply filters");
    expect(html).not.toContain("Open student file");
  });

  it("empty and error states are explained, first page disables Previous", () => {
    expect(render("en", { logs: [], total: 0, offset: 0 })).toContain("No audit entries match");
    expect(render("en", { isError: true })).toContain("The audit log could not be loaded.");
    expect(render("en", { offset: 0, onPrev: null })).toMatch(/data-testid="audit-pager-prev"[^>]*disabled|disabled=""[^>]*data-testid="audit-pager-prev"/);
    expect(render("en", { targetInvalid: true })).toContain("Enter a full ID");
  });
});

describe("SA-16 admin module EN/FR", () => {
  const keys = Object.keys(s32StaffAdminEn);
  it("every EN key has a different, non-empty FR value, registered in the dictionaries", () => {
    expect(Object.keys(s32StaffAdminFr).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      expect(k in en && k in fr, k).toBe(true);
      const e = (s32StaffAdminEn as Record<string, string>)[k];
      const f = (s32StaffAdminFr as Record<string, string>)[k];
      expect(f.trim(), k).not.toBe("");
      if (e !== "Actions") expect(f, k).not.toBe(e); // "Actions" is a shared cognate (allow-listed in the core parity test)
      // same placeholders in both languages
      expect([...e.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), k).toEqual([...f.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });
  it("French uses vouvoiement (no tu-forms)", () => {
    expect(Object.values(s32StaffAdminFr).join(" ")).not.toMatch(/\b(tu|ton|ta|tes|toi|ton|tes)\b/i);
  });
  it("every server refusal code has a translated explanation", () => {
    for (const code of ["LAST_ADMIN", "SELF_DEMOTION", "SELF_ARCHIVE", "REASON_REQUIRED"]) {
      const key = ADMIN_ERROR_KEY[code];
      expect(key, code).toBeTruthy();
      expect(translate("fr", key)).not.toBe(translate("en", key));
    }
  });
  it("admin.tsx and the invitations panel carry no hard-coded English labels from the audit", () => {
    const admin = read("client/src/pages/admin.tsx");
    for (const s of ["Loading users...", "Search users by name or email", "Change role", "Recent activity log", "Audit logs\n", "Lumière Administration\""]) {
      expect(admin, s).not.toContain(s);
    }
    const panel = read("client/src/components/admin/invitations-panel.tsx");
    for (const s of ["Invite a student", "Issue invitation", "Resend</", "Revoke</", "No invitations yet"]) expect(panel, s).not.toContain(s);
  });
});

describe("SA-32 / SA-09 add student", () => {
  it("the done-state button is labelled for what it opens: the Student File", () => {
    expect(translate("en", "sa.add.openFile")).toBe("Open student file");
    expect(translate("fr", "sa.add.openFile")).toBe("Ouvrir le dossier de l’étudiant");
    const src = read("client/src/components/admin/add-student-dialog.tsx");
    expect(src).toMatch(/data-testid="button-open-new-student">\{t\("sa\.add\.openFile"\)\}/);
    expect(src).not.toContain("Open student workspace");
  });
  it("the duplicate-email message and link are wired (code STUDENT_EMAIL_EXISTS -> /admin/students/:id)", () => {
    expect(translate("en", "sa.add.duplicate")).toBe("A student with this email already exists — open it");
    const src = read("client/src/components/admin/add-student-dialog.tsx");
    expect(src).toContain("STUDENT_EMAIL_EXISTS");
    expect(src).toContain("adminStudentWorkspacePath(error.existingStudentId)");
    expect(src).toContain('data-testid="link-existing-student"');
  });
  it("DOB, phone and address stay required: the database columns are NOT NULL", () => {
    const sql = read("migrations/005_student_profiles.sql");
    expect(sql).toMatch(/dob date not null/);
    expect(sql).toMatch(/phone_primary text not null/);
    expect(sql).toMatch(/address_line1 text not null/);
    expect(sql).toMatch(/address_country text not null/);
  });
});

describe("SA-33 invitations", () => {
  it("delivery messages are translated and still never claim an email was sent unless it was", () => {
    expect(deliveryMessage("sent", "x@synthetic.invalid", "fr")).toContain("envoyée par courriel à x@synthetic.invalid");
    for (const d of ["not_configured", "failed", "skipped"] as const) {
      expect(deliveryMessage(d, "x@synthetic.invalid", "fr")).not.toMatch(/envoyée par courriel à/);
      expect(deliveryMessage(d, "x@synthetic.invalid", "en")).toMatch(/Copy the link/);
    }
  });
  it("resend uses its own per-row choices, never the issue form's language / send-email state", () => {
    const src = read("client/src/components/admin/invitations-panel.tsx");
    expect(src).toContain("resendLanguage");
    expect(src).toContain("resendSendEmail");
    expect(src).toMatch(/resend\.mutate\(\{ id: resendRow\.id, language: resendLanguage, sendEmail: resendSendEmail \}\)/);
    expect(src).not.toMatch(/resendInvitation\(id, \{ language, sendEmail \}\)/);
    expect(src).toContain('data-testid="resend-dialog"');
  });
});

describe("SA-27 dead code and stale copy", () => {
  it("control-center-live.tsx is gone and nothing imports it", () => {
    expect(fs.existsSync(path.join(ROOT, "client/src/components/admin/control-center-live.tsx"))).toBe(false);
    const all = ["client/src/pages/admin.tsx", "client/src/App.tsx"].map(read).join("\n");
    expect(all).not.toContain("control-center-live");
  });
  it("the 'Activity feed not connected' placeholder is gone", () => {
    expect(read("client/src/pages/admin.tsx")).not.toContain("Activity feed not connected");
    expect(JSON.stringify(en)).not.toContain("Activity feed not connected");
  });
});
