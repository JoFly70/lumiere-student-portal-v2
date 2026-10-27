/**
 * S16 hardening: real parsers/routers and validation, in-memory dependencies only.
 * Never loads a database client or contacts Supabase.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";
import { configureRequestBody } from "../server/lib/request-body";
import { partialForUpdate } from "../shared/partial-for-update";
import { insertStudentSchema } from "../shared/schema";
import { studentContactInputSchema } from "../shared/student-profile-contract";
import { formatValidationErrors } from "../server/lib/validation";
import { sendErrorResponse } from "../server/lib/errors";

const state = vi.hoisted(() => ({ updates: [] as Array<{ table: string; data: unknown }> }));
vi.mock("../server/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      update: (data: unknown) => {
        state.updates.push({ table, data });
        const chain = {
          eq: () => chain,
          select: () => chain,
          single: async () => ({ data, error: null }),
        };
        return chain;
      },
    }),
  },
}));
vi.mock("../server/middleware/auth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!req.headers["x-test-actor"]) return res.status(401).json({ error: "Unauthorized" });
    req.user = { id: "00000000-0000-4000-8000-000000000001", role: "staff" };
    next();
  },
}));
import programsRouter from "../server/routes/programs";

function programApp() {
  const app = express();
  configureRequestBody(app);
  app.use("/api", programsRouter);
  return app;
}

describe("S16 Zod 4 updates preserve existing academic and authority values", () => {
  beforeEach(() => { state.updates.length = 0; });

  it.each([
    ["/programs/test", "degree_programs", { name: "Updated title" }],
    ["/courses/test", "courses", { description: "Updated description" }],
    ["/enrollments/test", "student_program_enrollments", { expected_completion_date: "2027-06-01" }],
  ])("partial update %s forwards only supplied fields", async (path, table, body) => {
    const res = await request(programApp()).put("/api" + path).set("x-test-actor", "staff").send(body);
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([{ table, data: body }]);
  });

  it("rejects invalid academic credits before the repository boundary", async () => {
    const res = await request(programApp()).put("/api/courses/test")
      .set("x-test-actor", "staff").send({ credits: -3 });
    expect(res.status).toBe(400);
    expect(res.body.error[0].path).toEqual(["credits"]);
    expect(state.updates).toEqual([]);
  });

  it("does not allow unauthenticated academic edits", async () => {
    expect((await request(programApp()).put("/api/courses/test").send({ credits: 3 })).status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it("does not reset student consent, prior credits, nationality or contact preferences", () => {
    const patch = partialForUpdate(insertStudentSchema.omit({ user_id: true, photo_url: true, email: true })).strict();
    expect(patch.parse({ first_name: "Synthetic" })).toEqual({ first_name: "Synthetic" });
    expect(patch.safeParse({ user_id: "00000000-0000-4000-8000-000000000002" }).success).toBe(false);
    expect(patch.parse({ prior_credits: false, nationality: [] })).toEqual({ prior_credits: false, nationality: [] });
  });

  it("keeps existing contact scopes when only the name is changed", () => {
    expect(partialForUpdate(studentContactInputSchema).strict().parse({ full_name: "Synthetic Contact" }))
      .toEqual({ full_name: "Synthetic Contact" });
    expect(partialForUpdate(studentContactInputSchema).strict().parse({ scopes: [] })).toEqual({ scopes: [] });
  });

  it("preserves create defaults while update defaults stay absent", () => {
    const create = z.object({ credits: z.number().default(3), active: z.boolean().default(true) });
    expect(create.parse({})).toEqual({ credits: 3, active: true });
    expect(partialForUpdate(create).parse({})).toEqual({});
  });

  it("formats actual Zod 4 issues in the existing 400 error response", () => {
    const parsed = z.object({ credits: z.number().positive() }).safeParse({ credits: -1 });
    if (parsed.success) throw new Error("Expected validation failure");
    expect(formatValidationErrors(parsed.error)[0]).toContain("credits:");
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    sendErrorResponse(res, parsed.error, "synthetic-request");
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      code: "VALIDATION_ERROR", details: [{ field: "credits", message: expect.any(String) }],
    });
  });
});

describe("S16 production body-size boundaries run before validation", () => {
  function appAndHandler() {
    const app = express();
    const handler = vi.fn((req: express.Request, res: express.Response) =>
      res.json({ parsed: true, capturedRaw: !!req.rawBody }));
    configureRequestBody(app);
    app.post(/.*/, handler);
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res.status(err.status ?? 500).json({ code: err.type }));
    return { app, handler };
  }

  it("rejects large invalid arrays before generating per-element validation issues", async () => {
    const { app, handler } = appAndHandler();
    const res = await request(app).post("/api/students").send({ nationality: Array(60_000).fill(0) });
    expect(res.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it("captures raw bytes on an ordinary JSON request", async () => {
    const { app } = appAndHandler();
    expect((await request(app).post("/api/example").send({ value: "small" })).body)
      .toEqual({ parsed: true, capturedRaw: true });
  });

  it("allows the existing larger staff roadmap import, but not another endpoint", async () => {
    const { app, handler } = appAndHandler();
    const body = { note: "x".repeat(150_000) };
    expect((await request(app).post("/api/admin/students/synthetic/roadmap/import").send(body)).status).toBe(200);
    handler.mockClear();
    expect((await request(app).post("/api/admin/students/synthetic/profile").send(body)).status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it("bounds the roadmap parser at 2 MiB too", async () => {
    const { app, handler } = appAndHandler();
    const res = await request(app).post("/api/admin/students/synthetic/roadmap/import")
      .send({ note: "x".repeat(2 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });
});
