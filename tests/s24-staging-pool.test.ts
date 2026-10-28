import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postgres: vi.fn(), end: vi.fn().mockResolvedValue(undefined), execute: vi.fn(),
}));
vi.mock("postgres", () => ({ default: mocks.postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: () => ({ execute: mocks.execute }) }));

describe("isolated staging session-pool budget", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Not a URL or credential: the driver is mocked and no network call is made.
    vi.stubEnv("DATABASE_URL", "unit-test-no-network");
    mocks.postgres.mockReturnValue({ end: mocks.end });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("caps only the explicitly identified development staging pool and closes it", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("S22_STAGING_PROJECT_REF", "tqgwoyzlnkqwkcjsiocd");
    const { db, closeDatabase } = await import("../server/lib/db");
    await db.execute(undefined as never);
    expect(mocks.postgres).toHaveBeenCalledWith("unit-test-no-network", { max: 2, idle_timeout: 10 });
    await closeDatabase();
    expect(mocks.end).toHaveBeenCalledWith({ timeout: 5 });
  });
  it("does not change production pool configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("S22_STAGING_PROJECT_REF", "tqgwoyzlnkqwkcjsiocd");
    const { db, closeDatabase } = await import("../server/lib/db");
    await db.execute(undefined as never);
    expect(mocks.postgres).toHaveBeenCalledWith("unit-test-no-network", {});
    await closeDatabase();
  });
});
