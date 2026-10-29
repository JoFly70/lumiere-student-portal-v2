/**
 * Academic library (/library): per-course shelves (course guide, study checklist, linked documents), the student's own
 * documents by category with search, filters, preview/download, versions and provenance, and evidence upload.
 * The school's learning platform stays the source of graded coursework; this page organises plan and evidence.
 */
import React, { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { BookOpen, CheckCircle2, Clock, Download, Eye, FileText, GraduationCap, History, Info, Search, ShieldAlert, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HsCourseView, HsSubjectView } from "@shared/high-school-contract";
import type { StudentDocument } from "@shared/schema";
import { StatusPill, StudentSurface, buttonClass } from "@/components/student-progress/student-ui";
import { DocumentViewer, downloadDocument } from "@/components/library/document-viewer";
import { UploadEvidence } from "@/components/library/upload-evidence";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocuments, useMyProfile } from "@/hooks/use-documents";
import { useToast } from "@/hooks/use-toast";
import { useHighSchoolView } from "@/lib/high-school-queries";
import { courseDescription } from "@/lib/hs-course-descriptions";
import {
  LIB_CATEGORIES, attentionOfDoc, courseMatches, docMatches, groupVersions, provenanceOf, visibleNotes,
  type DocGroup, type LibCategory,
} from "@/lib/library-model";
import { isPlanningTarget, displayTitle } from "@/lib/degree-map";
import { courseStatusView, courseTitleView, creditsLabel, orderedSubjects, subjectLabel, taskKindLabel, taskStatusView, sortedTasks } from "@/pages/high-school-presentation";
import { formatShortDate } from "@/pages/student-roadmap-presentation";
import { useT, type TranslationKey } from "@/i18n";
import { plannedWindowText } from "@/components/high-school/course-drawer";

const field = "min-h-[44px] w-full rounded-lg border border-student-line-strong bg-student-card px-3 text-sm text-student-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink";

function useLang() {
  const { language } = useT();
  return language === "fr" ? "fr" : "en";
}

function DocCard({ group, courseTitle, onView }: { group: DocGroup; courseTitle: string | null; onView: (d: StudentDocument) => void }) {
  const { t } = useT();
  const lang = useLang();
  const { toast } = useToast();
  const [showAll, setShowAll] = useState(false);
  const latest = group.versions[0]!;
  const earlier = group.versions.slice(1);
  const attention = attentionOfDoc(latest);
  const day = (iso: string) => formatShortDate(iso.slice(0, 10), lang) ?? iso.slice(0, 10);
  const row = (d: StudentDocument, isLatest: boolean) => {
    const prov = provenanceOf(d);
    const att = attentionOfDoc(d);
    return (
      <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5" data-testid="doc-version" data-latest={isLatest}>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="break-all text-sm font-medium text-student-ink">{d.file_name}</span>
            {isLatest && <span className="rounded-full bg-student-gold-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-student-gold-ink" data-testid="badge-latest">{t("ux.lib.latest")}</span>}
          </span>
          <span className="mt-0.5 block text-xs text-student-muted" data-testid="doc-provenance">
            {t(prov === "you" ? "ux.lib.prov.you" : "ux.lib.prov.lumiere")} · {day(d.created_at)} ·{" "}
            <span className={cn(att === "action" && "font-semibold text-st-attention")}>{t(`documents.statusLabel.${d.status}` as TranslationKey)}</span>
          </span>
          {att === "action" && d.student_message && <span className="mt-1 block text-xs text-st-attention">{d.student_message}</span>}
        </span>
        <span className="flex shrink-0 gap-2">
          <button type="button" className={cn(buttonClass.outline, "min-h-[40px] px-3")} onClick={() => onView(d)} aria-label={t("ux.lib.previewAria", { name: d.file_name })} data-testid="doc-preview"><Eye className="h-4 w-4" aria-hidden="true" />{t("ux.lib.preview")}</button>
          <button type="button" className={cn(buttonClass.outline, "min-h-[40px] px-3")} onClick={() => void downloadDocument(d).catch(() => toast({ variant: "destructive", title: t("documents.toast.downloadFailed"), description: t("documents.toast.downloadFailedDetail", { name: d.file_name }) }))} aria-label={t("ux.lib.downloadAria", { name: d.file_name })} data-testid="doc-download"><Download className="h-4 w-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only">{t("ux.lib.download")}</span></button>
        </span>
      </li>
    );
  };
  return (
    <li className={cn("rounded-2xl border bg-student-card p-4", attention === "action" ? "border-st-attention" : "border-student-line")} data-testid="doc-group" data-category={group.category}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-student-muted">
        <FileText className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
        <span className="font-semibold uppercase tracking-[0.1em]">{t(`ux.lib.type.${latest.doc_type}` as TranslationKey) === `ux.lib.type.${latest.doc_type}` ? t("ux.lib.type.other") : t(`ux.lib.type.${latest.doc_type}` as TranslationKey)}</span>
        {courseTitle && <span>· {courseTitle}</span>}
      </div>
      <ul className="divide-y divide-student-line">{row(latest, true)}</ul>
      {visibleNotes(latest) && <p className="mt-1 text-xs text-student-muted">{visibleNotes(latest)}</p>}
      {earlier.length > 0 && (
        <div className="mt-1">
          <button type="button" className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-medium text-student-gold-ink underline underline-offset-4" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)} data-testid="toggle-versions"><History className="h-4 w-4" aria-hidden="true" />{t("ux.lib.versions", { n: earlier.length })}</button>
          {showAll && <ul className="divide-y divide-student-line border-t border-student-line">{earlier.map((d) => row(d, false))}</ul>}
        </div>
      )}
    </li>
  );
}

