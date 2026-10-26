/** Program tab: create/select the high school enrollment, history, disclosure, historical graduates. */
import { useState } from "react";
import { Link } from "wouter";
import { GraduationCap, University } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { BUILT_IN_TEMPLATES, GENERIC_SCHOOL_DESCRIPTION, HS_ENROLLMENT_STATUSES, formatHalfUnits, type HsCurriculumTemplate, type HsEnrollmentSummary } from "@shared/high-school-contract";
import { adminHighSchoolApi, useHsTemplates } from "@/lib/admin-high-school-api";
import {
  createEnrollmentBody, disclosureGate, enrollmentTimeline, evidenceGate, formatDate, isOpenEnrollment, noteGate, templateOptionLabel,
  updateEnrollmentBody, validateEnrollmentForm, type EnrollmentForm,
} from "@/lib/admin-high-school-logic";
import { ActionMessage, EvidenceSelect, FIELD_CLASS, Field, GatedButton, Notice, Pill, SectionHeading, type SectionProps } from "./shared";
import { useStaffAction } from "./use-staff-action";

const EMPTY_FORM: EnrollmentForm = { templateKey: "", templateVersion: 1, status: "planned", startedOn: "", targetCompletionDate: "", overrideCredits: "", overrideReason: "" };

export function CreateEnrollmentCard({ studentId, templates, hasOpen }: { studentId: string; templates: readonly HsCurriculumTemplate[]; hasOpen: boolean }) {
  const [form, setForm] = useState<EnrollmentForm>({ ...EMPTY_FORM, templateKey: templates[0]?.templateKey ?? "", templateVersion: templates[0]?.version ?? 1 });
  const action = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.createEnrollment(studentId, body), "High school program created.");
  const tpl = templates.find((t) => t.templateKey === form.templateKey && t.version === form.templateVersion) ?? templates[0];
  const problem = validateEnrollmentForm(form);
  const gate = hasOpen
    ? { enabled: false, reason: "This student already has an open high school program. Close it (withdrawn, transferred out or completed) before starting another." }
    : problem ? { enabled: false, reason: problem } : { enabled: true, reason: null };
  const set = <K extends keyof EnrollmentForm>(k: K, v: EnrollmentForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Card data-testid="create-enrollment">
      <CardHeader>
        <CardTitle className="text-base">Create high school program</CardTitle>
        <CardDescription>A student can hold several programs over time, but only one open high school program at once.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <Field id="hs-template" label="Curriculum template and version" hint={tpl ? `${formatHalfUnits(tpl.totalRequiredHalfUnits)} credits required by default${tpl.jurisdiction ? ` (${tpl.jurisdiction})` : ""}.` : undefined}>
          <select id="hs-template" className={FIELD_CLASS} aria-describedby="hs-template-hint" value={`${form.templateKey}@${form.templateVersion}`}
            onChange={(e) => { const [k, v] = e.target.value.split("@"); setForm((f) => ({ ...f, templateKey: k ?? "", templateVersion: Number(v) || 1 })); }}>
            {templates.map((t) => <option key={`${t.templateKey}@${t.version}`} value={`${t.templateKey}@${t.version}`}>{templateOptionLabel(t)}</option>)}
          </select>
        </Field>
        <Field id="hs-status" label="Starting status">
          <select id="hs-status" className={FIELD_CLASS} value={form.status} onChange={(e) => set("status", e.target.value as "planned" | "active")}>
            <option value="planned">Planned (not yet confirmed by the school)</option>
            <option value="active">Active (enrolled)</option>
          </select>
        </Field>
        <Field id="hs-started" label="Start date (optional)"><Input id="hs-started" type="date" value={form.startedOn} onChange={(e) => set("startedOn", e.target.value)} /></Field>
        <Field id="hs-target" label="Target completion date (optional)" hint="A target, not a guarantee."><Input id="hs-target" type="date" value={form.targetCompletionDate} onChange={(e) => set("targetCompletionDate", e.target.value)} aria-describedby="hs-target-hint" /></Field>
        <fieldset className="md:col-span-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">Total-required exception (optional)</legend>
          <p className="mb-3 text-xs text-muted-foreground">Leave blank to use the template total{tpl ? ` (${formatHalfUnits(tpl.totalRequiredHalfUnits)})` : ""}. Use for a state requirement such as 22 credits; a reason is required and kept in the record.</p>
          <div className="grid gap-4 md:grid-cols-[10rem_1fr]">
            <Field id="hs-override" label="Total credits"><Input id="hs-override" inputMode="decimal" placeholder="e.g. 22" value={form.overrideCredits} onChange={(e) => set("overrideCredits", e.target.value)} /></Field>
            <Field id="hs-override-reason" label="Reason for the exception"><Input id="hs-override-reason" value={form.overrideReason} onChange={(e) => set("overrideReason", e.target.value)} placeholder="Why this student's total differs" /></Field>
          </div>
        </fieldset>
        <div className="md:col-span-2 space-y-3">
          <ActionMessage message={action.message} />
          <GatedButton id="hs-create" gate={gate} pending={action.pending} onClick={() => tpl && action.run(createEnrollmentBody(form, tpl.totalRequiredHalfUnits))}>Create program</GatedButton>
        </div>
      </CardContent>
    </Card>
  );
}

