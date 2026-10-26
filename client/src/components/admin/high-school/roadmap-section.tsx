/** Roadmap tab: configure the approved credits and electives in the draft, set the schedule, publish. */
import { useMemo, useState } from "react";
import { ArrowRightLeft, MoreHorizontal, Plus, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  addCourse, addTask, areaPlanRows, blockingDraftIssues, defaultOpenAreas, formatDate, statusLabel, fromTemplateBody, plannedHalfUnits, publishBody, publishGate, removeCourse, removeTask,
  replaceCourse, restoreCourse, saveDraftBody, setTaskDueDate, updateCourse, validateDraftContent, validateNewCourse, validateNewTask, type NewCourseForm,
} from "@/lib/admin-high-school-logic";
import { ActionMessage, DISABLED_CLASS, FIELD_CLASS, Field, GatedButton, MiniBar, Notice, Pill, SectionHeading, type SectionProps } from "./shared";
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

function CourseCard({ course, content, onChange, replacedBy }: { course: HsPlanCourse; content: HsRoadmapContent; onChange: (c: HsRoadmapContent) => void; replacedBy: string | null }) {
  const [replacing, setReplacing] = useState(false);
  const [form, setForm] = useState<NewCourseForm>({ ...EMPTY_COURSE, areaKey: course.areaKey, credits: formatHalfUnits(course.halfUnits) });
  const dim = course.status !== "planned";
  const problem = replacing ? validateNewCourse(content, form) : null;
  return (
    <li className={`space-y-3 px-4 py-3 ${dim ? "bg-muted/30" : ""}`} data-testid="plan-course" data-status={course.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-medium ${dim ? "text-muted-foreground line-through" : ""}`}>{course.title}</p>
          <p className="text-xs text-muted-foreground">
            {formatHalfUnits(course.halfUnits)} {course.halfUnits === 2 ? "credit" : "credits"} · {course.plannedStart || course.plannedEnd ? `${formatDate(course.plannedStart)} to ${formatDate(course.plannedEnd)}` : "Dates not set"}
            {course.replacesCourseKey ? ` · replaces ${content.courses.find((c) => c.key === course.replacesCourseKey)?.title ?? course.replacesCourseKey}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {course.status === "replaced" ? <Pill tone="warn">Replaced{replacedBy ? ` by ${replacedBy}` : ""} — history kept</Pill> : null}
          {course.status === "removed" ? <Pill tone="bad">Removed from plan — history kept</Pill> : null}
          {course.status === "planned" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label={`Actions for ${course.title}`}><MoreHorizontal className="h-4 w-4" aria-hidden="true" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setReplacing(true)}><ArrowRightLeft className="mr-2 h-4 w-4" aria-hidden="true" />Replace course…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onChange(removeCourse(content, course.key))}><Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Remove from plan</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {course.status === "removed" ? <Button type="button" variant="outline" size="sm" onClick={() => onChange(restoreCourse(content, course.key))}><Undo2 className="mr-1 h-4 w-4" aria-hidden="true" />Restore</Button> : null}
        </div>
      </div>
      {replacing ? (
        <div className="space-y-3 rounded-md border border-dashed p-3" data-testid="replace-form">
          <p className="text-sm">The new course takes over from <span className="font-medium">{course.title}</span>. This course stays in the history; progress and results already recorded are kept.</p>
          <CourseForm idPrefix={`rep-${course.key}`} content={content} value={form} onChange={setForm} />
          <div className="flex flex-wrap items-start gap-3">
            <GatedButton id={`rep-${course.key}-go`} size="sm" gate={problem ? { enabled: false, reason: problem } : { enabled: true, reason: null }} onClick={() => { onChange(replaceCourse(content, course.key, form)); setReplacing(false); }}>Replace course</GatedButton>
            <Button type="button" variant="ghost" size="sm" onClick={() => setReplacing(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}
      {course.status === "planned" ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Edit credit and dates, tasks ({course.tasks.length})</summary>
          <div className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[9rem_10rem_10rem]">
          <Field id={`c-${course.key}-credit`} label="Credit">
            <select id={`c-${course.key}-credit`} className={FIELD_CLASS} value={course.halfUnits} onChange={(e) => onChange(updateCourse(content, course.key, { halfUnits: Number(e.target.value) }))}>
              {[...new Set([...HALF_OPTIONS, course.halfUnits])].sort((a, b) => a - b).map((h) => <option key={h} value={h}>{formatHalfUnits(h)} credits</option>)}
            </select>
          </Field>
          <Field id={`c-${course.key}-start`} label="Planned start"><Input id={`c-${course.key}-start`} type="date" value={course.plannedStart ?? ""} onChange={(e) => onChange(updateCourse(content, course.key, { plannedStart: e.target.value || null }))} /></Field>
          <Field id={`c-${course.key}-end`} label="Planned end"><Input id={`c-${course.key}-end`} type="date" value={course.plannedEnd ?? ""} onChange={(e) => onChange(updateCourse(content, course.key, { plannedEnd: e.target.value || null }))} /></Field>
        </div>
<TaskEditor course={course} content={content} onChange={onChange} /></div>
        </details>
      ) : null}
    </li>
  );
}

function CreditPlan({ content }: { content: HsRoadmapContent }) {
  const rows = areaPlanRows(content);
  const planned = plannedHalfUnits(content);
  return (
    <Card data-testid="credit-plan">
      <CardHeader>
        <CardTitle className="text-base">Approved credits</CardTitle>
        <CardDescription>Planned {formatHalfUnits(planned)} of {formatHalfUnits(content.totalRequiredHalfUnits)} required credits. Planned credit is not earned credit.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto" tabIndex={0} role="region" aria-label="Credits by area">
        <table className="w-full min-w-[34rem] text-sm">
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
                <td className={`py-2 text-right tabular-nums ${r.gapHalfUnits !== 0 ? "font-medium" : "text-muted-foreground"}`}>{r.gapHalfUnits > 0 ? formatHalfUnits(r.gapHalfUnits) : r.gapHalfUnits < 0 ? `${formatHalfUnits(-r.gapHalfUnits)} over` : "Complete"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function RoadmapEditor({ state, studentId, isAdmin, eid }: Pick<SectionProps, "state" | "studentId" | "isAdmin"> & { eid: string }) {
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

      <Card data-testid="course-plan">
        <CardHeader>
          <CardTitle className="text-base">Courses, electives and tasks</CardTitle>
          <CardDescription>Each course is 0.5, 1 or more credits. Replacing or removing a course keeps its history; official results stay attached to it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-0 p-0">
          <Accordion type="multiple" value={openAreas} onValueChange={setOpenAreas} className="border-t">
            {areaGroups.map(({ row, courses }) => (
              <AccordionItem key={row.key} value={row.key} className="border-b" data-testid="area-group">
                <AccordionTrigger className="gap-3 px-4 py-3 hover:no-underline">
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-left">
                    <span className="min-w-[10rem] text-sm font-semibold">{row.label}</span>
                    <span className="flex min-w-[9rem] flex-1 items-center gap-3 text-xs font-normal text-muted-foreground">
                      <MiniBar className="max-w-[10rem]" value={row.plannedHalfUnits} max={row.requiredHalfUnits} over={row.gapHalfUnits < 0} />
                      <span className="whitespace-nowrap tabular-nums">{formatHalfUnits(row.plannedHalfUnits)} of {formatHalfUnits(row.requiredHalfUnits)} planned · {courses.filter((c) => c.status === "planned").length === 1 ? "1 course" : `${courses.filter((c) => c.status === "planned").length} courses`}</span>
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="p-0">
                  {courses.length === 0 ? <p className="border-t px-4 py-3 text-sm text-muted-foreground">No courses planned in this area yet. Add one below.</p> : (
                    <ul className="divide-y border-t">{courses.map((c) => <CourseCard key={c.key} course={c} content={content} onChange={setContent} replacedBy={replacedBy(c.key)} />)}</ul>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <div className="space-y-3 border-t p-4">
            <h3 className="text-sm font-semibold">Add a course or elective</h3>
            <CourseForm idPrefix="new-course" content={content} value={courseForm} onChange={setCourseForm} />
            <GatedButton id="new-course-add" variant="outline" gate={courseProblem ? { enabled: false, reason: courseProblem } : { enabled: true, reason: null }} onClick={() => { setContent(addCourse(content, courseForm)); setCourseForm(EMPTY_COURSE); }}>Add to plan</GatedButton>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <PacingCard content={content} onChange={setContent} />
        <PoliciesCard key={epoch} content={content} onChange={setContent} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Message to the student (optional)</CardTitle><CardDescription>Shown with the published roadmap.</CardDescription></CardHeader>
        <CardContent>
          <label htmlFor="rm-message" className="sr-only">Message to the student</label>
          <Textarea id="rm-message" rows={3} maxLength={600} value={content.studentMessage ?? ""} onChange={(e) => setContent({ ...content, studentMessage: e.target.value || null })} />
        </CardContent>
      </Card>

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

export function RoadmapSection({ state, studentId, isAdmin }: SectionProps) {
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
      {!draft ? (
        <Card data-testid="no-draft">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="max-w-xl text-sm">
              {cur.published ? <>
                <p className="font-medium">Version {cur.published.versionNumber} is published. There is no open draft.</p>
                <p className="text-muted-foreground">Start a new draft from the published version to adjust pacing, replace a course or reschedule. Progress and results are kept.</p>
              </> : <>
                <p className="font-medium">No roadmap yet.</p>
                <p className="text-muted-foreground">Create a draft from the {cur.template.title} template ({formatHalfUnits(cur.enrollment.totalRequiredHalfUnits)} credits required).</p>
              </>}
            </div>
            <div className="space-y-3">
              <ActionMessage message={fromTemplate.message} />
              <GatedButton id="rm-new-draft" pending={fromTemplate.pending} gate={{ enabled: true, reason: null }} onClick={() => fromTemplate.run(fromTemplateBody())}>
                {cur.published ? "Adjust pacing: new draft from published" : "Create draft from template"}
              </GatedButton>
            </div>
          </CardContent>
        </Card>
      ) : <RoadmapEditor key={`${draft.versionId}-${draft.draftRevision}`} state={state} studentId={studentId} isAdmin={isAdmin} eid={eid} />}
      <VersionHistory history={cur.versionHistory} />
    </section>
  );
}
