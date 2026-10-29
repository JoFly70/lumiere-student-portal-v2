/**
 * Owner Control Center body. Greeting + date, "Needs your attention now", a KPI row of REAL numbers (demo/test
 * students are excluded and revealed only by the "Show demo students" toggle), a students preview and recent
 * activity. Every number is a link to the filtered records. Reads only existing staff endpoints plus the two
 * read-only aggregates (/api/admin/documents/queue, /api/admin/directory/students).
 */
import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, CalendarDays, ChevronRight, CircleDollarSign, FileCheck2, GraduationCap, Inbox, MessageSquareWarning, PartyPopper, Plus, Receipt, Search, UserRoundCheck, UsersRound, Wallet,
} from "lucide-react";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTickets, useTicketStats, type Ticket } from "@/hooks/use-tickets";
import { staffStatusLabel } from "@shared/support-contract";
import { StaffCard, StaffEmpty, StaffPill, StaffSectionHeader, KpiTile, staffBtn, staffField } from "@/components/staff/staff-ui";
import {
  DemoPill, StudentPhoto, StudentStatusPill, factsById, formatMoney, isDemoStudent, isDemoTicket, studentIdByUserId, relativeTime, sentence, shortProgram, studentFullName,
  useDirectoryFacts, useDirectoryStudents, type DirectoryStudent,
} from "@/components/admin/directory/directory-data";
import { adminStudentWorkspacePath } from "@/pages/admin-student-workspace-presentation";
import { cn } from "@/lib/utils";

interface QueueDoc { documentId: string; studentId: string; studentName: string; docType: string; uploadedAt: string | null }
interface Analytics {
  studentsByStatus?: Record<string, number>;
  hsEnrollments?: { active: number; pending: number };
  totalRevenue?: number;
  testAccounts?: { users: number; students: number };
}
interface AuditEntry { id: string; event_type: string; severity: string; action_description: string; created_at: string }

const ELECTIVE_PREFIX = "Elective change request:";
const docLabel = (t: string) => sentence(t);