function EnrollmentFacts({ e }: { e: HsEnrollmentSummary }) {
  const rows: [string, string][] = [
    ["Template", `${e.templateKey} v${e.templateVersion}`],
    ["Total required", `${formatHalfUnits(e.totalRequiredHalfUnits)} credits${e.jurisdiction ? ` · ${e.jurisdiction}` : ""}`],
    ["Started", formatDate(e.startedOn)],
    ["Target completion", formatDate(e.targetCompletionDate)],
    ["School reference", e.schoolStudentRef ?? "—"],
    ["Revision", String(e.revision)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
      {rows.map(([k, v]) => <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</dt><dd className="mt-0.5 break-words">{v}</dd></div>)}
    </dl>
  );
}

function EnrollmentEditor({ studentId, e }: { studentId: string; e: HsEnrollmentSummary }) {
  const [status, setStatus] = useState<string>(e.status);
  const [target, setTarget] = useState(e.targetCompletionDate ?? "");
  const [note, setNote] = useState("");
  const action = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.updateEnrollment(studentId, e.id, body), "Program updated.");
  const gate = noteGate(note);
  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={(ev) => { ev.preventDefault(); if (gate.enabled) action.run(updateEnrollmentBody(e.revision, { status, targetCompletionDate: target || null }, note), () => setNote("")); }}>
      <Field id="hs-edit-status" label="Status">
        <select id="hs-edit-status" className={FIELD_CLASS} value={status} onChange={(ev) => setStatus(ev.target.value)}>
          {HS_ENROLLMENT_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
      </Field>
      <Field id="hs-edit-target" label="Target completion date"><Input id="hs-edit-target" type="date" value={target} onChange={(ev) => setTarget(ev.target.value)} /></Field>
      <Field id="hs-edit-note" label="Note for the record (required)" className="md:col-span-2"><Input id="hs-edit-note" value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Why this change" /></Field>
      <div className="md:col-span-2 space-y-3">
        <ActionMessage message={action.message} />
        <GatedButton id="hs-edit-save" type="submit" variant="outline" gate={gate} pending={action.pending}>Save changes</GatedButton>
      </div>
    </form>
  );
}