function CourseShelf({ course, groups, onView, onUpload, today }: { course: HsCourseView; groups: DocGroup[]; onView: (d: StudentDocument) => void; onUpload: () => void; today: string }) {
  const { t, language } = useT();
  const lang = useLang();
  const title = displayTitle(course.title);
  const description = courseDescription(course.key, lang);
  const st = courseStatusView(course.status, language);
  const window = plannedWindowText(course, lang, t);
  const tasks = sortedTasks(course.tasks).filter((k) => !isPlanningTarget(k));
  void today;
  return (
    <div className="space-y-4" data-testid="course-shelf" data-course-key={course.key}>
      <header className="space-y-1.5">
        <h2 className="font-serif text-2xl tracking-tight text-student-ink">{title}</h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-student-muted"><StatusPill status={st.key} label={st.label} />{creditsLabel(course.halfUnits, language)}{window ? ` · ${window}` : ""}</p>
      </header>

      <section className="rounded-2xl border border-student-line bg-student-card p-4" aria-labelledby="shelf-guide">
        <h3 id="shelf-guide" className="mb-1.5 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.1em] text-student-muted"><BookOpen className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />{t("ux.lib.guide")}</h3>
        {description ? <><p className="text-sm leading-relaxed text-student-ink">{description}</p><p className="mt-1 text-xs text-student-muted">{t("hs.subjects.descriptionNote")}</p></> : <p className="text-sm text-student-muted">{t("ux.lib.noGuide")}</p>}
      </section>

      <section className="rounded-2xl border border-student-line bg-student-card p-4" aria-labelledby="shelf-checklist" data-testid="shelf-checklist">
        <h3 id="shelf-checklist" className="mb-1.5 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.1em] text-student-muted"><CheckCircle2 className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />{t("ux.lib.checklist")}</h3>
        {tasks.length === 0 ? <p className="text-sm text-student-muted">{t("ux.drawer.noTasks")}</p> : (
          <ul className="divide-y divide-student-line">
            {tasks.map((k) => {
              const s = taskStatusView(k.status, language);
              return (
                <li key={k.key} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="checklist-task">
                  <span className="min-w-0"><span className="block text-xs font-semibold uppercase tracking-[0.1em] text-student-muted">{taskKindLabel(k.kind, language)}</span><span className="block text-sm font-medium text-student-ink">{k.title}</span></span>
                  <StatusPill status={s.key} label={s.label} className="px-2 py-0.5 text-[11px]" />
                </li>
              );
            })}
          </ul>
        )}
        <Link href={`/high-school?course=${encodeURIComponent(course.key)}`} className="mt-2 inline-flex min-h-[44px] items-center text-sm font-medium text-student-gold-ink underline underline-offset-4" data-testid="shelf-report-link">{t("ux.lib.reportProgress")}</Link>
      </section>

      <section aria-labelledby="shelf-docs" data-testid="shelf-docs">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 id="shelf-docs" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.1em] text-student-muted"><FileText className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />{t("ux.lib.linkedDocs")}</h3>
          <button type="button" className={cn(buttonClass.outline, "min-h-[40px]")} onClick={onUpload} data-testid="shelf-upload"><Upload className="h-4 w-4" aria-hidden="true" />{t("ux.lib.uploadHere")}</button>
        </div>
        {groups.length === 0 ? <p className="rounded-2xl border border-dashed border-student-line-strong p-4 text-sm text-student-muted" data-testid="shelf-docs-empty">{t("ux.lib.noLinkedDocs")}</p> : <ul className="space-y-3">{groups.map((g) => <DocCard key={g.id} group={g} courseTitle={null} onView={onView} />)}</ul>}
      </section>
    </div>
  );
}