export function greeting(now: Date, name?: string): string {
  const h = now.getHours();
  const part = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

function AttentionRow({ href, icon, label, hint, count, tone = "attention", testId }: { href: string; icon: React.ReactNode; label: string; hint: string; count: number; tone?: "attention" | "urgent"; testId?: string }) {
  return (
    <li>
      <Link href={href} data-testid={testId} className="group flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-student-gold-soft/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-student-gold-ink">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-student-gold-soft text-student-gold-ink" aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-student-ink">{label}</span>
          <span className="block truncate text-xs text-student-muted">{hint}</span>
        </span>
        <StaffPill tone={tone} className="tabular-nums">{count}</StaffPill>
        <ChevronRight className="h-4 w-4 shrink-0 text-student-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </li>
  );
}

export function ControlCenterLive() {
  const { user } = useAuth();
  const [term, setTerm] = useState("");
  const [showDemo, setShowDemo] = useState(false);
  const now = new Date();

  const analytics = useQuery<{ analytics: Analytics }>({ queryKey: ["/api/admin/analytics/dashboard"], queryFn: () => apiRequest("/api/admin/analytics/dashboard") });
  const students = useDirectoryStudents();
  const facts = useDirectoryFacts();
  const docs = useQuery<{ documents: QueueDoc[] }>({ queryKey: ["/api/admin/documents/queue"], queryFn: () => apiRequest("/api/admin/documents/queue") });
  const stats = useTicketStats(true);
  const awaiting = useTickets({ view: "active", awaiting: "staff", limit: 50 });
  const electives = useTickets({ view: "active", search: "Elective change", limit: 50 });
  const audit = useQuery<{ logs: AuditEntry[] }>({ queryKey: ["/api/admin/audit-logs", { limit: 10 }], queryFn: () => apiRequest("/api/admin/audit-logs?limit=10") });

  const a = analytics.data?.analytics;
  const all = students.data?.students ?? [];
  const byId = useMemo(() => factsById(facts.data?.facts), [facts.data]);
  const demoIds = useMemo(() => new Set(all.filter(isDemoStudent).map((s) => s.id)), [all]);
  const demoUserIds = useMemo(() => new Set(all.filter((s) => isDemoStudent(s) && s.user_id).map((s) => s.user_id as string)), [all]);
  const studentOfUser = useMemo(() => studentIdByUserId(all), [all]);
  const real = all.filter((s) => !demoIds.has(s.id));
  const demoCount = demoIds.size;

  // Operational numbers: demo/test students never count.
  const queue = (docs.data?.documents ?? []).filter((d) => !demoIds.has(d.studentId));
  const ticketList = (awaiting.data?.tickets ?? []).filter((t) => !isDemoTicket(t, demoUserIds));
  const electiveCount = (electives.data?.tickets ?? []).filter((t) => t.subject.startsWith(ELECTIVE_PREFIX) && !isDemoTicket(t, demoUserIds)).length;
  const overdue = real.filter((s) => byId.get(s.id)?.billing?.overdue);
  const lead = real.filter((s) => s.status === "lead");
  const realCount = a?.studentsByStatus ? Object.values(a.studentsByStatus).reduce((x, y) => x + y, 0) : real.length;
  const hs = a?.hsEnrollments;
  const received = a?.totalRevenue;
  const currency = Array.from(byId.values()).find((f) => f.billing)?.billing?.currency ?? "USD";

  const needle = term.trim().toLowerCase();
  const preview = (showDemo ? all : real)
    .filter((s) => !needle || `${s.first_name} ${s.last_name} ${s.preferred_name ?? ""} ${s.email ?? ""} ${s.student_code ?? ""}`.toLowerCase().includes(needle))
    .slice(0, 6);

  const attention = [
    { key: "tickets", href: "/support", icon: <Inbox className="h-4 w-4" />, label: "Tickets waiting for your reply", hint: stats.data?.stats.overdue ? `${stats.data.stats.overdue} past the response target` : "Reply, assign or add a private note", count: ticketList.length, tone: (stats.data?.stats.overdue ?? 0) > 0 ? ("urgent" as const) : ("attention" as const) },
    { key: "docs", href: "/admin/students?view=docs", icon: <FileCheck2 className="h-4 w-4" />, label: "Documents to review", hint: queue[0] ? `Oldest waiting: ${queue[queue.length - 1]?.studentName || "student"} · ${docLabel(queue[queue.length - 1]?.docType ?? "document")}` : "", count: queue.length, tone: "attention" as const },
    { key: "electives", href: "/admin/elective-requests", icon: <MessageSquareWarning className="h-4 w-4" />, label: "Elective change requests", hint: "Review, then record the school's decision", count: electiveCount, tone: "attention" as const },
    { key: "overdue", href: "/admin/students?view=overdue", icon: <CircleDollarSign className="h-4 w-4" />, label: "Installments past due", hint: overdue.slice(0, 2).map((s) => studentFullName(s)).join(", ") + (overdue.length > 2 ? "…" : ""), count: overdue.length, tone: "urgent" as const },
    { key: "lead", href: "/admin/students?status=lead", icon: <UserRoundCheck className="h-4 w-4" />, label: "Pre-enrollment students", hint: "Open the file to see the gates still pending", count: lead.length, tone: "attention" as const },
  ];
  const pending = attention.filter((r) => r.count > 0);
  const loadingAttention = awaiting.isLoading || docs.isLoading || students.isLoading;

  const logs = audit.data?.logs ?? [];

  return (
    <div className="space-y-5" data-testid="control-center-live">
      <header className="flex flex-col gap-3 border-b border-student-line pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-student-gold-ink"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
          <h1 className="mt-1 font-serif text-3xl leading-tight tracking-tight text-student-ink sm:text-4xl" data-testid="text-page-title">{greeting(now, user?.name)}</h1>
          <p className="mt-1 text-sm text-student-muted">{loadingAttention ? "Checking what needs you…" : pending.length ? `${pending.reduce((n, r) => n + r.count, 0)} items need you today.` : "You are all caught up."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/support" className={cn(staffBtn.outline, "inline-flex items-center justify-center border")}><Inbox className="h-4 w-4" aria-hidden="true" />Support desk</Link>
          <Link href="/admin/students" className={cn(staffBtn.primary, "inline-flex items-center justify-center")}><GraduationCap className="h-4 w-4" aria-hidden="true" />All students</Link>
        </div>
      </header>

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="kpi-row">
        <Link href="/admin/students" className="block h-full min-w-0 rounded-2xl [&>*]:h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink" data-testid="kpi-students-link">
          <KpiTile label="Students" value={students.data || a ? realCount : "—"} hint={demoCount && !showDemo ? `real · ${demoCount} demo hidden` : "real students"} icon={<UsersRound className="h-4 w-4" />} testId="kpi-students" />
        </Link>
        <Link href="/admin/students?status=active&program=any" className="block h-full min-w-0 rounded-2xl [&>*]:h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink" data-testid="kpi-hs-link">
          <KpiTile label="High school" value={hs ? hs.active : "—"} hint={hs ? `active · ${hs.pending} pending` : "active enrollments"} icon={<GraduationCap className="h-4 w-4" />} testId="kpi-hs" />
        </Link>
        <Link href="/support" className="block h-full min-w-0 rounded-2xl [&>*]:h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink" data-testid="kpi-awaiting-link">
          <KpiTile label="Open tickets" value={awaiting.data ? ticketList.length : "—"} hint={stats.data ? `${stats.data.stats.awaitingStudent} waiting on students` : "waiting on Lumière"} tone={ticketList.length > 0 ? "attention" : "default"} icon={<Inbox className="h-4 w-4" />} testId="kpi-awaiting" />
        </Link>
        <Link href="/admin/students?view=docs" className="block h-full min-w-0 rounded-2xl [&>*]:h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink" data-testid="kpi-documents-link">
          <KpiTile label="Documents to review" value={docs.data ? queue.length : "—"} hint="pending or resubmitted" tone={queue.length > 0 ? "attention" : "default"} icon={<FileCheck2 className="h-4 w-4" />} testId="kpi-documents" />
        </Link>
        <Link href="/staff/billing" className="col-span-2 block h-full min-w-0 rounded-2xl [&>*]:h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink md:col-span-1" data-testid="kpi-payments-link">
          <KpiTile label="Received, 30 days" value={received !== undefined ? formatMoney(received, currency) : "—"} hint="confirmed receipts" icon={<Wallet className="h-4 w-4" />} testId="kpi-payments" />
        </Link>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <StaffCard padded={false} aria-labelledby="cc-attention-heading" data-testid="needs-attention-now">
            <div className="px-4 pt-4 sm:px-5 sm:pt-5"><StaffSectionHeader id="cc-attention-heading" title="Needs your attention now" description="Real students only. Each line opens the records behind the number." className="mb-3" /></div>
            {loadingAttention ? <div className="space-y-2 px-4 pb-4" role="status" aria-label="Loading"><div className="h-12 animate-pulse rounded-lg bg-student-line/60" /><div className="h-12 animate-pulse rounded-lg bg-student-line/60" /></div>
              : pending.length === 0 ? <div className="px-4 pb-5 sm:px-5"><StaffEmpty icon={<PartyPopper className="h-6 w-6" />} title="Nothing is waiting on you">No tickets to answer, documents to review or payments overdue. <Link href="/admin/students" className="font-semibold text-student-gold-ink underline-offset-4 hover:underline">Browse students</Link> to plan ahead.</StaffEmpty></div>
              : <ul className="divide-y divide-student-line border-t border-student-line" data-testid="attention-list">{pending.map((r) => <AttentionRow key={r.key} href={r.href} icon={r.icon} label={r.label} hint={r.hint} count={r.count} tone={r.tone} testId={`attention-${r.key}`} />)}</ul>}
          </StaffCard>

          <StaffCard aria-labelledby="cc-students-heading" data-testid="cc-students">
            <StaffSectionHeader id="cc-students-heading" title="Students" description="Open a file to manage the student in one place." icon={<UsersRound className="h-5 w-5" />}
              actions={<Link href={`/admin/students${showDemo ? "?demo=1" : ""}`} className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-student-gold-ink underline-offset-4 hover:underline" data-testid="link-all-students">View all<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>} />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative sm:max-w-xs sm:flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-3 h-4 w-4 text-student-muted" aria-hidden="true" />
                <label htmlFor="cc-student-search" className="sr-only">Search students</label>
                <input id="cc-student-search" className={cn(staffField, "pl-8")} placeholder="Search name or code" value={term} onChange={(e) => setTerm(e.target.value)} data-testid="cc-student-search" />
              </div>
              <label htmlFor="cc-show-demo" className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-student-ink">
                <input id="cc-show-demo" type="checkbox" className="h-4 w-4 accent-[hsl(var(--s-ink))]" checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} data-testid="cc-show-demo" />
                Show demo students{demoCount ? ` (${demoCount})` : ""}
              </label>
            </div>
            {students.isError ? <p role="alert" className="mt-3 text-sm text-st-urgent">Students could not be loaded.</p> : null}
            {students.data && preview.length === 0 ? <StaffEmpty className="mt-3" title={needle ? "No student matches" : "No students yet"}>{needle ? "Try another name or code." : "Students appear here once their file is created."}</StaffEmpty> : (
              <ul className="mt-2 divide-y divide-student-line" data-testid="cc-student-list">
                {preview.map((st) => <PreviewRow key={st.id} st={st} program={byId.get(st.id)?.program?.title} last={byId.get(st.id)?.lastActivityAt ?? null} />)}
              </ul>
            )}
          </StaffCard>
        </div>

        <div className="min-w-0 space-y-5">
          <StaffCard aria-labelledby="cc-cases-heading" data-testid="cc-cases">
            <StaffSectionHeader id="cc-cases-heading" title="Waiting on Lumière" description="Newest tickets with no staff reply yet." icon={<Inbox className="h-5 w-5" />} />
            {ticketList.length === 0 && awaiting.data ? <StaffEmpty title="Nothing is waiting">Every open ticket is with the student or resolved.</StaffEmpty> : (
              <ul className="divide-y divide-student-line" data-testid="cc-open-cases">
                {ticketList.slice(0, 5).map((t: Ticket) => {
                  const sid = studentOfUser.get(t.reporter_id);
                  const href = `/support?${sid ? `studentId=${encodeURIComponent(sid)}&` : ""}ticket=${encodeURIComponent(t.id)}`;
                  return <li key={t.id}><Link href={href} className="block rounded-md px-1 py-2.5 hover:bg-student-gold-soft/50" data-testid="cc-open-case">
                    <span className="block min-w-0 truncate text-sm font-medium text-student-ink" title={t.subject}>{t.subject}</span>
                    <span className="mt-0.5 block truncate text-xs text-student-muted">{t.ticket_number} · {staffStatusLabel(t.status)} · {sentence(t.priority)}</span>
                  </Link></li>;
                })}
              </ul>
            )}
            <Link href="/support" className="mt-2 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-student-gold-ink underline-offset-4 hover:underline">Open the support desk<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>
          </StaffCard>

          <StaffCard aria-labelledby="cc-activity-heading" data-testid="cc-activity">
            <StaffSectionHeader id="cc-activity-heading" title="Recent activity" description="The latest audited actions across the portal." icon={<Activity className="h-5 w-5" />} />
            {audit.isError ? <p role="alert" className="text-sm text-st-urgent">Recent activity could not be loaded.</p> : null}
            {audit.data && logs.length === 0 ? <StaffEmpty title="No activity yet">Actions appear here as soon as someone works in the portal.</StaffEmpty> : (
              <ul className="space-y-3" data-testid="cc-activity-list">
                {logs.map((l) => <li key={l.id} className="flex gap-3">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", l.severity === "critical" || l.severity === "error" ? "bg-st-urgent" : l.severity === "warning" ? "bg-st-attention" : "bg-student-gold-ink")} aria-hidden="true" />
                  <span className="min-w-0"><span className="block text-sm leading-snug text-student-ink">{l.action_description || sentence(l.event_type)}</span><span className="block text-xs text-student-muted">{relativeTime(l.created_at)}</span></span>
                </li>)}
              </ul>
            )}
            <Link href="/admin?tab=logs" className="mt-3 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-student-gold-ink underline-offset-4 hover:underline"><Receipt className="h-4 w-4" aria-hidden="true" />Full audit log</Link>
          </StaffCard>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-student-muted"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Need a new student file? Use <Link href="/admin/students" className="font-semibold text-student-gold-ink underline-offset-4 hover:underline">Add student</Link> on the Students page.</p>
    </div>
  );
}

function PreviewRow({ st, program, last }: { st: DirectoryStudent; program?: string; last: string | null }) {
  const name = studentFullName(st);
  return (
    <li>
      <Link href={adminStudentWorkspacePath(st.id)} className="group flex min-w-0 items-center gap-3 py-2.5 hover:bg-student-gold-soft/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-student-gold-ink" data-testid="cc-student-open" aria-label={`Open ${name}`}>
        <StudentPhoto student={st} size="md" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2"><span className="truncate font-medium text-student-ink" title={name}>{name}</span>{isDemoStudent(st) ? <DemoPill /> : null}</span>
          <span className="block truncate text-xs text-student-muted">{st.student_code ?? "No code"} · {program ? shortProgram(program) : "No program yet"} · {relativeTime(last)}</span>
        </span>
        <span className="hidden sm:block"><StudentStatusPill status={st.status} /></span>
        <ChevronRight className="h-4 w-4 shrink-0 text-student-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </li>
  );
}
