import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { MemoryBudgetStore } from "../server/services/academic-assistant/budget";
import { loadAssistantConfig } from "../server/services/academic-assistant/config";
import { answerMessage, buildProviderMessages, decideLive } from "../server/services/academic-assistant/service";
import { composeOwnerContext, extractCitations, scrubFreeText, type OwnerContextInput } from "../server/services/owner-assistant/context";
import { askOwnerAssistant, buildOwnerMessages } from "../server/services/owner-assistant/service";
import { createAdminOwnerAssistantRouter } from "../server/routes/admin-owner-assistant";
import { makeDemoPlan, makeContractPlan } from "../scripts/s26/demo-plan.mjs";
import { TEMPLATE_STANDARD_21_V3 as T, hsRoadmapContentSchema } from "../shared/high-school-contract";
import { contentFromTemplate } from "../shared/high-school-projection";

const ctx: OwnerContextInput = {
  student: { id: "stu-1", student_code: "LCA-2026-0009", status: "active", user_id: "u-1" },
  highSchool: null,
  reviewQueue: [],
  documents: [{ id: "d1", doc_type: "hs_transcript", status: "pending", uploaded_at: "2026-10-29T00:00:00Z", rejection_reason: "call me at +212 600 000 000 or a@b.co" }],
  tickets: [{ id: "t1", subject: "DEMO — question about my roadmap", status: "open", category: "academic", priority: "normal", updated_at: "2026-10-29T00:00:00Z" }],
};
const live = () => ({ ...loadAssistantConfig(), liveEnabled: true, hasApiKey: true, liveRoles: new Set(["admin"]) });

beforeEach(() => {
  process.env.META_MODEL_API_KEY = "test-key";
});

describe("S26 owner AI grounding", () => {
  it("builds numbered records without contact data", () => {
    const recs = composeOwnerContext(ctx);
    expect(recs.map((r) => r.ref)).toEqual(["R1", "R2", "R3"]);
    const all = recs.map((r) => r.text).join(" ");
    expect(all).not.toMatch(/a@b\.co|600 000/);
    expect(scrubFreeText("mail x@y.org now")).toBe("mail [email] now");
    const msgs = buildOwnerMessages(recs, "What is pending?", "en", "answer");
    expect(msgs[0].content).toContain("[R2] Document: hs_transcript");
  });

  it("keeps only citations to real records", () => {
    const recs = composeOwnerContext(ctx);
    expect(extractCitations("See [R2] and R9 and [R2]", recs).map((r) => r.ref)).toEqual(["R2"]);
  });

  it("answers live with citations for admins only, and is honestly unavailable otherwise", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ model: "muse-spark-1.3-contributor", choices: [{ message: { content: "The transcript is pending review [R2]." }, finish_reason: "stop" }], usage: { prompt_tokens: 300, completion_tokens: 80 } }) }));
    const deps = { loadContext: async () => ctx, budget: new MemoryBudgetStore(), fetchImpl, config: live };
    const a = await askOwnerAssistant({ id: "admin", role: "admin" }, { studentId: "stu-1", question: "What is pending?", language: "en", task: "answer" }, deps);
    expect(a.mode).toBe("live");
    expect(a.citations.map((c) => c.ref)).toEqual(["R2"]);
    // The answer reports the pinned model it requested and the model the provider says served it.
    expect(a.model).toEqual({ requested: "muse-spark-1.3-contributor", served: "muse-spark-1.3-contributor" });
    const staff = await askOwnerAssistant({ id: "s", role: "staff" }, { studentId: "stu-1", question: "x", language: "en", task: "answer" }, deps);
    expect(staff).toMatchObject({ mode: "unavailable", reason: "not_eligible", reply: null });
    const off = await askOwnerAssistant({ id: "admin", role: "admin" }, { studentId: "stu-1", question: "x", language: "fr", task: "draft_reply" }, { ...deps, config: () => ({ ...live(), liveEnabled: false }) });
    expect(off).toMatchObject({ mode: "unavailable", reason: "disabled", reply: null, requiresHumanApproval: true });
    expect(off.recordSummary).toContain("[R1]");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("route: admin only, CSRF-guarded route accepts admin, refuses student and staff", async () => {
    const mk = (role: string) => {
      const app = express();
      app.use(express.json());
      app.use("/api/admin", createAdminOwnerAssistantRouter({
        deps: { loadContext: async (id) => (id === "stu-1" ? ctx : null), budget: new MemoryBudgetStore(), config: () => ({ ...live(), liveEnabled: false }) },
        auth: (req, _res, next) => { (req as any).user = { id: `u-${role}`, role }; next(); },
        csrf: (_req, _res, next) => next(),
        audit: async () => {},
      }));
      return app;
    };
    const ok = await request(mk("admin")).post("/api/admin/students/stu-1/owner-assistant").send({ question: "What is pending?", language: "en" });
    expect(ok.status).toBe(200);
    expect(ok.body.mode).toBe("unavailable");
    expect((await request(mk("admin")).post("/api/admin/students/nope/owner-assistant").send({ question: "q", language: "en" })).status).toBe(404);
    for (const role of ["student", "staff", "coach"]) {
      expect((await request(mk(role)).post("/api/admin/students/stu-1/owner-assistant").send({ question: "q", language: "en" })).status).toBe(403);
    }
  });
});

