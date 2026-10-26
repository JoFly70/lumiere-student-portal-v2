/**
 * Section F: graduation and official documents. Academic work finished and
 * degree awarded are two different things, so the timeline is split in two with
 * the university's conferral as the dividing line.
 */
import React from "react";
import { Link } from "wouter";
import { Landmark, Hourglass, PenLine, ShieldCheck } from "lucide-react";
import type { MilestoneView, StudentGraduateProgramView } from "@shared/graduate-program-contract";
import { cn } from "@/lib/utils";
import { Pill, SectionHeading, StatusPill, STATUS_STYLE, cardClass } from "@/components/student-progress/student-ui";
import { GlyphIcon, StatePill } from "./graduate-ui";
import { SECTION_IDS, formatDate, milestoneDatePrefix, milestoneDisplay, splitGraduation } from "./graduate-presentation";

type Graduation = NonNullable<StudentGraduateProgramView["graduation"]>;

function MilestoneItem({ m, last }: { m: MilestoneView; last: boolean }) {
  const d = milestoneDisplay(m);
  // A done, officially confirmed step gets ONE chip, not "Confirmed" plus "Confirmed from university document".
  const singleChip = m.state === "done" && m.official;
  const date = formatDate(m.date);
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0" data-testid="milestone" data-key={m.key} data-state={m.state} data-official={m.official}>
      <div className="relative flex w-6 shrink-0 justify-center" aria-hidden="true">
        {!last && <span className="absolute left-1/2 top-6 -bottom-5 w-px -translate-x-1/2 bg-student-line-strong" />}
        <span className={cn("z-10 mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-student-card", STATUS_STYLE[d.status].border, m.state === "later" && "border-dashed")}>
          <GlyphIcon status={d.status} glyph={d.glyph} />
        </span>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-student-ink">{m.label}</p>
        <div className="flex flex-wrap items-center gap-2">
          {!singleChip && <StatePill status={d.status} label={d.label} glyph={d.glyph} />}
          {m.official && (
            singleChip ? (
              <StatusPill status="official" label="Confirmed from university document" data-testid="official-marker" />
            ) : (
              <Pill tone="gold" icon={<ShieldCheck className="h-3 w-3" aria-hidden="true" />} data-testid="official-marker">Confirmed from university document</Pill>
            )
          )}
          {date && (
            <span className="text-xs text-student-muted">
              {milestoneDatePrefix(m.key)} <time dateTime={m.date ?? undefined}>{date}</time>
            </span>
          )}
        </div>
        <p className="text-sm text-student-muted">{m.detail}</p>
      </div>
    </li>
  );
}

function Stage({ id, icon, title, subtitle, items, tone }: { id: string; icon: React.ReactNode; title: string; subtitle: string; items: readonly MilestoneView[]; tone: "work" | "award" }) {
  return (
    <section aria-labelledby={id} className={cn(cardClass, "space-y-4", tone === "award" && "border-student-gold")} data-testid={`stage-${tone}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-student-gold-ink">{icon}</span>
        <div>
          <h3 id={id} className="font-serif text-lg text-student-ink">{title}</h3>
          <p className="text-xs text-student-muted">{subtitle}</p>
        </div>
      </div>
      <ol>{items.map((m, i) => <MilestoneItem key={m.key} m={m} last={i === items.length - 1} />)}</ol>
    </section>
  );
}

/** The dividing callout: what is finished vs what only the university can decide. */
export function WorkVsDegreeCallout({ graduation }: { graduation: Graduation }) {
  const conferred = formatDate(graduation.conferredOn);
  return (
    <div className="rounded-2xl border-2 border-student-gold bg-student-gold-soft p-4 sm:p-5" role="note" data-testid="work-vs-degree">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1" data-testid="callout-work">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-student-gold-ink">Academic work</p>
          <StatusPill status={graduation.academicWorkComplete ? "applied" : "progress"} label={graduation.academicWorkComplete ? "Academic work finished" : "Academic work in progress"} />
        </div>
        <div className="space-y-1" data-testid="callout-degree">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-student-gold-ink">University degree</p>
          {graduation.awardConferred ? (
            <StatusPill status="official" label={conferred ? `Degree conferred on ${conferred}` : "Degree conferred"} />
          ) : (
            <StatePill status="notstarted" label="Degree not yet conferred" glyph="later" />
          )}
        </div>
      </div>
      <p className="mt-3 text-sm font-medium leading-relaxed text-student-ink" data-testid="graduation-explanation">{graduation.explanation}</p>
    </div>
  );
}

export function GraduationSection({ graduation }: { graduation: Graduation }) {
  const { work, award } = splitGraduation(graduation.milestones);
  return (
    <section aria-labelledby="graduate-graduation-title" id={SECTION_IDS.graduation} className="scroll-mt-24 space-y-4" data-testid="graduate-graduation">
      <SectionHeading
        id="graduate-graduation-title"
        title="Graduation and official documents"
        description="Finishing your work and receiving your degree are two separate moments."
      />
      <Stage id="stage-work-title" tone="work" icon={<PenLine className="h-5 w-5" aria-hidden="true" />} title="Academic work finished" subtitle="Your side of the programme" items={work} />
      <WorkVsDegreeCallout graduation={graduation} />
      <Stage id="stage-award-title" tone="award" icon={<Landmark className="h-5 w-5" aria-hidden="true" />} title="Degree awarded by the university" subtitle="Decided and documented by the university, then recorded by Lumière" items={award} />
      <p className="flex items-center gap-2 text-xs text-student-muted">
        <Hourglass className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Questions about a step? <Link href="/support" className="font-medium text-student-gold-ink underline underline-offset-4">Ask about my Master's</Link>
      </p>
    </section>
  );
}
