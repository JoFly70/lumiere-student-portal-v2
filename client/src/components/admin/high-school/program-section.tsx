/** Program tab: create/select the high school enrollment, history, disclosure, historical graduates. */
import { useState } from "react";
import { Link } from "wouter";
import { GraduationCap, University } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { BUILT_IN_TEMPLATES, GENERIC_SCHOOL_DESCRIPTION, HS_ENROLLMENT_STATUSES, formatHalfUnits, latestTemplateVersions, type HsCurriculumTemplate, type HsEnrollmentSummary } from "@shared/high-school-contract";
import { adminHighSchoolApi, useHsTemplates } from "@/lib/admin-high-school-api";
import {
  CLOSED_RECORD_TEXT, createEnrollmentBody, disclosureGate, disclosurePreview, enrollmentTimeline, evidenceGate, isOpenEnrollment, noteGate, statusLabel,
  updateEnrollmentBody, validateEnrollmentForm, type EnrollmentForm,
} from "@/lib/admin-high-school-logic";
import { ActionMessage, EvidenceSelect, FIELD_CLASS, FormPanel, Field, GatedButton, Notice, Pill, RecordButton, SectionCard, SectionHeading, useOpenForm, type OpenForm, type SectionProps } from "./shared";
import { useStaffAction } from "./use-staff-action";
import { useHs } from "./hs-i18n";

const EMPTY_FORM: EnrollmentForm = { templateKey: "", templateVersion: 1, status: "planned", startedOn: "", targetCompletionDate: "", overrideCredits: "", overrideReason: "" };

export function CreateEnrollmentCard({ studentId, templates, hasOpen, form: openForm }: { studentId: string; templates: readonly HsCurriculumTemplate[]; hasOpen: boolean; form?: OpenForm }) {
  const { t, fc } = useHs();
  const own = useOpenForm("all");
  const panel = openForm ?? own;
  const [form, setForm] = useState<EnrollmentForm>({ ...EMPTY_FORM, templateKey: templates[0]?.templateKey ?? "", templateVersion: templates[0]?.version ?? 1 });
  const action = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.createEnrollment(studentId, body), t("s32dir.hs.p.created"));
  const tpl = templates.find((x) => x.templateKey === form.templateKey && x.version === form.templateVersion) ?? templates[0];
  const tplLabel = (x: Pick<HsCurriculumTemplate, "title" | "version" | "totalRequiredHalfUnits">) => t("s32dir.hs.p.tpl.opt", { title: x.title, v: x.version, n: fc(x.totalRequiredHalfUnits) });
  const problem = validateEnrollmentForm(form);
  const gate = hasOpen
    ? { enabled: false, reason: t("s32dir.hs.p.hasOpen") }
    : problem ? { enabled: false, reason: problem } : { enabled: true, reason: null };
  const set = <K extends keyof EnrollmentForm>(k: K, v: EnrollmentForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <SectionCard testId="create-enrollment" title={t("s32dir.hs.p.create")} description={t("s32dir.hs.p.create.desc")}
      action={<RecordButton form={panel} id="create">{t("s32dir.hs.p.create")}</RecordButton>}>
      <FormPanel form={panel} id="create" className="grid gap-4 md:grid-cols-2">
        <Field id="hs-template" label={t("s32dir.hs.p.tpl.label")} hint={tpl ? t("s32dir.hs.p.tpl.hint", { n: fc(tpl.totalRequiredHalfUnits), j: tpl.jurisdiction ? ` (${tpl.jurisdiction})` : "" }) : undefined}>
          <select id="hs-template" className={FIELD_CLASS} aria-describedby="hs-template-hint" value={`${form.templateKey}@${form.templateVersion}`}
            onChange={(e) => { const [k, v] = e.target.value.split("@"); setForm((f) => ({ ...f, templateKey: k ?? "", templateVersion: Number(v) || 1 })); }}>
            {templates.map((tp) => <option key={`${tp.templateKey}@${tp.version}`} value={`${tp.templateKey}@${tp.version}`}>{tplLabel(tp)}</option>)}
          </select>
        </Field>
        <Field id="hs-status" label={t("s32dir.hs.p.startStatus")}>
          <select id="hs-status" className={FIELD_CLASS} value={form.status} onChange={(e) => set("status", e.target.value as "planned" | "active")}>
            <option value="planned">{t("s32dir.hs.p.opt.planned")}</option>
            <option value="active">{t("s32dir.hs.p.opt.active")}</option>
          </select>
        </Field>
        <Field id="hs-started" label={t("s32dir.hs.p.startDate")}><Input id="hs-started" type="date" value={form.startedOn} onChange={(e) => set("startedOn", e.target.value)} /></Field>
        <Field id="hs-target" label={t("s32dir.hs.p.targetDate.opt")} hint={t("s32dir.hs.targetHint")}><Input id="hs-target" type="date" value={form.targetCompletionDate} onChange={(e) => set("targetCompletionDate", e.target.value)} aria-describedby="hs-target-hint" /></Field>
        <fieldset className="rounded-md border bg-background p-3 md:col-span-2">
          <legend className="px-1 text-sm font-medium">{t("s32dir.hs.p.exc.legend")}</legend>
          <p className="mb-3 text-xs text-muted-foreground">{t("s32dir.hs.p.exc.help", { tot: tpl ? ` (${fc(tpl.totalRequiredHalfUnits)})` : "" })}</p>
          <div className="grid gap-4 md:grid-cols-[10rem_1fr]">
            <Field id="hs-override" label={t("s32dir.hs.p.exc.credits")}><Input id="hs-override" inputMode="decimal" placeholder={t("s32dir.hs.p.exc.creditsPh")} value={form.overrideCredits} onChange={(e) => set("overrideCredits", e.target.value)} /></Field>
            <Field id="hs-override-reason" label={t("s32dir.hs.p.exc.reason")}><Input id="hs-override-reason" value={form.overrideReason} onChange={(e) => set("overrideReason", e.target.value)} placeholder={t("s32dir.hs.p.exc.reasonPh")} /></Field>
          </div>
        </fieldset>
        <div className="space-y-3 md:col-span-2">
          <ActionMessage message={action.message} />
          <GatedButton id="hs-create" gate={gate} pending={action.pending} onClick={() => tpl && action.run(createEnrollmentBody(form, tpl.totalRequiredHalfUnits))}>{t("s32dir.hs.p.createBtn")}</GatedButton>
        </div>
      </FormPanel>
      {!panel.isOpen("create") && hasOpen ? <p className="text-sm text-muted-foreground">{t("s32dir.hs.p.hasOpen")}</p> : null}
    </SectionCard>
  );
}

