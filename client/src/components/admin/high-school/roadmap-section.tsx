/** Roadmap tab: configure the approved credits and electives in the draft, set the schedule, publish. */
import { useMemo, useState } from "react";
import { ArrowRightLeft, MoreHorizontal, Plus, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HS_TASK_KINDS, formatHalfUnits, type HsPlanCourse, type HsRoadmapContent, type HsTaskKind } from "@shared/high-school-contract";
import { adminHighSchoolApi } from "@/lib/admin-high-school-api";
import {
  CLOSED_RECORD_TEXT, addCourse, addTask, areaPlanRows, blockingDraftIssues, defaultOpenAreas, isOpenEnrollment, statusLabel, fromTemplateBody, plannedHalfUnits, publishBody, publishGate, removeCourse, removeTask,
  replaceCourse, restoreCourse, saveDraftBody, setTaskDueDate, updateCourse, validateDraftContent, validateNewCourse, validateNewTask, type NewCourseForm,
} from "@/lib/admin-high-school-logic";
import { ActionMessage, DISABLED_CLASS, FIELD_CLASS, Field, FormPanel, GatedButton, MiniBar, Notice, Pill, RecordButton, SectionCard, SectionHeading, useOpenForm, type OpenForm, type SectionProps } from "./shared";
import { useStaffAction } from "./use-staff-action";
import { useHs } from "./hs-i18n";
import { PacingCard, PoliciesCard, VersionHistory } from "./roadmap-parts";

const HALF_OPTIONS = [1, 2, 3, 4, 5, 6, 8];
const EMPTY_COURSE: NewCourseForm = { title: "", areaKey: "", credits: "1", plannedStart: "", plannedEnd: "" };

