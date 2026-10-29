import express from "express";
import request from "supertest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { describe, expect, it, vi } from "vitest";

vi.mock("../server/middleware/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) return res.status(401).json({ error: "Authentication required" });
    req.user = { id: `user-${role}`, email: "x@example.test", role };
    next();
  },
}));
vi.mock("../server/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { createAdminViewAsStudentRouter, type AdminViewAsStudentRouterDeps } from "../server/routes/admin-view-as-student";
import { createStudentPreferencesRouter, type LanguagePreferenceStore } from "../server/routes/student-preferences";
import { HsError } from "../server/services/high-school-service";
import { summarizeForPreview } from "../shared/view-as-student-contract";
import { initialSync } from "../client/src/lib/language-preference";
import { ViewAsStudentScreen, StaffProgressSummary, studentVisibleTicketThread } from "../client/src/pages/admin-view-as-student";
import { HS_AWAITING_REVIEW, HS_NEW_STUDENT } from "./helpers/s11-hs-ui-fixtures";
import { META } from "./helpers/s18-academic-fixtures";

const STUDENT = { id: "stu-1", first_name: "Yanis", last_name: "Synthetic", preferred_name: null, status: "active", user_id: "user-student-1" };

function app(over: Partial<AdminViewAsStudentRouterDeps> = {}) {
  const audit = vi.fn(async () => undefined);
  const denied = vi.fn();
  const getStaffState = vi.fn(async () => ({ studentId: "stu-1", enrollments: [], hasUniversityProgram: false, current: { reviewQueue: [{}, {}] } as any, guardians: [], events: [{ id: "e1", type: "x", actorId: null, summary: "s", createdAt: "2026-10-27T10:00:00.000Z" }] }));
  const deps: AdminViewAsStudentRouterDeps = {
    getStudent: async (id) => (id === "stu-1" ? STUDENT : null),
    service: { getStudentAcademicSource: async () => ({ view: HS_AWAITING_REVIEW, meta: { ...META, milestones: [] } }), getStaffState },
    getLanguage: async () => "fr",
    audit,
    onDenied: denied,
    ...over,
  };
  const a = express();
  a.use(express.json());
  a.use("/api/admin", createAdminViewAsStudentRouter(deps));
  return { a, audit, denied, getStaffState };
}

describe("S25 view as student API", () => {
  it("returns the student's own projection, a stored-records summary and the saved language; audits the view", async () => {
    const { a, audit } = app();
    const res = await request(a).get("/api/admin/students/stu-1/view-as-student").set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.mode).toBe("read_only_preview");
    expect(res.body.student).toEqual({ id: "stu-1", displayName: "Yanis Synthetic", status: "active", hasPortalAccount: true, preferredLanguage: "fr" });
    expect(res.body.highSchool).toEqual(JSON.parse(JSON.stringify(HS_AWAITING_REVIEW)));
    expect(res.body.academicProjection.credits.total.requiredHalfUnits).toBe(HS_AWAITING_REVIEW.credits.requiredHalfUnits);
    expect(res.body.summary.pendingEvidence).toBe(2);
    expect(res.body.summary.lastRecordedActivityAt).toBe("2026-10-27T10:00:00.000Z");
    expect(res.body.summary.creditsEarnedHalfUnits).toBe(HS_AWAITING_REVIEW.credits.earnedHalfUnits);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "profile.viewed", actorUserId: "user-admin", targetResourceId: "stu-1", isEducationalRecord: true }));
    expect(JSON.stringify(res.body)).not.toMatch(/password|token|user-student-1/i);
  });

  it("refuses staff, coach and students (audited) and guests", async () => {
    for (const role of ["staff", "coach", "student"]) {
      const { a, denied, audit } = app();
      const res = await request(a).get("/api/admin/students/stu-1/view-as-student").set("x-test-role", role);
      expect(res.status).toBe(403);
      expect(denied).toHaveBeenCalledTimes(1);
      expect(audit).not.toHaveBeenCalled();
    }
    const { a } = app();
    expect((await request(a).get("/api/admin/students/stu-1/view-as-student")).status).toBe(401);
  });

  it("has no write surface", async () => {
    const { a } = app();
    for (const m of ["post", "put", "patch", "delete"] as const) {
      expect((await request(a)[m]("/api/admin/students/stu-1/view-as-student").set("x-test-role", "admin")).status).toBe(404);
    }
  });

  it("404 for an unknown student; null projections without a high school enrollment; 500 without internals", async () => {
    expect((await request(app().a).get("/api/admin/students/nope/view-as-student").set("x-test-role", "admin")).status).toBe(404);
    const none = app({ service: { getStudentAcademicSource: async () => { throw new HsError("HS_NO_ENROLLMENT", 404, "none"); }, getStaffState: vi.fn() as any } });
    const res = await request(none.a).get("/api/admin/students/stu-1/view-as-student").set("x-test-role", "admin");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ highSchool: null, academicProjection: null, summary: null });
    const broken = app({ service: { getStudentAcademicSource: async () => { throw new Error("SELECT secret FROM x"); }, getStaffState: vi.fn() as any } });
    const err = await request(broken.a).get("/api/admin/students/stu-1/view-as-student").set("x-test-role", "admin");
    expect(err.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(err.body)).not.toContain("secret");
  });

  it("summary counts only stored records; reported work is never earned credit", () => {
    const s = summarizeForPreview(HS_AWAITING_REVIEW, [], null);
    expect(s.creditsEarnedHalfUnits).toBe(HS_AWAITING_REVIEW.credits.earnedHalfUnits);
    expect(s.awaitingConfirmationHalfUnits).toBe(HS_AWAITING_REVIEW.credits.awaitingConfirmationHalfUnits);
    expect(s.creditsEarnedHalfUnits + s.creditsRemainingHalfUnits).toBe(s.creditsRequiredHalfUnits);
    expect(s.lastRecordedActivityAt).toBeNull();
    const fresh = summarizeForPreview(HS_NEW_STUDENT, [], null);
    expect(fresh.creditsEarnedHalfUnits).toBe(0);
    expect(fresh.officialResults).toBe(0);
  });
});