/** The target completion date is deliberately NOT here: it is shown once in the summary strip and edited in the form. */
function EnrollmentFacts({ e, templateTitle }: { e: HsEnrollmentSummary; templateTitle: string }) {
  const { t, x, fc, date } = useHs();
  const rows: [string, string][] = [
    [t("s32dir.hs.p.fact.curr"), t("s32dir.hs.p.fact.currVal", { title: templateTitle, v: e.templateVersion })],
    [t("s32dir.hs.p.fact.total"), t("s32dir.hs.p.fact.totalVal", { n: fc(e.totalRequiredHalfUnits), j: e.jurisdiction ? ` · ${e.jurisdiction}` : "" })],
    [t("s32dir.hs.p.fact.started"), date(e.startedOn)],
    [t("s32dir.hs.p.fact.ref"), e.schoolStudentRef ?? x("Not assigned")],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-4">
      {rows.map(([k, v]) => <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</dt><dd className="mt-1 break-words tabular-nums">{v}</dd></div>)}
    </dl>
  );
}

function EnrollmentEditor({ studentId, e }: { studentId: string; e: HsEnrollmentSummary }) {
  const { t, x } = useHs();
  const [status, setStatus] = useState<string>(e.status);
  const [target, setTarget] = useState(e.targetCompletionDate ?? "");
  const [schoolRef, setSchoolRef] = useState(e.schoolStudentRef ?? "");
  const [note, setNote] = useState("");
  const action = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.updateEnrollment(studentId, e.id, body), t("s32dir.hs.p.updated"));
  const refChanged = schoolRef.trim() !== (e.schoolStudentRef ?? "");
  const changed = status !== e.status || target !== (e.targetCompletionDate ?? "") || refChanged;
  const gate = !changed ? { enabled: false, reason: "No changes to save." } : noteGate(note);
  const patch = { status, targetCompletionDate: target || null, ...(refChanged ? { schoolStudentRef: schoolRef.trim() || null } : {}) };
  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={(ev) => { ev.preventDefault(); if (gate.enabled) action.run(updateEnrollmentBody(e.revision, patch, note), () => setNote("")); }}>
      <Field id="hs-edit-status" label={t("s32dir.hs.p.status")}>
        <select id="hs-edit-status" className={FIELD_CLASS} value={status} onChange={(ev) => setStatus(ev.target.value)}>
          {HS_ENROLLMENT_STATUSES.map((s) => <option key={s} value={s}>{x(statusLabel(s))}</option>)}
        </select>
      </Field>
      <Field id="hs-edit-target" label={t("s32dir.hs.p.targetDate")} hint={t("s32dir.hs.targetHint")}><Input id="hs-edit-target" type="date" value={target} aria-describedby="hs-edit-target-hint" onChange={(ev) => setTarget(ev.target.value)} /></Field>
      <Field id="hs-edit-school-ref" label={t("s32dir.hs.p.schoolRef")} hint={t("s32dir.hs.p.schoolRef.hint")} className="md:col-span-2"><Input id="hs-edit-school-ref" value={schoolRef} maxLength={80} aria-describedby="hs-edit-school-ref-hint" onChange={(ev) => setSchoolRef(ev.target.value)} /></Field>
      <Field id="hs-edit-note" label={t("s32dir.hs.note.required")} className="md:col-span-2"><Input id="hs-edit-note" value={note} onChange={(ev) => setNote(ev.target.value)} placeholder={t("s32dir.hs.p.whyChange")} /></Field>
      <div className="space-y-3 md:col-span-2">
        <ActionMessage message={action.message} />
        <GatedButton id="hs-edit-save" type="submit" gate={gate} pending={action.pending}>{t("s32dir.hs.p.saveChanges")}</GatedButton>
      </div>
    </form>
  );
}

