/**
 * S27 Roadmap, log-first (high-school students). Calm by design: a header with one gold "Log progress" button, three
 * summary tiles, the courses open now (with assessment dots), the order of what comes next, electives awaiting the
 * school's approval, and completed courses folded away. Prop-driven; the container wires the real mutation.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Plus, RotateCcw } from "lucide-react";
import type { HsCourseView, StudentHighSchoolView } from "@shared/high-school-contract";
import type { StudentJourneyView } from "@shared/s27-contract";
import { courseDescription } from "@/lib/hs-course-descriptions";
import { subjectLabel } from "@/pages/high-school-presentation";
import {
  averageScore, buildDots, completedTile, courseName, groupRoadmap, logGuidance, loggableCourses, nextTaskOf, passedCount, progressPayload, workTasks,
  type Dot, type LogCourseOption, type LogMode,
} from "@/lib/s27/roadmap-model";
import { creditFigures, toCredits } from "@/lib/s27/cockpit-model";
import { formatDay } from "@/lib/s27/dates";
import { useS27T } from "@/lib/s27/i18n-util";
import type { TranslationKey } from "@/i18n";
import { S27Page, Eyebrow, S27Sheet } from "./ui";

export interface LogSubmit {
  readonly body: ReturnType<typeof progressPayload> extends infer R ? R extends { ok: true; body: infer B } ? B : never : never;
  readonly kind: "lesson" | "exam" | "project";
  readonly label: string;
  readonly mode: LogMode;
}
export type LogResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface RoadmapLogProps {
  readonly view: StudentHighSchoolView;
  readonly journey: StudentJourneyView | null;
  readonly today: string;
  /** Course key to open the Log sheet on (from ?log=). */
  readonly initialLog?: string | null;
  readonly onLog: (input: LogSubmit) => Promise<LogResult>;
  /** Other electives the student could choose (template / config). Omitted when none is configured. */
  readonly alternatives?: readonly string[];
  readonly detailsHref?: string;
}