describe("S25 view as student screen", () => {
  const render = (node: React.ReactElement) =>
    renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(Router, { ssrPath: "/admin/students/stu-1/view-as-student" }, node)));
  const data = { mode: "read_only_preview" as const, student: { id: "stu-1", displayName: "Yanis Synthetic", status: "active", hasPortalAccount: true, preferredLanguage: "fr" as const }, highSchool: HS_AWAITING_REVIEW, academicProjection: null, summary: summarizeForPreview(HS_AWAITING_REVIEW, [], null), generatedAt: "2026-10-27T10:00:00.000Z" };

  it("shows the localized read-only preview, return link, saved language, summary, and all supported screens", () => {
    const html = render(React.createElement(ViewAsStudentScreen, { data, studentId: "stu-1", docs: [] }));
    expect(html).toContain("Aperçu en lecture seule");
    expect(html).toContain('href="/admin/students/stu-1"');
    expect(html).toContain("Langue choisie par l&#x27;étudiant: Français");
    expect(html).toContain('data-testid="preview-summary"');
    expect(html).toContain("Secondaire");
    expect(html).toContain("Profil");
    expect(html).toContain("Documents");
    expect(html).toContain("Assistance");
    expect(html).toContain("Facturation");
    expect(html).toContain("écran du parcours de cours");
    expect(html).toContain('aria-checked="true" class="min-h-10 px-3 text-xs font-semibold bg-foreground text-background" data-testid="preview-language-fr"');
  });

  it("never shows internal support notes or their attachments in the student preview", () => {
    const visible = studentVisibleTicketThread({
      ticket_comments: [
        { id: "public", is_internal: false },
        { id: "internal", is_internal: true },
      ],
      ticket_attachments: [
        { id: "public-file", comment_id: "public" },
        { id: "internal-file", comment_id: "internal" },
        { id: "unlinked-file", comment_id: null },
      ],
    } as any);
    expect(visible.comments.map((comment) => comment.id)).toEqual(["public"]);
    expect(visible.attachments.map((attachment) => attachment.id)).toEqual(["public-file", "unlinked-file"]);
  });

  it("explains when there is nothing to summarize", () => {
    expect(render(React.createElement(StaffProgressSummary, { data: { ...data, summary: null } }))).toContain("No high school enrollment");
  });
});

describe("S25 student language preference", () => {
  function memory(): LanguagePreferenceStore & { rows: Map<string, string> } {
    const rows = new Map<string, string>();
    return { rows, get: async (u) => (rows.get(u) as any) ?? null, set: async (u, l) => void rows.set(u, l) };
  }
  function prefApp(store: LanguagePreferenceStore, role = "student") {
    const a = express();
    a.use(express.json());
    a.use("/api/student/preferences", createStudentPreferencesRouter({
      store,
      auth: (req, _res, next) => { req.user = { id: "u1", email: "x@example.test", role } as any; next(); },
      csrf: (req, res, next) => (req.headers["x-csrf-token"] === "ok" ? next() : res.status(403).json({ error: "csrf" })),
    }));
    return a;
  }

  it("saves and reads the student's own choice only, with CSRF and validation", async () => {
    const store = memory();
    const a = prefApp(store);
    expect((await request(a).get("/api/student/preferences")).body).toEqual({ language: null });
    expect((await request(a).put("/api/student/preferences/language").send({ language: "fr" })).status).toBe(403);
    expect((await request(a).put("/api/student/preferences/language").set("x-csrf-token", "ok").send({ language: "de" })).status).toBe(400);
    expect((await request(a).put("/api/student/preferences/language").set("x-csrf-token", "ok").send({ language: "fr", userId: "other" })).status).toBe(400);
    expect((await request(a).put("/api/student/preferences/language").set("x-csrf-token", "ok").send({ language: "fr" })).body).toEqual({ language: "fr" });
    expect([...store.rows]).toEqual([["u1", "fr"]]);
    expect((await request(a).get("/api/student/preferences")).body).toEqual({ language: "fr" });
  });

  it("is students only and degrades safely when the table is missing", async () => {
    expect((await request(prefApp(memory(), "admin")).get("/api/student/preferences")).status).toBe(403);
    const missing: LanguagePreferenceStore = { get: async () => { throw new Error("relation does not exist"); }, set: async () => { throw new Error("relation does not exist"); } };
    const a = prefApp(missing);
    expect((await request(a).get("/api/student/preferences")).body).toEqual({ language: null });
    const put = await request(a).put("/api/student/preferences/language").set("x-csrf-token", "ok").send({ language: "en" });
    expect(put.status).toBe(503);
    expect(JSON.stringify(put.body)).not.toContain("relation");
  });

  it("first sync: a saved server choice wins; otherwise an explicit browser choice is uploaded", () => {
    expect(initialSync("fr", "en", true)).toEqual({ apply: "fr", upload: null });
    expect(initialSync("fr", "fr", false)).toEqual({ apply: null, upload: null });
    expect(initialSync(null, "fr", true)).toEqual({ apply: null, upload: "fr" });
    expect(initialSync(null, "en", false)).toEqual({ apply: null, upload: null });
  });
});