export function DisclosureCard({ studentId, e, form: openForm }: { studentId: string; e: HsEnrollmentSummary; form?: OpenForm }) {
  const { t, x } = useHs();
  const own = useOpenForm("all");
  const panel = openForm ?? own;
  const closed = !isOpenEnrollment(e);
  const [disclosed, setDisclosed] = useState(e.institutionDisclosed);
  const [name, setName] = useState(e.awardingSchoolName ?? "");
  const [note, setNote] = useState("");
  const action = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.updateEnrollment(studentId, e.id, body), t("s32dir.hs.p.disc.saved"));
  const dg = disclosureGate(e, disclosed, name, GENERIC_SCHOOL_DESCRIPTION);
  const now = disclosurePreview(e.status, e.institutionDisclosed, e.awardingSchoolName, GENERIC_SCHOOL_DESCRIPTION);
  const after = disclosurePreview(e.status, disclosed, name, GENERIC_SCHOOL_DESCRIPTION);
  const changed = disclosed !== e.institutionDisclosed || name.trim() !== (e.awardingSchoolName ?? "");
  const ng = noteGate(note);
  const gate = !changed ? { enabled: false, reason: "No changes to save." } : !dg.enabled ? dg : ng;
  return (
    <SectionCard testId="disclosure-card" title={t("s32dir.hs.p.disc.title")} description={t("s32dir.hs.p.disc.desc")}
      action={closed ? null : <RecordButton form={panel} id="disclosure" variant="outline">{t("s32dir.hs.p.disc.change")}</RecordButton>}>
      <div className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="disclosure-preview">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("s32dir.hs.p.disc.sees")}</p>
        <p className="mt-1 font-medium">{x(now.sees)}</p>
        <p className="text-xs text-muted-foreground">{x(now.why)}</p>
        {!closed && (disclosed !== e.institutionDisclosed || name !== (e.awardingSchoolName ?? "")) ? <p className="mt-2 text-xs text-muted-foreground">{t("s32dir.hs.p.disc.after")} <span className="font-medium text-foreground">{x(after.sees)}</span>. {x(after.why)}</p> : null}
      </div>
      {closed ? <p className="text-sm text-muted-foreground" data-testid="closed-record">{x(CLOSED_RECORD_TEXT)} {t("s32dir.hs.p.disc.closed")}</p> : (
        <FormPanel form={panel} id="disclosure" className="space-y-4">
          <div className="flex items-center gap-3">
            <Checkbox id="hs-disclosed" checked={disclosed} onCheckedChange={(v) => setDisclosed(v === true)} />
            <label htmlFor="hs-disclosed" className="text-sm font-medium">{t("s32dir.hs.p.disc.check")}</label>
          </div>
          <Field id="hs-school-name" label={t("s32dir.hs.p.disc.name")}><Input id="hs-school-name" value={name} onChange={(ev) => setName(ev.target.value)} placeholder={t("s32dir.hs.p.disc.namePh")} /></Field>
          <Field id="hs-disclosure-note" label={t("s32dir.hs.note.required")}><Input id="hs-disclosure-note" value={note} onChange={(ev) => setNote(ev.target.value)} placeholder={t("s32dir.hs.p.disc.notePh")} /></Field>
          <ActionMessage message={action.message} />
          <GatedButton id="hs-disclosure-save" gate={gate} pending={action.pending}
            onClick={() => action.run(updateEnrollmentBody(e.revision, { institutionDisclosed: disclosed, awardingSchoolName: name.trim() ? name.trim() : null }, note), () => setNote(""))}>{t("s32dir.hs.p.disc.save")}</GatedButton>
        </FormPanel>
      )}
    </SectionCard>
  );
}

