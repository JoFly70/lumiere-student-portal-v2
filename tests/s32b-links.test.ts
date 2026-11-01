/**
 * S32-B link validation and role-aware routing (SA-02, SA-04, SA-06, SA-15, SA-19, SA-20, SA-21, SA-29, SA-34).
 *
 * 1. The shared route manifest equals the role gates actually declared in client/src/App.tsx.
 * 2. Every href the server builds for staff surfaces (Control Center queue, S29 Needs Attention, Owner AI citations,
 *    calendar items, global search) lands on an existing client route.
 * 3. After the role-aware rewrite, a staff link never lands on the support desk unless it was a support link, and a
 *    coach is only ever sent to the support desk.
 * 4. Return-to-destination after sign-in only accepts same-origin paths the role may open.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CLIENT_ROUTES, canRoleOpen, matchClientRoute, returnPathForRole, roleHomePath, roleSafeHref, safeReturnPath,
  studentFilePath, studentWorkspacePath, supportStudentPath, supportTicketPath, type PortalRole,
} from "../shared/staff-links";
import { buildControlCenter, ELECTIVE_SUBJECT_PREFIX, type ControlCenterFacts } from "../server/services/program-journey/control-center";
import { buildAttention, EMPTY_EXTRA } from "../server/services/s29/rules";
import { DEFAULT_CONCIERGE_SETTINGS } from "../shared/s29-contract";
import { composeOwnerContext, type OwnerContextInput } from "../server/services/owner-assistant/context";
import { profileIdentityHref, documentsHref } from "../client/src/lib/admin-high-school-logic";
import { STAFF_PROFILE_PATHS } from "../client/src/components/admin/student-profile-review-logic";
import { queueActionHref, fileTabFromSearch } from "../client/src/lib/owner-presentation";

const NOW = new Date("2026-11-11T12:00:00Z");

// ── 1. manifest == App.tsx ────────────────────────────────────────────────────

function appRoutes(): Array<{ path: string; access: string }> {
  const src = readFileSync(path.resolve(__dirname, "../client/src/App.tsx"), "utf8");
  const router = src.slice(src.indexOf("function Router()"), src.indexOf("function AuthenticatedLayout()"));
  const out: Array<{ path: string; access: string }> = [];
  // Self-closing routes first, so a "<Route ... />" is never read as the opening tag of the next route.
  const re = /<Route path="([^"]+)"[^>]*?\/>|<Route path="([^"]+)"[^>]*>([\s\S]*?)<\/Route>/g;
  for (let m = re.exec(router); m; m = re.exec(router)) {
    const p = m[1] ?? m[2]!;
    const body = m[3] ?? "";
    const role = /requireRole=\{?\[?([^}>]+?)\]?\}?>/.exec(body)?.[1];
    const protectedRoute = body.includes("<ProtectedRoute");
    const roles = role ? role.replace(/["'\s]/g, "").split(",").sort().join(",") : null;
    out.push({ path: p, access: roles ?? (protectedRoute ? "authenticated" : "public") });
  }
  return out;
}

describe("S32-B route manifest mirrors App.tsx", () => {
  it("declares exactly the same paths and role gates", () => {
    const fromApp = appRoutes();
    const fromManifest = CLIENT_ROUTES.map((r) => ({ path: r.path, access: typeof r.access === "string" ? r.access : [...r.access].sort().join(",") }));
    expect(fromApp.length).toBeGreaterThan(30);
    expect(fromManifest).toEqual(fromApp);
  });
  it("opens the Student File and directory to staff, keeps the Advanced Workspace admin-only, never to coaches", () => {
    expect(canRoleOpen("staff", "/admin/students/s1?tab=documents")).toBe(true);
    expect(canRoleOpen("staff", "/admin/students")).toBe(true);
    expect(canRoleOpen("staff", "/admin/students/s1/workspace#profile")).toBe(false);
    expect(canRoleOpen("staff", "/admin/students/s1/view-as-student")).toBe(false);
    expect(canRoleOpen("staff", "/admin/assistant")).toBe(false);
    expect(canRoleOpen("coach", "/admin/students/s1")).toBe(false);
    expect(canRoleOpen("admin", "/admin/students/s1/workspace")).toBe(true);
    expect(canRoleOpen("staff", "/admin/support?ticket=1")).toBe(false); // the route that never existed (SA-21)
  });
  it("lands each role on its home after sign-in (SA-20)", () => {
    expect(roleHomePath("admin")).toBe("/admin/support-center");
    expect(roleHomePath("staff")).toBe("/staff/control-center");
    expect(roleHomePath("coach")).toBe("/support");
    expect(roleHomePath("student")).toBe("/");
    for (const r of ["admin", "staff", "coach"] as const) expect(canRoleOpen(r, roleHomePath(r))).toBe(true);
  });
});

// ── 2 & 3. every server-built href lands, role-safely ─────────────────────────

const facts = (): ControlCenterFacts => ({
  students: [
    { id: "hs1", code: "C1", name: "Diploma One", preferredName: null, userId: "u1" },
    { id: "dg1", code: "C2", name: "Degree One", preferredName: null, userId: "u2" },
  ],
  enrollments: [{ id: "e1", studentId: "hs1", status: "active", requiredHalfUnits: 42, startedOn: "2026-06-01", createdAt: "2026-06-01T00:00:00Z", content: null }],
  progress: [], awards: [], results: [],
  agreements: [{ studentId: "hs1", signedOn: "2026-10-20", activatedOn: null, supportMonths: 9, accessMonths: 36, languageTestDays: 30, priorSchoolingDays: 90, languageTestStatus: "open", languageTestDoneOn: null, priorSchoolingStatus: "open", priorSchoolingDoneOn: null }],
  pendingDocuments: [{ studentId: "hs1", count: 2 }, { studentId: "dg1", count: 1 }],
  evidenceAwaiting: [{ studentId: "hs1", count: 1 }],
  billing: [], receiptsThisMonth: [],
  tickets: [
    { id: "t-open", studentId: "hs1", subject: "Question about my plan", status: "open", createdAt: "2026-11-10T10:00:00Z" },
    { id: "t-el", studentId: "dg1", subject: `${ELECTIVE_SUBJECT_PREFIX} Swap course`, status: "open", createdAt: "2026-11-10T10:00:00Z" },
  ],
  sessionRequests: [{ id: "sr1", studentId: "hs1", slotAt: "2026-11-20T15:00:00Z" }],
  degrees: [{ studentId: "dg1" }],
  truncated: false,
});

function allServerHrefs(): Array<{ source: string; kind: string; href: string }> {
  const cc = buildControlCenter(facts(), NOW);
  const att = buildAttention(facts(), {
    ...EMPTY_EXTRA,
    checkpoints: [{ studentId: "hs1", key: "orientation", plannedOn: "2026-11-01" }],
    upcomingSessions: [{ id: "os1", studentId: "hs1", slotAt: "2026-11-12T10:00:00Z" }],
    pendingVerification: [{ studentId: "hs1", count: 2, oldest: "2026-11-01T00:00:00Z" }],
    pendingImports: [{ id: "b1", sourceKind: "provider_progress", rows: 3, students: 1, validatedAt: "2026-11-09T00:00:00Z" }],
    readyToLink: [{ studentId: "dg1", accountCreatedAt: "2026-11-10T00:00:00Z" }],
    failedNotifications: [{ id: "n1", studentId: "hs1", template: "support.reply", at: "2026-11-10T00:00:00Z" }],
  }, DEFAULT_CONCIERGE_SETTINGS, NOW);
  const ctx: OwnerContextInput = {
    student: { id: "hs1", student_code: "C1", status: "active", user_id: "u1" },
    highSchool: null, reviewQueue: [],
    documents: [{ id: "d1", doc_type: "hs_transcript", status: "pending", uploaded_at: "2026-10-29T00:00:00Z", rejection_reason: null }],
    tickets: [{ id: "t1", subject: "A question", status: "open", category: "academic", priority: "normal", updated_at: "2026-10-29T00:00:00Z" }],
  };
  return [
    ...cc.queue.map((q) => ({ source: "control-center", kind: q.kind, href: q.href })),
    ...att.items.map((i) => ({ source: "s29", kind: i.kind, href: i.href })),
    ...composeOwnerContext(ctx).map((r) => ({ source: "owner-ai", kind: r.kind, href: r.path })),
    { source: "hs-logic", kind: "guardian", href: profileIdentityHref("hs1") },
    { source: "hs-logic", kind: "documents", href: documentsHref("hs1") },
    { source: "profile-review", kind: "documents", href: STAFF_PROFILE_PATHS.documents("hs1") },
    { source: "search", kind: "student", href: "/admin/students/hs1" }, // server/services/global-search staffScope path
  ];
}

describe("S32-B every server-built staff href lands on a real page", () => {
  const hrefs = allServerHrefs();
  it("covers every link family", () => {
    const sources = new Set(hrefs.map((h) => h.source));
    for (const s of ["control-center", "s29", "owner-ai", "hs-logic", "profile-review", "search"]) expect(sources.has(s)).toBe(true);
    expect(hrefs.length).toBeGreaterThan(15);
  });
  it.each(hrefs.map((h) => [h.source, h.kind, h.href] as const))("%s %s -> %s exists and admin can open it", (_s, _k, href) => {
    expect(matchClientRoute(href), href).not.toBeNull();
    expect(canRoleOpen("admin", href), href).toBe(true);
  });
  it("support items open the ticket itself, never the Control Center (SA-04)", () => {
    const reply = hrefs.find((h) => h.kind === "support_reply" && h.source === "control-center")!;
    expect(reply.href).toBe(supportTicketPath("t-open"));
    expect(hrefs.filter((h) => h.href.startsWith("/admin/support")).map((h) => h.href)).toEqual([]);
  });
  it("degree students' academic links open the Degree plan tab (SA-29)", () => {
    for (const h of hrefs.filter((x) => x.href.includes("/admin/students/dg1?"))) {
      expect(fileTabFromSearch(h.href.slice(h.href.indexOf("?")), "degree"), h.href).not.toBe("roadmap");
    }
    expect(hrefs.find((h) => h.kind === "notification_failed")!.href).toBe("/admin/notifications?state=failed");
  });
  it("guardian decisions open the Workspace Guardian & identity tab; document links the Documents tab (SA-06, SA-21)", () => {
    expect(profileIdentityHref("hs1")).toBe(studentWorkspacePath("hs1", "profile"));
    expect(documentsHref("hs1")).toBe(studentFilePath("hs1", "documents"));
    expect(hrefs.find((h) => h.source === "owner-ai" && h.kind === "guardians")?.href ?? studentWorkspacePath("hs1", "profile")).toBe(studentWorkspacePath("hs1", "profile"));
    expect(hrefs.filter((h) => h.source === "owner-ai" && h.kind === "ticket").map((h) => h.href)).toEqual(expect.arrayContaining([supportTicketPath("t1")]));
  });
  it.each(hrefs.map((h) => [h.kind, h.href] as const))("staff: %s %s is never bounced to the support desk", (_k, href) => {
    const safe = queueActionHref(href, "staff");
    expect(canRoleOpen("staff", safe), safe).toBe(true);
    if (!href.startsWith("/support") && !href.startsWith("/admin/elective-requests")) expect(safe.startsWith("/support"), `${href} -> ${safe}`).toBe(false);
  });
  it("coach: every link becomes the support desk (a ticket link keeps its ticket)", () => {
    for (const h of hrefs) {
      const safe = roleSafeHref(h.href, "coach");
      expect(safe.split("?")[0]).toBe("/support");
    }
    expect(roleSafeHref(supportTicketPath("t9"), "coach")).toBe("/support?ticket=t9");
  });
  it("rewrites the admin-only targets staff may meet", () => {
    expect(roleSafeHref("/admin/support-center#cc-attention", "staff")).toBe("/staff/control-center#cc-attention");
    expect(roleSafeHref(studentWorkspacePath("s 1", "documents"), "staff")).toBe(studentFilePath("s 1", "documents"));
    expect(roleSafeHref("/admin/elective-requests?ticket=t2", "staff")).toBe(supportTicketPath("t2"));
    expect(roleSafeHref("/admin/assistant", "staff")).toBe("/staff/control-center");
    expect(roleSafeHref("https://evil.example/x", "staff")).toBe("/staff/control-center");
    expect(roleSafeHref(supportStudentPath("s1"), "staff")).toBe("/support?studentId=s1");
  });
});

// ── 4. return to destination ──────────────────────────────────────────────────

describe("S32-B return to the page opened before sign-in (SA-19)", () => {
  it("accepts same-origin portal paths only", () => {
    expect(safeReturnPath("/admin/students/s1/workspace#profile")).toBe("/admin/students/s1/workspace#profile");
    expect(safeReturnPath("/support?ticket=t1")).toBe("/support?ticket=t1");
    for (const bad of ["https://evil.example", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "/login", "/reset-password?x=1", "", "/nowhere", `/${"a".repeat(600)}`, "/admin\u0000"]) {
      expect(safeReturnPath(bad), bad).toBeNull();
    }
  });
  it("restores only what the signed-in role may open", () => {
    const cases: Array<[string, PortalRole, string | null]> = [
      ["/admin/students/s1/workspace", "admin", "/admin/students/s1/workspace"],
      ["/admin/students/s1/workspace", "staff", null],
      ["/admin/students/s1?tab=documents", "staff", "/admin/students/s1?tab=documents"],
      ["/admin/students/s1", "coach", null],
      ["/documents", "student", "/documents"],
      ["/admin/calendar", "student", null],
      ["/support?ticket=t1", "coach", "/support?ticket=t1"],
    ];
    for (const [p, role, want] of cases) expect(returnPathForRole(p, role), `${role} ${p}`).toBe(want);
  });
});
