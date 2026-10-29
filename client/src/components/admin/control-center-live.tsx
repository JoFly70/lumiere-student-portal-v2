/**
 * S26 — live part of the Student Support Control Center: who needs help now, and every
 * authorized student one click from their file, their read-only preview and Owner AI.
 * Reads only existing staff endpoints (/api/students, /api/tickets, /api/tickets/stats/summary).
 */
import React, { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, Eye, FileCheck2, Inbox, MessageSquareWarning, Search, UsersRound } from "lucide-react";
import { isSyntheticAccount } from "@shared/synthetic-accounts";
import { apiRequest } from "@/lib/api";
import { useTickets, useTicketStats, type Ticket } from "@/hooks/use-tickets";
import { staffStatusLabel } from "@shared/support-contract";
import { KpiTile, StaffAvatar, StaffCard, StaffEmpty, StaffPill, StaffSectionHeader, staffField } from "@/components/staff/staff-ui";

interface StudentRow { id: string; first_name: string; last_name: string; preferred_name?: string | null; student_code?: string | null; status: string; user_id?: string | null }

const isDemo = (s: StudentRow) => /^DEMO/i.test(s.preferred_name ?? "") || /^DEMO/i.test(s.first_name);
const isTestStudent = (s: StudentRow) => isSyntheticAccount({ first_name: s.first_name, preferred_name: s.preferred_name, name: `${s.first_name} ${s.last_name}` });

interface QueueDoc { documentId: string; studentId: string; studentName: string; docType: string; uploadedAt: string | null }
const ELECTIVE_PREFIX = "Elective change request:";
const docLabel = (t: string) => { const w = t.replace(/[_-]+/g, " ").trim(); return w.charAt(0).toUpperCase() + w.slice(1); };

