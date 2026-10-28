/**
 * S25 — owner "View as Student" (/admin/students/:studentId/view-as-student). Admin only.
 * Data: GET /api/admin/students/:studentId/view-as-student (shared/view-as-student-contract.ts).
 *
 * READ-ONLY: renders the student's own projections with the student UI components, but outside
 * HsActionsProvider (actions are inert) and with in-preview links disabled, so nothing here can report
 * progress, request a transcript, open a ticket or navigate into student-only routes. The preview language
 * lives in a nested I18nProvider and never changes the owner's own language.
 */
import React, { useEffect, useState, type MouseEvent } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Eye, Loader2, RefreshCw } from "lucide-react";
import { formatHalfUnits } from "@shared/high-school-contract";
import type { ViewAsStudentResponse } from "@shared/view-as-student-contract";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/api";
import { I18nProvider, LANGUAGES, type Language } from "@/i18n";
import { useDocuments } from "@/hooks/use-documents";
import { HighSchoolPageView } from "@/components/high-school/high-school-view";
import { HsNoEnrollment } from "@/components/high-school/states";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { CockpitView } from "@/components/cockpit/cockpit-view";
import { summarizeDocuments, type CockpitOps } from "@/components/cockpit/model";
import { deckState } from "@/lib/academic-flight-deck-presentation";
import { CockpitNotConfigured } from "@/pages/high-school-flight-deck";
import "@/styles/flight-deck-preview.css";
import "@/styles/academic-flight-deck.css";

export const viewAsStudentPath = (studentId: string) => `/api/admin/students/${encodeURIComponent(studentId)}/view-as-student`;