export function RoadmapLog({ view, journey, today, initialLog = null, onLog, alternatives, detailsHref }: RoadmapLogProps) {
  const { t, lang, pl, num } = useS27T();
  const groups = useMemo(() => groupRoadmap(view), [view]);
  const figures = useMemo(() => creditFigures(view), [view]);
  const options = useMemo(() => loggableCourses(view), [view]);
  const [logOpen, setLogOpen] = useState(false);
  const [logCourse, setLogCourse] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const tile = completedTile(groups);
  const pace = journey?.pace ?? null;

  const openLog = (courseKey: string | null) => { setLogCourse(courseKey); setLogOpen(true); };
  useEffect(() => {
    if (initialLog && options.some((o) => o.key === initialLog)) openLog(initialLog);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLog]);

  const electiveCredits = toCredits(view.credits.elective.requiredHalfUnits);
  const completedCredits = groups.completed.reduce((n, c) => n + toCredits(c.halfUnits), 0);
  const creditLabel = (c: HsCourseView) => pl("s27.rm.credit", toCredits(c.halfUnits), { n: num(toCredits(c.halfUnits)) });

  return (
    <S27Page testId="hs-roadmap">
      <section className="rm2-head">
        <div>
          <Eyebrow>{t("s27.rm.eyebrow")}</Eyebrow>
          <h1>{t("s27.rm.title")}</h1>
          <p>{t("s27.rm.intro")}</p>
        </div>
        <button className="b-log" type="button" onClick={() => openLog(null)} data-testid="rm-log-open">
          <Plus aria-hidden="true" size={18} strokeWidth={2.4} />{t("s27.rm.log")}
        </button>
      </section>

      <section className="rm2-sum" aria-label={t("s27.rm.summary")} data-testid="rm-summary">
        <div>
          <span className="k">{t("s27.rm.tile.credits")}</span>
          <span className="v">{num(figures.confirmed)}<small>{t("s27.rm.tile.creditsOf", { n: num(figures.required) })}</small></span>
          <span className="meter" aria-hidden="true"><i style={{ width: `${figures.fraction * 100}%` }} /></span>
        </div>
        <div>
          <span className="k">{t("s27.rm.tile.courses")}</span>
          <span className="v">{tile.done}<small>{t("s27.rm.tile.coursesOf", { n: tile.total })}</small></span>
          <span className="meter" aria-hidden="true"><i style={{ width: `${tile.total ? (tile.done / tile.total) * 100 : 0}%` }} /></span>
        </div>
        {pace && (
          <div>
            <span className="k">{t("s27.rm.tile.exams")}</span>
            <span className="v">{pace.examsThisWeek}<small>{pace.weeklyExamLimit ? t("s27.rm.tile.examsOf", { n: pace.weeklyExamLimit }) : t("s27.rm.tile.examsNoLimit")}</small></span>
            {pace.weeklyExamLimit ? <span className="meter" aria-hidden="true"><i style={{ width: `${Math.min(100, (pace.examsThisWeek / pace.weeklyExamLimit) * 100)}%` }} /></span> : null}
          </div>
        )}
      </section>

      <section className="rm2-sec" aria-labelledby="now-h" data-testid="rm-now">
        <div className="rm2-st"><h2 id="now-h">{t("s27.rm.now")}</h2><span>{pl("s27.rm.nowCount", groups.now.length)}</span></div>
        {groups.now.length === 0 ? (
          <div className="state"><p>{t("s27.rm.nowEmpty")}</p></div>
        ) : (
          <div className="nowgrid">
            {groups.now.map((c) => <NowCard key={c.key} course={c} onLog={() => openLog(c.key)} canLog={options.some((o) => o.key === c.key)} lang={lang} />)}
          </div>
        )}
      </section>

      {groups.upNext.length > 0 && (
        <section className="rm2-sec" aria-labelledby="up-h" data-testid="rm-upnext">
          <div className="rm2-st"><h2 id="up-h">{t("s27.rm.up")}</h2><span>{t("s27.rm.upNote")}</span></div>
          <ol className="uplist">
            {groups.upNext.map(({ course, no }) => {
              const n = workTasks(course).length;
              return (
                <li key={course.key}>
                  <span className="no">{no}</span>
                  <span><b>{courseName(course.title)}</b><small>{subjectLabel(course.subject, lang)}{n > 0 ? ` · ${pl("s27.rm.assessments", n)}` : ""}</small></span>
                  <span className="r">{creditLabel(course)}{course.plannedStart && <><br />{t("s27.rm.startsAbout", { date: formatDay(course.plannedStart, lang) })}</>}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {groups.electives.length > 0 && (
        <section className="rm2-sec" aria-labelledby="el-h" data-testid="rm-electives">
          <div className="rm2-st"><h2 id="el-h">{t("s27.rm.el")}</h2><span>{t("s27.rm.elNote", { n: num(electiveCredits) })}</span></div>
          <ol className="uplist">
            {groups.electives.map(({ course, no }) => (
              <li key={course.key}>
                <span className="no">{no}</span>
                <span><b>{courseName(course.title)}</b><small>{courseDescription(course.key, lang) ?? subjectLabel(course.subject, lang)}</small></span>
                <span className="r"><span className="pill warn"><i />{t("s27.rm.awaiting")}</span></span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {alternatives && alternatives.length > 0 && (
        <section className="rm2-sec alts" aria-labelledby="alt-h" data-testid="rm-alternatives">
          <div className="rm2-st"><h2 id="alt-h" style={{ fontSize: "1.25rem" }}>{t("s27.rm.alt")}</h2><span>{t("s27.rm.altNote")}</span></div>
          <div className="altchips">{alternatives.map((a) => <span key={a}>{a}</span>)}</div>
        </section>
      )}

      {groups.completed.length > 0 && (
        <section className="rm2-sec" aria-labelledby="dn-h" data-testid="rm-completed">
          <div className="rm2-st">
            <h2 id="dn-h">{t("s27.rm.done", { n: groups.completed.length, c: num(completedCredits) })}</h2>
            <button className="link" type="button" aria-expanded={showDone} aria-controls="rm-donelist" onClick={() => setShowDone((v) => !v)}>{showDone ? t("s27.rm.hide") : t("s27.rm.showAll")}</button>
          </div>
          <div id="rm-donelist" hidden={!showDone}>
            <div className="donegrid">
              {groups.completed.map((c) => {
                const avg = averageScore(c);
                return <div key={c.key} className="dc"><b>{courseName(c.title)}</b><span>{avg !== null ? `${avg}%` : "✓"}</span></div>;
              })}
            </div>
          </div>
        </section>
      )}

      {detailsHref && <Link className="link more-link" href={detailsHref} data-testid="rm-details-link">{t("s27.rm.details")} →</Link>}
      <p className="small">{t("s27.rm.footer")}</p>

      <LogSheet open={logOpen} onOpenChange={setLogOpen} options={options} initialCourse={logCourse} onLog={onLog} />
    </S27Page>
  );
}

// ── Now cards ───────────────────────────────────────────────────────────────

function DotView({ dot }: { dot: Dot }) {
  const { t } = useS27T();
  const cls = ["dt2", dot.state === "todo" ? "" : dot.state, dot.project ? "proj" : ""].filter(Boolean).join(" ");
  return <span className={cls} title={`${dot.title} · ${t(`s27.rm.dot.${dot.state}` as TranslationKey)}`}>{dot.label}</span>;
}

function NowCard({ course, onLog, canLog, lang }: { course: HsCourseView; onLog: () => void; canLog: boolean; lang: "en" | "fr" }) {
  const { t, pl, num } = useS27T();
  const dots = buildDots(course);
  const k = passedCount(course);
  const next = nextTaskOf(course);
  const waiting = course.status === "awaiting_school";
  const retake = next?.status === "retake_required";
  const name = courseName(course.title);
  return (
    <article className={`nc${waiting ? " wait" : ""}`} data-testid={`now-${course.key}`} data-status={course.status}>
      <span className="sj">{subjectLabel(course.subject, lang)} · {pl("s27.rm.credit", toCredits(course.halfUnits), { n: num(toCredits(course.halfUnits)) })}</span>
      <h3>{name}</h3>
      <div className="dots" aria-hidden="true">{dots.map((d) => <DotView key={d.key} dot={d} />)}</div>
      {waiting ? (
        <p className="nx"><b>{t("s27.rm.allPassed").split(". ")[0]}.</b> {t("s27.rm.allPassed").split(". ").slice(1).join(". ")}</p>
      ) : next ? (
        <p className={`nx${retake ? " warn" : ""}`}>
          {t("s27.rm.next")} <b>{next.title}</b>{next.dueDate ? <> · {t("s27.rm.planned", { date: formatDay(next.dueDate, lang, "weekday") })}</> : null}
          {retake && <><br /><RotateCcw className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />{t("s27.rm.retake")}</>}
        </p>
      ) : null}
      {!waiting && k.waiting > 0 && <p className="nx">{t("s27.rm.waitGrade", { n: k.waiting })}</p>}
      <div className="row">
        <span className="pct">{t("s27.rm.passed", { d: k.done, t: k.total, pct: k.pct })}</span>
        {!waiting && canLog && <button className="b-sm" type="button" onClick={onLog} aria-label={t("s27.rm.logCourseAria", { course: name })} data-testid={`now-log-${course.key}`}>{t("s27.rm.logCourse")}</button>}
      </div>
    </article>
  );
}

// ── Log sheet ───────────────────────────────────────────────────────────────

function LogSheet({ open, onOpenChange, options, initialCourse, onLog }: {
  open: boolean; onOpenChange: (o: boolean) => void; options: readonly LogCourseOption[]; initialCourse: string | null; onLog: (i: LogSubmit) => Promise<LogResult>;
}) {
  const { t } = useS27T();
  const [courseKey, setCourseKey] = useState("");
  const [itemKey, setItemKey] = useState("");
  const [mode, setMode] = useState<LogMode>("submitted");
  const [score, setScore] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const course = options.find((o) => o.key === courseKey) ?? null;
  const item = course?.items.find((i) => i.key === itemKey) ?? null;

  // Every time the sheet opens: pre-select the course and the course's next task.
  useEffect(() => {
    if (!open) return;
    const c = options.find((o) => o.key === initialCourse) ?? options[0] ?? null;
    setCourseKey(c?.key ?? "");
    setItemKey(c?.defaultItemKey ?? "");
    setMode("submitted");
    setScore("");
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCourse]);

  const pickCourse = (key: string) => {
    const c = options.find((o) => o.key === key);
    setCourseKey(key);
    setItemKey(c?.defaultItemKey ?? "");
  };

  const guidance = logGuidance({ mode, scoreRaw: score, kind: item?.kind ?? null });
  const hint = guidance.key === "none" ? "" : t(`s27.log.hint.${guidance.key}` as TranslationKey, { pass: 65 });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!course || !item || busy) return;
    const payload = progressPayload({ courseKey: course.key, taskKey: item.key, mode, scoreRaw: score, expectedRevision: item.revision });
    if (!payload.ok) { setError(t("s27.log.hint.scoreRange")); return; }
    setBusy(true);
    setError(null);
    const res = await onLog({ body: payload.body, kind: item.kind, label: item.title, mode });
    setBusy(false);
    if (res.ok) onOpenChange(false);
    else setError(res.message);
  };

  return (
    <S27Sheet open={open} onOpenChange={onOpenChange} title={t("s27.log.title")} closeLabel={t("s27.common.close")} testId="log-sheet">
      {options.length === 0 ? (
        <p className="hint">{t("s27.log.empty")}</p>
      ) : (
        <form className="sh-form" onSubmit={submit} noValidate data-testid="log-form">
          <label className="fl" htmlFor="lg-course">{t("s27.log.course")}</label>
          <select id="lg-course" value={courseKey} onChange={(e) => pickCourse(e.target.value)}>
            {options.map((o) => <option key={o.key} value={o.key}>{o.title}</option>)}
          </select>
          <label className="fl" htmlFor="lg-item">{t("s27.log.item")}</label>
          <select id="lg-item" value={itemKey} onChange={(e) => setItemKey(e.target.value)}>
            {(course?.items ?? []).map((i) => <option key={i.key} value={i.key}>{i.title}{i.submitted ? ` ${t("s27.log.submittedSuffix")}` : ""}</option>)}
          </select>
          <span className="fl" id="lg-where">{t("s27.log.where")}</span>
          <div className="seg" role="radiogroup" aria-labelledby="lg-where">
            <button type="button" role="radio" aria-checked={mode === "submitted"} onClick={() => setMode("submitted")}>{t("s27.log.mode.submitted")}<small>{t("s27.log.mode.submittedSub")}</small></button>
            <button type="button" role="radio" aria-checked={mode === "graded"} onClick={() => setMode("graded")}>{t("s27.log.mode.graded")}<small>{t("s27.log.mode.gradedSub")}</small></button>
          </div>
          {mode === "graded" && (
            <div>
              <label className="fl" htmlFor="lg-score">{t("s27.log.score")}</label>
              <input id="lg-score" type="number" min={0} max={100} inputMode="numeric" placeholder={t("s27.log.scorePh")} value={score} onChange={(e) => setScore(e.target.value)} aria-describedby="lg-hint" />
            </div>
          )}
          <p id="lg-hint" className={`hint${guidance.tone === "bad" ? " bad" : ""}`} aria-live="polite" data-testid="log-hint">{hint}</p>
          {error && <p className="hint bad" role="alert" data-testid="log-error">{error}</p>}
          <button className="b-log full" type="submit" disabled={busy || !item}>{busy ? t("s27.log.saving") : t("s27.log.save")}</button>
        </form>
      )}
    </S27Sheet>
  );
}
