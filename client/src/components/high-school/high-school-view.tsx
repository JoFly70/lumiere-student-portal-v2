/**
 * Prop-driven High School Pathway page (S11). The page file feeds it data;
 * actions come from HsActionsProvider, so it renders from fixtures.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, GraduationCap, School, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentHighSchoolView } from "@shared/high-school-contract";
import { formatShortDate } from "@/pages/student-roadmap-presentation";
import { governanceCopy, hsTabParts, HS_TABS, tabFromHash, todayIso, type HsTabId } from "@/pages/high-school-presentation";
import { useT } from "@/i18n";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { JourneyTab } from "./journey-tab";
import { SubjectsTab } from "./subjects-tab";
import { DegreeMapView } from "./degree-map";
import { GraduationTab } from "./graduation-tab";
import { FamilyCard } from "./family-card";
import { PriorEducationCard } from "./prior-education-card";
import { HsNoRoadmap } from "./states";

export interface HsWelcome { readonly name: string; readonly photoUrl: string | null }

function Header({ view, welcome }: { view: StudentHighSchoolView; welcome?: HsWelcome | null }) {
  const { t, language } = useT();
  const gov = governanceCopy(language);
  const e = view.enrollment;
  const started = formatShortDate(e.startedOn, language);
  const [open, setOpen] = useState(false);
  return (
    <header className="space-y-2" data-testid="hs-header">
      {welcome && (
        <div className="flex items-center gap-3" data-testid="hs-welcome">
          <Avatar className="h-12 w-12 sm:h-14 sm:w-14">
            <AvatarImage src={welcome.photoUrl || undefined} alt="" />
            <AvatarFallback aria-hidden="true">{welcome.name.trim().charAt(0).toUpperCase() || "?"}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="break-words font-serif text-xl text-student-ink" data-testid="hs-welcome-name">{t("hs.welcome.hello", { name: welcome.name })}</p>
            <p className="break-words text-sm text-student-muted" data-testid="hs-welcome-program">{t("hs.welcome.program", { program: view.enrollment.programTitle })}</p>
          </div>
        </div>
      )}
      <h1 className="font-serif text-3xl tracking-tight text-student-ink sm:text-4xl">{t("hs.title")}</h1>
      <p className="flex flex-col items-start gap-y-1 text-sm text-student-muted sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2" data-testid="school-line">
        <span className="flex items-center gap-2">
          <School className="h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
          <span className="font-medium text-student-ink" data-testid="school-name">{e.schoolDisplayName}</span>
        </span>
        <span aria-hidden="true" className="hidden sm:inline">·</span>
        <span className="pl-6 sm:pl-0" data-testid="program-title">{e.programTitle}</span>
        {started && (<><span aria-hidden="true" className="hidden sm:inline">·</span><span className="pl-6 sm:pl-0">{t("hs.started", { date: started })}</span></>)}
      </p>
      <div data-testid="governance-note" role="note">
        <p className="flex items-start gap-2 text-sm text-student-ink sm:items-center">
          <ShieldCheck className="mt-3 h-4 w-4 shrink-0 text-student-gold-ink sm:mt-0" aria-hidden="true" />
          <span>{gov.headline}{" "}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="hs-official-explainer"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-md font-medium text-student-gold-ink underline underline-offset-4 hover:no-underline"
            data-testid="button-whats-official"
          >
            {t("hs.whatsOfficial")}
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </button></span>
        </p>
        <p id="hs-official-explainer" hidden={!open} className="max-w-2xl pb-1 text-sm leading-relaxed text-student-muted" data-testid="official-explainer">
          {gov.detail}
        </p>
      </div>
    </header>
  );
}

function GraduatedBanner({ view }: { view: StudentHighSchoolView }) {
  const { t, language } = useT();
  const on = formatShortDate(view.graduation.diploma.conferredOn, language);
  return (
    <section className="flex items-start gap-4 rounded-2xl border border-student-gold bg-student-gold-soft p-5 sm:p-6" aria-labelledby="hs-graduated" data-testid="graduated-banner">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-student-seal text-student-seal-ink" aria-hidden="true">
        <GraduationCap className="h-6 w-6" />
      </span>
      <div className="space-y-1">
        <h2 id="hs-graduated" className="font-serif text-2xl tracking-tight text-student-ink">{t("hs.graduated.title")}</h2>
        <p className="text-sm leading-relaxed text-student-ink">
          {on ? t("hs.graduated.on", { school: view.enrollment.schoolDisplayName, date: on }) : t("hs.graduated.noDate", { school: view.enrollment.schoolDisplayName })}
        </p>
      </div>
    </section>
  );
}

export function HighSchoolPageView({
  view,
  today = todayIso(),
  initialTab = "journey",
  defaultOpenSubject = null,
  defaultOpenCourse = null,
  welcome = null,
}: {
  welcome?: HsWelcome | null;
  view: StudentHighSchoolView;
  today?: string;
  initialTab?: HsTabId;
  defaultOpenSubject?: string | null;
  defaultOpenCourse?: string | null;
}) {
  const { t, language } = useT();
  const [tab, setTab] = useState<HsTabId>(initialTab);
  const [focusCourse, setFocusCourse] = useState<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    try {
      const fromHash = tabFromHash(window.location.hash);
      if (fromHash) setTab(fromHash);
    } catch {
      /* hash is a convenience */
    }
  }, []);

  const select = useCallback((id: HsTabId, courseKey: string | null = null) => {
    setTab(id);
    setFocusCourse(courseKey);
    try {
      window.history.replaceState(null, "", `#${id}`);
    } catch {
      /* ignore */
    }
  }, []);

  const onKey = (e: React.KeyboardEvent, index: number) => {
    const last = HS_TABS.length - 1;
    let next = -1;
    if (e.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next < 0) return;
    e.preventDefault();
    select(HS_TABS[next].id);
    tabRefs.current[HS_TABS[next].id]?.focus();
  };

  const graduated = view.graduation.status === "diploma_conferred";
  const props = { view, today, onNavigate: select };

  return (
    <StudentSurface testId="high-school-page">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <Header view={view} welcome={welcome} />
        {graduated && <GraduatedBanner view={view} />}
        {!view.roadmap ? (
          <div className="space-y-4 sm:space-y-6">
            <HsNoRoadmap />
            <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
              <PriorEducationCard items={view.priorEducation} subjects={view.subjects} />
              <FamilyCard guardians={view.guardians} />
            </div>
          </div>
        ) : (
          <>
            <div role="tablist" aria-label={t("hs.tabs.label")} className="grid grid-cols-4 gap-1 rounded-2xl border border-student-line bg-student-card p-1" data-testid="hs-tabs">
              {HS_TABS.map((tb, i) => {
                const selected = tab === tb.id;
                const parts = hsTabParts(tb.id, language);
                return (
                  <button
                    key={tb.id}
                    ref={(el) => { tabRefs.current[tb.id] = el; }}
                    role="tab"
                    type="button"
                    id={`hs-tab-${tb.id}`}
                    aria-selected={selected}
                    aria-controls={`hs-panel-${tb.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => select(tb.id)}
                    onKeyDown={(e) => onKey(e, i)}
                    className={cn(
                      "min-h-[48px] rounded-xl px-2 text-sm font-semibold leading-tight transition-colors sm:px-4 sm:text-base",
                      selected ? "bg-student-seal text-student-seal-ink" : "text-student-ink hover:bg-student-gold-soft",
                    )}
                    data-testid={`tab-${tb.id}`}
                  >
                    {/* "My " is dropped below sm so "Graduation" never wraps at 390px. */}
                    <span className="hidden sm:inline">{parts.prefix}</span>
                    {parts.rest}
                  </button>
                );
              })}
            </div>
            {HS_TABS.map((tb) => (
              <div key={tb.id} role="tabpanel" id={`hs-panel-${tb.id}`} aria-labelledby={`hs-tab-${tb.id}`} hidden={tab !== tb.id} tabIndex={0} className="focus-visible:outline-offset-4">
                <h2 className="sr-only">{hsTabParts(tb.id, language).prefix}{hsTabParts(tb.id, language).rest}</h2>
                {tb.id === "roadmap" && <DegreeMapView view={view} today={today} initialCourse={defaultOpenCourse} />}
                {tb.id === "journey" && <JourneyTab {...props} />}
                {tb.id === "subjects" && <SubjectsTab view={view} today={today} focusCourseKey={focusCourse} defaultOpenSubject={defaultOpenSubject} defaultOpenCourse={defaultOpenCourse} />}
                {tb.id === "graduation" && <GraduationTab {...props} />}
              </div>
            ))}
          </>
        )}
      </div>
    </StudentSurface>
  );
}
