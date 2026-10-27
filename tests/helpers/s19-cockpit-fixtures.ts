/** SYNTHETIC cockpit fixtures (S19): invented student, school, documents, tickets and billing. Not real records. */
import type { StudentBillingView } from "../../shared/billing-contract";
import type { CockpitOps } from "../../client/src/components/cockpit/model";
import { COMPLETE_COURSES, PARTIAL_COURSES, makeProjection } from "./s18-flight-deck-fixtures";

export const S19_PARTIAL = makeProjection();
/** Near complete: everything official except one half-credit and the last elective in progress. */
export const S19_NEAR_COMPLETE = makeProjection({
  courses: COMPLETE_COURSES.map((c) => (c.key === "electives-all" ? { ...c, hu: 8 } : c)).concat([
    { key: "elective-last", title: "Entrepreneurship", area: "electives", hu: 2, basis: "in_progress" },
  ]),
  actions: [{ kind: "next_task", message: "Entrepreneurship: finish the final project", courseKey: "elective-last", taskKey: null, dueDate: "2026-11-14", owner: "student" }],
  paceStatus: "ahead",
});
export { COMPLETE_COURSES, PARTIAL_COURSES, makeProjection };

export const S19_DOCS = [
  { id: "d1", status: "rejected" }, { id: "d2", status: "resubmit_requested" }, { id: "d3", status: "pending" }, { id: "d4", status: "verified" },
];
export const S19_TICKETS = {
  tickets: [{ id: "t1", status: "waiting_on_student" }, { id: "t2", status: "in_progress" }, { id: "t3", status: "resolved" }],
  pagination: { total: 3, limit: 100, offset: 0 },
};
export const S19_BILLING: StudentBillingView = {
  state: "configured", currency: "USD", agreedCents: 480000, discountCents: 0, netObligationCents: 480000, paidCents: 240000, remainingCents: 240000,
  overpaid: false, creditCents: 0,
  nextDue: { installmentId: "i1", dueDate: "2026-11-15", amountCents: 80000, status: "scheduled" } as never,
  installments: [], receipts: [], evidenceAwaitingReview: [],
};
export const S19_OPS_READY: CockpitOps = {
  documents: { state: "ready", data: { needAction: 2, underReview: 1, total: 4 } },
  support: { state: "ready", data: { open: 2, waitingOnStudent: 1 } },
  payments: { state: "ready", data: { currency: "USD", remainingCents: 240000, nextDue: { dueDate: "2026-11-15", amountCents: 80000 }, overdue: false, evidenceUnderReview: 0 } },
};
