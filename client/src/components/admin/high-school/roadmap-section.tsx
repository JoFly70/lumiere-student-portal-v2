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
  CLOSED_RECORD_TEXT, addCourse, addTask, areaPlanRows, blockingDraftIssues, creditsLabel, defaultOpenAreas, formatDate, isOpenEnrollment, statusLabel, fromTemplateBody, plannedHalfUnits, publishBody, publishGate, removeCourse, removeTask,
  replaceCourse, restoreCourse, saveDraftBody, setTaskDueDate, updateCourse, validateDraftContent, validateNewCourse, validateNewTask, type NewCourseForm,
} from "@/lib/admin-high-school-logic";
import { ActionMessage, DISABLED_CLASS, FIELD_CLASS, Field, FormPanel, GatedButton, MiniBar, Notice, Pill, RecordButton, SectionCard, SectionHeading, useOpenForm, type OpenForm, type SectionProps } from "./shared";
import { useStaffAction } from "./use-staff-action";
import { PacingCard, PoliciesCard, VersionHistory } from "./roadmap-parts";

const HALF_OPTIONS = [1, 2, 3, 4, 5, 6, 8];
const EMPTY_COURSE: NewCourseForm = { title: "", areaKey: "", credits: "1", plannedStart: "", plannedEnd: "" };

