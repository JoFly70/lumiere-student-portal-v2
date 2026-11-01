/**
 * Elective change requests (admin): the queue of student requests to swap an elective, with an
 * auditable stage workflow stored as internal notes on the support ticket (no database change).
 */
import React from "react";
import { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Shuffle } from "lucide-react";
import { StaffEmpty, StaffNotice, StaffPage, StaffPageHeader, StaffAvatar, staffBtn, staffTable } from "@/components/staff/staff-ui";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api";
import { type Ticket, type TicketComment } from "@/hooks/use-tickets";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n/en";
import { ageLabel, deriveStage, isClosedStage, parseElectiveRequest, type ElectiveStage } from "@/lib/elective-stage";
import { ElectiveDetail } from "@/components/admin/elective/elective-detail";
import { StagePill } from "@/components/admin/elective/stage-pill";

void React;

type Filter = "open" | "requested" | "lumiere_review" | "school_pending" | "approved" | "closed" | "all";
const K = (key: string) => key as TranslationKey;
const FILTERS: readonly { key: Filter; labelKey: string }[] = [
  { key: "open", labelKey: "s32sup.el.filter.open" },
  { key: "requested", labelKey: "s32sup.stage.requested" },
  { key: "lumiere_review", labelKey: "s32sup.stage.lumiere_review" },
  { key: "school_pending", labelKey: "s32sup.stage.school_pending" },
  { key: "approved", labelKey: "s32sup.el.filter.approved" },
  { key: "closed", labelKey: "s32sup.el.filter.closed" },
  { key: "all", labelKey: "s32sup.el.filter.all" },
];

/** One row of GET /api/tickets/elective-requests: the ticket summary plus its internal stage notes. */
type ElectiveListItem = Ticket & { stage_notes: TicketComment[] };
const matches = (f: Filter, s: ElectiveStage) => f === "all" || (f === "open" ? !isClosedStage(s) : f === "closed" ? isClosedStage(s) : f === s);

interface Row { ticket: Ticket; stage: ElectiveStage | null; from: string; to: string }

