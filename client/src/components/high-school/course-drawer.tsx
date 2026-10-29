/**
 * Course drawer: description, where the course stands (planned / reported / verified), tasks with progress
 * reporting (existing API), the elective "Request a change" action and a way into the library shelf.
 */
import React from "react";
import { Link } from "wouter";
import { BookOpen, Calendar } from "lucide-react";
import type { HsCourseView } from "@shared/high-school-contract";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusPill, buttonClass } from "@/components/student-progress/student-ui";
import { formatShortDate } from "@/pages/student-roadmap-presentation";
import { courseStatusView, courseTitleView, creditsLabel, sortedTasks } from "@/pages/high-school-presentation";
import { courseDescription } from "@/lib/hs-course-descriptions";
import { electiveAwaitsApproval } from "@/lib/elective-change";
import { courseBasis, coursePhaseWeeks, isPlanningTarget, type CreditBasis, displayTitle } from "@/lib/degree-map";
import { useT, type TranslationKey } from "@/i18n";
import { CourseSupport, ElectiveChange, TaskRow } from "./subjects-tab";

export const BASIS_PILL: Record<CreditBasis, "notstarted" | "submitted" | "official"> = {
  planned: "notstarted",
  reported: "submitted",
  verified: "official",
};

export function plannedWindowText(course: HsCourseView, language: "en" | "fr", t: (k: TranslationKey, v?: Record<string, string | number>) => string): string | null {
  const phase = coursePhaseWeeks(course);
  if (phase) return t("ux.map.course.phase", { from: phase.from, to: phase.to });
  if (course.plannedStart || course.plannedEnd) {
    return [formatShortDate(course.plannedStart, language), formatShortDate(course.plannedEnd, language)].filter(Boolean).join(language === "fr" ? " au " : " to ");
  }
  return null;
}

export function CourseDrawer({ course, schoolLine, today, onClose }: { course: HsCourseView | null; schoolLine: string; today: string; onClose: () => void }) {
  const { t, language } = useT();
  const lang = language === "fr" ? "fr" : "en";
  return (
    <Sheet open={!!course} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto border-l border-student-line bg-student-card p-0 sm:max-w-lg" data-testid="course-drawer">
        {course && <DrawerBody course={course} schoolLine={schoolLine} today={today} lang={lang} />}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ course, schoolLine, today, lang }: { course: HsCourseView; schoolLine: string; today: string; lang: "en" | "fr" }) {
  const { t, language } = useT();
  const basis = courseBasis(course) ?? "planned";
  const title = displayTitle(course.title);
  const st = courseStatusView(course.status, language);
  const description = courseDescription(course.key, lang);
  const window = plannedWindowText(course, lang, t);
  const tasks = sortedTasks(course.tasks).filter((k) => !isPlanningTarget(k));
  const hasPlanningTarget = course.tasks.some((k) => /^Planning target/i.test(k.title));
  const awaits = course.kind === "elective" && electiveAwaitsApproval(course.title);
  return (
    <>
      <SheetHeader className="space-y-2 border-b border-student-line bg-student-bg p-5 pr-12 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={BASIS_PILL[basis]} label={t(`ux.status.${basis}` as TranslationKey)} />
          {awaits && <StatusPill status="attention" label={t("ux.map.approval.pending")} />}
        </div>
        <SheetTitle className="font-serif text-2xl leading-tight tracking-tight text-student-ink">{title}</SheetTitle>
        <SheetDescription className="text-sm text-student-muted">
          {creditsLabel(course.halfUnits, language)} · {course.kind === "elective" ? t("ux.map.group.elective") : t("ux.map.group.core")}
          {course.tasksTotal > 0 ? ` · ${t("ux.map.course.tasks", { done: course.tasksDone, total: course.tasksTotal })}` : ""}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-5 p-5">
        <section aria-labelledby="drawer-stands" className="space-y-1.5">
          <h3 id="drawer-stands" className="text-xs font-semibold uppercase tracking-[0.14em] text-student-muted">{t("ux.drawer.stands")}</h3>
          <p className="flex flex-wrap items-center gap-2 text-sm text-student-ink">
            <StatusPill status={st.key} label={st.label} />
            <span>{t(`ux.drawer.explain.${basis}` as TranslationKey)}</span>
          </p>
          {awaits && <p className="text-sm text-student-muted" data-testid="drawer-approval-note">{t("ux.drawer.approvalNote", { school: schoolLine })}</p>}
        </section>

        {description && (
          <section aria-labelledby="drawer-about" className="space-y-1.5" data-testid="course-description">
            <h3 id="drawer-about" className="text-xs font-semibold uppercase tracking-[0.14em] text-student-muted">{t("ux.drawer.about")}</h3>
            <p className="text-sm leading-relaxed text-student-ink">{description}</p>
            <p className="text-xs text-student-muted">{t("hs.subjects.descriptionNote")}</p>
          </section>
        )}

        {(window || hasPlanningTarget) && (
          <p className="flex items-start gap-2 text-sm text-student-ink" data-testid="drawer-window">
            <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
            <span>
              <span className="font-medium">{t("ux.drawer.window")}</span> {window ?? t("ux.map.course.noWindow")}
              {hasPlanningTarget && <span className="block text-xs text-student-muted">{t("ux.timeline.note")}</span>}
            </span>
          </p>
        )}

        <section aria-labelledby="drawer-tasks" className="space-y-2">
          <h3 id="drawer-tasks" className="text-xs font-semibold uppercase tracking-[0.14em] text-student-muted">{t("ux.drawer.tasks")}</h3>
          {tasks.length === 0 ? (
            <p className="text-sm text-student-muted">{t("ux.drawer.noTasks")}</p>
          ) : (
            <ul className="divide-y divide-student-line rounded-xl border border-student-line bg-student-card px-3 py-3" aria-label={t("hs.subjects.tasksIn", { title })}>
              {tasks.map((k) => <TaskRow key={k.key} course={course} task={k} today={today} />)}
            </ul>
          )}
        </section>

        <Link href={`/library?course=${encodeURIComponent(course.key)}`} className={buttonClass.outline} data-testid="drawer-library-link">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          {t("ux.drawer.library")}
        </Link>

        {course.kind === "elective" && course.status !== "replaced" && <ElectiveChange course={course} />}
        {course.status !== "transfer_credit" && course.status !== "replaced" && <CourseSupport course={course} schoolLine={schoolLine} />}
      </div>
    </>
  );
}
