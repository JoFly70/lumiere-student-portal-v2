import { describe, expect, it, vi } from "vitest";
import { revokeAllSupabaseSessions } from "../server/lib/session-revocation";

describe("Phase 5E Supabase session revocation", () => {
  it("uses the supplied JWT with global scope", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });

    await expect(revokeAllSupabaseSessions({ signOut }, "validated-jwt"))
      .resolves.toEqual({ revoked: true });
    expect(signOut).toHaveBeenCalledWith("validated-jwt", "global");
  });

  it("fails explicitly when Supabase returns a revocation error", async () => {
    const signOut = vi.fn().mockResolvedValue({
      error: { message: "revocation unavailable" },
    });

    await expect(revokeAllSupabaseSessions({ signOut }, "validated-jwt"))
      .resolves.toEqual({
        revoked: false,
        error: "revocation unavailable",
      });
  });

  it("fails explicitly when the revocation call throws", async () => {
    const signOut = vi.fn().mockRejectedValue(new Error("network unavailable"));

    await expect(revokeAllSupabaseSessions({ signOut }, "validated-jwt"))
      .resolves.toEqual({
        revoked: false,
        error: "network unavailable",
      });
  });
});