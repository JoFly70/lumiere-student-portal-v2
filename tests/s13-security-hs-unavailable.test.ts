/**
 * S13 lane C (H) — an unavailable database / missing table on the HS routes is a
 * truthful 503 HS_UNAVAILABLE (never a fake empty 200, never leaked internals);
 * other failures stay a generic 500. Router-level, fake service, no database.
 */
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../server/middleware/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const role = req.header("x-role");
    if (!role) return res.status(401).json({ error: "Authentication required" });
    req.user = { id: "11111111-1111-4111-8111-111111111111", role, email: "synthetic@example.test" };
    return next();
  },
}));

import { createStudentHighSchoolRouter } from "../server/routes/student-high-school";
import { createAdminHighSchoolRouter } from "../server/routes/admin-high-school";
import { toHsUnavailable } from "../server/services/high-school-service";

const pgError = (code: string, message = "relation \"hs_enrollments\" does not exist") => Object.assign(new Error(message), { code });
const wrapped = (code: string) => Object.assign(new Error("Failed query: select * from hs_enrollments secret-sql"), { cause: pgError(code) });

function apps(failure: unknown) {
  const boom = async () => {
    throw failure;
  };
  const service: any = new Proxy({}, { get: () => boom });
  const app = express();
  app.use(express.json());
  app.use("/api/student", createStudentHighSchoolRouter({ getStudentByUserId: async () => ({ id: "22222222-2222-4222-8222-222222222222" }), service }));
  app.use("/api/admin", createAdminHighSchoolRouter({ service, audit: () => undefined, onAccessDenied: () => undefined }));
  return app;
}

describe("S13 H — truthful HS errors", () => {
  it.each([["undefined table", pgError("42P01")], ["wrapped undefined table", wrapped("42P01")], ["connection refused", pgError("ECONNREFUSED", "connect ECONNREFUSED 10.0.0.9:5432")], ["db shutdown", pgError("57P01")], ["connection class 08", pgError("08006")]])(
    "%s -> 503 HS_UNAVAILABLE with no internals, on student and admin routes",
    async (_n, failure) => {
      const app = apps(failure);
      const studentRes = await request(app).get("/api/student/high-school").set("x-role", "student");
      const programsRes = await request(app).get("/api/student/programs").set("x-role", "student");
      const adminRes = await request(app).get("/api/admin/students/22222222-2222-4222-8222-222222222222/high-school").set("x-role", "staff");
      for (const res of [studentRes, programsRes, adminRes]) {
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe("HS_UNAVAILABLE");
        expect(res.text).not.toMatch(/hs_enrollments|secret-sql|10\.0\.0\.9|relation/);
      }
    },
  );

  it("an unexpected non-infrastructure error stays a generic 500 INTERNAL_ERROR", async () => {
    const res = await request(apps(new Error("boom: secret detail"))).get("/api/student/high-school").set("x-role", "student");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(res.text).not.toContain("secret detail");
  });

  it("toHsUnavailable leaves business errors and unrelated errors untouched", () => {
    const plain = new Error("x");
    expect(toHsUnavailable(plain)).toBe(plain);
    expect(toHsUnavailable(pgError("23505", "duplicate"))).toBeInstanceOf(Error);
    expect((toHsUnavailable(pgError("23505", "duplicate")) as any).status).toBeUndefined();
  });
});
