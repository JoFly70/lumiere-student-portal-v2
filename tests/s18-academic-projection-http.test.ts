import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../server/middleware/auth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const raw = req.headers["x-test-user"];
    if (!raw) return res.status(401).json({ error: "Authentication required" });
    req.user = JSON.parse(String(raw));
    next();
  },
}));

import { createStudentAcademicProjectionRouter } from "../server/routes/student-academic-projection";
import { HsError } from "../server/services/high-school-service";
import { award, makeView, META } from "./helpers/s18-academic-fixtures";

const STUDENTS: Record<string, string> = { "user-a": "student-a", "user-b": "student-b" };
const sources = {
  "student-a": { view: makeView({ awards: [award("english-1", "english", 2)] }), meta: { ...META, milestones: [] } },
  "student-b": { view: makeView(), meta: { ...META, milestones: [] } },
} as const;
const seen: string[] = [];

function app() {
  const a = express();
  a.use(express.json());
  a.use(
    "/api/student",
    createStudentAcademicProjectionRouter({
      getStudentByUserId: async (uid) => (STUDENTS[uid] ? { id: STUDENTS[uid] } : null),
      service: {
        getStudentAcademicSource: async (sid) => {
          seen.push(sid);
          const s = (sources as any)[sid];
          if (!s) throw new HsError("HS_NO_ENROLLMENT", 404, "No high school enrollment yet");
          return s;
        },
      },
    }),
  );
  return a;
}
const as = (id: string, role = "student") => JSON.stringify({ id, role });

describe("S18 GET /api/student/academic-projection", () => {
  it("returns the authenticated student's own projection", async () => {
    const res = await request(app()).get("/api/student/academic-projection").set("x-test-user", as("user-a"));
    expect(res.status).toBe(200);
    expect(res.body.contract).toBe("academic-projection/1");
    expect(res.body.program.templateKey).toBe("us-hs-diploma-21");
    expect(res.body.credits.total.officialHalfUnits).toBe(2);
    expect(res.body.credits.core.requiredHalfUnits + res.body.credits.elective.requiredHalfUnits).toBe(42);
  });

  it("student A cannot obtain student B's projection", async () => {
    seen.length = 0;
    const res = await request(app()).get("/api/student/academic-projection").set("x-test-user", as("user-b"));
    expect(res.status).toBe(200);
    expect(res.body.credits.total.officialHalfUnits).toBe(0);
    expect(seen).toEqual(["student-b"]);
  });

  it("rejects studentId in the query and never uses it", async () => {
    seen.length = 0;
    const res = await request(app()).get("/api/student/academic-projection?studentId=student-b").set("x-test-user", as("user-a"));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("HS_STUDENT_ID_NOT_ACCEPTED");
    expect(seen).toEqual([]);
    const other = await request(app()).get("/api/student/academic-projection?id=student-b&userId=user-b").set("x-test-user", as("user-a"));
    expect(other.status).toBe(200);
    expect(seen).toEqual(["student-a"]);
  });

  it("non-student roles get 403, anonymous 401", async () => {
    for (const role of ["staff", "admin", "coach"]) {
      const res = await request(app()).get("/api/student/academic-projection").set("x-test-user", as("user-a", role));
      expect(res.status).toBe(403);
    }
    expect((await request(app()).get("/api/student/academic-projection")).status).toBe(401);
  });

  it("404 HS_NO_ENROLLMENT when the student has no program", async () => {
    STUDENTS["user-c"] = "student-c";
    const res = await request(app()).get("/api/student/academic-projection").set("x-test-user", as("user-c"));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("HS_NO_ENROLLMENT");
  });
});
