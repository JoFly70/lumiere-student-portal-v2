/**
 * Owner students directory (/admin/students): search, filters, avatar cards with program, status, latest
 * activity and balance. Demo/test students are hidden until the owner switches "Show demo students" on, and
 * then wear a DEMO pill. Filters are addressable by URL so every Control Center number lands on its records.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, Search, UsersRound, X } from "lucide-react";
import { AddStudentDialog } from "@/components/admin/add-student-dialog";
import {
  DemoPill, StudentPhoto, StudentStatusPill, STUDENT_STATUS_OPTIONS, factsById, formatMoney, isDemoStudent, relativeTime,
  shortProgram, studentFullName, studentIdByUserId, useDirectoryFacts, useDirectoryStudents, type DirectoryFacts, type DirectoryStudent,
} from "@/components/admin/directory/directory-data";
import { StaffCard, StaffEmpty, StaffPage, StaffPageHeader, StaffPill, staffField } from "@/components/staff/staff-ui";
import { useTickets } from "@/hooks/use-tickets";
import { apiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";
import { awaitingFor } from "@shared/support-contract";
import { adminStudentWorkspacePath } from "@/pages/admin-student-workspace-presentation";

const VIEWS = {
  all: "Everyone",
  attention: "Needs attention",
  docs: "Documents to review",
  tickets: "Waiting on Lumière",
  overdue: "Payment overdue",
} as const;
type View = keyof typeof VIEWS;

interface QueueDoc { studentId: string }

export function parseDirectoryFilters(search: string) {
  const p = new URLSearchParams(search);
  const view = p.get("view") as View | null;
  return {
    q: p.get("q") ?? "",
    status: p.get("status") ?? "all",
    program: p.get("program") ?? "all",
    view: view && view in VIEWS ? view : ("all" as View),
    demo: p.get("demo") === "1",
  };
}

const selectCls = cn(staffField, "pr-8");

export default function AdminStudents() {
  const urlSearch = useSearch();
  const initial = useMemo(() => parseDirectoryFilters(urlSearch), [urlSearch]);
  const [q, setQ] = useState(initial.q);
  const [status, setStatus] = useState(initial.status);
  const [program, setProgram] = useState(initial.program);
  const [view, setView] = useState<View>(initial.view);
  const [showDemo, setShowDemo] = useState(initial.demo);
  useEffect(() => {
    setQ(initial.q); setStatus(initial.status); setProgram(initial.program); setView(initial.view); setShowDemo(initial.demo);
  }, [initial]);

  const students = useDirectoryStudents();
  const facts = useDirectoryFacts();
  const docs = useQuery<{ documents: QueueDoc[] }>({ queryKey: ["/api/admin/documents/queue"], queryFn: () => apiRequest("/api/admin/documents/queue") });
  const open = useTickets({ view: "active", limit: 200 });

  const all = students.data?.students ?? [];
  const byId = useMemo(() => factsById(facts.data?.facts), [facts.data]);
  const demoCount = all.filter(isDemoStudent).length;
  const docCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of docs.data?.documents ?? []) m.set(d.studentId, (m.get(d.studentId) ?? 0) + 1);
    return m;
  }, [docs.data]);
  const waiting = useMemo(() => {
    const m = new Map<string, number>();
    const byUser = studentIdByUserId(all);
    for (const t of open.data?.tickets ?? []) {
      const sid = byUser.get(t.reporter_id);
      if (sid && awaitingFor(t.status) === "staff") m.set(sid, (m.get(sid) ?? 0) + 1);
    }
    return m;
  }, [open.data, all]);

  const programOptions = useMemo(() => {
    const titles = new Set<string>();
    for (const f of facts.data?.facts ?? []) if (f.program) titles.add(f.program.title);
    return Array.from(titles).sort();
  }, [facts.data]);

  const needle = q.trim().toLowerCase();
  const rows = all.filter((s) => {
    if (!showDemo && isDemoStudent(s)) return false;
    if (status !== "all" && s.status !== status) return false;
    const f = byId.get(s.id);
    if (program === "none" && f?.program) return false;
    if (program === "any" && !f?.program) return false;
    if (program !== "all" && program !== "none" && program !== "any" && f?.program?.title !== program) return false;
    if (view === "docs" && !docCounts.get(s.id)) return false;
    if (view === "tickets" && !waiting.get(s.id)) return false;
    if (view === "overdue" && !f?.billing?.overdue) return false;
    if (view === "attention" && !(docCounts.get(s.id) || waiting.get(s.id) || f?.billing?.overdue)) return false;
    if (needle) {
      const hay = `${s.first_name} ${s.last_name} ${s.preferred_name ?? ""} ${s.email ?? ""} ${s.student_code ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const real = all.filter((s) => !isDemoStudent(s));
  const filtered = q || status !== "all" || program !== "all" || view !== "all";
  const reset = () => { setQ(""); setStatus("all"); setProgram("all"); setView("all"); };

  return (
    <StaffPage width="wide" testId="admin-students">
      <StaffPageHeader
        eyebrow="Staff Portal · Students"
        title="Students"
        description={students.data ? `${real.length} student${real.length === 1 ? "" : "s"}${demoCount ? ` · ${demoCount} demo` : ""}. Open a file to see everything about one student in one place.` : "Loading the directory…"}
        actions={<AddStudentDialog />}
      />

      <section aria-label="Find students" className="space-y-3">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-student-muted" aria-hidden="true" />
            <label htmlFor="students-search" className="sr-only">Search students</label>
            <input id="students-search" className={cn(staffField, "pl-9")} placeholder="Search name, email or student code" value={q} onChange={(e) => setQ(e.target.value)} data-testid="students-search" />
          </div>
          <div>
            <label htmlFor="students-status" className="sr-only">Status</label>
            <select id="students-status" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="students-status">
              {STUDENT_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="students-program" className="sr-only">Program</label>
            <select id="students-program" className={selectCls} value={program} onChange={(e) => setProgram(e.target.value)} data-testid="students-program">
              <option value="all">All programs</option>
              <option value="any">Any program</option>
              {programOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value="none">No program yet</option>
            </select>
          </div>
          <div>
            <label htmlFor="students-view" className="sr-only">Show</label>
            <select id="students-view" className={selectCls} value={view} onChange={(e) => setView(e.target.value as View)} data-testid="students-view">
              {(Object.keys(VIEWS) as View[]).map((k) => <option key={k} value={k}>{VIEWS[k]}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <label htmlFor="students-show-demo" className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-student-ink">
            <input id="students-show-demo" type="checkbox" className="h-4 w-4 accent-[hsl(var(--s-ink))]" checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} data-testid="students-show-demo" />
            Show demo students{demoCount ? ` (${demoCount})` : ""}
            <span className="hidden text-xs text-student-muted sm:inline">· synthetic, never counted in real totals</span>
          </label>
          <p className="flex items-center gap-3 text-sm text-student-muted" aria-live="polite">
            <span>{rows.length} shown</span>
            {filtered ? <button type="button" onClick={reset} className="inline-flex min-h-10 items-center gap-1 font-semibold text-student-gold-ink underline-offset-4 hover:underline"><X className="h-3.5 w-3.5" aria-hidden="true" />Clear filters</button> : null}
          </p>
        </div>
      </section>

      {students.isError ? <p role="alert" className="text-sm text-st-urgent">The students could not be loaded. Reload the page to retry.</p> : null}
      {students.isLoading ? <div className="space-y-2" role="status" aria-label="Loading students">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[72px] animate-pulse rounded-2xl bg-student-line/60" />)}</div> : null}

      {students.data && rows.length === 0 ? (
        <StaffEmpty icon={<UsersRound className="h-6 w-6" />} title={filtered ? "No student matches these filters" : "No students yet"}
          action={filtered ? <button type="button" onClick={reset} className="inline-flex min-h-10 items-center font-semibold text-student-gold-ink underline-offset-4 hover:underline">Clear filters</button> : <AddStudentDialog />}>
          {filtered ? "Try a different name, or clear the filters to see everyone." : "Add the first student to start their file."}
        </StaffEmpty>
      ) : null}

      {rows.length > 0 ? (
        <StaffCard padded={false} className="overflow-hidden" aria-label="Student list">
          <div className="hidden grid-cols-[minmax(0,2fr)_8.5rem_minmax(14rem,2.2fr)_minmax(0,1.3fr)_7rem_5.5rem_1.25rem] gap-4 border-b border-student-line bg-student-gold-soft/50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-student-muted lg:grid" aria-hidden="true">
            <span>Student</span><span>Status</span><span>Program</span><span>Needs attention</span><span>Latest activity</span><span className="text-right">Balance</span><span />
          </div>
          <ul className="divide-y divide-student-line" data-testid="students-list">
            {rows.map((s) => <StudentRow key={s.id} s={s} f={byId.get(s.id)} docs={docCounts.get(s.id) ?? 0} waiting={waiting.get(s.id) ?? 0} />)}
          </ul>
        </StaffCard>
      ) : null}

      <p className="flex items-center gap-1.5 text-xs text-student-muted"><ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />Looking for billing across students? <Link href="/staff/billing" className="font-semibold text-student-gold-ink underline-offset-4 hover:underline">Open student billing</Link></p>
    </StaffPage>
  );
}

function StudentRow({ s, f, docs, waiting }: { s: DirectoryStudent; f?: DirectoryFacts; docs: number; waiting: number }) {
  const name = studentFullName(s);
  const demo = isDemoStudent(s);
  const bal = f?.billing;
  return (
    <li>
      <Link href={adminStudentWorkspacePath(s.id)} aria-label={`Open ${name}`} data-testid="student-row"
        className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-student-gold-soft/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-student-gold-ink lg:grid-cols-[minmax(0,2fr)_8.5rem_minmax(14rem,2.2fr)_minmax(0,1.3fr)_7rem_5.5rem_1.25rem] lg:gap-x-4">
        <span className="flex min-w-0 items-center gap-3 lg:col-start-1">
          <StudentPhoto student={s} size="md" />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2"><span className="min-w-0 [overflow-wrap:anywhere] font-medium leading-snug text-student-ink line-clamp-2" title={name}>{name}</span>{demo ? <DemoPill /> : null}</span>
            <span className="block truncate font-mono text-xs text-student-muted">{s.student_code ?? "No code yet"}</span>
          </span>
        </span>
        <span className="col-start-3 row-start-1 flex justify-end lg:col-start-2 lg:row-start-1 lg:justify-start"><StudentStatusPill status={s.status} /></span>
        <span className="col-span-3 col-start-1 min-w-0 text-sm text-student-muted lg:col-span-1 lg:col-start-3">
          {(() => {
            const [main, ...rest] = f?.program ? shortProgram(f.program.title).split(" · ") : ["No program yet"];
            return <><span className="block whitespace-nowrap text-student-ink" title={f?.program?.title}>{main}</span>{rest.length ? <span className="block whitespace-nowrap text-xs text-student-muted">{rest.join(" · ")}</span> : null}</>;
          })()}
        </span>
        <span className={`col-span-3 col-start-1 min-w-0 flex-wrap gap-1.5 lg:col-span-1 lg:col-start-4 ${(docs || waiting || bal?.overdue) ? "flex" : "hidden lg:block"}`} data-testid="student-attention">
          {waiting ? <StaffPill tone="attention">{waiting} awaiting reply</StaffPill> : null}
          {docs ? <StaffPill tone="attention">{docs} to review</StaffPill> : null}
          {bal?.overdue ? <StaffPill tone="urgent">Payment overdue</StaffPill> : null}
          {!(docs || waiting || bal?.overdue) ? <span className="text-xs text-student-muted">Nothing waiting</span> : null}
        </span>
        <span className="col-span-3 col-start-1 text-xs text-student-muted lg:col-span-1 lg:col-start-5 lg:text-sm"><span className="lg:hidden">Last activity: </span>{relativeTime(f?.lastActivityAt)}</span>
        <span className="col-span-3 col-start-1 text-sm tabular-nums text-student-ink lg:col-span-1 lg:col-start-6 lg:text-right">
          {bal ? <><span className="lg:hidden text-xs text-student-muted">Balance: </span><span className="font-medium">{formatMoney(bal.balanceCents, bal.currency)}</span>{bal.balanceCents === 0 ? <span className="ml-1 text-xs text-student-muted">paid</span> : null}</> : <span className="text-xs text-student-muted">No fee on file</span>}
        </span>
        <ChevronRight className="col-start-3 row-start-2 hidden h-4 w-4 justify-self-end text-student-muted transition-transform group-hover:translate-x-0.5 lg:col-start-7 lg:row-start-1 lg:block" aria-hidden="true" />
      </Link>
    </li>
  );
}
