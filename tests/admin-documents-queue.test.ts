import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createAdminDocumentsQueueRouter } from "../server/routes/admin-documents-queue";

const item = { documentId: "d1", studentId: "s1", studentName: "Sara B", docType: "hs_transcript", uploadedAt: "2026-10-29T00:00:00.000Z" };
const mk = (role: string) => {
  const app = express();
  app.use("/api/admin", createAdminDocumentsQueueRouter({
    list: async () => [item],
    auth: ((req: any, _res: any, next: any) => { req.user = { id: `u-${role}`, role }; next(); }) as any,
  }));
  return app;
};

describe("admin documents queue", () => {
  it("allows admin and staff", async () => {
    for (const role of ["admin", "staff"]) {
      const r = await request(mk(role)).get("/api/admin/documents/queue");
      expect(r.status).toBe(200);
      expect(r.body.documents).toEqual([item]);
    }
  });
  it("refuses student and coach", async () => {
    for (const role of ["student", "coach"]) {
      expect((await request(mk(role)).get("/api/admin/documents/queue")).status).toBe(403);
    }
  });
});
