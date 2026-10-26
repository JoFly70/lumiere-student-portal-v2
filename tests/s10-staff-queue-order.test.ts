import { describe, expect, it } from "vitest";
import { orderStaffQueue } from "../client/src/components/support/support-presentation";

const t = (id: string, status: string, awaiting_since: string, is_overdue = false) => ({ id, status, awaiting_since, is_overdue });

describe("S10: staff desk triage order (server returns newest first)", () => {
  it("puts open overdue work first, then longest waiting, then resolved/closed in server order", () => {
    const serverOrder = [
      t("new-open", "open", "2026-10-25T09:00:00Z"),
      t("resolved-recent", "resolved", "2026-10-24T09:00:00Z"),
      t("old-waiting", "waiting_on_student", "2026-10-10T09:00:00Z"),
      t("overdue", "in_progress", "2026-10-20T09:00:00Z", true),
      t("closed-old", "closed", "2026-09-01T09:00:00Z"),
    ];
    expect(orderStaffQueue(serverOrder).map((x) => x.id)).toEqual(["overdue", "old-waiting", "new-open", "resolved-recent", "closed-old"]);
  });

  it("does not mutate the input and handles an empty queue", () => {
    const input = [t("a", "open", "2026-10-02T00:00:00Z"), t("b", "open", "2026-10-01T00:00:00Z")];
    const copy = input.map((x) => x.id);
    expect(orderStaffQueue(input).map((x) => x.id)).toEqual(["b", "a"]);
    expect(input.map((x) => x.id)).toEqual(copy);
    expect(orderStaffQueue([])).toEqual([]);
  });
});
