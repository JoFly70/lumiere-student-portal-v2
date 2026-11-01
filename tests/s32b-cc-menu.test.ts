/** S32-B: one "needs you" count (SA-15) and the role menus (SA-16, SA-13, SA-36, SA-03). */
import { describe, expect, it } from "vitest";
import { needsModel, studentOpenHref } from "../client/src/components/admin/control/control-center";
import { staffMenuFor } from "../client/src/components/app-sidebar";
import { canRoleOpen } from "../shared/staff-links";
import { translate } from "../client/src/i18n";

const q = (severity: "critical" | "warning" | "info", studentId = "s1") => ({ severity, studentId }) as never;

describe("SA-15 one needs-you number", () => {
  it("uses the persisted Needs Attention open count when available, and points the ring at it", () => {
    const m = needsModel({ queue: [q("critical"), q("warning"), q("warning")] }, new Set(), { open: 5, urgent: 1, high: 2 });
    expect(m).toEqual({ total: 5, critical: 1, warning: 2, info: 2, anchor: "#cc-attention" });
  });
  it("a dismissal (open count drops) moves the headline", () => {
    expect(needsModel({ queue: [] }, new Set(), { open: 4, urgent: 1, high: 2 }).total).toBe(4);
  });
  it("falls back to S27 queue ITEMS (not students), demo excluded, with the fallback anchor", () => {
    const m = needsModel({ queue: [q("critical"), q("warning", "s2"), q("info", "demo")] }, new Set(["demo"]), null);
    expect(m).toEqual({ total: 2, critical: 1, warning: 1, info: 0, anchor: "#cc-queue" });
  });
});

describe("staff menus", () => {
  it("every menu item opens for its role, labels are translated, and 'Notifications' is the email delivery log", () => {
    for (const role of ["admin", "staff", "coach"] as const) {
      for (const item of staffMenuFor(role)) {
        expect(canRoleOpen(role, item.url), `${role} ${item.url}`).toBe(true);
        expect(translate("fr", item.labelKey)).not.toBe(translate("en", item.labelKey));
      }
    }
    expect(staffMenuFor("staff").find((i) => i.url === "/admin/notifications")!.labelKey).toBe("s32.nav.emailDelivery");
    expect(translate("en", "s32.nav.emailDelivery")).toBe("Email delivery");
  });
  it("staff get the Students directory; coaches only the support desk", () => {
    expect(staffMenuFor("staff").map((i) => i.url)).toContain("/admin/students");
    expect(staffMenuFor("staff").map((i) => i.url)).not.toContain("/admin/assistant");
    expect(staffMenuFor("coach").map((i) => i.url)).toEqual(["/support"]);
  });
  it("roster Open goes to the Student File for admin and staff", () => {
    expect(studentOpenHref({ studentId: "s1", program: "degree" }, "staff")).toBe("/admin/students/s1");
    expect(studentOpenHref({ studentId: "s1", program: "high_school" }, "admin")).toBe("/admin/students/s1");
  });
});
