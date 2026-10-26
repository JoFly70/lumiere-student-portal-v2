/**
 * S10 — client side of truthful support creation, plus navigation/entry-point wiring.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "../client/src/lib/api";
import { describeCreateFailure, newIdempotencyKey } from "../client/src/hooks/use-tickets";
import { SUPPORT_IDEMPOTENCY_KEY_PATTERN } from "../shared/support-contract";

const read = (...p: string[]) => fs.readFileSync(path.resolve(import.meta.dirname, "..", ...p), "utf8");

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest keeps the error code (S08 open issue 6)", () => {
  it("throws ApiError with status, code and details; message stays the API error text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "nope", code: "SUPPORT_CREATE_INCOMPLETE", details: { mayHaveSaved: true } }), { status: 503 })));
    const err = await apiRequest("/api/tickets", { method: "POST", body: "{}" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ message: "nope", status: 503, code: "SUPPORT_CREATE_INCOMPLETE", details: { mayHaveSaved: true } });
  });

  it("non-JSON error bodies still produce an Error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 502 })));
    const err = await apiRequest("/x").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Request failed");
  });
});

describe("truthful create-failure wording and idempotency keys", () => {
  it("keys satisfy the server pattern and are unique", () => {
    const a = newIdempotencyKey();
    expect(SUPPORT_IDEMPOTENCY_KEY_PATTERN.test(a)).toBe(true);
    expect(newIdempotencyKey()).not.toBe(a);
  });

  it("claims 'not saved' only when the server said so", () => {
    expect(describeCreateFailure(new ApiError("We could not save your request.", 503, "SUPPORT_CREATE_INCOMPLETE", { saved: false, mayHaveSaved: false })).mayHaveSaved).toBe(false);
    expect(describeCreateFailure(new ApiError("unconfirmed", 503, "SUPPORT_CREATE_INCOMPLETE", { saved: false, mayHaveSaved: true })).mayHaveSaved).toBe(true);
    // A network failure (fetch rejected) is unknown, never "not sent".
    expect(describeCreateFailure(new TypeError("Failed to fetch")).mayHaveSaved).toBe(true);
  });
});

describe("support entry points", () => {
  it("every role has a Support link in the sidebar; students also in the bottom bar", () => {
    const sidebar = read("client/src/components/app-sidebar.tsx");
    for (const list of ["studentMenuItems", "adminMenuItems", "staffMenuItems"]) {
      const block = sidebar.slice(sidebar.indexOf(`const ${list}`), sidebar.indexOf("];", sidebar.indexOf(`const ${list}`)));
      expect(block, list).toContain('url: "/support"');
    }
    expect(read("client/src/components/student-shell.tsx")).toContain('url: "/support"');
  });

  it("the roadmap item card links to /support?item=<key> for active items only", () => {
    const card = read("client/src/components/student-progress/item-card.tsx");
    expect(card).toContain("/support?item=${encodeURIComponent(item.key)}");
    expect(card).toContain('item.planStatus === "planned" || item.planStatus === "hold"');
  });

  it("the Support route admits every authenticated role (no role restriction)", () => {
    const app = read("client/src/App.tsx");
    const route = app.slice(app.indexOf('<Route path="/support">'), app.indexOf('<Route path="/coach-dashboard">'));
    expect(route).toContain("<ProtectedRoute>");
    expect(route).not.toContain("requireRole");
  });
});
