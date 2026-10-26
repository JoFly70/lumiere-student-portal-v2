/**
 * S11 — staff High School Pathway workspace (/admin/students/:studentId/high-school).
 * Admin shell (default shadcn look). Lumière coordinates; the awarding school decides.
 * Every mutation returns the refreshed StaffHighSchoolState, which replaces the query cache.
 */
import { useState } from "react";
import { Link, useParams } from "wouter";
import { AlertCircle, ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatHalfUnits, halfUnitPercent, type StaffHighSchoolState } from "@shared/high-school-contract";
import { useAuth } from "@/lib/auth";
import { useDocuments } from "@/hooks/use-documents";
import { useHsState } from "@/lib/admin-high-school-api";
import { formatDate } from "@/lib/admin-high-school-logic";
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
  const pct = halfUnitPercent(credits.earnedHalfUnits, credits.requiredHalfUnits);
  return (
    <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="hs-summary">
      <div className="lg:col-span-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Officially earned credit</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{formatHalfUnits(credits.earnedHalfUnits)} <span className="text-base font-normal text-muted-foreground">of {formatHalfUnits(credits.requiredHalfUnits)} credits</span></p>
        <div role="progressbar" aria-label="Officially earned credit" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-foreground" style={{ width: `${pct}%` }} /></div>
        <p className="mt-1 text-xs text-muted-foreground">Core {formatHalfUnits(credits.core.earnedHalfUnits)}/{formatHalfUnits(credits.core.requiredHalfUnits)} · Electives {formatHalfUnits(credits.elective.earnedHalfUnits)}/{formatHalfUnits(credits.elective.requiredHalfUnits)} · {formatHalfUnits(credits.remainingHalfUnits)} remaining</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Waiting for review</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{c.reviewQueue.length}</p>
        <p className="text-xs text-muted-foreground">student reports, not yet official</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Target completion</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{formatDate(c.enrollment.targetCompletionDate)}</p>
        <p className="text-xs text-muted-foreground">a target, not a guarantee</p>
      </div>
    </div>
  );
}

export function HighSchoolWorkspace({ state, studentId, isAdmin, docs, defaultTab = "program" }: SectionProps & { defaultTab?: HsTabId }) {
  const [tab, setTab] = useState<HsTabId>(defaultTab);
  const c = state.current;
  const pending = c?.reviewQueue.length ?? 0;
  const props = { state, studentId, isAdmin, docs };
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Link href={`/admin/students/${encodeURIComponent(studentId)}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to student workspace</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight">High school pathway</h1>
            <p className="mt-1 text-muted-foreground">{c ? c.enrollment.programTitle : "No high school program yet"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {c ? <Pill tone={c.enrollment.status === "active" ? "good" : "neutral"}>{c.enrollment.status.replace(/_/g, " ")}</Pill> : null}
            {state.hasUniversityProgram ? <Pill>Also in a university program</Pill> : null}
            {!isAdmin ? <Pill tone="warn">Staff view: publishing and conferral are admin-only</Pill> : null}
          </div>
        </div>
        <Notice tone="official">Lumière plans and coordinates. The awarding school decides course completion, credit, grades and the diploma. A student's report is never official until you record the school's result with a verified document.</Notice>
      </header>
      <SummaryStrip state={state} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as HsTabId)} className="space-y-5">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 p-1" aria-label="High school pathway sections">
          {HS_TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="min-h-10 px-3">
              {t.label}{t.id === "results" && pending > 0 ? <span className="ml-2 rounded-full bg-foreground px-1.5 py-0.5 text-xs text-background">{pending}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
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
