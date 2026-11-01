/**
 * S32-B: one source of truth for staff-facing deep links.
 *
 * - `CLIENT_ROUTES` mirrors the role gates declared in client/src/App.tsx (a test parses App.tsx and fails when the
 *   two disagree), so server-built hrefs (Control Center queue, Needs Attention, search, calendar, Owner AI
 *   citations, notifications) can be validated against what each role may actually open.
 * - The path builders below are the only way new code should build a student, ticket or workspace link.
 * - `roleSafeHref` turns any internal href into one the viewer's role can open, so a staff member is never bounced
 *   to the support desk by a link that was built for the owner.
 *
 * Pure module: no React, no I/O. Imported by the client (`@shared/staff-links`) and the server.
 */

export type PortalRole = "admin" | "staff" | "coach" | "student";

const enc = encodeURIComponent;

// ── path builders ─────────────────────────────────────────────────────────────

export type StudentFileTab = "overview" | "roadmap" | "plan" | "documents" | "billing" | "notes" | "sessions";

/** The primary Student File (admin + staff). `tab` must be one the File knows; extra params are kept. */
export function studentFilePath(studentId: string, tab?: StudentFileTab, extra?: Record<string, string>): string {
  const base = `/admin/students/${enc(studentId)}`;
  const q = new URLSearchParams({ ...(tab && tab !== "overview" ? { tab } : {}), ...(extra ?? {}) }).toString();
  return q ? `${base}?${q}` : base;
}

/** Sections of the Advanced Academic Workspace that accept a hash (see admin-student-workspace.tsx). */
export type WorkspaceSection = "overview" | "academics" | "documents" | "billing" | "support" | "profile" | "activity" | "ai";

/** The Advanced Academic Workspace (admin only). */
export function studentWorkspacePath(studentId: string, section?: WorkspaceSection): string {
  return `/admin/students/${enc(studentId)}/workspace${section ? `#${section}` : ""}`;
}

export const studentRoadmapPath = (studentId: string) => `/admin/students/${enc(studentId)}/roadmap`;
export const studentHighSchoolPath = (studentId: string, tab?: string) => `/admin/students/${enc(studentId)}/high-school${tab ? `?tab=${enc(tab)}` : ""}`;
export const studentBillingPath = (studentId: string) => `/admin/students/${enc(studentId)}/billing`;

/** One support conversation (the staff desk opens it; students open their own). */
export const supportTicketPath = (ticketId: string) => `/support?ticket=${enc(ticketId)}`;
/** Every support conversation of one student (admin + staff). */
export const supportStudentPath = (studentId: string) => `/support?studentId=${enc(studentId)}`;

/** Each role's home after sign-in. Staff start on their Control Center (Needs Attention first). */
export function roleHomePath(role: string | null | undefined): string {
  switch (role) {
    case "admin": return "/admin/support-center";
    case "staff": return "/staff/control-center";
    case "coach": return "/support";
    default: return "/";
  }
}

// ── route manifest (mirrors App.tsx) ──────────────────────────────────────────

export type RouteAccess = "public" | "authenticated" | readonly PortalRole[];

export interface ClientRoute {
  /** Wouter pattern exactly as written in App.tsx. */
  readonly path: string;
  readonly access: RouteAccess;
}

const A = ["admin"] as const;
const AS = ["admin", "staff"] as const;
const S = ["student"] as const;

export const CLIENT_ROUTES: readonly ClientRoute[] = [
  { path: "/login", access: "public" },
  { path: "/reset-password", access: "public" },
  { path: "/experience", access: "public" },
  { path: "/auth/verify", access: "public" },
  { path: "/verify-email", access: "public" },
  { path: "/resend-verification", access: "public" },
  { path: "/", access: "public" },
  { path: "/dashboard", access: "public" },
  { path: "/admin/support-center", access: A },
  { path: "/staff/control-center", access: AS },
  { path: "/admin/diagnostics", access: A },
  { path: "/admin/notifications", access: AS },
  { path: "/admin/calendar", access: AS },
  { path: "/admin/imports", access: AS },
  { path: "/admin/web-research", access: AS },
  { path: "/admin/assistant", access: A },
  { path: "/admin/elective-requests", access: A },
  { path: "/admin/students", access: AS },
  { path: "/admin", access: A },
  { path: "/admin/students/:studentId/roadmap", access: AS },
  { path: "/admin/students/:studentId/high-school", access: AS },
  { path: "/staff/billing", access: AS },
  { path: "/admin/students/:studentId/view-as-student", access: A },
  { path: "/admin/students/:studentId/billing", access: AS },
  { path: "/admin/students/:studentId/workspace", access: A },
  { path: "/admin/students/:studentId", access: AS },
  { path: "/flight-deck", access: S },
  { path: "/assistant", access: S },
  { path: "/high-school/flight-deck", access: S },
  { path: "/profile", access: S },
  { path: "/calendar", access: S },
  { path: "/roadmap", access: S },
  { path: "/high-school", access: S },
  { path: "/beyond", access: S },
  { path: "/library", access: S },
  { path: "/notifications", access: S },
  { path: "/documents", access: S },
  { path: "/billing", access: S },
  { path: "/support", access: "authenticated" },
  { path: "/coach-dashboard", access: "public" },
];

