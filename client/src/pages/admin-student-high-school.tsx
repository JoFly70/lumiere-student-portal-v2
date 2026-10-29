/**
 * S11 — staff High School Pathway workspace (/admin/students/:studentId/high-school).
 * Admin shell (default shadcn look). Lumière coordinates; the awarding school decides.
 * Every mutation returns the refreshed StaffHighSchoolState, which replaces the query cache.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { AlertCircle, ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatHalfUnits, type StaffHighSchoolState } from "@shared/high-school-contract";
import { StaffPageHeader } from "@/components/staff/staff-ui";
import { useAuth } from "@/lib/auth";
import { useDocuments } from "@/hooks/use-documents";
import { useHsState } from "@/lib/admin-high-school-api";
import { formatDate, isCompleted, remainingHalfUnits, statusLabel } from "@/lib/admin-high-school-logic";
import { CreditBar } from "@/components/admin/high-school/credit-bar";
import { Notice, Pill, type SectionProps } from "@/components/admin/high-school/shared";
import { ProgramSection } from "@/components/admin/high-school/program-section";
import { PriorEducationSection } from "@/components/admin/high-school/prior-education-section";
import { RoadmapSection } from "@/components/admin/high-school/roadmap-section";
import { ResultsSection } from "@/components/admin/high-school/results-section";
import { GraduationSection } from "@/components/admin/high-school/graduation-section";
import { GuardiansSection } from "@/components/admin/high-school/guardians-section";
import { EventsSection } from "@/components/admin/high-school/events-section";

export const HS_TABS = [
  { id: "program", label: "Program" },
  { id: "prior", label: "Prior study" },
  { id: "roadmap", label: "Roadmap" },
  { id: "results", label: "Reviews & results" },
  { id: "graduation", label: "Graduation" },
  { id: "guardians", label: "Guardians" },
  { id: "activity", label: "Activity" },
] as const;
export type HsTabId = (typeof HS_TABS)[number]["id"];

function initialTab(): HsTabId {
  try {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (HS_TABS.some((x) => x.id === t)) return t as HsTabId;
  } catch {
    /* no window (static render) */
  }
  return "program";
}

export function SummaryStrip({ state }: { state: StaffHighSchoolState }) {
  const c = state.current;
  if (!c) return null;
  const credits = c.credits;
  const done = isCompleted(state);
  const conferred = c.graduation.diploma.conferredOn;
  const remaining = remainingHalfUnits(credits.requiredHalfUnits, credits.earnedHalfUnits);
  return (
    <div className="grid gap-5 rounded-lg border bg-card p-4 sm:p-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" data-testid="hs-summary">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Officially earned credit</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{formatHalfUnits(credits.earnedHalfUnits)} <span className="text-base font-normal text-muted-foreground">of {formatHalfUnits(credits.requiredHalfUnits)} credits{remaining === 0 ? " · requirement met" : ""}</span></p>
        <div className="mt-3"><CreditBar credits={credits} /></div>
      </div>
      <dl className="grid grid-cols-2 gap-4 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{done ? "Completed on" : "Target completion"}</dt>
          <dd className="mt-1 text-lg font-semibold">{done ? formatDate(conferred ?? c.enrollment.targetCompletionDate) : formatDate(c.enrollment.targetCompletionDate)}</dd>
          {done ? null : <dd className="text-xs text-muted-foreground">a target, not a guarantee</dd>}
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Roadmap</dt>
          <dd className="mt-1 text-lg font-semibold">{c.published ? `Version ${c.published.versionNumber}` : "Not published"}</dd>
          <dd className="text-xs text-muted-foreground">{c.draft ? `Draft v${c.draft.versionNumber} open` : c.published ? "No open draft" : "Draft not started"}</dd>
        </div>
      </dl>
    </div>
  );
}

export function HighSchoolWorkspace({ state, studentId, isAdmin, docs, defaultTab = "program", initialOpenForm }: SectionProps & { defaultTab?: HsTabId }) {
  const [tab, setTab] = useState<HsTabId>(defaultTab);
  const c = state.current;
  const pending = c?.reviewQueue.length ?? 0;
  const props = { state, studentId, isAdmin, docs, initialOpenForm };
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Keep the active tab visible inside the horizontally scrollable tab list.
    const el = listRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    el?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [tab]);
  return (
    <div className="space-y-6">
      <StaffPageHeader
        back={<Link href={`/admin/students/${encodeURIComponent(studentId)}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to student file</Link>}
        eyebrow="Staff Portal · High school"
        title="High school pathway"
        description={c ? c.enrollment.programTitle : "No high school program yet. Create the program in the Program tab to start."}
        meta={
          <div className="flex flex-wrap gap-2">
            {c ? <Pill tone={c.enrollment.status === "active" ? "good" : "neutral"}>{statusLabel(c.enrollment.status)}</Pill> : null}
            {state.hasUniversityProgram ? <Pill>Also in a university program</Pill> : null}
            {!isAdmin ? <Pill tone="warn">Staff view: publishing, eligibility sign-off and conferral are admin-only</Pill> : null}
          </div>
        }
      />
      {tab === "program" ? <Notice tone="official" testId="governance-banner">Lumière plans and coordinates. The awarding school decides course completion, credit, grades and the diploma. A student's report is never official until you record the school's result with a verified document.</Notice> : null}
      <SummaryStrip state={state} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as HsTabId)} className="space-y-5">
        {/* One row, never wrapped: an intended horizontal scroll region with edge fades as the scroll cue. */}
        <div className="relative" data-testid="hs-tabs" ref={listRef}>
          <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto p-1 [scrollbar-width:thin]" aria-label="High school pathway sections">
            {HS_TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="min-h-10 shrink-0 px-3">
                {t.label}{t.id === "results" && pending > 0 ? <span className="ml-2 rounded-full bg-foreground px-1.5 py-0.5 text-xs tabular-nums text-background">{pending}</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>
          <span aria-hidden="true" data-testid="hs-tabs-fade" className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-md bg-gradient-to-l from-muted via-muted/80 to-transparent md:hidden" />
        </div>
        <TabsContent value="program" className="mt-0"><ProgramSection {...props} /></TabsContent>
        <TabsContent value="prior" className="mt-0"><PriorEducationSection {...props} /></TabsContent>
        <TabsContent value="roadmap" className="mt-0"><RoadmapSection {...props} /></TabsContent>
        <TabsContent value="results" className="mt-0"><ResultsSection {...props} /></TabsContent>
        <TabsContent value="graduation" className="mt-0"><GraduationSection {...props} /></TabsContent>
        <TabsContent value="guardians" className="mt-0"><GuardiansSection {...props} /></TabsContent>
        <TabsContent value="activity" className="mt-0"><EventsSection state={state} /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function AdminStudentHighSchool() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const query = useHsState(studentId);
  const documents = useDocuments(studentId || null);
  if (query.isLoading) return <div role="status" className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading high school pathway…</div>;
  if (query.isError || !query.data) {
    return (
      <div role="alert" className="mx-auto max-w-md rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
        <AlertCircle className="mx-auto mb-2 h-6 w-6 text-destructive" aria-hidden="true" />
        <p className="font-medium">The high school pathway could not be loaded.</p>
        <Button className="mt-3" variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Retry</Button>
      </div>
    );
  }
  return <HighSchoolWorkspace state={query.data} studentId={studentId} isAdmin={isAdmin} docs={documents.data ?? []} defaultTab={initialTab()} />;
}
