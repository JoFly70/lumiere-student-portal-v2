/**
 * Elective change requests (admin): the queue of student requests to swap an elective, with an
 * auditable stage workflow stored as internal notes on the support ticket (no database change).
 */
import React from "react";
import { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Shuffle } from "lucide-react";
import { StaffEmpty, StaffNotice, StaffPage, StaffPageHeader, StaffAvatar, staffBtn, staffTable } from "@/components/staff/staff-ui";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api";
import { useTickets, type Ticket } from "@/hooks/use-tickets";
import { ELECTIVE_SUBJECT_PREFIX } from "@/lib/elective-change";
import { STAGE_LABEL, ageLabel, deriveStage, isClosedStage, parseElectiveRequest, type ElectiveStage } from "@/lib/elective-stage";
import { ElectiveDetail } from "@/components/admin/elective/elective-detail";
import { StagePill } from "@/components/admin/elective/stage-pill";

void React;

type Filter = "open" | "requested" | "lumiere_review" | "school_pending" | "approved" | "closed" | "all";
const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: "open", label: "All open" },
  { key: "requested", label: STAGE_LABEL.requested },
  { key: "lumiere_review", label: STAGE_LABEL.lumiere_review },
  { key: "school_pending", label: STAGE_LABEL.school_pending },
  { key: "approved", label: "Approved, to apply" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];
const matches = (f: Filter, s: ElectiveStage) => f === "all" || (f === "open" ? !isClosedStage(s) : f === "closed" ? isClosedStage(s) : f === s);

interface Row { ticket: Ticket; stage: ElectiveStage | null; from: string; to: string }