export function ControlCenterLive() {
  const [term, setTerm] = useState("");
  const [showTest, setShowTest] = useState(false);
  const q = term.trim();
  const students = useQuery<{ students: StudentRow[]; total: number }>({
    queryKey: ["/api/students", "control-center", q],
    queryFn: () => apiRequest(`/api/students?limit=50${q ? `&search=${encodeURIComponent(q)}` : ""}`),
  });
  const docs = useQuery<{ documents: QueueDoc[] }>({
    queryKey: ["/api/admin/documents/queue"],
    queryFn: () => apiRequest("/api/admin/documents/queue"),
  });
  const electives = useTickets({ view: "active", search: "Elective change", limit: 50 });
  const stats = useTicketStats(true);
  const open = useTickets({ view: "active", awaiting: "staff", limit: 8 });
  const s = stats.data?.stats;
  const allRows = students.data?.students ?? [];
  const testCount = allRows.filter(isTestStudent).length;
  const rows = showTest ? allRows : allRows.filter((st) => !isTestStudent(st));
  const realTotal = students.data ? Math.max(0, students.data.total - testCount) : null;
  const electiveCount = (electives.data?.tickets ?? []).filter((t: Ticket) => t.subject.startsWith(ELECTIVE_PREFIX)).length;
  const queue = docs.data?.documents ?? [];

  return (
    <div className="space-y-4" data-testid="control-center-live">
      <section aria-label="Support at a glance" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Students" value={realTotal !== null ? String(realTotal) : "—"} hint={testCount > 0 && !showTest ? `excl. ${testCount} test` : "authorized for you"} icon={<UsersRound className="h-4 w-4" />} testId="kpi-students" />
        <KpiTile label="Waiting on Lumière" value={s ? String(s.awaitingStaff) : "—"} hint="tickets needing a reply" tone={s && s.awaitingStaff > 0 ? "attention" : "default"} icon={<Inbox className="h-4 w-4" />} testId="kpi-awaiting" />
        <KpiTile label="Overdue" value={s ? String(s.overdue) : "—"} hint="past response target" tone={s && s.overdue > 0 ? "urgent" : "default"} testId="kpi-overdue" />
        <KpiTile label="Unassigned" value={s ? String(s.unassigned) : "—"} hint="open, no owner" testId="kpi-unassigned" />
        <Link href="/support?search=Elective%20change" className="block min-w-0 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink" data-testid="kpi-elective-link">
          <KpiTile label="Elective change requests" value={electives.data ? String(electiveCount) : "—"} hint="open the tickets" tone={electiveCount > 0 ? "attention" : "default"} icon={<MessageSquareWarning className="h-4 w-4" />} testId="kpi-elective" />
        </Link>
        <a href="#cc-documents" className="block min-w-0 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink" data-testid="kpi-documents-link">
          <KpiTile label="Documents awaiting review" value={docs.data ? String(queue.length) : "—"} hint="pending or resubmit" tone={queue.length > 0 ? "attention" : "default"} icon={<FileCheck2 className="h-4 w-4" />} testId="kpi-documents" />
        </a>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <StaffCard aria-labelledby="cc-students-heading">
          <StaffSectionHeader id="cc-students-heading" title="Students" description="Open a complete student file, the read-only student view, or Owner AI." icon={<UsersRound className="h-5 w-5" />} />
          <label htmlFor="cc-student-search" className="sr-only">Search students</label>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-student-muted" aria-hidden="true" />
            <input id="cc-student-search" className={`${staffField} pl-8`} placeholder="Search by name, email or student code" value={term} onChange={(e) => setTerm(e.target.value)} data-testid="cc-student-search" />
          </div>
          <div className="mt-2">
            {testCount > 0 || showTest ? (
              <label htmlFor="cc-show-test" className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-student-ink">
                <input id="cc-show-test" type="checkbox" className="h-4 w-4 accent-[hsl(var(--s-ink))]" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} data-testid="cc-show-test" />
                Show test students ({testCount})
              </label>
            ) : null}
          </div>
          {students.isError ? <p role="alert" className="mt-3 text-sm text-st-urgent">Students could not be loaded.</p> : null}
          {rows.length === 0 && students.data ? (
            <StaffEmpty title={q ? "No student matches" : "No students yet"} className="mt-4">{q ? "Try another name or code." : "Students appear here once their file is created."}</StaffEmpty>
          ) : (
            <ul className="mt-3 divide-y divide-student-line" data-testid="cc-student-list">
              {rows.map((st) => {
                const name = `${st.preferred_name && !isDemo(st) ? st.preferred_name : st.first_name} ${st.last_name}`;
                const file = `/admin/students/${encodeURIComponent(st.id)}`;
                return (
                  <li key={st.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <Link href={file} className="flex min-w-0 max-w-full flex-1 items-center gap-3" data-testid="cc-student-open">
                      <StaffAvatar name={name} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block min-w-0 truncate font-medium text-student-ink" title={name}>{name}</span>
                        <span className="block truncate text-xs text-student-muted">{st.student_code ?? "No code"} · {st.status}{st.user_id ? " · portal login linked" : ""}</span>
                      </span>
                    </Link>
                    <span className="flex flex-wrap items-center gap-2">
                      {isDemo(st) ? <StaffPill tone="attention">DEMO · not a real student</StaffPill> : isTestStudent(st) ? <StaffPill tone="attention">Test account</StaffPill> : null}
                      <Link href={`${file}/view-as-student`} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-student-line px-2 text-xs font-medium text-student-ink hover:bg-student-gold-soft" aria-label={`View as student: ${name}`}><Eye className="h-3.5 w-3.5" aria-hidden="true" />View as student</Link>
                      <Link href={`/admin/assistant?studentId=${encodeURIComponent(st.id)}`} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-student-line px-2 text-xs font-medium text-student-ink hover:bg-student-gold-soft" aria-label={`Ask Owner AI about ${name}`}><BrainCircuit className="h-3.5 w-3.5" aria-hidden="true" />AI</Link>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </StaffCard>

        <StaffCard aria-labelledby="cc-cases-heading">
          <StaffSectionHeader id="cc-cases-heading" title="Open cases waiting on Lumière" description="Reply, add a private note, assign or resolve from the ticket." icon={<Inbox className="h-5 w-5" />} />
          {(open.data?.tickets ?? []).length === 0 && open.data ? (
            <StaffEmpty title="Nothing is waiting" className="mt-4">Every open ticket is with the student or resolved.</StaffEmpty>
          ) : (
            <ul className="mt-3 divide-y divide-student-line" data-testid="cc-open-cases">
              {(open.data?.tickets ?? []).map((t: Ticket) => {
                const sid = (t as Ticket & { student_id?: string | null }).student_id;
                const href = `/support?${sid ? `studentId=${encodeURIComponent(sid)}&` : ""}ticket=${encodeURIComponent(t.id)}`;
                return (
                  <li key={t.id} className="py-3">
                    <Link href={href} className="block rounded-md hover:bg-student-gold-soft/50" data-testid="cc-open-case">
                      <span className="block min-w-0 truncate font-medium text-student-ink" title={t.subject}>{t.subject}</span>
                      <span className="mt-0.5 block text-xs text-student-muted">{t.ticket_number} · {staffStatusLabel(t.status)} · {t.priority}</span>
                    </Link>
                    {sid ? <Link href={`/admin/students/${encodeURIComponent(sid)}`} className="text-xs font-semibold text-student-gold-ink underline-offset-4 hover:underline">Student file</Link> : null}
                  </li>
                );
              })}
            </ul>
          )}
          <Link href="/support" className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-student-gold-ink underline-offset-4 hover:underline">All tickets in the support desk</Link>
        </StaffCard>
      </div>

      <StaffCard id="cc-documents" aria-labelledby="cc-docs-heading">
        <StaffSectionHeader id="cc-docs-heading" title="Documents awaiting review" description="Pending or resubmission-requested uploads, newest first." icon={<FileCheck2 className="h-5 w-5" />} />
        {docs.isError ? <p role="alert" className="mt-3 text-sm text-st-urgent">The document queue could not be loaded.</p> : null}
        {queue.length === 0 && docs.data ? (
          <StaffEmpty title="No documents waiting" className="mt-4">Every uploaded document has been reviewed.</StaffEmpty>
        ) : (
          <ul className="mt-3 divide-y divide-student-line" data-testid="cc-doc-queue">
            {queue.map((d) => (
              <li key={d.documentId}>
                <Link href={`/admin/students/${encodeURIComponent(d.studentId)}#documents`} className="flex min-w-0 items-center justify-between gap-3 py-3 hover:bg-student-gold-soft/50" data-testid="cc-doc-open">
                  <span className="min-w-0">
                    <span className="block min-w-0 truncate font-medium text-student-ink" title={d.studentName}>{d.studentName || "Student"}</span>
                    <span className="block truncate text-xs text-student-muted">{docLabel(d.docType)}{d.uploadedAt ? ` · uploaded ${new Date(d.uploadedAt).toLocaleDateString()}` : ""}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-student-gold-ink">Review</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </StaffCard>
    </div>
  );
}