function HistoricalGraduateCard({ studentId, templates, isAdmin, docs, form: panel }: { studentId: string; templates: readonly HsCurriculumTemplate[]; isAdmin: boolean; docs: SectionProps["docs"]; form: OpenForm }) {
  const { t, fc } = useHs();
  const [tplIdx, setTplIdx] = useState(0);
  const [conferredOn, setConferredOn] = useState("");
  const [school, setSchool] = useState("");
  const [diploma, setDiploma] = useState("");
  const [transcript, setTranscript] = useState("");
  const [note, setNote] = useState("");
  const action = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.historicalGraduate(studentId, body), t("s32dir.hs.p.hg.saved"));
  const tp = templates[tplIdx] ?? templates[0];
  const gate = !isAdmin ? { enabled: false, reason: "Only an administrator can import a historical graduate." }
    : !conferredOn || school.trim().length < 2 ? { enabled: false, reason: "Enter the conferral date and the awarding school." }
    : !evidenceGate(diploma, docs, "diploma").enabled || !evidenceGate(transcript, docs, "transcript").enabled ? { enabled: false, reason: "Select a verified diploma and a verified transcript as evidence." }
    : noteGate(note);
  return (
    <SectionCard testId="historical-graduate" title={t("s32dir.hs.p.hg.title")} description={t("s32dir.hs.p.hg.desc")}
      action={<RecordButton form={panel} id="historical" variant="outline">{t("s32dir.hs.p.hg.record")}</RecordButton>}>
      <FormPanel form={panel} id="historical" className="grid gap-4 md:grid-cols-2">
        <Field id="hg-template" label={t("s32dir.hs.p.hg.template")}><select id="hg-template" className={FIELD_CLASS} value={tplIdx} onChange={(e) => setTplIdx(Number(e.target.value))}>{templates.map((x, i) => <option key={`${x.templateKey}@${x.version}`} value={i}>{t("s32dir.hs.p.tpl.opt", { title: x.title, v: x.version, n: fc(x.totalRequiredHalfUnits) })}</option>)}</select></Field>
        <Field id="hg-date" label={t("s32dir.hs.p.hg.conferred")}><Input id="hg-date" type="date" value={conferredOn} onChange={(e) => setConferredOn(e.target.value)} /></Field>
        <Field id="hg-school" label={t("s32dir.hs.p.hg.school")} className="md:col-span-2"><Input id="hg-school" value={school} onChange={(e) => setSchool(e.target.value)} /></Field>
        <EvidenceSelect id="hg-diploma" label={t("s32dir.hs.docDiploma")} value={diploma} onChange={setDiploma} docs={docs} purpose="diploma" />
        <EvidenceSelect id="hg-transcript" label={t("s32dir.hs.docTranscript")} value={transcript} onChange={setTranscript} docs={docs} purpose="transcript" />
        <Field id="hg-note" label={t("s32dir.hs.note.required")} className="md:col-span-2"><Input id="hg-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="space-y-3 md:col-span-2">
          <ActionMessage message={action.message} />
          <GatedButton id="hg-save" gate={gate} pending={action.pending}
            onClick={() => tp && action.run({ templateKey: tp.templateKey, templateVersion: tp.version, conferredOn, awardingSchoolName: school.trim(), diplomaEvidenceDocumentId: diploma, transcriptEvidenceDocumentId: transcript, note: note.trim() })}>{t("s32dir.hs.p.hg.record")}</GatedButton>
        </div>
      </FormPanel>
    </SectionCard>
  );
}

