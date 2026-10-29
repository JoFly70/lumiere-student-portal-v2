import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { MemoryBudgetStore } from "../server/services/academic-assistant/budget";
import { loadAssistantConfig } from "../server/services/academic-assistant/config";
import { callMuseSparkWebSearch } from "../server/services/academic-assistant/meta-adapter";
import { askWebResearch, personalDataIn, webResearchDecision, WebResearchRejectedError } from "../server/services/web-research/service";
import { createAdminWebResearchRouter } from "../server/routes/admin-web-research";

const live = () => ({ ...loadAssistantConfig(), liveEnabled: true, hasApiKey: true, liveRoles: new Set(["admin", "staff"]) });
const providerBody = {
  model: "muse-spark-1.3-contributor",
  status: "completed",
  output: [
    { id: "ws_1", type: "web_search_call", status: "completed" },
    { id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text: "DEAC accredits distance-education institutions.", annotations: [
      { type: "url_citation", url: "https://www.deac.org/", title: "DEAC", start_index: 0, end_index: 4 },
      { type: "url_citation", url: "https://www.deac.org/", title: "DEAC duplicate", start_index: 5, end_index: 9 },
      { type: "url_citation", url: "javascript:alert(1)", title: "bad", start_index: 0, end_index: 1 },
    ] }] },
  ],
  usage: { input_tokens: 900, output_tokens: 300 },
};
const okFetch = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => providerBody }));

beforeEach(() => { process.env.META_MODEL_API_KEY = "test-key"; });

describe("S27 web research (staff and admins only)", () => {
  it("calls the Responses API with the built-in web_search tool on the pinned model, and parses safe citations", async () => {
    const fetchImpl = okFetch();
    const out = await callMuseSparkWebSearch({ instructions: "rules", question: "What does DEAC accredit?" }, { maxOutputTokens: 800, timeoutMs: 5000, maxSearches: 3, fetchImpl: fetchImpl as never });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("https://api.meta.ai/v1/responses");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "muse-spark-1.3-contributor", input: "What does DEAC accredit?", tools: [{ type: "web_search" }], max_tool_calls: 3 });
    expect(out.searched).toBe(true);
    expect(out.citations).toEqual([{ url: "https://www.deac.org/", title: "DEAC" }]); // deduplicated, javascript: dropped
    expect(out.servedModel).toBe("muse-spark-1.3-contributor");
    await expect(callMuseSparkWebSearch({ instructions: "x", question: "y" }, { maxOutputTokens: 1, timeoutMs: 10, maxSearches: 1, fetchImpl: fetchImpl as never, model: "other-model" })).rejects.toMatchObject({ kind: "model_rejected" });
  });

  it("refuses questions carrying contact data or student codes; dates and years are fine", () => {
    expect(personalDataIn("Email jane@example.org about this")).toBe(true);
    expect(personalDataIn("call +1 (514) 555-0199")).toBe(true);
    expect(personalDataIn("what about LCA-2026-0001?")).toBe(true);
    expect(personalDataIn("what about lca-2026-0001?")).toBe(true);
    expect(personalDataIn("DEAC transfer policy changes since 2026-10-29")).toBe(false);
    expect(personalDataIn("Is a 120 credit bachelor's possible in 2027?")).toBe(false);
  });

  it("staff and admins only; an off switch and a missing key make it unavailable", () => {
    const cfg = live();
    expect(webResearchDecision("admin", cfg, {})).toEqual({ live: true });
    expect(webResearchDecision("staff", cfg, {})).toEqual({ live: true });
    for (const role of ["coach", "student"]) expect(webResearchDecision(role, cfg, {})).toEqual({ live: false, reason: "not_eligible" });
    expect(webResearchDecision("staff", cfg, { SPARK_WEB_SEARCH: "off" })).toEqual({ live: false, reason: "disabled" });
    expect(webResearchDecision("staff", { ...cfg, hasApiKey: false }, {})).toEqual({ live: false, reason: "not_configured" });
    // Ops can narrow live AI to admins only: staff then lose web research too.
    expect(webResearchDecision("staff", { ...cfg, liveRoles: new Set(["admin"]) }, {})).toEqual({ live: false, reason: "not_eligible" });
  });

  it("sends only the question; personal data is refused before any provider call", async () => {
    const fetchImpl = okFetch();
    const deps = { budget: new MemoryBudgetStore(), fetchImpl: fetchImpl as never, config: live, env: {} };
    await expect(askWebResearch({ id: "s", role: "staff" }, { question: "write to a@b.co", language: "en" }, deps)).rejects.toBeInstanceOf(WebResearchRejectedError);
    expect(fetchImpl).not.toHaveBeenCalled();
    const a = await askWebResearch({ id: "s", role: "staff" }, { question: "What does DEAC accredit?", language: "fr" }, deps);
    expect(a).toMatchObject({ mode: "live", searched: true, sources: [{ url: "https://www.deac.org/" }], model: { requested: "muse-spark-1.3-contributor", served: "muse-spark-1.3-contributor" } });
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body).input).toBe("What does DEAC accredit?");
  });

  it("web research may only spend while the month is under its share of the cap (default half)", async () => {
    const budget = new MemoryBudgetStore();
    const cfg = () => ({ ...live(), monthlyBudgetUsd: 2 });
    // Another assistant already spent $1.20 of the $2 cap this month: above the 50% web share.
    await budget.reserve(new Date().toISOString().slice(0, 7), 1_200_000, 2_000_000);
    const fetchImpl = okFetch();
    const a = await askWebResearch({ id: "s", role: "staff" }, { question: "What does DEAC accredit?", language: "en" }, { budget, fetchImpl: fetchImpl as never, config: cfg, env: {} });
    expect(a).toMatchObject({ mode: "unavailable", reason: "budget_exhausted" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("route: staff and admins allowed; coaches and students refused; personal data is a 400", async () => {
    const mk = (role: string) => {
      const app = express();
      app.use(express.json());
      app.use("/api/admin", createAdminWebResearchRouter({
        deps: { budget: new MemoryBudgetStore(), fetchImpl: okFetch() as never, config: live, env: {} },
        auth: (req, _res, next) => { (req as any).user = { id: `u-${role}`, role }; next(); },
        csrf: (_req, _res, next) => next(),
        audit: async () => {},
      }));
      return app;
    };
    for (const role of ["admin", "staff"]) {
      const r = await request(mk(role)).post("/api/admin/web-research").send({ question: "What does DEAC accredit?", language: "en" });
      expect(r.status).toBe(200);
      expect(r.body.mode).toBe("live");
    }
    for (const role of ["coach", "student"]) {
      expect((await request(mk(role)).post("/api/admin/web-research").send({ question: "What does DEAC accredit?", language: "en" })).status).toBe(403);
      expect((await request(mk(role)).get("/api/admin/web-research/status")).status).toBe(403);
    }
    const pii = await request(mk("staff")).post("/api/admin/web-research").send({ question: "ask jane@example.org", language: "en" });
    expect(pii.status).toBe(400);
    expect(pii.body.error.code).toBe("WEB_RESEARCH_PERSONAL_DATA");
  });
});