function CourseForm({ idPrefix, content, value, onChange, lockArea }: { idPrefix: string; content: HsRoadmapContent; value: NewCourseForm; onChange: (v: NewCourseForm) => void; lockArea?: boolean }) {
  const { t, credits } = useHs();
  const set = <K extends keyof NewCourseForm>(k: K, v: NewCourseForm[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.4fr_9rem_10rem_10rem]">
      <Field id={`${idPrefix}-title`} label={t("s32dir.hs.pe.courseTitle")}><Input id={`${idPrefix}-title`} value={value.title} onChange={(e) => set("title", e.target.value)} /></Field>
      <Field id={`${idPrefix}-area`} label={t("s32dir.hs.rm.area")}>
        <select id={`${idPrefix}-area`} className={FIELD_CLASS} value={value.areaKey} disabled={lockArea} onChange={(e) => set("areaKey", e.target.value)}>
          <option value="">{t("s32dir.hs.rm.choose")}</option>
          {content.areas.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
      </Field>
      <Field id={`${idPrefix}-credits`} label={t("s32dir.hs.rm.credit")}>
        <select id={`${idPrefix}-credits`} className={FIELD_CLASS} value={value.credits} onChange={(e) => set("credits", e.target.value)}>
          {HALF_OPTIONS.map((h) => <option key={h} value={formatHalfUnits(h)}>{credits(h)}</option>)}
        </select>
      </Field>
      <Field id={`${idPrefix}-start`} label={t("s32dir.hs.rm.pstart")}><Input id={`${idPrefix}-start`} type="date" value={value.plannedStart} onChange={(e) => set("plannedStart", e.target.value)} /></Field>
      <Field id={`${idPrefix}-end`} label={t("s32dir.hs.rm.pend")}><Input id={`${idPrefix}-end`} type="date" value={value.plannedEnd} onChange={(e) => set("plannedEnd", e.target.value)} /></Field>
    </div>
  );
}

function TaskEditor({ course, content, onChange }: { course: HsPlanCourse; content: HsRoadmapContent; onChange: (c: HsRoadmapContent) => void }) {
  const { t, x } = useHs();
  const [kind, setKind] = useState<HsTaskKind>("lesson");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const problem = validateNewTask({ kind, title, dueDate: due });
  const id = `task-${course.key}`;
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("s32dir.hs.rm.tasks.title")}</p>
      {course.tasks.length === 0 ? <p className="text-sm text-muted-foreground">{t("s32dir.hs.rm.tasks.none")}</p> : (
        <ul className="divide-y rounded-md border">
          {course.tasks.map((tk) => (
            <li key={tk.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <Pill tone={tk.kind === "lesson" ? "neutral" : "official"}>{x(statusLabel(tk.kind))}</Pill>
              <span className="min-w-0 flex-1 basis-40 break-words">{tk.title}</span>
              <label className="sr-only" htmlFor={`${id}-${tk.key}-due`}>{t("s32dir.hs.rm.tasks.due", { title: tk.title })}</label>
              <Input id={`${id}-${tk.key}-due`} type="date" className="h-9 w-40" value={tk.dueDate ?? ""} onChange={(e) => onChange(setTaskDueDate(content, course.key, tk.key, e.target.value))} />
              <Button type="button" variant="ghost" size="sm" aria-label={t("s32dir.hs.rm.tasks.remove", { title: tk.title })} onClick={() => onChange(removeTask(content, course.key, tk.key))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid items-end gap-3 sm:grid-cols-[8rem_1fr_10rem_auto]">
        <Field id={`${id}-kind`} label={t("s32dir.hs.rm.tasks.type")}><select id={`${id}-kind`} className={FIELD_CLASS} value={kind} onChange={(e) => setKind(e.target.value as HsTaskKind)}>{HS_TASK_KINDS.map((k) => <option key={k} value={k}>{x(statusLabel(k))}</option>)}</select></Field>
        <Field id={`${id}-title`} label={t("s32dir.hs.rm.tasks.titleLabel")}><Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field id={`${id}-due`} label={t("s32dir.hs.rm.tasks.dueLabel")}><Input id={`${id}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Button type="button" variant="outline" className={`min-h-10 ${DISABLED_CLASS}`} disabled={problem !== null} aria-label={t("s32dir.hs.rm.tasks.addAria", { course: course.title })} onClick={() => { onChange(addTask(content, course.key, { kind, title, dueDate: due })); setTitle(""); setDue(""); }}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />{t("s32dir.hs.rm.tasks.add")}</Button>
      </div>
    </div>
  );
}

function CourseCard({ course, content, onChange, replacedBy, form }: { course: HsPlanCourse; content: HsRoadmapContent; onChange: (c: HsRoadmapContent) => void; replacedBy: string | null; form: OpenForm }) {
  const { t, credits, date, fc } = useHs();
  const [repForm, setRepForm] = useState<NewCourseForm>({ ...EMPTY_COURSE, areaKey: course.areaKey, credits: formatHalfUnits(course.halfUnits) });
  const dim = course.status !== "planned";
  const repId = `replace-${course.key}`;
  const editId = `edit-${course.key}`;
  const problem = form.isOpen(repId) ? validateNewCourse(content, repForm) : null;
  return (
    <li className={`space-y-3 px-4 py-3 sm:px-5 ${dim ? "bg-muted/30" : ""}`} data-testid="plan-course" data-status={course.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-medium ${dim ? "text-muted-foreground line-through" : ""}`}>{course.title}</p>
          <p className="text-xs text-muted-foreground">
            <span className="tabular-nums">{credits(course.halfUnits)}</span> · {course.plannedStart || course.plannedEnd ? t("s32dir.hs.rm.course.dates", { a: date(course.plannedStart), b: date(course.plannedEnd) }) : t("s32dir.hs.rm.course.noDates")}
            {course.status === "planned" ? t(course.tasks.length === 1 ? "s32dir.hs.rm.course.task.one" : "s32dir.hs.rm.course.task.other", { n: course.tasks.length }) : ""}
            {course.replacesCourseKey ? t("s32dir.hs.rm.course.replaces", { title: content.courses.find((c) => c.key === course.replacesCourseKey)?.title ?? course.replacesCourseKey }) : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {course.status === "replaced" ? <Pill tone="warn">{replacedBy ? t("s32dir.hs.rm.course.replacedBy", { title: replacedBy }) : t("s32dir.hs.rm.course.replaced")}</Pill> : null}
          {course.status === "removed" ? <Pill tone="bad">{t("s32dir.hs.rm.course.removed")}</Pill> : null}
          {course.status === "planned" ? (
            <>
              <RecordButton form={form} id={editId} variant="outline" size="sm">{t("s32dir.hs.rm.course.edit")}</RecordButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label={t("s32dir.hs.rm.course.actions", { title: course.title })}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => form.open(repId)}><ArrowRightLeft className="mr-2 h-4 w-4" aria-hidden="true" />{t("s32dir.hs.rm.course.replaceMenu")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onChange(removeCourse(content, course.key))}><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />{t("s32dir.hs.rm.course.removeMenu")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
          {course.status === "removed" ? <Button type="button" variant="outline" size="sm" onClick={() => onChange(restoreCourse(content, course.key))}><Undo2 className="mr-1 h-4 w-4" aria-hidden="true" />{t("s32dir.hs.rm.course.restore")}</Button> : null}
        </div>
      </div>
      {form.isOpen(repId) ? (
        <FormPanel form={form} id={repId} className="space-y-3">
          <div data-testid="replace-form" className="space-y-3">
            <p className="text-sm">{t("s32dir.hs.rm.course.takeover.a")}<span className="font-medium">{course.title}</span>{t("s32dir.hs.rm.course.takeover.b")}</p>
            <CourseForm idPrefix={`rep-${course.key}`} content={content} value={repForm} onChange={setRepForm} />
            <div className="flex flex-wrap items-start gap-3">
              <GatedButton id={`rep-${course.key}-go`} size="sm" gate={problem ? { enabled: false, reason: problem } : { enabled: true, reason: null }} onClick={() => { onChange(replaceCourse(content, course.key, repForm)); form.close(); }}>{t("s32dir.hs.rm.course.replace")}</GatedButton>
              <Button type="button" variant="ghost" size="sm" onClick={() => form.close()}>{t("owner.cancel")}</Button>
            </div>
          </div>
        </FormPanel>
      ) : null}
      {course.status === "planned" ? (
        <FormPanel form={form} id={editId} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[9rem_10rem_10rem]">
            <Field id={`c-${course.key}-credit`} label={t("s32dir.hs.rm.credit")}>
              <select id={`c-${course.key}-credit`} className={FIELD_CLASS} value={course.halfUnits} onChange={(e) => onChange(updateCourse(content, course.key, { halfUnits: Number(e.target.value) }))}>
                {[...new Set([...HALF_OPTIONS, course.halfUnits])].sort((a, b) => a - b).map((h) => <option key={h} value={h}>{fc(h)} {t("s32dir.hs.rm.creditsWord")}</option>)}
              </select>
            </Field>
            <Field id={`c-${course.key}-start`} label={t("s32dir.hs.rm.pstart")}><Input id={`c-${course.key}-start`} type="date" value={course.plannedStart ?? ""} onChange={(e) => onChange(updateCourse(content, course.key, { plannedStart: e.target.value || null }))} /></Field>
            <Field id={`c-${course.key}-end`} label={t("s32dir.hs.rm.pend")}><Input id={`c-${course.key}-end`} type="date" value={course.plannedEnd ?? ""} onChange={(e) => onChange(updateCourse(content, course.key, { plannedEnd: e.target.value || null }))} /></Field>
          </div>
          <TaskEditor course={course} content={content} onChange={onChange} />
        </FormPanel>
      ) : null}
    </li>
  );
}

function CreditPlan({ content }: { content: HsRoadmapContent }) {
  const { t, fc } = useHs();
  const gapText = (gap: number): string => (gap > 0 ? fc(gap) : gap < 0 ? t("s32dir.hs.rm.over", { n: fc(-gap) }) : t("s32dir.hs.rm.fully"));
  const kindText = (k: string) => (k === "core" ? t("s32dir.hs.rm.kind.core") : k === "elective" ? t("s32dir.hs.rm.kind.elective") : k);
  const rows = areaPlanRows(content);
  const planned = plannedHalfUnits(content);
  return (
    <SectionCard testId="credit-plan" title={t("s32dir.hs.rm.plan.title")} description={<>{t("s32dir.hs.rm.plan.a")}<span className="tabular-nums">{t("s32dir.hs.pe.ofN", { a: fc(planned), b: fc(content.totalRequiredHalfUnits) })}</span>{t("s32dir.hs.rm.plan.b")}</>}>
      {/* Wide screens: a table. Phones: stacked rows, so Required and Planned never scroll out of view. */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("s32dir.hs.rm.plan.caption")}</caption>
          <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><th scope="col" className="py-2 pr-3 font-medium">{t("s32dir.hs.rm.area")}</th><th scope="col" className="py-2 pr-3 font-medium">{t("s32dir.hs.rm.plan.kind")}</th><th scope="col" className="w-[26%] py-2 pr-3 font-medium"><span className="sr-only">{t("s32dir.hs.rm.plan.vs")}</span></th><th scope="col" className="py-2 pr-3 text-right font-medium">{t("s32dir.hs.rm.plan.required")}</th><th scope="col" className="py-2 pr-3 text-right font-medium">{t("s32dir.hs.rm.plan.planned")}</th><th scope="col" className="py-2 text-right font-medium">{t("s32dir.hs.rm.plan.toPlan")}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-medium">{r.label}</th>
                <td className="py-2 pr-3 capitalize">{kindText(r.kind)}</td>
                <td className="py-2 pr-3"><MiniBar value={r.plannedHalfUnits} max={r.requiredHalfUnits} over={r.gapHalfUnits < 0} /></td>
                <td className="py-2 pr-3 text-right tabular-nums">{fc(r.requiredHalfUnits)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fc(r.plannedHalfUnits)}</td>
                <td className={`py-2 text-right tabular-nums ${r.gapHalfUnits !== 0 ? "font-medium" : "text-muted-foreground"}`}>{gapText(r.gapHalfUnits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y md:hidden" data-testid="credit-plan-rows">
        {rows.map((r) => (
          <li key={r.key} className="space-y-1.5 py-2.5 first:pt-0 last:pb-0">
            <p className="flex items-baseline justify-between gap-2 text-sm"><span className="font-medium">{r.label}</span><span className="text-xs capitalize text-muted-foreground">{kindText(r.kind)}</span></p>
            <MiniBar value={r.plannedHalfUnits} max={r.requiredHalfUnits} over={r.gapHalfUnits < 0} />
            <p className="text-xs text-muted-foreground">
              {t("s32dir.hs.rm.plan.required")} <span className="tabular-nums font-medium text-foreground">{fc(r.requiredHalfUnits)}</span> · {t("s32dir.hs.rm.plan.planned")} <span className="tabular-nums font-medium text-foreground">{fc(r.plannedHalfUnits)}</span> · {t("s32dir.hs.rm.plan.toPlan")} <span className={`tabular-nums ${r.gapHalfUnits !== 0 ? "font-medium text-foreground" : ""}`}>{gapText(r.gapHalfUnits)}</span>
            </p>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

export function RoadmapEditor({ state, studentId, isAdmin, eid, initialOpenForm }: Pick<SectionProps, "state" | "studentId" | "isAdmin" | "initialOpenForm"> & { eid: string }) {
  const { t, x, fc } = useHs();
  const form = useOpenForm(initialOpenForm ?? null);
  const cur = state.current!;
  const draft = cur.draft;
  const published = cur.published;
  const [content, setContent] = useState<HsRoadmapContent>(draft!.content);
  const [courseForm, setCourseForm] = useState<NewCourseForm>(EMPTY_COURSE);
  const [confirm, setConfirm] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const dirty = useMemo(() => JSON.stringify(content) !== JSON.stringify(draft!.content), [content, draft]);
  const save = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.saveDraft(studentId, eid, body), t("s32dir.hs.rm.draftSaved"));
  const publish = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.publish(studentId, eid, body), t("s32dir.hs.rm.published"));
  const issues = useMemo(() => validateDraftContent(content), [content]);
  const blocking = useMemo(() => blockingDraftIssues(content), [content]);
  const gate = publishGate(state, isAdmin, dirty, publish.pending);
  const courseProblem = validateNewCourse(content, courseForm);
  const replacedBy = (key: string) => content.courses.find((c) => c.replacesCourseKey === key)?.title ?? null;
  const areaGroups = areaPlanRows(content).map((r) => ({ row: r, courses: content.courses.filter((c) => c.areaKey === r.key) }));
  const [openAreas, setOpenAreas] = useState<string[]>(() => defaultOpenAreas(draft!.content));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{t("s32dir.hs.rm.draftVersion", { n: draft!.versionNumber })}</Badge>
          {dirty ? <Pill tone="warn">{t("s32dir.hs.rm.unsaved")}</Pill> : <Pill>{t("s32dir.hs.rm.saved")}</Pill>}
          {published ? <Pill tone="good">{t("s32dir.hs.rm.publishedVersion", { n: published.versionNumber })}</Pill> : <Pill>{t("s32dir.hs.rm.nothingPublished")}</Pill>}
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {dirty ? <Button type="button" variant="ghost" className="min-h-10" onClick={() => { setContent(draft!.content); setEpoch((n) => n + 1); }}>{t("s32dir.hs.rm.discard")}</Button> : null}
          <GatedButton id="rm-save" variant="outline" pending={save.pending} gate={dirty ? (blocking.length ? { enabled: false, reason: blocking[0]! } : { enabled: true, reason: null }) : { enabled: false, reason: x("No changes to save.") }}
            onClick={() => save.run(saveDraftBody(draft!.draftRevision, content))}>{t("s32dir.hs.rm.saveDraft")}</GatedButton>
          <GatedButton id="rm-publish" gate={gate} pending={publish.pending} onClick={() => setConfirm(true)}>{t("s32dir.hs.rm.publishBtn")}</GatedButton>
        </div>
      </div>
      <ActionMessage message={save.message} />
      <ActionMessage message={publish.message} />
      {draft!.validationErrors.length > 0 ? <Notice tone="error"><p className="font-medium">{t("s32dir.hs.rm.draftProblems")}</p><ul className="ml-4 list-disc">{draft!.validationErrors.map((e) => <li key={e}>{e}</li>)}</ul></Notice> : null}
      {issues.length > 0 ? (
        <details className="rounded-md border px-3 py-2 text-sm" data-testid="draft-issues">
          <summary className="cursor-pointer font-medium">{t(issues.length === 1 ? "s32dir.hs.rm.notes.one" : "s32dir.hs.rm.notes.other", { n: issues.length })}</summary>
          <ul className="ml-4 mt-2 list-disc space-y-1 text-muted-foreground">{issues.map((m) => <li key={m}>{x(m)}</li>)}</ul>
        </details>
      ) : null}

      <CreditPlan content={content} />

      <SectionCard testId="course-plan" flush title={t("s32dir.hs.rm.courses.title")} description={t("s32dir.hs.rm.courses.desc")}>
        <Accordion type="multiple" value={openAreas} onValueChange={setOpenAreas}>
          {areaGroups.map(({ row, courses }) => (
            <AccordionItem key={row.key} value={row.key} className="border-b" data-testid="area-group">
              <AccordionTrigger className="gap-3 px-4 py-3 hover:no-underline sm:px-5">
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-left">
                  <span className="min-w-[10rem] text-sm font-semibold">{row.label}</span>
                  <span className="flex min-w-[9rem] flex-1 items-center gap-3 text-xs font-normal text-muted-foreground">
                    <MiniBar className="max-w-[10rem]" value={row.plannedHalfUnits} max={row.requiredHalfUnits} over={row.gapHalfUnits < 0} />
                    <span className="tabular-nums">{t("s32dir.hs.rm.area.planned", { a: fc(row.plannedHalfUnits), b: fc(row.requiredHalfUnits), c: courses.filter((c) => c.status === "planned").length === 1 ? t("s32dir.hs.rm.area.course.one") : t("s32dir.hs.rm.area.course.other", { n: courses.filter((c) => c.status === "planned").length }) })}</span>
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="p-0">
                {courses.length === 0 ? <p className="border-t px-4 py-3 text-sm text-muted-foreground sm:px-5">{t("s32dir.hs.rm.area.empty")}</p> : (
                  <ul className="divide-y border-t">{courses.map((c) => <CourseCard key={c.key} course={c} content={content} onChange={setContent} replacedBy={replacedBy(c.key)} form={form} />)}</ul>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-sm font-semibold">{t("s32dir.hs.rm.addCourse.title")}</h4>
            <RecordButton form={form} id="add-course" variant="outline">{t("s32dir.hs.rm.addCourse")}</RecordButton>
          </div>
          <FormPanel form={form} id="add-course" className="space-y-3">
            <CourseForm idPrefix="new-course" content={content} value={courseForm} onChange={setCourseForm} />
            <GatedButton id="new-course-add" gate={courseProblem ? { enabled: false, reason: courseProblem } : { enabled: true, reason: null }} onClick={() => { setContent(addCourse(content, courseForm)); setCourseForm(EMPTY_COURSE); form.close(); }}>{t("s32dir.hs.rm.addToPlan")}</GatedButton>
          </FormPanel>
        </div>
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <PacingCard content={content} onChange={setContent} form={form} />
        <PoliciesCard key={epoch} content={content} onChange={setContent} form={form} />
      </div>

      <SectionCard title={t("s32dir.hs.rm.msg.title")} description={t("s32dir.hs.rm.msg.desc")}>
        <label htmlFor="rm-message" className="sr-only">{t("s32dir.hs.rm.msg.label")}</label>
        <Textarea id="rm-message" rows={3} maxLength={600} value={content.studentMessage ?? ""} onChange={(e) => setContent({ ...content, studentMessage: e.target.value || null })} />
      </SectionCard>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("s32dir.hs.rm.dlg.title", { n: draft!.versionNumber })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("s32dir.hs.rm.dlg.desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("owner.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => publish.run(publishBody(draft!.draftRevision, published?.versionId ?? null))}>{t("s32dir.hs.rm.dlg.publish")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function RoadmapSection({ state, studentId, isAdmin, initialOpenForm }: SectionProps) {
  const { t, x, fc } = useHs();
  const cur = state.current;
  const eid = cur?.enrollment.id ?? "";
  const fromTemplate = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.draftFromTemplate(studentId, eid, body), t("s32dir.hs.rm.draftCreated"));
  if (!cur) return <section aria-labelledby="hs-roadmap-h"><SectionHeading id="hs-roadmap-h" title={t("s32dir.hs.rm.heading")} /><Notice>{t("s32dir.hs.rm.needProgram")}</Notice></section>;
  const draft = cur.draft;
  return (
    <section aria-labelledby="hs-roadmap-h" className="space-y-5">
      <SectionHeading id="hs-roadmap-h" title={t("s32dir.hs.rm.heading")}>
        {t("s32dir.hs.rm.desc")}
      </SectionHeading>
      {!isOpenEnrollment(cur.enrollment) ? (
        <Notice tone="info" testId="closed-record">{x(CLOSED_RECORD_TEXT)} {t("s32dir.hs.rm.closed")}</Notice>
      ) : !draft ? (
        <SectionCard testId="no-draft" title={cur.published ? t("s32dir.hs.rm.nd.published", { n: cur.published.versionNumber }) : t("s32dir.hs.rm.nd.none")}
          description={cur.published ? t("s32dir.hs.rm.nd.descPublished") : t("s32dir.hs.rm.nd.descNew", { title: cur.template.title, n: fc(cur.enrollment.totalRequiredHalfUnits) })}>
          <ActionMessage message={fromTemplate.message} />
          <GatedButton id="rm-new-draft" pending={fromTemplate.pending} gate={{ enabled: true, reason: null }} onClick={() => fromTemplate.run(fromTemplateBody())}>
            {cur.published ? t("s32dir.hs.rm.nd.adjust") : t("s32dir.hs.rm.nd.create")}
          </GatedButton>
        </SectionCard>
      ) : <RoadmapEditor key={`${draft.versionId}-${draft.draftRevision}`} state={state} studentId={studentId} isAdmin={isAdmin} eid={eid} initialOpenForm={initialOpenForm} />}
      <VersionHistory history={cur.versionHistory} />
    </section>
  );
}
