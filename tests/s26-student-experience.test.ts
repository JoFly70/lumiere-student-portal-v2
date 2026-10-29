import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createAdminStudentExperienceRouter, isDemoTarget, type ExperienceDeps } from "../server/routes/admin-student-experience";

const real = { id: "real-1", user_id: null, student_code: "LCA-2026-0001", preferred_name: null, first_name: "Real", last_name: "Student" };
const realWithLogin = { ...real, id: "real-2", user_id: "u-real", student_code: "LCA-2026-0009" };
const mirror = { id: "mir-1", user_id: "u-mirror", student_code: "LCA-2026-0010", preferred_name: "DEMO-MIRROR-LCA-2026-0001", first_name: "DEMO", last_name: "Mirror" };
const demo = { id: "demo-1", user_id: "u-demo", student_code: "LCA-2026-0002", preferred_name: "DEMO-S26-FR", first_name: "DEMO", last_name: "Eleve" };
const accounts: Record<string, any> = {
  "u-mirror": { id: "u-mirror", email: "s26.mirror@lumiere-demo.invalid", name: "DEMO Mirror", role: "student" },
  "u-demo": { id: "u-demo", email: "s26.demo.student@lumiere-demo.invalid", name: "DEMO", role: "student" },
  "u-real": { id: "u-real", email: "family@example.com", name: "Real", role: "student" },
};

function app(role: string, over: Partial<ExperienceDeps> = {}) {
  const issueSession = vi.fn(async () => ({ access_token: "a", refresh_token: "r", expires_at: 1 }));
  const deps: ExperienceDeps = {
    getStudent: async (id) => ({ "real-1": real, "real-2": realWithLogin, "demo-1": demo, "mir-1": mirror } as any)[id] ?? null,
    findMirror: async (code) => (code === "LCA-2026-0001" ? mirror : null),
    getAccount: async (id) => accounts[id] ?? null,
    issueSession,
    audit: async () => {},
    auth: (req, _res, next) => { (req as any).user = { id: "x", role }; next(); },
    csrf: (_req, _res, next) => next(),
    ...over,
  };
  const a = express();
  a.use(express.json());
  a.use("/api/admin", createAdminStudentExperienceRouter(deps));
  return { a, issueSession };
}

describe("S26 Experience as student", () => {
  it("real student -> session for the synthetic mirror only; the real account is never used", async () => {
    const { a, issueSession } = app("admin");
    const r = await request(a).post("/api/admin/students/real-1/experience");
    expect(r.status).toBe(200);
    expect(r.body.user.email).toMatch(/\.invalid$/);
    expect(r.body.mirror.studentId).toBe("mir-1");
    expect(issueSession).toHaveBeenCalledWith("s26.mirror@lumiere-demo.invalid", "u-mirror");
  });
  it("synthetic demo student -> its own demo session", async () => {
    const r = await request(app("admin").a).post("/api/admin/students/demo-1/experience");
    expect(r.status).toBe(200);
    expect(r.body.user.id).toBe("u-demo");
  });
  it("real student without a mirror -> 404, never the real login", async () => {
    const { a, issueSession } = app("admin");
    expect((await request(a).post("/api/admin/students/real-2/experience")).status).toBe(404);
    expect(issueSession).not.toHaveBeenCalled();
  });
  it("refuses a 'mirror' whose account is not synthetic", async () => {
    const { a, issueSession } = app("admin", { getAccount: async () => accounts["u-real"] });
    expect((await request(a).post("/api/admin/students/real-1/experience")).status).toBe(403);
    expect(issueSession).not.toHaveBeenCalled();
  });
  it("staff, coach and students are refused", async () => {
    for (const role of ["staff", "coach", "student"]) {
      expect((await request(app(role).a).post("/api/admin/students/demo-1/experience")).status).toBe(403);
    }
  });
  it("isDemoTarget requires .invalid email, student role, DEMO name and matching user", () => {
    expect(isDemoTarget(demo as any, accounts["u-demo"])).toBe(true);
    expect(isDemoTarget({ ...demo, preferred_name: "Jonas" } as any, accounts["u-demo"])).toBe(false);
    // S27: the marker needs a separator, so a real name that merely starts with "Demo" is never a demo target
    expect(isDemoTarget({ ...demo, preferred_name: "Demont" } as any, accounts["u-demo"])).toBe(false);
    expect(isDemoTarget({ ...demo, preferred_name: "DEMO" } as any, accounts["u-demo"])).toBe(false);
    expect(isDemoTarget(demo as any, { ...accounts["u-demo"], role: "admin" })).toBe(false);
  });
});