export default function Library() {
  const { t, language } = useT();
  const lang = useLang();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const shelf = params.get("course") ?? "";
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const docs = useDocuments(profile?.id ?? null);
  const hs = useHighSchoolView();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<LibCategory | "all">("all");
  const [view, setView] = useState<StudentDocument | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadCourse, setUploadCourse] = useState("");

  const subjects: HsSubjectView[] = hs.data ? orderedSubjects(hs.data.subjects) : [];
  const courses: HsCourseView[] = subjects.flatMap((s) => s.courses.filter((c) => c.status !== "replaced"));
  const titleOf = (key: string | null) => (key ? (courses.find((c) => c.key === key) ? displayTitle(courses.find((c) => c.key === key)!.title) : null) : null);
  const groups = useMemo(() => groupVersions(docs.data ?? []), [docs.data]);
  const course = courses.find((c) => c.key === shelf) ?? null;
  const q = query.trim();

  const setShelf = (key: string) => navigate(key ? `/library?course=${encodeURIComponent(key)}` : "/library", { replace: false });
  const openUpload = (courseKey = "") => { setUploadCourse(courseKey); setUploadOpen(true); };

  const filtered = groups.filter((g) => (category === "all" || g.category === category) && (!q || docMatches(g, q, titleOf(g.courseKey))));
  const matchedCourses = q ? courses.filter((c) => courseMatches({ key: c.key, title: c.title, tasks: c.tasks }, q)) : [];
  const countFor = (key: string) => groups.filter((g) => g.courseKey === key).length;
  const needAction = groups.filter((g) => attentionOfDoc(g.versions[0]!) === "action").length;
  const loading = profileLoading || (!!profile && docs.isLoading) || hs.isLoading;

  return (
    <StudentSurface testId="library-page">
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <header className="space-y-2">
          <h1 className="font-serif text-3xl tracking-tight text-student-ink sm:text-4xl">{t("ux.lib.title")}</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-student-muted">{t("ux.lib.subtitle")}</p>
          <p className="flex items-start gap-2 rounded-xl border border-student-gold/50 bg-student-gold-soft px-3 py-2.5 text-sm text-student-ink" role="note" data-testid="lms-note"><Info className="mt-0.5 h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />{t("ux.lib.lmsNote")}</p>
        </header>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-student-muted" aria-hidden="true" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("ux.lib.search")} aria-label={t("ux.lib.searchAria")} className={cn(field, "pl-9")} data-testid="library-search" />
          </div>
          <button type="button" className={buttonClass.solid} onClick={() => openUpload(shelf)} disabled={!profile} data-testid="library-upload-button"><Upload className="h-4 w-4" aria-hidden="true" />{t("ux.lib.upload.title")}</button>
        </div>

        {loading ? (
          <div role="status" aria-label={t("cockpit.loading")} className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
            <nav aria-label={t("ux.lib.shelves")} className="lg:sticky lg:top-2 lg:self-start" data-testid="library-shelves">
              <label className="sr-only" htmlFor="shelf-select">{t("ux.lib.shelves")}</label>
              <select id="shelf-select" className={cn(field, "lg:hidden")} value={shelf} onChange={(e) => setShelf(e.target.value)} data-testid="shelf-select">
                <option value="">{t("ux.lib.allDocs")}</option>
                {subjects.map((s) => (
                  <optgroup key={s.subject} label={subjectLabel(s.subject, language)}>
                    {s.courses.filter((c) => c.status !== "replaced").map((c) => <option key={c.key} value={c.key}>{displayTitle(c.title)}</option>)}
                  </optgroup>
                ))}
              </select>
              <div className="hidden max-h-[calc(100dvh-9rem)] overflow-y-auto rounded-2xl border border-student-line bg-student-card p-2 lg:block">
                <button type="button" onClick={() => setShelf("")} aria-current={!shelf ? "page" : undefined} className={cn("flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm font-semibold", !shelf ? "bg-student-seal text-student-seal-ink" : "text-student-ink hover:bg-student-gold-soft")} data-testid="shelf-all">
                  <span className="flex items-center gap-2"><GraduationCap className="h-4 w-4" aria-hidden="true" />{t("ux.lib.allDocs")}</span><span className="text-xs tnum">{groups.length}</span>
                </button>
                {subjects.map((s) => (
                  <div key={s.subject} className="mt-2">
                    <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-student-muted">{subjectLabel(s.subject, language)}</p>
                    <ul>
                      {s.courses.filter((c) => c.status !== "replaced").map((c) => {
                        const active = shelf === c.key;
                        const n = countFor(c.key);
                        return (
                          <li key={c.key}>
                            <button type="button" onClick={() => setShelf(c.key)} aria-current={active ? "page" : undefined} className={cn("flex min-h-[40px] w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm", active ? "bg-student-seal text-student-seal-ink" : "text-student-ink hover:bg-student-gold-soft")} data-testid="shelf-link">
                              <span className="min-w-0 break-words">{displayTitle(c.title)}</span>
                              {n > 0 && <span className="shrink-0 rounded-full bg-student-gold-soft px-1.5 text-[11px] font-semibold text-student-gold-ink tnum">{n}</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </nav>

            <div className="min-w-0 space-y-5" data-testid="library-content">
              {q && (
                <section aria-label={t("ux.lib.results")} className="space-y-3" data-testid="search-results">
                  <h2 className="font-serif text-xl text-student-ink">{t("ux.lib.results")}: {matchedCourses.length + filtered.length}</h2>
                  {matchedCourses.length > 0 && (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {matchedCourses.map((c) => <li key={c.key}><button type="button" onClick={() => { setQuery(""); setShelf(c.key); }} className="flex min-h-[48px] w-full items-center gap-2 rounded-xl border border-student-line bg-student-card px-3 text-left text-sm font-medium text-student-ink hover:bg-student-gold-soft" data-testid="result-course"><BookOpen className="h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />{displayTitle(c.title)}</button></li>)}
                    </ul>
                  )}
                </section>
              )}

              {!q && course ? (
                <CourseShelf course={course} groups={groups.filter((g) => g.courseKey === course.key)} onView={setView} onUpload={() => openUpload(course.key)} today="" />
              ) : (
                <section aria-labelledby="lib-docs" className="space-y-3" data-testid="library-docs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 id="lib-docs" className="font-serif text-2xl tracking-tight text-student-ink">{t("ux.lib.myDocs")}</h2>
                    {needAction > 0 && <p className="flex items-center gap-1.5 text-sm font-medium text-st-attention" data-testid="docs-need-action"><ShieldAlert className="h-4 w-4" aria-hidden="true" />{t("cockpit.docs.needAction", { n: needAction })}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2" role="group" aria-label={t("ux.lib.filterAria")} data-testid="category-filters">
                    {(["all", ...LIB_CATEGORIES] as const).map((c) => {
                      const n = c === "all" ? groups.length : groups.filter((g) => g.category === c).length;
                      if (c !== "all" && n === 0) return null;
                      return (
                        <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={cn("inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium", category === c ? "border-student-seal bg-student-seal text-student-seal-ink" : "border-student-line-strong bg-student-card text-student-ink hover:bg-student-gold-soft")} data-testid={`cat-${c}`}>
                          {c === "all" ? t("ux.map.filter.all") : t(`ux.lib.cat.${c}` as TranslationKey)}<span className="text-xs opacity-80 tnum">{n}</span>
                        </button>
                      );
                    })}
                  </div>
                  {docs.error ? (
                    <p role="alert" className="rounded-xl border border-st-attention bg-st-attention-soft p-4 text-sm text-student-ink">{t("ux.lib.error")}</p>
                  ) : filtered.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-student-line-strong p-6 text-center" data-testid="library-empty">
                      <Clock className="mx-auto mb-2 h-6 w-6 text-student-gold-ink" aria-hidden="true" />
                      <p className="text-sm text-student-muted">{q || category !== "all" ? t("ux.lib.noMatch") : t("ux.lib.empty")}</p>
                      {!q && category === "all" && <button type="button" className={cn(buttonClass.outline, "mt-3")} onClick={() => openUpload("")}><Upload className="h-4 w-4" aria-hidden="true" />{t("ux.lib.upload.title")}</button>}
                    </div>
                  ) : (
                    <ul className="space-y-3">{filtered.map((g) => <DocCard key={g.id} group={g} courseTitle={titleOf(g.courseKey)} onView={setView} />)}</ul>
                  )}
                  <p className="text-xs text-student-muted">{t("ux.lib.docsLink")} <Link href="/documents" className="font-medium text-student-gold-ink underline underline-offset-4">{t("nav.documents")}</Link></p>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
      <DocumentViewer doc={view} onClose={() => setView(null)} />
      <UploadEvidence open={uploadOpen} onOpenChange={setUploadOpen} profile={profile} courses={courses.map((c) => ({ key: c.key, title: displayTitle(c.title) }))} defaultCourse={uploadCourse} defaultCategory={uploadCourse ? "coursework" : "academic"} />
    </StudentSurface>
  );
}