export default function AdminElectiveRequests() {
  const qc = useQueryClient();
  const search = useSearch();
  const [, navigate] = useLocation();
  const selectedId = new URLSearchParams(search).get("ticket");
  const [filter, setFilter] = useState<Filter>("open");
  const list = useTickets({ search: "Elective change", limit: 100 });
  const tickets = useMemo(() => (list.data?.tickets ?? []).filter((t) => t.subject.startsWith(ELECTIVE_SUBJECT_PREFIX)), [list.data]);
  // The stage lives in the ticket's internal notes, which only the detail endpoint returns.
  const details = useQueries({
    queries: tickets.map((t) => ({ queryKey: ["ticket", t.id], queryFn: () => apiRequest<{ ticket: Ticket }>(`/api/tickets/${t.id}`), staleTime: 15_000 })),
  });
  const rows: Row[] = tickets.map((t, i) => {
    const d = details[i]?.data?.ticket;
    const f = parseElectiveRequest(t.subject, t.description);
    return { ticket: t, stage: d ? deriveStage(d.ticket_comments ?? []) : null, from: f.courseTitle, to: f.alternate };
  });
  const loadingStages = details.some((d) => d.isLoading);
  const counts = (f: Filter) => rows.filter((r) => r.stage && matches(f, r.stage)).length;
  const shown = rows.filter((r) => r.stage === null || matches(filter, r.stage));
  const select = (id: string | null) => navigate(id ? `/admin/elective-requests?ticket=${encodeURIComponent(id)}` : "/admin/elective-requests", { replace: true });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["tickets"] }); void qc.invalidateQueries({ queryKey: ["ticket"] }); };

  return (
    <StaffPage width="wide" testId="admin-elective-requests">
      <StaffPageHeader
        back={<Link href="/admin/support-center" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Control Center</Link>}
        eyebrow="Lumière · Admin"
        title="Elective change requests"
        description="Students ask to swap an elective. Move each request through Lumière review and school approval, tell the student, then apply it to the roadmap as a new version."
      />

      <nav aria-label="Filter requests" className="flex flex-wrap gap-2" data-testid="elective-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink ${filter === f.key ? "border-student-gold-ink bg-student-gold-soft text-student-ink" : "border-student-line-strong bg-student-card text-student-muted hover:bg-student-gold-soft/50"}`}
          >
            {f.label}
            {!loadingStages ? <span className="rounded-full bg-student-seal px-1.5 py-0.5 text-[11px] font-semibold leading-none text-student-seal-ink">{counts(f.key)}</span> : null}
          </button>
        ))}
      </nav>

      {list.isError ? <StaffNotice tone="urgent" role="alert" action={<Button type="button" variant="outline" className={staffBtn.outline} onClick={() => void list.refetch()}>Retry</Button>}>Requests could not be loaded.</StaffNotice> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:items-start">
        <section aria-label="Request queue" className="min-w-0">
          {list.isLoading ? <div role="status" className="h-40 animate-pulse rounded-2xl bg-student-gold-soft/40"><span className="sr-only">Loading requests</span></div>
            : shown.length === 0 ? (
              <StaffEmpty icon={<Shuffle className="h-6 w-6" />} title={tickets.length === 0 ? "No elective change requests yet" : "Nothing in this view"} testId="elective-empty">
                {tickets.length === 0 ? "When a student asks to change an elective from their High School pathway, it appears here." : "Try another filter to see the rest of the queue."}
              </StaffEmpty>
            ) : (
              <>
                <div className={`${staffTable.frame} hidden overflow-x-auto md:block`}>
                  <table className={staffTable.table} data-testid="elective-queue">
                    <thead><tr><th className={staffTable.th}>Student</th><th className={staffTable.th}>Change</th><th className={staffTable.th}>Stage</th><th className={staffTable.th}>Age</th></tr></thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.ticket.id} className={`${staffTable.tr} ${selectedId === r.ticket.id ? "bg-student-gold-soft/60" : ""}`}>
                          <td className={staffTable.td}>
                            <button type="button" onClick={() => select(r.ticket.id)} aria-current={selectedId === r.ticket.id} className="flex min-w-0 items-start gap-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink" data-testid="elective-row">
                              <StaffAvatar name={r.ticket.reporter_name} size="sm" />
                              <span className="min-w-0"><span className="block break-words font-medium text-student-ink">{r.ticket.reporter_name}</span><span className="block text-xs text-student-muted">{r.ticket.assignee?.name ?? "Unassigned"}</span></span>
                            </button>
                          </td>
                          <td className={`${staffTable.td} min-w-[11rem]`}><span className="block break-words">{r.from || "Course"}</span><span className="block break-words text-student-muted">→ {r.to || "Requested course"}</span></td>
                          <td className={staffTable.td}>{r.stage ? <StagePill stage={r.stage} /> : <span className="text-xs text-student-muted">Loading…</span>}</td>
                          <td className={`${staffTable.td} whitespace-nowrap tabular-nums`}>{ageLabel(r.ticket.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="space-y-3 md:hidden" data-testid="elective-queue-cards">
                  {shown.map((r) => (
                    <li key={r.ticket.id}>
                      <button type="button" onClick={() => select(r.ticket.id)} aria-current={selectedId === r.ticket.id} className={`w-full min-w-0 space-y-2 rounded-2xl border p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink ${selectedId === r.ticket.id ? "border-student-gold-ink bg-student-gold-soft/60" : "border-student-line bg-student-card"}`}>
                        <span className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-student-ink">{r.ticket.reporter_name}</span>{r.stage ? <StagePill stage={r.stage} /> : null}</span>
                        <span className="block break-words text-sm text-student-ink">{r.from || "Course"} <span className="text-student-muted">→ {r.to || "Requested course"}</span></span>
                        <span className="block text-xs text-student-muted">{ageLabel(r.ticket.created_at)} · {r.ticket.assignee?.name ?? "Unassigned"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
        </section>

        <section aria-label="Request detail" className="min-w-0">
          {selectedId ? <ElectiveDetail ticketId={selectedId} onChanged={refresh} />
            : shown.length > 0 ? <StaffEmpty title="Select a request" testId="elective-select-hint">Choose a request to see its history and decide.</StaffEmpty> : null}
        </section>
      </div>
    </StaffPage>
  );
}