function splitHref(href: string): { path: string; query: string; hash: string } {
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt + 1) : "";
  const noHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const qAt = noHash.indexOf("?");
  return { path: qAt >= 0 ? noHash.slice(0, qAt) : noHash, query: qAt >= 0 ? noHash.slice(qAt + 1) : "", hash };
}

function matches(pattern: string, path: string): boolean {
  const p = pattern.split("/");
  const s = path.replace(/\/+$/, "").split("/");
  if (path === "/" || pattern === "/") return path === pattern;
  if (p.length !== s.length) return false;
  return p.every((seg, i) => (seg.startsWith(":") ? (s[i] ?? "").length > 0 : seg === s[i]));
}

/** The manifest route an internal href lands on (first match, in App.tsx order), or null (NotFound). */
export function matchClientRoute(href: string): ClientRoute | null {
  const { path } = splitHref(href);
  return CLIENT_ROUTES.find((r) => matches(r.path, path)) ?? null;
}

/** True when `role` can open `href` without being redirected (NotFound and wrong-role routes are false). */
export function canRoleOpen(role: PortalRole, href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const route = matchClientRoute(href);
  if (!route) return false;
  if (route.access === "public" || route.access === "authenticated") return true;
  return route.access.includes(role);
}

const STUDENT_SUB = /^\/admin\/students\/([^/?#]+)(?:\/([^/?#]*))?/;

/**
 * Rewrites an internal href for the viewer's role so it lands on a page that role may open:
 *  - admin: unchanged;
 *  - staff: the owner Control Center becomes the staff Control Center; the Advanced Workspace and the admin-only
 *    "view as student" become the Student File (documents for the workspace documents hash); anything else the staff
 *    role cannot open falls back to their Control Center;
 *  - coach: only the support desk (a ticket link keeps its ticket); everything else becomes /support.
 * External or malformed hrefs return the role home.
 */
export function roleSafeHref(href: string, role: string | null | undefined): string {
  const r = (role ?? "") as PortalRole;
  // eslint-disable-next-line no-control-regex
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//") || href.includes("\\") || /[\u0000-\u001f\u007f]/.test(href)) return roleHomePath(r);
  if (r === "admin") return href;
  if (r === "staff") {
    if (canRoleOpen("staff", href)) return href;
    const { path, query, hash } = splitHref(href);
    if (path === "/admin/support-center") return `/staff/control-center${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
    // Elective requests are reviewed by the owner; staff open the same request as a support conversation.
    const ticket = new URLSearchParams(query).get("ticket");
    if (path === "/admin/elective-requests" && ticket) return supportTicketPath(ticket);
    const m = STUDENT_SUB.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      return hash === "documents" ? studentFilePath(id, "documents") : studentFilePath(id);
    }
    return roleHomePath("staff");
  }
  if (r === "coach") return splitHref(href).path === "/support" ? href : "/support";
  return canRoleOpen("student", href) ? href : "/";
}

// ── return to destination after sign-in ───────────────────────────────────────

export const RETURN_TO_STORAGE_KEY = "lumiere_return_to";

/**
 * A same-origin, path-only destination that is safe to restore after sign-in, or null. Refuses external URLs,
 * protocol-relative and backslash tricks, control characters, auth pages (which would loop) and anything longer
 * than 512 characters.
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  const route = matchClientRoute(raw);
  if (!route || route.access === "public") return null;
  return raw;
}

/** The stored destination if the signed-in role can open it, otherwise null (the caller uses the role home). */
export function returnPathForRole(raw: unknown, role: string | null | undefined): string | null {
  const p = safeReturnPath(raw);
  if (!p || !role) return null;
  return canRoleOpen(role as PortalRole, p) ? p : null;
}
