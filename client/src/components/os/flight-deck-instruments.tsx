import { Link } from "wouter";
import { AlertCircle, ArrowRight, Check, CircleDashed, FileText, Flag, GraduationCap, HelpCircle, Layers, ListChecks, CreditCard, BookOpen, User, Route } from "lucide-react";
import { formatHalfUnits } from "@shared/high-school-contract";
import {
  CREDIT_STATUSES,
  PREVIEW_ACTIONS,
  PREVIEW_FILE_STATUS,
  PREVIEW_MILESTONES,
  PREVIEW_QUICK_LINKS,
  STATUS_HINT,
  STATUS_LABEL,
  cellsFor,
  creditsText,
  sumTotals,
  type CreditStatus,
  type PreviewSubject,
  type StatusTotals,
} from "@/lib/flight-deck-preview-data";

export type ViewMode = "verified" | "projected";

/** The pattern + colour key for a status. Always paired with a label where it is shown. */
export function StatusSwatch({ status }: { status: CreditStatus }) {
  return <i className="fdp-swatch" data-s={status} aria-hidden="true" />;
}

/** Statuses that count in the current view. In "verified only" the rest are dimmed, not removed. */
const counts = (s: CreditStatus, mode: ViewMode) => mode === "projected" || s === "verified";

export function StatusLegend({ totals, mode }: { totals: StatusTotals; mode: ViewMode }) {
  const total = sumTotals(totals);
  return (
    <ul className="fdp-legend" data-testid="status-legend">
      {CREDIT_STATUSES.map((s) => (
        <li key={s} data-dim={!counts(s, mode) && s !== "open"}>
          <StatusSwatch status={s} />
          <span className="l-name">
            {STATUS_LABEL[s]}
            <span className="l-hint">{STATUS_HINT[s]}</span>
          </span>
          <span className="l-val tnum">
            {creditsText(totals[s])}
            <small>{totals[s]} of {total} half-units</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One stacked bar. In "verified only" the unverified remainder is drawn as an empty track. */
export function StackedBar({ totals, mode, label }: { totals: StatusTotals; mode: ViewMode; label: string }) {
  const total = sumTotals(totals);
  const parts = CREDIT_STATUSES.filter((s) => totals[s] > 0 && (mode === "projected" || s === "verified"));
  return (
    <div className="fdp-bar" role="img" aria-label={label}>
      {parts.map((s) => (
        <i key={s} className="fdp-cell" data-s={s} style={{ width: `${(totals[s] / total) * 100}%` }} />
      ))}
    </div>
  );
}

export function CoverageBars({ core, elective, mode }: { core: StatusTotals; elective: StatusTotals; mode: ViewMode }) {
  const whole = {
    verified: core.verified + elective.verified,
    in_progress: core.in_progress + elective.in_progress,
    planned: core.planned + elective.planned,
    open: core.open + elective.open,
  };
  const rows = [
    { key: "whole", name: "Whole program", totals: whole },
    { key: "core", name: "Core requirement", totals: core },
    { key: "elective", name: "Elective requirement", totals: elective },
  ];
  return (
    <div className="fdp-bars" data-testid="coverage-bars">
      {rows.map(({ key, name, totals }) => {
        const total = sumTotals(totals);
        const shown = mode === "verified" ? totals.verified : totals.verified + totals.in_progress + totals.planned;
        const text = `${formatHalfUnits(shown)} of ${formatHalfUnits(total)} credits`;
        return (
          <div key={key}>
            <div className="fdp-bar-top">
              <span className="fdp-bar-name">{name}</span>
              <span className="fdp-bar-val tnum">{text}</span>
            </div>
            <StackedBar totals={totals} mode={mode} label={`${name}: ${text} (${mode === "verified" ? "verified only" : "including planned"}, sample)`} />
            <div className="fdp-bar-foot tnum">
              {shown} of {total} half-units · {total - shown} still to verify{mode === "projected" ? " or plan" : ""}
            </div>
          </div>
        );
      })}
      <div className="fdp-bars-key" aria-hidden="true">
        {CREDIT_STATUSES.map((s) => (
          <span key={s}><StatusSwatch status={s} />{STATUS_LABEL[s]}</span>
        ))}
      </div>
    </div>
  );
}

/** Subject matrix: one square per half-unit, grouped by subject. Selecting a row opens its detail. */
export function SubjectStrips({ subjects, mode, onOpen }: { subjects: readonly PreviewSubject[]; mode: ViewMode; onOpen: (s: PreviewSubject) => void }) {
  return (
    <div className="fdp-strips" data-testid="subject-strips">
      {subjects.map((s) => {
        const cells = cellsFor(s.totals);
        const shown = mode === "verified" ? s.totals.verified : s.totals.verified + s.totals.in_progress + s.totals.planned;
        const cols = Math.min(s.requiredHalfUnits, 10);
        return (
          <button
            key={s.subject}
            type="button"
            className="fdp-strip"
            onClick={() => onOpen(s)}
            aria-label={`${s.label}: ${shown} of ${s.requiredHalfUnits} half-units ${mode === "verified" ? "verified" : "verified, in progress or planned"}. Open details.`}
            data-testid={`subject-${s.subject}`}
          >
            <span className="fdp-strip-label">{s.label}</span>
            <span className="fdp-strip-meta tnum">
              {shown} of {s.requiredHalfUnits} <span className="fdp-strip-more">· details</span>
            </span>
            <span className="fdp-strip-cells" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 22px))` }} aria-hidden="true">
              {cells.map((c, i) => (
                <i key={i} className="fdp-cell" data-s={mode === "verified" && (c === "in_progress" || c === "planned") ? "open" : c} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function MilestoneTimeline() {
  return (
    <ol className="fdp-timeline" data-testid="milestones">
      {PREVIEW_MILESTONES.map((m) => (
        <li key={m.key} aria-current={m.state === "current" ? "step" : undefined}>
          <span className="fdp-dot" data-m={m.state}>
            {m.state === "done" && <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />}
          </span>
          <div>
            <p className="fdp-ms-title">{m.title}</p>
            <p className="fdp-ms-when">
              {m.when}
              <span className="fdp-ms-state">
                {" · "}
                {m.state === "done" ? "Done" : m.state === "current" ? "You are here" : "Upcoming"}
              </span>
            </p>
            <p className="fdp-ms-note">{m.note}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function NextActions() {
  return (
    <ul className="fdp-actions" data-testid="next-actions">
      {PREVIEW_ACTIONS.map((a) => (
        <li key={a.key}>
          <Link href={a.href} className="fdp-action" data-tone={a.tone}>
            <span className="fdp-action-icon" aria-hidden="true">
              {a.tone === "attention" ? <AlertCircle className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
            </span>
            <span>
              <span className="fdp-action-title">{a.title}</span>
              <br />
              <span className="fdp-action-detail">{a.detail}</span>
            </span>
            <span className="fdp-chip" data-tone={a.tone}>{a.due}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function FileStatus() {
  return (
    <ul className="fdp-files" data-testid="file-status">
      {PREVIEW_FILE_STATUS.map((f) => (
        <li key={f.key}>
          <Link href={f.href} className="fdp-file">
            <span className="fdp-file-label">{f.label}</span>
            <span className="fdp-file-value">{f.value}</span>
            <span className="fdp-file-detail">{f.detail}</span>
            <span className="fdp-file-mark" data-state={f.state}>
              {f.state === "attention" ? <AlertCircle className="h-4 w-4" aria-hidden="true" /> : <CircleDashed className="h-4 w-4" aria-hidden="true" />}
              {f.state === "attention" ? "Needs you" : "Info"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const LINK_ICONS: Record<string, typeof Flag> = {
  journey: Route,
  subjects: Layers,
  course: BookOpen,
  progress: GraduationCap,
  documents: FileText,
  support: HelpCircle,
  profile: User,
  billing: CreditCard,
};

export function QuickLinks() {
  return (
    <div className="fdp-links" data-testid="quick-links">
      {PREVIEW_QUICK_LINKS.map((q) => {
        const Icon = LINK_ICONS[q.key] ?? Flag;
        return (
          <Link key={q.key} href={q.href} className="fdp-link" data-testid={`quicklink-${q.key}`}>
            <span className="fdp-link-top">
              <Icon className="h-5 w-5" aria-hidden="true" />
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </span>
            <span>
              <span className="fdp-link-title">{q.title}</span>
              <br />
              <span className="fdp-link-blurb">{q.blurb}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
