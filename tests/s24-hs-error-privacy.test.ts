import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
vi.mock("../server/lib/logger", () => ({ logger: mocks }));
vi.mock("../server/middleware/auth", () => ({ requireAuth: vi.fn() }));
import { sendHsError } from "../server/routes/high-school-http";

describe("high-school database error privacy", () => {
  it("keeps useful pooler cause identifiers without SQL, bound values or raw messages", () => {
    const failure = new Error("SQL_WITH_PRIVATE_BINDINGS", {
      cause: Object.assign(new Error("MaxClientsInSessionMode: max clients reached"), { code: "XX000" }),
    });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    sendHsError(res as never, failure, "student view");
    expect(res.status).toHaveBeenCalledWith(500);
    expect(mocks.error).toHaveBeenCalledWith("High school student view failed",
      { code: "XX000", reason: "SESSION_POOL_CAPACITY" });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("SQL_WITH_PRIVATE_BINDINGS");
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain("SQL_WITH_PRIVATE_BINDINGS");
  });
});
