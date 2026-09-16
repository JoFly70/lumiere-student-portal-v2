import { describe, expect, it, vi } from "vitest";
import { listPlacementsForAssignment } from "../server/repositories/student-credit-placement-repo";

describe("Phase 5B — placement repository read boundary", () => {
  it("returns joined placement bindings for every lifecycle status in deterministic query order", async () => {
    const rows = ["active", "revoked", "superseded"].map((status, index) => ({
      placement: {
        id: `placement-${index + 1}`,
        programAssignmentId: "assignment-1",
        status,
      },
      decision: {
        id: `decision-${index + 1}`,
        programAssignmentId: "assignment-1",
        creditRecordId: `credit-${index + 1}`,
      },
      creditRecord: {
        id: `credit-${index + 1}`,
        studentId: "student-1",
        sourceId: "source-1",
      },
    }));
    const query = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn().mockResolvedValue(rows),
    };
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    query.where.mockReturnValue(query);
    const tx = {
      select: vi.fn().mockReturnValue(query),
    };

    const result = await listPlacementsForAssignment("assignment-1", tx as any);

    expect(result).toBe(rows);
    expect(result.map((row) => row.placement.status)).toEqual([
      "active",
      "revoked",
      "superseded",
    ]);
    expect(tx.select).toHaveBeenCalledWith(expect.objectContaining({
      placement: expect.anything(),
      decision: expect.anything(),
      creditRecord: expect.anything(),
    }));
    expect(query.from).toHaveBeenCalledTimes(1);
    expect(query.innerJoin).toHaveBeenCalledTimes(2);
    expect(query.where).toHaveBeenCalledTimes(1);
    expect(query.orderBy).toHaveBeenCalledTimes(1);
    expect(query.orderBy.mock.calls[0]).toHaveLength(2);
  });
});