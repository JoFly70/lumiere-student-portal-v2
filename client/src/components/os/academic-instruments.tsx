/**
 * Instruments of the real Academic Flight Deck (S18). They render view models from
 * lib/academic-flight-deck-presentation and reuse the S17 preview's visual language (styles/flight-deck-preview.css
 * classes). They never import the preview's synthetic data.
 */
import { useState } from "react";
import { Link } from "wouter";
import { AlertCircle, Check, ListChecks, ChevronDown } from "lucide-react";
import { formatHalfUnits, HALF_UNITS_PER_CREDIT } from "@shared/high-school-contract";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  CREDIT_STATUSES,
  STATUS_LABEL,
  creditsText,
  type CoverageRow,
  type CreditStatus,
  type GaugeModel,
  type LegendRow,
  type MilestoneModel,
  type NextActionModel,
  type SubjectDetail,
  type SubjectStripModel,
  type ViewMode,
} from "@/lib/academic-flight-deck-presentation";

export function StatusSwatch({ status }: { status: CreditStatus }) {
  return <i className="fdp-swatch" data-s={status} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------------------------- gauge

const SIZE = 240;
const C = SIZE / 2;
const R = 100;
const START = 135;
const SWEEP = 270;
const GAP_DEG = 0.9;

function point(angle: number, radius = R): [number, number] {
  const a = (angle * Math.PI) / 180;
  return [C + radius * Math.cos(a), C + radius * Math.sin(a)];
}
function arc(from: number, to: number): string {
  const [x0, y0] = point(from);
  const [x1, y1] = point(to);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const SEG_STROKE: Record<string, { stroke: string; dash?: string; opacity?: number }> = {
  official: { stroke: "var(--t-green)" },
  awaiting_school: { stroke: "var(--t-amber)", dash: "2 2" },
  in_progress: { stroke: "var(--t-blue)" },
  planned: { stroke: "var(--t-text-2)", dash: "5 3", opacity: 0.55 },
};

export function AcademicGauge({ gauge }: { gauge: GaugeModel }) {
  const total = gauge.requiredHalfUnits;
  const toAngle = (n: number) => START + (SWEEP * n) / total;
  const ticks = Array.from({ length: Math.floor(total / 2) + 1 }, (_, i) => toAngle(i * 2));
  return (
    <div className="fdp-gauge" data-testid="credit-gauge">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={gauge.ariaLabel}>
        <path className="track" d={arc(START, START + SWEEP)} />
        {ticks.map((a, i) => {
          const [x0, y0] = point(a, R - 16);
          const [x1, y1] = point(a, R - 21);
          return <line key={i} className="tick" x1={x0} y1={y0} x2={x1} y2={y1} />;
        })}
        {gauge.segments.map((s) => {
          if (!s.halfUnits) return null;
          const style = SEG_STROKE[s.status]!;
          const hidden = !s.visible;
          return (
            <path
              key={s.status}
              className={`seg${hidden ? " off" : ""}`}
              data-segment={s.status}
              d={arc(toAngle(s.from) + GAP_DEG / 2, toAngle(s.to) - GAP_DEG / 2)}
              stroke={style.stroke}
              strokeDasharray={style.dash}
              opacity={hidden ? 0 : style.opacity}
            >
              <title>{`${STATUS_LABEL[s.status]}: ${formatHalfUnits(s.halfUnits)} credits`}</title>
            </path>
          );
        })}
      </svg>
      <div className="fdp-gauge-center">
        <div className="fdp-gauge-num tnum" data-testid="gauge-value">{formatHalfUnits(gauge.shownHalfUnits)}</div>
        <div className="fdp-gauge-of">of {formatHalfUnits(total)} credits</div>
        <div className="fdp-gauge-cap">{gauge.caption}</div>
      </div>
    </div>
  );
}

export function AcademicLegend({ rows }: { rows: readonly LegendRow[] }) {
  return (
    <ul className="fdp-legend" data-testid="status-legend">
      {rows.map((r) => (
        <li key={r.status} data-dim={r.dim} data-status={r.status}>
          <StatusSwatch status={r.status} />
          <span className="l-name">
            {r.label}
            <span className="l-hint">{r.hint}</span>
          </span>
          <span className="l-val tnum" data-testid={`legend-${r.status}`}>
            {r.creditsText}
            <small>{r.halfUnitsText}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------- coverage

function StackedBar({ row, mode }: { row: CoverageRow; mode: ViewMode }) {
  const { tally } = row;
  const parts = CREDIT_STATUSES.filter((s) => s !== "open" && tally[s] > 0 && (mode === "projected" || s === "official"));
  return (
    <div className="fdp-bar" role="img" aria-label={`${row.name}: ${row.text} (${mode === "verified" ? "official only" : "including awaiting, in progress and planned"})`}>
      {parts.map((s) => (
        <i key={s} className="fdp-cell" data-s={s} style={{ width: `${(tally[s] / tally.required) * 100}%` }} />
      ))}
    </div>
  );
}

export function AcademicCoverage({ main, areas, mode }: { main: readonly CoverageRow[]; areas: readonly CoverageRow[]; mode: ViewMode }) {
  return (
    <div className="fdp-bars" data-testid="coverage-bars">
      {main.map((row) => (
        <div key={row.key} data-testid={`coverage-${row.key}`}>
          <div className="fdp-bar-top">
            <span className="fdp-bar-name">{row.name}</span>
            <span className="fdp-bar-val tnum">{row.text}</span>
          </div>
          <StackedBar row={row} mode={mode} />
          <div className="fdp-bar-foot tnum">{row.foot}</div>
        </div>
      ))}
      {areas.length > 0 && (
        <details className="fdl-areas" data-testid="coverage-areas">
          <summary>By requirement area</summary>
          <div className="fdl-areas-list">
            {areas.map((row) => (
              <div key={row.key} data-testid={`coverage-${row.key}`}>
                <div className="fdp-bar-top">
                  <span className="fdp-bar-name">{row.name}</span>
                  <span className="fdp-bar-val tnum">{row.text}</span>
                </div>
                <StackedBar row={row} mode={mode} />
              </div>
            ))}
          </div>
        </details>
      )}
      <div className="fdp-bars-key" aria-hidden="true">
        {CREDIT_STATUSES.map((s) => (
          <span key={s}><StatusSwatch status={s} />{STATUS_LABEL[s]}</span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- subjects

export function AcademicSubjectStrips({ subjects, onOpen }: { subjects: readonly SubjectStripModel[]; onOpen: (subject: SubjectStripModel["subject"]) => void }) {
  return (
    <div className="fdp-strips" data-testid="subject-strips">
      {subjects.map((s) => {
        const cols = Math.min(Math.max(s.tally.required, 1), 10);
        return (
          <button key={s.subject} type="button" className="fdp-strip" onClick={() => onOpen(s.subject)} aria-label={s.ariaLabel} data-testid={`subject-${s.subject}`}>
            <span className="fdp-strip-label">{s.label}</span>
            <span className="fdp-strip-meta tnum">
              {s.meta} <span className="fdp-strip-more">· details</span>
            </span>
            <span className="fdp-strip-cells" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 22px))` }} aria-hidden="true">
              {s.cells.map((c, i) => (
                <i key={i} className="fdp-cell" data-s={c} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- milestones

export function AcademicMilestones({ milestones }: { milestones: readonly MilestoneModel[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ol className="fdp-timeline" data-testid="milestones">
      {milestones.map((m) => {
        const expanded = open === m.key;
        return (
          <li key={m.key} aria-current={m.state === "current" ? "step" : undefined} data-state={m.state}>
            <span className="fdp-dot" data-m={m.state}>
              {m.state === "done" && <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />}
            </span>
            <div>
              <button
                type="button"
                className="fdl-ms-btn"
                aria-expanded={expanded}
                aria-controls={`ms-detail-${m.key}`}
                onClick={() => setOpen(expanded ? null : m.key)}
                data-testid={`milestone-${m.key}`}
              >
                <span>
                  <span className="fdp-ms-title">{m.title}</span>
                  <br />
                  <span className="fdp-ms-when">
                    {m.when}
                    <span className="fdp-ms-state">{" · "}{m.stateLabel}</span>
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 fdl-chev" aria-hidden="true" />
              </button>
              <p className="fdp-ms-note">{m.note}</p>
              {expanded && (
                <p className="fdl-ms-detail" id={`ms-detail-${m.key}`} data-testid={`milestone-detail-${m.key}`}>{m.detail}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------------------------- next actions

export function AcademicNextActions({ actions }: { actions: readonly NextActionModel[] }) {
  return (
    <ul className="fdp-actions" data-testid="next-actions">
      {actions.map((a) => (
        <li key={a.key}>
          <Link href={a.href} className="fdp-action" data-tone={a.tone} data-kind={a.kind} data-course-key={a.courseKey ?? undefined} data-testid={`action-${a.kind}`}>
            <span className="fdp-action-icon" aria-hidden="true">
              {a.tone === "attention" ? <AlertCircle className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
            </span>
            <span>
              <span className="fdp-action-title">{a.message}</span>
              <br />
              <span className="fdp-action-detail">{a.kindLabel} · {a.ownerLabel}</span>
            </span>
            {a.due && <span className="fdp-chip" data-tone={a.tone}>{a.due}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------- subject drawer

export function AcademicSubjectSheet({ detail, onClose }: { detail: SubjectDetail | null; onClose: () => void }) {
  return (
    <Sheet open={!!detail} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="fdp-sheet" data-testid="subject-sheet">
        {detail && (
          <>
            <SheetHeader className="fdp-sheet-head space-y-0 text-left">
              <SheetTitle className="fdp-sheet-title">{detail.label}</SheetTitle>
              <SheetDescription className="fdp-sheet-sub">{detail.subtitle}</SheetDescription>
            </SheetHeader>
            <div className="fdp-sheet-body">
              <section>
                <h3>Courses</h3>
                {detail.courses.length === 0 ? (
                  <p className="fdp-sheet-note" data-testid="sheet-no-courses">No courses are planned for this subject yet.</p>
                ) : (
                  <ul data-testid="sheet-courses">
                    {detail.courses.map((c) => (
                      <li key={c.key} className="fdl-course" data-course-key={c.key} data-basis={c.status} data-testid="sheet-course">
                        <div className="fdp-course" style={{ borderTop: 0 }}>
                          <StatusSwatch status={c.status} />
                          <div>
                            <div className="fdp-course-title">{c.title}</div>
                            <div className="fdp-course-status">
                              {c.basisLabel} · {c.courseStatusLabel}
                            </div>
                            <div className="fdp-course-status">
                              {c.kindLabel} · {c.areaLabel}
                              {c.dates ? ` · ${c.dates}` : ""}
                            </div>
                          </div>
                          <div className="fdp-course-hu tnum">
                            {c.halfUnitsText}
                            <small>{c.creditsText}</small>
                          </div>
                        </div>
                        <div className="fdl-tasks">
                          <p className="fdl-tasks-sum">{c.tasksText}</p>
                          {c.tasks.length > 0 && (
                            <ul>
                              {c.tasks.map((t) => (
                                <li key={t.key} data-testid="sheet-task" data-overdue={t.overdue}>
                                  <span>{t.title}</span>
                                  <span className="fdl-task-state">
                                    {t.statusLabel}
                                    {t.due ? ` · ${t.due}` : ""}
                                    {t.overdue ? " · overdue" : ""}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <Link href="/high-school" className="fdl-sheet-link" data-testid="sheet-link-high-school">
                  Open this in My High School
                </Link>
              </section>

              <section>
                <h3>Half-credit math</h3>
                <div className="fdp-math tnum" data-testid="subject-math">
                  {detail.math.map((row) => (
                    <div key={row.status} className="fdp-math-row" data-status={row.status}>
                      <span>
                        <StatusSwatch status={row.status} />
                        {row.label}
                      </span>
                      <span>{row.halfUnits} half-units</span>
                    </div>
                  ))}
                  <div className="fdp-math-row total">
                    <span>Requirement</span>
                    <span>{detail.requiredText}</span>
                  </div>
                </div>
                <p className="fdp-sheet-note" style={{ marginTop: 10 }}>
                  1 credit = {HALF_UNITS_PER_CREDIT} half-units, so a half-credit course counts as 1. Sums are exact whole numbers.
                </p>
              </section>

              {detail.areas.length > 1 && (
                <section>
                  <h3>Requirement areas</h3>
                  <div className="fdp-math tnum">
                    {detail.areas.map((a) => (
                      <div key={a.key} className="fdp-math-row">
                        <span>{a.label}</span>
                        <span>
                          {creditsText(a.officialHalfUnits)} official of {formatHalfUnits(a.requiredHalfUnits)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <p className="fdp-sheet-note">Only credit confirmed by the school is official. Everything else here is your own report or your plan.</p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
