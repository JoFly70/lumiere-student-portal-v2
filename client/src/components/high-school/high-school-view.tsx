/**
 * Prop-driven High School Pathway page (S11). The page file feeds it data;
 * actions come from HsActionsProvider, so it renders from fixtures.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, GraduationCap, School, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentHighSchoolView } from "@shared/high-school-contract";
import { formatShortDate } from "@/pages/student-roadmap-presentation";
import { GOVERNANCE_COPY, HS_TABS, tabFromHash, todayIso, type HsTabId } from "@/pages/high-school-presentation";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { JourneyTab } from "./journey-tab";
import { SubjectsTab } from "./subjects-tab";
import { GraduationTab } from "./graduation-tab";
import { FamilyCard } from "./family-card";
import { PriorEducationCard } from "./prior-education-card";
import { HsNoRoadmap } from "./states";

function Header({ view }: { view: StudentHighSchoolView }) {
  const e = view.enrollment;
  const started = formatShortDate(e.startedOn);
  const [open, setOpen] = useState(false);
  return (
    <header className="space-y-2" data-testid="hs-header">
      <h1 className="font-serif text-3xl tracking-tight text-student-ink sm:text-4xl">My High School Journey</h1>
      <p className="flex flex-col items-start gap-y-1 text-sm text-student-muted sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2" data-testid="school-line">
        <span className="flex items-center gap-2">
          <School className="h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
          <span className="font-medium text-student-ink" data-testid="school-name">{e.schoolDisplayName}</span>
        </span>
        <span aria-hidden="true" className="hidden sm:inline">·</span>
        <span className="pl-6 sm:pl-0" data-testid="program-title">{e.programTitle}</span>
        {started && (<><span aria-hidden="true" className="hidden sm:inline">·</span><span className="pl-6 sm:pl-0">Started {started}</span></>)}
      </p>
      <div data-testid="governance-note" role="note">
        <p className="flex items-start gap-2 text-sm text-student-ink sm:items-center">
          <ShieldCheck className="mt-3 h-4 w-4 shrink-0 text-student-gold-ink sm:mt-0" aria-hidden="true" />
          <span>{GOVERNANCE_COPY.headline}{" "}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="hs-official-explainer"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-md font-medium text-student-gold-ink underline underline-offset-4 hover:no-underline"
            data-testid="button-whats-official"
          >
            What&apos;s official?
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </button></span>
        </p>
        <p id="hs-official-explainer" hidden={!open} className="max-w-2xl pb-1 text-sm leading-relaxed text-student-muted" data-testid="official-explainer">
          {GOVERNANCE_COPY.detail}
        </p>
      </div>
    </header>
  );
}

function GraduatedBanner({ view }: { view: StudentHighSchoolView }) {
  const on = formatShortDate(view.graduation.diploma.conferredOn);
  return (
    <section className="flex items-start gap-4 rounded-2xl border border-student-gold bg-student-gold-soft p-5 sm:p-6" aria-labelledby="hs-graduated" data-testid="graduated-banner">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-student-seal text-student-seal-ink" aria-hidden="true">
        <GraduationCap className="h-6 w-6" />
      </span>
      <div className="space-y-1">
        <h2 id="hs-graduated" className="font-serif text-2xl tracking-tight text-student-ink">Congratulations, you graduated</h2>
        <p className="text-sm leading-relaxed text-student-ink">
          {view.enrollment.schoolDisplayName} conferred your diploma{on ? ` on ${on}` : ""}. Well done.
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
}: {
  view: StudentHighSchoolView;
  today?: string;
  initialTab?: HsTabId;
  defaultOpenSubject?: string | null;
  defaultOpenCourse?: string | null;
}) {
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
        <Header view={view} />
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
            <div role="tablist" aria-label="High school sections" className="grid grid-cols-3 gap-1 rounded-2xl border border-student-line bg-student-card p-1" data-testid="hs-tabs">
              {HS_TABS.map((t, i) => {
                const selected = tab === t.id;
                return (
                  <button
                    key={t.id}
                    ref={(el) => { tabRefs.current[t.id] = el; }}
                    role="tab"
                    type="button"
                    id={`hs-tab-${t.id}`}
                    aria-selected={selected}
                    aria-controls={`hs-panel-${t.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => select(t.id)}
                    onKeyDown={(e) => onKey(e, i)}
                    className={cn(
                      "min-h-[48px] rounded-xl px-2 text-sm font-semibold leading-tight transition-colors sm:px-4 sm:text-base",
                      selected ? "bg-student-seal text-student-seal-ink" : "text-student-ink hover:bg-student-gold-soft",
                    )}
                    data-testid={`tab-${t.id}`}
                  >
                    {/* "My " is dropped below sm so "Graduation" never wraps at 390px. */}
                    {t.label.startsWith("My ") ? (
                      <>
                        <span className="hidden sm:inline">My </span>
                        {t.label.slice(3)}
                      </>
                    ) : (
                      t.label
                    )}
                  </button>
                );
              })}
            </div>
            {HS_TABS.map((t) => (
              <div key={t.id} role="tabpanel" id={`hs-panel-${t.id}`} aria-labelledby={`hs-tab-${t.id}`} hidden={tab !== t.id} tabIndex={0} className="focus-visible:outline-offset-4">
                <h2 className="sr-only">{t.label}</h2>
                {t.id === "journey" && <JourneyTab {...props} />}
                {t.id === "subjects" && <SubjectsTab view={view} today={today} focusCourseKey={focusCourse} defaultOpenSubject={defaultOpenSubject} defaultOpenCourse={defaultOpenCourse} />}
                {t.id === "graduation" && <GraduationTab {...props} />}
              </div>
            ))}
          </>
        )}
      </div>
    </StudentSurface>
  );
}