describe("S26 student AI minor-safe policy", () => {
  it("students are live only under the explicit minor_safe_v1 policy, never via liveRoles", () => {
    const base = { ...loadAssistantConfig(), liveEnabled: true, hasApiKey: true, liveRoles: new Set(["admin"]) };
    expect(decideLive({ id: "s", role: "student" }, base)).toEqual({ live: false, reason: "not_eligible" });
    expect(decideLive({ id: "s", role: "student" }, { ...base, studentPolicy: "minor_safe_v1" })).toEqual({ live: true });
    process.env.SPARK_ASSISTANT_STUDENT_POLICY = "yes";
    expect(loadAssistantConfig().studentPolicy).toBeNull();
    process.env.SPARK_ASSISTANT_STUDENT_POLICY = "minor_safe_v1";
    expect(loadAssistantConfig().studentPolicy).toBe("minor_safe_v1");
    delete process.env.SPARK_ASSISTANT_STUDENT_POLICY;
  });

  it("student prompts carry the academic-integrity and minor-safe rules", async () => {
    const msgs = buildProviderMessages("help", "fr", [], [], 2500, true);
    expect(msgs[0].content).toMatch(/Intégrité académique/);
    let sent = "";
    const fetchImpl = vi.fn(async (_u: string, init: any) => { sent = init.body; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Faisons un plan de révision." }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10 } }) }; });
    const r = await answerMessage({ id: "s", role: "student" }, { message: "Comment réviser ?", language: "fr" }, { budget: new MemoryBudgetStore(), fetchImpl, config: () => ({ ...loadAssistantConfig(), liveEnabled: true, hasApiKey: true, studentPolicy: "minor_safe_v1" }) });
    expect(r.mode).toBe("live");
    expect(sent).toMatch(/ne réalisez, ne répondez et ne rédigez jamais un travail noté/);
  });
});

describe("S26 synthetic 21-credit demo plan", () => {
  it("is schema-valid: 22 courses, 42 half-units, 12 milestones, electives labelled TEST ONLY", () => {
    const draft = contentFromTemplate(T, 42, null).content;
    const plan = hsRoadmapContentSchema.parse(makeDemoPlan(draft));
    expect(plan.courses).toHaveLength(22);
    expect(plan.courses.reduce((n, c) => n + c.halfUnits, 0)).toBe(42);
    expect(plan.courses.filter((c) => c.title.includes("TEST ONLY / SCHOOL APPROVAL PENDING"))).toHaveLength(5);
    expect(plan.pacing.milestones.at(-1)).toEqual({ month: "2027-10", cumulativeHalfUnits: 42 });
    expect(plan.courses.every((c) => c.tasks.length > 0 && c.tasks.every((t) => t.dueDate !== null))).toBe(true);
  });

  it("contract plan for the real student: 16-week phases 3/8/16/21, the five contract electives, draft-only (no dates)", () => {
    const draft = contentFromTemplate(T, 42, null).content;
    const plan = hsRoadmapContentSchema.parse(makeContractPlan(draft));
    expect(plan.courses).toHaveLength(22);
    const electives = plan.courses.filter((c) => c.areaKey === "electives").map((c) => c.title.split(" — ")[0]);
    expect(electives).toEqual(["Microsoft Word & Excel", "Business Math", "English Communications", "Human Relations", "Reading Skills"]);
    expect(plan.courses.every((c) => c.plannedStart === null && c.tasks.every((t) => t.dueDate === null))).toBe(true);
    expect(plan.pacing.targetCompletionDate).toBeNull();
  });
});