export function DisclosureCard({ studentId, e }: { studentId: string; e: HsEnrollmentSummary }) {
  const [disclosed, setDisclosed] = useState(e.institutionDisclosed);
  const [name, setName] = useState(e.awardingSchoolName ?? "");
  const [note, setNote] = useState("");
  const action = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.updateEnrollment(studentId, e.id, body), "Disclosure setting saved.");
  const dg = disclosureGate(e, disclosed, name, GENERIC_SCHOOL_DESCRIPTION);
  const ng = noteGate(note);
  const gate = !dg.enabled ? dg : ng;
  return (
    <Card data-testid="disclosure-card">
      <CardHeader>
        <CardTitle className="text-base">Institution disclosure</CardTitle>
        <CardDescription>The awarding school's name is confidential. Until you disclose it, the student sees a generic description instead.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Checkbox id="hs-disclosed" checked={disclosed} onCheckedChange={(v) => setDisclosed(v === true)} />
          <label htmlFor="hs-disclosed" className="text-sm font-medium">Disclose the awarding school's name to the student</label>
        </div>
        <Field id="hs-school-name" label="Awarding school name (staff-only until disclosed)"><Input id="hs-school-name" value={name} onChange={(ev) => setName(ev.target.value)} placeholder="Name as it appears on the diploma" /></Field>
        <div className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="disclosure-preview">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">The student currently sees</p>
          <p className="mt-1 font-medium">{e.institutionDisclosed && e.awardingSchoolName ? e.awardingSchoolName : GENERIC_SCHOOL_DESCRIPTION}</p>
          {disclosed !== e.institutionDisclosed || name !== (e.awardingSchoolName ?? "") ? <p className="mt-2 text-xs text-muted-foreground">After saving: <span className="font-medium text-foreground">{dg.studentSees}</span></p> : null}
        </div>
        <Field id="hs-disclosure-note" label="Note for the record (required)"><Input id="hs-disclosure-note" value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="e.g. Enrollment confirmed by the school on 2026-11-02" /></Field>
        <ActionMessage message={action.message} />
        <GatedButton id="hs-disclosure-save" variant="outline" gate={gate} pending={action.pending}
          onClick={() => action.run(updateEnrollmentBody(e.revision, { institutionDisclosed: disclosed, awardingSchoolName: name.trim() ? name.trim() : null }, note), () => setNote(""))}>Save disclosure</GatedButton>
      </CardContent>
    </Card>
  );
}

function HistoricalGraduateCard({ studentId, templates, isAdmin, docs }: { studentId: string; templates: readonly HsCurriculumTemplate[]; isAdmin: boolean; docs: SectionProps["docs"] }) {
  const [tplIdx, setTplIdx] = useState(0);
  const [conferredOn, setConferredOn] = useState("");
  const [school, setSchool] = useState("");
  const [diploma, setDiploma] = useState("");
  const [transcript, setTranscript] = useState("");
  const [note, setNote] = useState("");
  const action = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.historicalGraduate(studentId, body), "Historical graduate recorded.");
  const t = templates[tplIdx] ?? templates[0];
  const gate = !isAdmin ? { enabled: false, reason: "Only an administrator can import a historical graduate." }
    : !conferredOn || school.trim().length < 2 ? { enabled: false, reason: "Enter the conferral date and the awarding school." }
    : !evidenceGate(diploma, docs).enabled || !evidenceGate(transcript, docs).enabled ? { enabled: false, reason: "Select a verified diploma and a verified transcript as evidence." }
    : noteGate(note);
  return (
    <details className="rounded-lg border" data-testid="historical-graduate">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Import a historical graduate (diploma already conferred)</summary>
      <div className="grid gap-4 border-t p-4 md:grid-cols-2">
        <p className="md:col-span-2 text-sm text-muted-foreground">For a student who already holds a diploma. Only confirmed records are imported: the diploma and the transcript must be verified Documents. No credit is calculated from this import.</p>
        <Field id="hg-template" label="Template"><select id="hg-template" className={FIELD_CLASS} value={tplIdx} onChange={(e) => setTplIdx(Number(e.target.value))}>{templates.map((x, i) => <option key={`${x.templateKey}@${x.version}`} value={i}>{templateOptionLabel(x)}</option>)}</select></Field>
        <Field id="hg-date" label="Diploma conferred on"><Input id="hg-date" type="date" value={conferredOn} onChange={(e) => setConferredOn(e.target.value)} /></Field>
        <Field id="hg-school" label="Awarding school" className="md:col-span-2"><Input id="hg-school" value={school} onChange={(e) => setSchool(e.target.value)} /></Field>
        <EvidenceSelect id="hg-diploma" label="Diploma (verified document)" value={diploma} onChange={setDiploma} docs={docs} />
        <EvidenceSelect id="hg-transcript" label="Transcript (verified document)" value={transcript} onChange={setTranscript} docs={docs} />
        <Field id="hg-note" label="Note for the record (required)" className="md:col-span-2"><Input id="hg-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="md:col-span-2 space-y-3">
          <ActionMessage message={action.message} />
          <GatedButton id="hg-save" variant="outline" gate={gate} pending={action.pending}
            onClick={() => t && action.run({ templateKey: t.templateKey, templateVersion: t.version, conferredOn, awardingSchoolName: school.trim(), diplomaEvidenceDocumentId: diploma, transcriptEvidenceDocumentId: transcript, note: note.trim() })}>Record historical graduate</GatedButton>
        </div>
      </div>
    </details>
  );
}