export default function AdminElectiveRequests() {
  const qc = useQueryClient();
  const search = useSearch();
  const [, navigate] = useLocation();
  const selectedId = new URLSearchParams(search).get("ticket");
  const [filter, setFilter] = useState<Filter>("open");
  const { t } = useT();
  // S32-B: ONE request (was one per ticket). The stage lives in the ticket's internal notes, which the endpoint returns.
  const list = useQuery({
    queryKey: ["elective-requests"],
    queryFn: () => apiRequest<{ requests: ElectiveListItem[] }>("/api/tickets/elective-requests"),
    staleTime: 15_000,
  });
  const tickets = useMemo(() => list.data?.requests ?? [], [list.data]);
  const rows: Row[] = tickets.map((tk) => {
    const f = parseElectiveRequest(tk.subject, tk.description);
    return { ticket: tk, stage: deriveStage(tk.stage_notes ?? []), from: f.courseTitle, to: f.alternate };
  });
  const loadingStages = list.isLoading;
  const ago = (iso: string) => { const a = ageLabel(iso); return a === "just now" ? t(K("s32sup.el.justNow")) : a; };
  const counts = (f: Filter) => rows.filter((r) => r.stage && matches(f, r.stage)).length;
  const shown = rows.filter((r) => r.stage === null || matches(filter, r.stage));
  const select = (id: string | null) => navigate(id ? `/admin/elective-requests?ticket=${encodeURIComponent(id)}` : "/admin/elective-requests", { replace: true });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["elective-requests"] }); void qc.invalidateQueries({ queryKey: ["tickets"] }); void qc.invalidateQueries({ queryKey: ["ticket"] }); };

  return (
    <StaffPage width="wide" testId="admin-elective-requests">
      <StaffPageHeader
        back={<Link href="/admin/support-center" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t(K("s32sup.el.back"))}</Link>}
        eyebrow={t(K("s32sup.el.eyebrow"))}
        title={t(K("s32sup.el.title"))}
        description={t(K("s32sup.el.desc"))}
      />

      <nav aria-label={t(K("s32sup.el.filterAria"))} className="flex flex-wrap gap-2" data-testid="elective-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink ${filter === f.key ? "border-student-gold-ink bg-student-gold-soft text-student-ink" : "border-student-line-strong bg-student-card text-student-muted hover:bg-student-gold-soft/50"}`}
          >
            {t(K(f.labelKey))}
            {!loadingStages ? <span className="rounded-full bg-student-seal px-1.5 py-0.5 text-[11px] font-semibold leading-none text-student-seal-ink">{counts(f.key)}</span> : null}
          </button>
        ))}
      </nav>

      {list.isError ? <StaffNotice tone="urgent" role="alert" action={<Button type="button" variant="outline" className={staffBtn.outline} onClick={() => void list.refetch()}>{t(K("s32sup.el.retry"))}</Button>}>{t(K("s32sup.el.loadFailed"))}</StaffNotice> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:items-start">
        <section aria-label={t(K("s32sup.el.queueAria"))} className="min-w-0">
          {list.isLoading ? <div role="status" className="h-40 animate-pulse rounded-2xl bg-student-gold-soft/40"><span className="sr-only">{t(K("s32sup.el.loading"))}</span></div>
            : shown.length === 0 ? (
              <StaffEmpty icon={<Shuffle className="h-6 w-6" />} title={tickets.length === 0 ? t(K("s32sup.el.emptyNone")) : t(K("s32sup.el.emptyView"))} testId="elective-empty">
                {tickets.length === 0 ? t(K("s32sup.el.emptyNoneBody")) : t(K("s32sup.el.emptyViewBody"))}
              </StaffEmpty>
            ) : (
              <>
                <div className={`${staffTable.frame} hidden overflow-x-auto md:block`}>
                  <table className={staffTable.table} data-testid="elective-queue">
                    <thead><tr><th className={staffTable.th}>{t(K("s32sup.el.colStudent"))}</th><th className={staffTable.th}>{t(K("s32sup.el.colChange"))}</th><th className={staffTable.th}>{t(K("s32sup.el.colStage"))}</th></tr></thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.ticket.id} className={`${staffTable.tr} ${selectedId === r.ticket.id ? "bg-student-gold-soft/60" : ""}`}>
                          <td className={`${staffTable.td} min-w-[15rem]`}>
                            <button type="button" onClick={() => select(r.ticket.id)} aria-current={selectedId === r.ticket.id} className="flex min-w-0 items-start gap-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink" data-testid="elective-row">
                              <StaffAvatar name={r.ticket.reporter_name} size="sm" />
                              <span className="min-w-0"><span className="block font-medium text-student-ink" title={r.ticket.reporter_name}>{r.ticket.reporter_name}</span><span className="block text-xs text-student-muted">{r.ticket.assignee?.name ?? t(K("s32sup.el.unassigned"))}</span></span>
                            </button>
                          </td>
                          <td className={`${staffTable.td} min-w-[11rem]`}><span className="block break-words">{r.from || t(K("s32sup.el.course"))}</span><span className="block break-words text-student-muted">→ {r.to || t(K("s32sup.el.requestedCourse"))}</span></td>
                          <td className={staffTable.td}>{r.stage ? <StagePill stage={r.stage} /> : <span className="text-xs text-student-muted">{t(K("s32sup.el.stageLoading"))}</span>}<span className="mt-1 block text-xs tabular-nums text-student-muted">{ago(r.ticket.created_at)}</span></td>
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
                        <span className="block break-words text-sm text-student-ink">{r.from || t(K("s32sup.el.course"))} <span className="text-student-muted">→ {r.to || t(K("s32sup.el.requestedCourse"))}</span></span>
                        <span className="block text-xs text-student-muted">{ago(r.ticket.created_at)} · {r.ticket.assignee?.name ?? t(K("s32sup.el.unassigned"))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
        </section>

        <section aria-label={t(K("s32sup.el.detailAria"))} className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
          {selectedId ? <ElectiveDetail ticketId={selectedId} onChanged={refresh} />
            : shown.length > 0 ? <StaffEmpty title={t(K("s32sup.el.selectTitle"))} testId="elective-select-hint">{t(K("s32sup.el.selectBody"))}</StaffEmpty> : null}
        </section>
      </div>
    </StaffPage>
  );
}