function CourseForm({ idPrefix, content, value, onChange, lockArea }: { idPrefix: string; content: HsRoadmapContent; value: NewCourseForm; onChange: (v: NewCourseForm) => void; lockArea?: boolean }) {
  const set = <K extends keyof NewCourseForm>(k: K, v: NewCourseForm[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.4fr_9rem_10rem_10rem]">
      <Field id={`${idPrefix}-title`} label="Course title"><Input id={`${idPrefix}-title`} value={value.title} onChange={(e) => set("title", e.target.value)} /></Field>
      <Field id={`${idPrefix}-area`} label="Area">
        <select id={`${idPrefix}-area`} className={FIELD_CLASS} value={value.areaKey} disabled={lockArea} onChange={(e) => set("areaKey", e.target.value)}>
          <option value="">Choose…</option>
          {content.areas.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
      </Field>
      <Field id={`${idPrefix}-credits`} label="Credit">
        <select id={`${idPrefix}-credits`} className={FIELD_CLASS} value={value.credits} onChange={(e) => set("credits", e.target.value)}>
          {HALF_OPTIONS.map((h) => <option key={h} value={formatHalfUnits(h)}>{formatHalfUnits(h)} {h === 2 ? "credit" : "credits"}</option>)}
        </select>
      </Field>
      <Field id={`${idPrefix}-start`} label="Planned start"><Input id={`${idPrefix}-start`} type="date" value={value.plannedStart} onChange={(e) => set("plannedStart", e.target.value)} /></Field>
      <Field id={`${idPrefix}-end`} label="Planned end"><Input id={`${idPrefix}-end`} type="date" value={value.plannedEnd} onChange={(e) => set("plannedEnd", e.target.value)} /></Field>
    </div>
  );
}

function TaskEditor({ course, content, onChange }: { course: HsPlanCourse; content: HsRoadmapContent; onChange: (c: HsRoadmapContent) => void }) {
  const [kind, setKind] = useState<HsTaskKind>("lesson");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const problem = validateNewTask({ kind, title, dueDate: due });
  const id = `task-${course.key}`;
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Lessons, exams and projects</p>
      {course.tasks.length === 0 ? <p className="text-sm text-muted-foreground">No tasks yet.</p> : (
        <ul className="divide-y rounded-md border">
          {course.tasks.map((t) => (
            <li key={t.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <Pill tone={t.kind === "lesson" ? "neutral" : "official"}>{statusLabel(t.kind)}</Pill>
              <span className="min-w-0 flex-1 basis-40 break-words">{t.title}</span>
              <label className="sr-only" htmlFor={`${id}-${t.key}-due`}>Due date for {t.title}</label>
              <Input id={`${id}-${t.key}-due`} type="date" className="h-9 w-40" value={t.dueDate ?? ""} onChange={(e) => onChange(setTaskDueDate(content, course.key, t.key, e.target.value))} />
              <Button type="button" variant="ghost" size="sm" aria-label={`Remove task ${t.title}`} onClick={() => onChange(removeTask(content, course.key, t.key))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid items-end gap-3 sm:grid-cols-[8rem_1fr_10rem_auto]">
        <Field id={`${id}-kind`} label="Type"><select id={`${id}-kind`} className={FIELD_CLASS} value={kind} onChange={(e) => setKind(e.target.value as HsTaskKind)}>{HS_TASK_KINDS.map((k) => <option key={k} value={k}>{statusLabel(k)}</option>)}</select></Field>
        <Field id={`${id}-title`} label="Task title"><Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field id={`${id}-due`} label="Due date"><Input id={`${id}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Button type="button" variant="outline" className={`min-h-10 ${DISABLED_CLASS}`} disabled={problem !== null} aria-label={`Add task to ${course.title}`} onClick={() => { onChange(addTask(content, course.key, { kind, title, dueDate: due })); setTitle(""); setDue(""); }}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />Add</Button>
      </div>
    </div>
  );
}

function CourseCard({ course, content, onChange, replacedBy, form }: { course: HsPlanCourse; content: HsRoadmapContent; onChange: (c: HsRoadmapContent) => void; replacedBy: string | null; form: OpenForm }) {
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
            <span className="tabular-nums">{creditsLabel(course.halfUnits)}</span> · {course.plannedStart || course.plannedEnd ? `${formatDate(course.plannedStart)} to ${formatDate(course.plannedEnd)}` : "Dates not set"}
            {course.status === "planned" ? ` · ${course.tasks.length} ${course.tasks.length === 1 ? "task" : "tasks"}` : ""}
            {course.replacesCourseKey ? ` · replaces ${content.courses.find((c) => c.key === course.replacesCourseKey)?.title ?? course.replacesCourseKey}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {course.status === "replaced" ? <Pill tone="warn">Replaced{replacedBy ? ` by ${replacedBy}` : ""} — history kept</Pill> : null}
          {course.status === "removed" ? <Pill tone="bad">Removed from plan — history kept</Pill> : null}
          {course.status === "planned" ? (
            <>
              <RecordButton form={form} id={editId} variant="outline" size="sm">Edit course and tasks</RecordButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Actions for ${course.title}`}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => form.open(repId)}><ArrowRightLeft className="mr-2 h-4 w-4" aria-hidden="true" />Replace course…</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onChange(removeCourse(content, course.key))}><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Remove from plan</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
          {course.status === "removed" ? <Button type="button" variant="outline" size="sm" onClick={() => onChange(restoreCourse(content, course.key))}><Undo2 className="mr-1 h-4 w-4" aria-hidden="true" />Restore</Button> : null}
        </div>
      </div>
      {form.isOpen(repId) ? (
        <FormPanel form={form} id={repId} className="space-y-3">
          <div data-testid="replace-form" className="space-y-3">
            <p className="text-sm">The new course takes over from <span className="font-medium">{course.title}</span>. This course stays in the history; progress and results already recorded are kept.</p>
            <CourseForm idPrefix={`rep-${course.key}`} content={content} value={repForm} onChange={setRepForm} />
            <div className="flex flex-wrap items-start gap-3">
              <GatedButton id={`rep-${course.key}-go`} size="sm" gate={problem ? { enabled: false, reason: problem } : { enabled: true, reason: null }} onClick={() => { onChange(replaceCourse(content, course.key, repForm)); form.close(); }}>Replace course</GatedButton>
              <Button type="button" variant="ghost" size="sm" onClick={() => form.close()}>Cancel</Button>
            </div>
          </div>
        </FormPanel>
      ) : null}
      {course.status === "planned" ? (
        <FormPanel form={form} id={editId} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[9rem_10rem_10rem]">
            <Field id={`c-${course.key}-credit`} label="Credit">
              <select id={`c-${course.key}-credit`} className={FIELD_CLASS} value={course.halfUnits} onChange={(e) => onChange(updateCourse(content, course.key, { halfUnits: Number(e.target.value) }))}>
                {[...new Set([...HALF_OPTIONS, course.halfUnits])].sort((a, b) => a - b).map((h) => <option key={h} value={h}>{formatHalfUnits(h)} credits</option>)}
              </select>
            </Field>
            <Field id={`c-${course.key}-start`} label="Planned start"><Input id={`c-${course.key}-start`} type="date" value={course.plannedStart ?? ""} onChange={(e) => onChange(updateCourse(content, course.key, { plannedStart: e.target.value || null }))} /></Field>
            <Field id={`c-${course.key}-end`} label="Planned end"><Input id={`c-${course.key}-end`} type="date" value={course.plannedEnd ?? ""} onChange={(e) => onChange(updateCourse(content, course.key, { plannedEnd: e.target.value || null }))} /></Field>
          </div>
          <TaskEditor course={course} content={content} onChange={onChange} />
        </FormPanel>
      ) : null}
    </li>
  );
}

const gapText = (gap: number): string => (gap > 0 ? formatHalfUnits(gap) : gap < 0 ? `${formatHalfUnits(-gap)} over` : "Fully planned");

function CreditPlan({ content }: { content: HsRoadmapContent }) {
  const rows = areaPlanRows(content);
  const planned = plannedHalfUnits(content);
  return (
    <SectionCard testId="credit-plan" title="Approved credits" description={<>Planned <span className="tabular-nums">{formatHalfUnits(planned)} of {formatHalfUnits(content.totalRequiredHalfUnits)}</span> required credits. Planned credit is not earned credit.</>}>
      {/* Wide screens: a table. Phones: stacked rows, so Required and Planned never scroll out of view. */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Required and planned credits by area</caption>
          <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><th scope="col" className="py-2 pr-3 font-medium">Area</th><th scope="col" className="py-2 pr-3 font-medium">Kind</th><th scope="col" className="w-[26%] py-2 pr-3 font-medium"><span className="sr-only">Planned against required</span></th><th scope="col" className="py-2 pr-3 text-right font-medium">Required</th><th scope="col" className="py-2 pr-3 text-right font-medium">Planned</th><th scope="col" className="py-2 text-right font-medium">Still to plan</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-medium">{r.label}</th>
                <td className="py-2 pr-3 capitalize">{r.kind}</td>
                <td className="py-2 pr-3"><MiniBar value={r.plannedHalfUnits} max={r.requiredHalfUnits} over={r.gapHalfUnits < 0} /></td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatHalfUnits(r.requiredHalfUnits)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatHalfUnits(r.plannedHalfUnits)}</td>
                <td className={`py-2 text-right tabular-nums ${r.gapHalfUnits !== 0 ? "font-medium" : "text-muted-foreground"}`}>{gapText(r.gapHalfUnits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y md:hidden" data-testid="credit-plan-rows">
        {rows.map((r) => (
          <li key={r.key} className="space-y-1.5 py-2.5 first:pt-0 last:pb-0">
            <p className="flex items-baseline justify-between gap-2 text-sm"><span className="font-medium">{r.label}</span><span className="text-xs capitalize text-muted-foreground">{r.kind}</span></p>
            <MiniBar value={r.plannedHalfUnits} max={r.requiredHalfUnits} over={r.gapHalfUnits < 0} />
            <p className="text-xs text-muted-foreground">
              Required <span className="tabular-nums font-medium text-foreground">{formatHalfUnits(r.requiredHalfUnits)}</span> · Planned <span className="tabular-nums font-medium text-foreground">{formatHalfUnits(r.plannedHalfUnits)}</span> · Still to plan <span className={`tabular-nums ${r.gapHalfUnits !== 0 ? "font-medium text-foreground" : ""}`}>{gapText(r.gapHalfUnits)}</span>
            </p>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

export function RoadmapEditor({ state, studentId, isAdmin, eid, initialOpenForm }: Pick<SectionProps, "state" | "studentId" | "isAdmin" | "initialOpenForm"> & { eid: string }) {
  const form = useOpenForm(initialOpenForm ?? null);
  const cur = state.current!;
  const draft = cur.draft;
  const published = cur.published;
  const [content, setContent] = useState<HsRoadmapContent>(draft!.content);
  const [courseForm, setCourseForm] = useState<NewCourseForm>(EMPTY_COURSE);
  const [confirm, setConfirm] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const dirty = useMemo(() => JSON.stringify(content) !== JSON.stringify(draft!.content), [content, draft]);
  const save = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.saveDraft(studentId, eid, body), "Draft saved.");
  const publish = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.publish(studentId, eid, body), "Roadmap published. The student now sees this version.");
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
          <Badge variant="outline">Draft version {draft!.versionNumber}</Badge>
          {dirty ? <Pill tone="warn">Unsaved changes</Pill> : <Pill>Saved</Pill>}
          {published ? <Pill tone="good">Published: version {published.versionNumber}</Pill> : <Pill>Nothing published yet</Pill>}
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {dirty ? <Button type="button" variant="ghost" className="min-h-10" onClick={() => { setContent(draft!.content); setEpoch((n) => n + 1); }}>Discard changes</Button> : null}
          <GatedButton id="rm-save" variant="outline" pending={save.pending} gate={dirty ? (blocking.length ? { enabled: false, reason: blocking[0]! } : { enabled: true, reason: null }) : { enabled: false, reason: "No changes to save." }}
            onClick={() => save.run(saveDraftBody(draft!.draftRevision, content))}>Save draft</GatedButton>
          <GatedButton id="rm-publish" gate={gate} pending={publish.pending} onClick={() => setConfirm(true)}>Publish approved roadmap</GatedButton>
        </div>
      </div>
      <ActionMessage message={save.message} />
      <ActionMessage message={publish.message} />
      {draft!.validationErrors.length > 0 ? <Notice tone="error"><p className="font-medium">The saved draft has problems:</p><ul className="ml-4 list-disc">{draft!.validationErrors.map((e) => <li key={e}>{e}</li>)}</ul></Notice> : null}
      {issues.length > 0 ? (
        <details className="rounded-md border px-3 py-2 text-sm" data-testid="draft-issues">
          <summary className="cursor-pointer font-medium">{issues.length} planning {issues.length === 1 ? "note" : "notes"} for this draft</summary>
          <ul className="ml-4 mt-2 list-disc space-y-1 text-muted-foreground">{issues.map((m) => <li key={m}>{m}</li>)}</ul>
        </details>
      ) : null}

      <CreditPlan content={content} />

      <SectionCard testId="course-plan" flush title="Courses, electives and tasks" description="Each course is 0.5, 1 or more credits. Replacing or removing a course keeps its history; official results stay attached to it. Tasks stay folded until you edit a course.">
        <Accordion type="multiple" value={openAreas} onValueChange={setOpenAreas}>
          {areaGroups.map(({ row, courses }) => (
            <AccordionItem key={row.key} value={row.key} className="border-b" data-testid="area-group">
              <AccordionTrigger className="gap-3 px-4 py-3 hover:no-underline sm:px-5">
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-left">
                  <span className="min-w-[10rem] text-sm font-semibold">{row.label}</span>
                  <span className="flex min-w-[9rem] flex-1 items-center gap-3 text-xs font-normal text-muted-foreground">
                    <MiniBar className="max-w-[10rem]" value={row.plannedHalfUnits} max={row.requiredHalfUnits} over={row.gapHalfUnits < 0} />
                    <span className="tabular-nums">{formatHalfUnits(row.plannedHalfUnits)} of {formatHalfUnits(row.requiredHalfUnits)} planned · {courses.filter((c) => c.status === "planned").length === 1 ? "1 course" : `${courses.filter((c) => c.status === "planned").length} courses`}</span>
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="p-0">
                {courses.length === 0 ? <p className="border-t px-4 py-3 text-sm text-muted-foreground sm:px-5">No courses planned in this area yet. Add one below.</p> : (
                  <ul className="divide-y border-t">{courses.map((c) => <CourseCard key={c.key} course={c} content={content} onChange={setContent} replacedBy={replacedBy(c.key)} form={form} />)}</ul>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-sm font-semibold">Add a course or elective</h4>
            <RecordButton form={form} id="add-course" variant="outline">Add a course</RecordButton>
          </div>
          <FormPanel form={form} id="add-course" className="space-y-3">
            <CourseForm idPrefix="new-course" content={content} value={courseForm} onChange={setCourseForm} />
            <GatedButton id="new-course-add" gate={courseProblem ? { enabled: false, reason: courseProblem } : { enabled: true, reason: null }} onClick={() => { setContent(addCourse(content, courseForm)); setCourseForm(EMPTY_COURSE); form.close(); }}>Add to plan</GatedButton>
          </FormPanel>
        </div>
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <PacingCard content={content} onChange={setContent} form={form} />
        <PoliciesCard key={epoch} content={content} onChange={setContent} form={form} />
      </div>

      <SectionCard title="Message to the student (optional)" description="Shown with the published roadmap.">
        <label htmlFor="rm-message" className="sr-only">Message to the student</label>
        <Textarea id="rm-message" rows={3} maxLength={600} value={content.studentMessage ?? ""} onChange={(e) => setContent({ ...content, studentMessage: e.target.value || null })} />
      </SectionCard>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish version {draft!.versionNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              The student will see this plan immediately. The previous version stays in the history, and progress and official results already recorded are kept. This is a plan and a target; it is not a promise of completion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => publish.run(publishBody(draft!.draftRevision, published?.versionId ?? null))}>Publish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function RoadmapSection({ state, studentId, isAdmin, initialOpenForm }: SectionProps) {
  const cur = state.current;
  const eid = cur?.enrollment.id ?? "";
  const fromTemplate = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.draftFromTemplate(studentId, eid, body), "Draft created.");
  if (!cur) return <section aria-labelledby="hs-roadmap-h"><SectionHeading id="hs-roadmap-h" title="Approved roadmap" /><Notice>Create the high school program first; the roadmap belongs to an enrollment.</Notice></section>;
  const draft = cur.draft;
  return (
    <section aria-labelledby="hs-roadmap-h" className="space-y-5">
      <SectionHeading id="hs-roadmap-h" title="Approved roadmap">
        Configure the approved credits and electives, the target schedule and any optional policies in a draft. Only an administrator publishes; the student never sees a draft.
      </SectionHeading>
      {!isOpenEnrollment(cur.enrollment) ? (
        <Notice tone="info" testId="closed-record">{CLOSED_RECORD_TEXT} The roadmap can no longer be changed; the published version and its history stay visible below.</Notice>
      ) : !draft ? (
        <SectionCard testId="no-draft" title={cur.published ? `Version ${cur.published.versionNumber} is published. There is no open draft.` : "No roadmap yet."}
          description={cur.published ? "Start a new draft from the published version to adjust pacing, replace a course or reschedule. Progress and results are kept." : `Create a draft from the ${cur.template.title} template (${formatHalfUnits(cur.enrollment.totalRequiredHalfUnits)} credits required).`}>
          <ActionMessage message={fromTemplate.message} />
          <GatedButton id="rm-new-draft" pending={fromTemplate.pending} gate={{ enabled: true, reason: null }} onClick={() => fromTemplate.run(fromTemplateBody())}>
            {cur.published ? "Adjust pacing: new draft from published" : "Create draft from template"}
          </GatedButton>
        </SectionCard>
      ) : <RoadmapEditor key={`${draft.versionId}-${draft.draftRevision}`} state={state} studentId={studentId} isAdmin={isAdmin} eid={eid} initialOpenForm={initialOpenForm} />}
      <VersionHistory history={cur.versionHistory} />
    </section>
  );
}