export function ProgramSection({ state, studentId, isAdmin, docs, templates }: SectionProps & { templates?: readonly HsCurriculumTemplate[] }) {
  const query = useHsTemplates();
  const list = templates ?? query.data?.templates ?? BUILT_IN_TEMPLATES;
  const timeline = enrollmentTimeline(state);
  const hasOpen = state.enrollments.some(isOpenEnrollment);
  const cur = state.current?.enrollment ?? null;
  return (
    <section aria-labelledby="hs-program-h" className="space-y-5">
      <SectionHeading id="hs-program-h" title="High school program">
        Lumière coordinates the plan; the awarding school decides credit, grades and the diploma. A high school program is separate from any university degree.
      </SectionHeading>
      {state.hasUniversityProgram ? (
        <Notice tone="info" testId="university-indicator">
          <span className="inline-flex items-center gap-2 font-medium"><University className="h-4 w-4" aria-hidden="true" />This student also has a university degree program.</span>
          <span className="block text-muted-foreground">High school credits never count toward the degree and are never mixed with university semester credits.</span>
        </Notice>
      ) : null}

      {cur ? (
        <Card data-testid="current-enrollment">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base"><GraduationCap className="h-4 w-4" aria-hidden="true" />{cur.programTitle}</CardTitle>
              <CardDescription>Current high school program</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="capitalize">{cur.status.replace(/_/g, " ")}</Badge>
              {cur.isHistorical ? <Pill>Historical graduate</Pill> : null}
              {cur.requiredOverrideReason ? <Pill tone="warn">Credit exception</Pill> : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <EnrollmentFacts e={cur} />
            {cur.requiredOverrideReason ? <Notice tone="warn">Total required set to {formatHalfUnits(cur.totalRequiredHalfUnits)} credits instead of the template default. Reason: {cur.requiredOverrideReason}</Notice> : null}
            {!cur.isHistorical ? <EnrollmentEditor studentId={studentId} e={cur} /> : <p className="text-sm text-muted-foreground">Imported with confirmed records only; the program cannot be edited here.</p>}
          </CardContent>
        </Card>
      ) : null}

      <Card data-testid="enrollment-history">
        <CardHeader>
          <CardTitle className="text-base">Enrollment history</CardTitle>
          <CardDescription>Every high school enrollment this student has held, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? <p className="text-sm text-muted-foreground">No high school enrollments yet.</p> : (
            <ol className="divide-y rounded-md border">
              {timeline.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm" aria-current={t.selected ? "true" : undefined}>
                  <div className="min-w-0"><p className="font-medium">{t.label}</p>{t.note ? <p className="text-xs text-muted-foreground">{t.note}</p> : null}</div>
                  <div className="flex gap-2">{t.selected ? <Pill tone="official">Shown here</Pill> : null}<Pill tone={t.open ? "good" : "neutral"}>{t.status}</Pill></div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {cur && !cur.isHistorical ? <DisclosureCard key={`${cur.id}-${cur.revision}`} studentId={studentId} e={cur} /> : null}
      {!hasOpen ? <CreateEnrollmentCard studentId={studentId} templates={list} hasOpen={hasOpen} /> : null}
      <HistoricalGraduateCard studentId={studentId} templates={list} isAdmin={isAdmin} docs={docs} />
      <p className="text-xs text-muted-foreground">Verify documents in <Link href={`/admin/students/${encodeURIComponent(studentId)}#workspace-documents`} className="underline">Documents</Link>; only verified documents can be used as evidence.</p>
    </section>
  );
}
