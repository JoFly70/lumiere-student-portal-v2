/**
 * Fixture-side model of the staff queue endpoints (GET /api/tickets filters and
 * GET /api/tickets/stats/summary), using the SAME shared rules as the server
 * (awaitingFor, isOverdue, active/resolved views). The screenshot renderer and the
 * regression tests use it so a stats tile number always equals the list it opens.
 */
import { awaitingFor, isOverdue, type SupportTicketSummary, type TicketStatus } from "../../shared/support-contract";

const ACTIVE: readonly TicketStatus[] = ["open", "in_progress", "waiting_on_student"];

type Row = SupportTicketSummary;

export function withOverdue(tickets: readonly Row[], now: Date): Row[] {
  return tickets.map((t) => ({
    ...t,
    is_overdue: isOverdue({ status: t.status, priority: t.priority, awaitingSince: t.awaiting_since }, now),
  }));
}

export function queryStaffQueue(tickets: readonly Row[], params: URLSearchParams, now: Date, meId: string): Row[] {
  const view = params.get("view");
  const awaiting = params.get("awaiting");
  const assignedTo = params.get("assignedTo");
  const search = (params.get("search") ?? "").toLowerCase();
  return withOverdue(tickets, now).filter((t) => {
    if (view === "active" && !ACTIVE.includes(t.status)) return false;
    if (view === "resolved" && ACTIVE.includes(t.status)) return false;
    if (awaiting && awaitingFor(t.status) !== awaiting) return false;
    if (params.get("overdue") === "true" && !t.is_overdue) return false;
    const assignee = t.assignee?.id ?? t.assigned_to ?? null;
    if (assignedTo === "unassigned" && assignee) return false;
    if (assignedTo === "me" && assignee !== meId) return false;
    if (search && !t.subject.toLowerCase().includes(search)) return false;
    return true;
  });
}

export function staffStats(tickets: readonly Row[], now: Date) {
  const rows = withOverdue(tickets, now);
  const byStatus: Record<TicketStatus, number> = { open: 0, in_progress: 0, waiting_on_student: 0, resolved: 0, closed: 0 };
  let awaitingStaff = 0, awaitingStudent = 0, overdue = 0, unassigned = 0;
  for (const t of rows) {
    byStatus[t.status] += 1;
    const aw = awaitingFor(t.status);
    if (aw === "staff") {
      awaitingStaff += 1;
      if (!(t.assignee?.id ?? t.assigned_to)) unassigned += 1;
      if (t.is_overdue) overdue += 1;
    } else if (aw === "student") awaitingStudent += 1;
  }
  return { stats: { byStatus, byCategory: {}, awaitingStaff, awaitingStudent, overdue, unassigned, avgResolutionHours: 0, resolvedLast30Days: rows.filter((t) => t.status === "resolved").length } };
}