function formatWhen(iso: string | null): string {
  if (!iso) return "None recorded";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "None recorded" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Swallows link clicks inside the preview: the owner stays on this page and no student route is opened. */
function blockNavigation(e: MouseEvent<HTMLDivElement>) {
  const anchor = (e.target as HTMLElement).closest?.("a[href]");
  if (anchor) {
    e.preventDefault();
    e.stopPropagation();
  }
}

export function StaffProgressSummary({ data }: { data: ViewAsStudentResponse }) {
  const s = data.summary;
  if (!s) return <p className="text-sm text-muted-foreground" data-testid="preview-summary-empty">No high school enrollment, so there is no academic progress to summarize.</p>;
  const items: Array<[string, string, string?]> = [
    ["Credits earned (official)", `${formatHalfUnits(s.creditsEarnedHalfUnits)} of ${formatHalfUnits(s.creditsRequiredHalfUnits)}`],
    ["Credits remaining", formatHalfUnits(s.creditsRemainingHalfUnits)],
    ["Reported, awaiting school", formatHalfUnits(s.awaitingConfirmationHalfUnits), "not counted as earned"],
    ["Courses underway", String(s.coursesUnderway)],
    ["Student-reported tasks", String(s.studentReportedTasks), "awaiting an official result"],
    ["Official school results", String(s.officialResults)],
    ["Pending evidence review", String(s.pendingEvidence)],
    ["Last recorded activity", formatWhen(s.lastRecordedActivityAt)],
    ["Next milestone", s.nextMilestone ? `${formatHalfUnits(s.nextMilestone.cumulativeHalfUnits)} credits by ${s.nextMilestone.month}` : "Not configured"],
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="preview-summary">
      {items.map(([label, value, note]) => (
        <div key={label} className="rounded-md border bg-card p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
          {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
        </div>
      ))}
      {!s.roadmapPublished ? <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">No roadmap is published yet; the student sees an empty plan.</p> : null}
    </dl>
  );
}

function PreviewDashboard({ data, ops }: { data: ViewAsStudentResponse; ops: CockpitOps }) {
  const p = data.academicProjection;
  if (!p) return <StudentSurface><HsNoEnrollment /></StudentSurface>;
  if (deckState(p) === "not_configured") return <CockpitNotConfigured projection={p} />;
  return (
    <StudentSurface testId="preview-dashboard">
      <div className="fdp fdp-live">
        <CockpitView projection={p} firstName={data.student.displayName.split(" ")[0] ?? null} ops={ops} />
      </div>
    </StudentSurface>
  );
}

export function ViewAsStudentScreen({ data, studentId, docs }: { data: ViewAsStudentResponse; studentId: string; docs: ReadonlyArray<{ status?: string | null }> | null }) {
  const [lang, setLang] = useState<Language>(data.student.preferredLanguage ?? "en");
  const ops: CockpitOps = {
    documents: docs ? { state: "ready", data: summarizeDocuments(docs) } : { state: "unavailable" },
    support: { state: "unavailable" },
    payments: { state: "unavailable" },
  };
  // The nested provider sets <html lang>; give it back to the owner's language on leave.
  useEffect(() => {
    const ownerLang = document.documentElement.lang;
    return () => {
      document.documentElement.lang = ownerLang;
    };
  }, []);
  const back = `/admin/students/${encodeURIComponent(studentId)}`;
  const saved = data.student.preferredLanguage;
  return (
    <div className="space-y-5" data-testid="view-as-student">
      <div role="status" className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50" data-testid="preview-banner">
        <p className="flex items-center gap-2">
          <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span><strong>Read-only preview</strong> of {data.student.displayName}'s portal. Nothing here changes the student's records, and links are disabled.</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Preview language" className="inline-flex rounded-md border">
            {LANGUAGES.map((l) => (
              <button key={l.code} type="button" role="radio" aria-checked={lang === l.code} onClick={() => setLang(l.code)} className={`min-h-10 px-3 text-xs font-semibold ${lang === l.code ? "bg-foreground text-background" : ""}`} data-testid={`preview-language-${l.code}`}>
                {l.short}
              </button>
            ))}
          </div>
          <Link href={back} className="inline-flex min-h-10 items-center gap-2 rounded-md border bg-background px-3 font-medium text-foreground" data-testid="link-exit-preview">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />Return to staff workspace
          </Link>
        </div>
      </div>

      <section aria-labelledby="preview-summary-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 id="preview-summary-heading" className="text-2xl font-semibold tracking-tight">Progress summary</h1>
          <p className="text-sm text-muted-foreground" data-testid="preview-language-saved">
            Student's chosen language: {saved ? LANGUAGES.find((l) => l.code === saved)?.label : "not saved yet (English by default)"}
          </p>
        </div>
        <StaffProgressSummary data={data} />
        <p className="text-xs text-muted-foreground">From stored records only: official credit comes from school-confirmed awards; student reports never count as earned.</p>
      </section>

      <I18nProvider key={lang} initialLanguage={lang}>
        <Tabs defaultValue="dashboard" className="space-y-4">
          <TabsList aria-label="Student portal pages">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="high-school">High school</TabsTrigger>
          </TabsList>
          {/* onClickCapture: in-preview links never navigate; buttons that only toggle the view still work. */}
          <div onClickCapture={blockNavigation} lang={lang} data-testid="preview-surface">
            <TabsContent value="dashboard" className="mt-0"><PreviewDashboard data={data} ops={ops} /></TabsContent>
            <TabsContent value="high-school" className="mt-0">
              {data.highSchool ? <HighSchoolPageView view={data.highSchool} /> : <StudentSurface><HsNoEnrollment /></StudentSurface>}
            </TabsContent>
          </div>
        </Tabs>
      </I18nProvider>
    </div>
  );
}

export default function AdminViewAsStudent() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const query = useQuery<ViewAsStudentResponse>({
    queryKey: ["admin-view-as-student", studentId],
    queryFn: () => apiRequest<ViewAsStudentResponse>(viewAsStudentPath(studentId)),
    enabled: !!studentId,
    staleTime: 0,
  });
  const documents = useDocuments(studentId || null);
  if (query.isLoading) return <div role="status" className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading student preview…</div>;
  if (query.isError || !query.data) {
    return (
      <div role="alert" className="mx-auto max-w-md rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
        <AlertCircle className="mx-auto mb-2 h-6 w-6 text-destructive" aria-hidden="true" />
        <p className="font-medium">The student preview could not be loaded.</p>
        <Button className="mt-3" variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Retry</Button>
      </div>
    );
  }
  return <ViewAsStudentScreen data={query.data} studentId={studentId} docs={documents.error ? null : documents.data ?? null} />;
}