export function ProgramSection({ state, studentId, isAdmin, docs, templates, initialOpenForm }: SectionProps & { templates?: readonly HsCurriculumTemplate[] }) {
  const { t, x, fc } = useHs();
  const query = useHsTemplates();
  const list = templates ?? query.data?.templates ?? BUILT_IN_TEMPLATES;
  const timeline = enrollmentTimeline(state);
  const cur = state.current?.enrollment ?? null;
  const curOpen = !!cur && isOpenEnrollment(cur);
  const hasOpen = state.enrollments.some(isOpenEnrollment) || curOpen;
  // A student with no program starts on the create form; otherwise every form stays folded until asked for.
  const form = useOpenForm(initialOpenForm !== undefined ? initialOpenForm : state.enrollments.length === 0 && !cur ? "create" : null);
  return (
    <section aria-labelledby="hs-program-h" className="space-y-5">
      <SectionHeading id="hs-program-h" title={t("s32dir.hs.p.heading")}>
        {t("s32dir.hs.p.heading.desc")}
      </SectionHeading>
      {state.hasUniversityProgram ? (
        <Notice tone="info" testId="university-indicator">
          <span className="inline-flex items-center gap-2 font-medium"><University className="h-4 w-4" aria-hidden="true" />{t("s32dir.hs.p.uni.a")}</span>
          <span className="block text-muted-foreground">{t("s32dir.hs.p.uni.b")}</span>
        </Notice>
      ) : null}

      {cur ? (
        <SectionCard testId="current-enrollment"
          title={<span className="flex items-center gap-2"><GraduationCap className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0">{cur.programTitle}</span></span>}
          description={t("s32dir.hs.p.current")}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{x(statusLabel(cur.status))}</Badge>
              {cur.isHistorical ? <Pill>{t("s32dir.hs.p.historical")}</Pill> : null}
              {cur.requiredOverrideReason ? <Pill tone="warn">{t("s32dir.hs.p.exception")}</Pill> : null}
              {curOpen && !cur.isHistorical ? <RecordButton form={form} id="edit-enrollment" variant="outline">{t("s32dir.hs.p.edit")}</RecordButton> : null}
            </div>
          }>
          <EnrollmentFacts e={cur} templateTitle={cur.programTitle} />
          {cur.requiredOverrideReason ? <Notice tone="warn">{t("s32dir.hs.p.overrideNote", { n: fc(cur.totalRequiredHalfUnits), reason: cur.requiredOverrideReason })}</Notice> : null}
          {cur.isHistorical ? <p className="text-sm text-muted-foreground">{t("s32dir.hs.p.importedOnly")}</p>
            : !curOpen ? <p className="text-sm text-muted-foreground" data-testid="closed-record">{x(CLOSED_RECORD_TEXT)} {t("s32dir.hs.p.closedEdit", { status: x(statusLabel(cur.status)).toLowerCase() })}</p>
            : <FormPanel form={form} id="edit-enrollment"><EnrollmentEditor studentId={studentId} e={cur} /></FormPanel>}
        </SectionCard>
      ) : null}

      <SectionCard testId="enrollment-history" title={t("s32dir.hs.p.hist.title")} description={t("s32dir.hs.p.hist.desc")}>
        {timeline.length === 0 ? <p className="text-sm text-muted-foreground">{t("s32dir.hs.p.hist.empty")}</p> : (
          <ol className="divide-y rounded-md border">
            {timeline.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm" aria-current={row.selected ? "true" : undefined}>
                <div className="min-w-0"><p className="font-medium">{x(row.label)}</p><p className="text-xs text-muted-foreground">{x(row.period)}</p>{row.note ? <p className="text-xs text-muted-foreground">{x(row.note)}</p> : null}</div>
                <div className="flex gap-2">{row.selected ? <Pill tone="official">{t("s32dir.hs.p.hist.shown")}</Pill> : null}<Pill tone={row.open ? "good" : "neutral"}>{x(row.status)}</Pill></div>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      {cur && !cur.isHistorical ? <DisclosureCard key={`${cur.id}-${cur.revision}`} studentId={studentId} e={cur} form={form} /> : null}
      {!hasOpen ? <CreateEnrollmentCard studentId={studentId} templates={latestTemplateVersions(list)} hasOpen={hasOpen} form={form} /> : null}
      <HistoricalGraduateCard studentId={studentId} templates={list} isAdmin={isAdmin} docs={docs} form={form} />
      <p className="text-xs text-muted-foreground">{t("s32dir.hs.p.verify.a")}<Link href={`/admin/students/${encodeURIComponent(studentId)}#workspace-documents`} className="underline">{t("s32dir.hs.p.verify.link")}</Link>{t("s32dir.hs.p.verify.b")}</p>
    </section>
  );
}
