/**
 * S12 — staff "Graduate programmes" workspace, mounted in the admin student
 * workspace. Existing admin look (muted shadcn tones), not the student surface.
 *
 * Every record shows three things at a glance: what is VERIFIED (issuer,
 * document, date, reviewer), what is only CLAIMED, and the ACTION still
 * required (the guard's blockers, in plain language). `verified` is only ever
 * shown after a 2xx from the verify endpoint; a 422 keeps the dialog open and
 * lists what is missing.
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, CircleDashed, GraduationCap, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getAuthToken, getCsrfToken } from "@/lib/api";
import {
  ASSESSMENT_TYPES,
  INSTITUTIONS,
  INSTITUTION_LABEL,
  PRIOR_BACHELOR_SOURCES,
  RESULT_STATUSES,
  TRACKING_STATUSES,
  CREDIT_AUTHORITIES,
  CREDIT_AUTHORITY_LABEL,
  RECOGNITION_OUTCOMES,
  verificationLabel,
  type StaffGraduateProgramView,
  type StaffGraduateWorkspace,
  type StaffRecordView,
  type SubjectRecord,
} from "@shared/graduate-program-contract";
import {
  STAFF_GRADUATE_PATHS,
  STAFF_GRADUATE_QUERY_KEY,
  TOPIC_DECISIONS,
  buildTopicDecisionBody,
  canDecideTopic,
  activeRuleSets,
  addableKinds,
  buildCreditBody,
  buildEnrollBody,
  buildResultBody,
  buildTrackBody,
  buildVerifyBody,
  canOfferVerify,
  classificationLine,
  creditGate,
  creditLayerText,
  emptyCreditForm,
  emptyResultForm,
  emptyTrackForm,
  enrollGate,
  failureSummary,
  kindLabel,
  legalizationLine,
  parseApiFailure,
  programSummary,
  recordTriad,
  recordsOfSection,
  resultGate,
  ruleSetLine,
  sectionsForRoute,
  titleLines,
  trackFormFromRecord,
  verifyFields,
  verifyFormDefaults,
  verifyGate,
  verifySubmitGate,
  type ApiFailure,
  type CreditForm,
  type EnrollForm,
  type ResultForm,
  type TrackForm,
  type VerifyForm,
} from "./graduate-program-review-logic";

type Role = "staff" | "admin";

export type PanelDialog =
  | { t: "enroll" }
  | { t: "verify"; program: StaffGraduateProgramView; record: StaffRecordView }
  | { t: "track"; program: StaffGraduateProgramView; record: StaffRecordView | null; kind?: StaffRecordView["kind"] }
  | { t: "topic"; record: StaffRecordView; outcome: keyof typeof TOPIC_DECISIONS }
  | { t: "subject"; program: StaffGraduateProgramView }
  | { t: "result"; program: StaffGraduateProgramView; subject: SubjectRecord }
  | { t: "credit"; program: StaffGraduateProgramView };

const humanize = (s: string) => s.replace(/_/g, " ");
const NONE = "__none";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return <div className="space-y-1"><Label htmlFor={id}>{label}</Label>{children}{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}</div>;
}

function Pick({ id, value, onChange, options, allowNone }: { id: string; value: string; onChange: (v: string) => void; options: readonly { value: string; label: string }[]; allowNone?: boolean }) {
  return <Select value={value === "" ? NONE : value} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
    <SelectTrigger id={id} className="min-h-11"><SelectValue placeholder="Choose…" /></SelectTrigger>
    <SelectContent>
      {allowNone ? <SelectItem value={NONE}>Not stated</SelectItem> : null}
      {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
    </SelectContent>
  </Select>;
}

const instOptions = INSTITUTIONS.map((i) => ({ value: i, label: INSTITUTION_LABEL[i] }));
const simple = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: humanize(x) }));

// ---------------------------------------------------------------------------
// Read-only view (pure; rendered in tests)
// ---------------------------------------------------------------------------

function StatusBadge({ rec }: { rec: StaffRecordView }) {
  if (!rec.official) return <Badge variant="outline">Tracking only</Badge>;
  if (rec.verificationStatus === "verified") return <Badge className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Verified</Badge>;
  if (rec.verificationStatus === "rejected" || rec.verificationStatus === "conflicting") return <Badge variant="destructive">{verificationLabel(rec.verificationStatus)}</Badge>;
  return <Badge variant="secondary" className="gap-1"><CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />Not verified</Badge>;
}

function RecordCard({ program, rec, role, onDialog, canEdit }: { program: StaffGraduateProgramView; rec: StaffRecordView; role: Role; onDialog?: (d: PanelDialog) => void; canEdit: boolean }) {
  const t = recordTriad(rec);
  const gate = verifyGate(rec, role);
  return <li className="space-y-3 rounded-md border p-3" data-testid="graduate-record" data-kind={rec.kind}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-medium">{rec.label}</p>
      <StatusBadge rec={rec} />
    </div>
    <div className="grid gap-3 text-sm md:grid-cols-3">
      <div data-testid="triad-verified"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Verified</p>
        {t.verified
          ? <ul className="mt-1 space-y-0.5"><li>{t.verified.issuer}</li><li>{t.verified.document}</li>
              {t.verified.outcome ? <li>Outcome: {t.verified.outcome}</li> : null}
              {t.verified.decisionDate ? <li>Decision date: {t.verified.decisionDate}</li> : null}
              {t.verified.effectiveDate ? <li>Effective date: {t.verified.effectiveDate}</li> : null}
              <li className="text-muted-foreground">Reviewed by {t.verified.reviewer ?? "unknown"}{t.verified.reviewedAt ? ` on ${t.verified.reviewedAt}` : ""}</li></ul>
          : <p className="mt-1 text-muted-foreground">{t.officialKind ? "Nothing verified yet." : "Not an official status."}</p>}
      </div>
      <div data-testid="triad-claimed"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Claimed / reported</p>
        {t.claimed.length ? <ul className="mt-1 space-y-0.5">{t.claimed.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="mt-1 text-muted-foreground">Nothing reported.</p>}
        {rec.note ? <p className="mt-1 text-xs text-muted-foreground">Note: {rec.note}</p> : null}
      </div>
      <div data-testid="triad-action"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Action required</p>
        {t.action.length ? <ul className="mt-1 list-disc space-y-0.5 pl-4">{t.action.map((a) => <li key={a}>{a}</li>)}</ul> : <p className="mt-1 text-muted-foreground">{t.verified ? "None." : t.officialKind ? "Nothing blocking." : "None."}</p>}
      </div>
    </div>
    {canEdit ? <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => onDialog?.({ t: "track", program, record: rec })}>Update tracking…</Button>
      {canDecideTopic(rec) && rec.details.topic ? (Object.keys(TOPIC_DECISIONS) as Array<keyof typeof TOPIC_DECISIONS>).map((o) => <Button key={o} type="button" size="sm" variant="outline" className="min-h-11" disabled={rec.outcome === o} onClick={() => onDialog?.({ t: "topic", record: rec, outcome: o })}>{TOPIC_DECISIONS[o]}…</Button>) : null}
      {canOfferVerify(rec) ? <Button type="button" size="sm" className="min-h-11" disabled={!gate.enabled} onClick={() => onDialog?.({ t: "verify", program, record: rec })}>Verify…</Button> : null}
      {!gate.enabled && canOfferVerify(rec) ? <p className="self-center text-xs text-muted-foreground">{gate.reason}</p> : null}
    </div> : null}
  </li>;
}

function ProgramCard({ p, role, onDialog, canEdit }: { p: StaffGraduateProgramView; role: Role; onDialog?: (d: PanelDialog) => void; canEdit: boolean }) {
  const titles = titleLines(p);
  const cls = classificationLine(p);
  const rs = ruleSetLine(p);
  const leg = legalizationLine(p);
  const sum = programSummary(p);
  const sv = p.studentView;
  const kinds = addableKinds(p);
  return <Card data-testid="graduate-program" data-route={p.program.route}>
    <CardHeader className="space-y-2 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CardTitle className="text-base">{titles.marketing}</CardTitle>
        <Badge variant="outline">{p.program.route === "eneb_unimarconi" ? "ENEB + university route" : "ENEB only"}</Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
        <div><dt className="inline text-muted-foreground">Contract title: </dt><dd className="inline">{titles.contract ?? "Same as marketing title"}</dd></div>
        <div data-testid="university-title"><dt className="inline text-muted-foreground">University title: </dt><dd className="inline">{titles.universityTitle.text}{titles.universityTitle.verified ? " (verified)" : ""}</dd></div>
        <div><dt className="inline text-muted-foreground">Awarding institution: </dt><dd className="inline">{INSTITUTION_LABEL[p.offering.awardingInstitution]}</dd></div>
        <div data-testid="classification"><dt className="inline text-muted-foreground">Classification: </dt><dd className="inline">{cls.text} · {cls.verificationText}</dd></div>
        <div><dt className="inline text-muted-foreground">Cohort: </dt><dd className="inline">{p.program.cohortLabel}</dd></div>
        <div data-testid="ruleset-line"><dt className="inline text-muted-foreground">Rule set: </dt><dd className="inline">{rs.text}</dd></div>
        <div><dt className="inline text-muted-foreground">ENEB status: </dt><dd className="inline">{sv.enebStatusLabel}</dd></div>
        <div><dt className="inline text-muted-foreground">University registration: </dt><dd className="inline">{sv.registration.label}{sv.registration.matricola ? ` (${sv.registration.matricola})` : ""}</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">{sum.verified} official item(s) verified · {sum.needAction} in progress without verification · {sum.openQuestions} open question(s)</p>
      {!rs.current ? <p className="flex items-center gap-1 text-xs text-amber-800 dark:text-amber-300"><ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />A newer rule set exists. This enrollment keeps its pinned terms.</p> : null}
    </CardHeader>
    <CardContent className="space-y-5">
      {leg ? <p className="rounded-md border bg-muted/40 p-2 text-sm" data-testid="legalization-line">{leg.text}</p> : null}

      {sectionsForRoute(p.program.route).map((s) => {
        const recs = recordsOfSection(p, s);
        return <section key={s.key} aria-labelledby={`sec-${p.program.id}-${s.key}`} className="space-y-2">
          <h4 id={`sec-${p.program.id}-${s.key}`} className="text-sm font-semibold">{s.title}</h4>
          {recs.length ? <ul className="space-y-2">{recs.map((r) => <RecordCard key={r.id} program={p} rec={r} role={role} onDialog={onDialog} canEdit={canEdit} />)}</ul> : <p className="text-sm text-muted-foreground">No record yet.</p>}
        </section>;
      })}
      {canEdit && kinds.length ? <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => onDialog?.({ t: "track", program: p, record: null })}>Add record…</Button>
      </div> : null}

      <section aria-labelledby={`sub-${p.program.id}`} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 id={`sub-${p.program.id}`} className="text-sm font-semibold">Subjects (tracked separately from the thesis)</h4>
          {canEdit ? <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => onDialog?.({ t: "subject", program: p })}>Add subject…</Button> : null}</div>
        {p.subjects.length === 0 ? <p className="text-sm text-muted-foreground">No subjects recorded.</p> : <ul className="divide-y rounded-md border">
          {p.subjects.map((s) => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm" data-testid="graduate-subject">
            <span><span className="font-medium">{s.title}</span> <span className="text-muted-foreground">· {s.authority === "eneb" ? "ENEB" : "University"} · student reports {humanize(s.studentProgress)}</span></span>
            <span className="flex flex-wrap items-center gap-2"><span>{s.resultStatus === "none" ? "No result" : `${humanize(s.resultStatus)}${s.gradeDisplay ? ` ${s.gradeDisplay}` : ""}`}</span><Badge variant={s.verificationStatus === "verified" ? "default" : "outline"}>{verificationLabel(s.verificationStatus).replace("Verified by Lumière", "Verified")}</Badge>
              {canEdit ? <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => onDialog?.({ t: "result", program: p, subject: s })}>Record result…</Button> : null}</span>
          </li>)}
        </ul>}
      </section>

      <section aria-labelledby={`cr-${p.program.id}`} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 id={`cr-${p.program.id}`} className="text-sm font-semibold">Credits by authority (never summed together)</h4>
          {canEdit && p.program.route === "eneb_unimarconi" ? <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => onDialog?.({ t: "credit", program: p })}>Add credit entry…</Button> : null}</div>
        <ul className="grid gap-2 md:grid-cols-2">{p.creditLayers.map((c) => <li key={c.authority} className="rounded-md border p-2 text-sm" data-testid="credit-layer" data-authority={c.authority}>
          <p className="font-medium">{c.label}: {c.state === "not_applicable" ? "Not applicable" : creditLayerText(c.amount, c.unit)}</p>
          <p className="text-xs text-muted-foreground">{c.explanation}</p></li>)}</ul>
        {p.credits.length ? <ul className="divide-y rounded-md border">{p.credits.map((c) => <li key={c.id} className="p-2 text-sm" data-testid="credit-entry">{CREDIT_AUTHORITY_LABEL[c.authority]}: {c.label}, {c.amount} {c.unit}{c.recognitionOutcome ? ` · ${humanize(c.recognitionOutcome)}` : ""}{c.conditions ? ` · Condition: ${c.conditions}` : ""}</li>)}</ul> : null}
      </section>

      <details className="rounded-md border p-3" data-testid="student-preview">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium"><ChevronDown className="h-4 w-4" aria-hidden="true" />What the student sees</summary>
        <div className="mt-2 space-y-2 text-sm">
          <p><span className="text-muted-foreground">Next step: </span><span className="font-medium">{sv.nextStep.title}</span>. {sv.nextStep.detail}</p>
          <p><span className="text-muted-foreground">Graduation: </span>{sv.graduation ? sv.graduation.explanation : "Not applicable on an ENEB-only programme."}</p>
          <p><span className="text-muted-foreground">Progress: </span>{sv.progress.statement}</p>
        </div>
      </details>
    </CardContent>
  </Card>;
}

export function GraduateProgramReviewView({ workspace, role = workspace.viewerRole ?? "staff", canEdit = true, onDialog, feedback }: { workspace: StaffGraduateWorkspace; role?: Role; canEdit?: boolean; onDialog?: (d: PanelDialog) => void; feedback?: string | null }) {
  return <section id="workspace-graduate" aria-labelledby="workspace-graduate-heading" className="scroll-mt-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="workspace-graduate-heading" className="flex items-center gap-2 text-xl font-semibold"><GraduationCap className="h-5 w-5" aria-hidden="true" />Graduate programmes</h2>
      {canEdit ? <Button type="button" className="min-h-11" onClick={() => onDialog?.({ t: "enroll" })}>Enroll in a programme…</Button> : null}
    </div>
    <p className="text-sm text-muted-foreground">ENEB and university records are separate. Only evidence from the right institution makes an official status verified; tracking and student progress are never blocked.</p>
    {feedback ? <div role="status" className="rounded-md border border-green-600/40 px-3 py-2 text-sm">{feedback}</div> : null}
    {workspace.programs.length === 0 ? <p className="rounded-md border p-4 text-sm text-muted-foreground" data-testid="graduate-empty">This student is not enrolled in a graduate programme.</p>
      : workspace.programs.map((p) => <ProgramCard key={p.program.id} p={p} role={role} onDialog={onDialog} canEdit={canEdit} />)}
  </section>;
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function FormDialog({ title, description, children, submitLabel, gate, onSubmit, onClose }: { title: string; description?: string; children: ReactNode; submitLabel: string; gate: { ok: boolean; reason: string | null }; onSubmit: () => Promise<void>; onClose: () => void }) {
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const mutation = useMutation({
    mutationFn: onSubmit,
    onError: (err) => setFailure(parseApiFailure(err)),
  });
  const summary = failure ? failureSummary(failure) : null;
  return <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{title}</DialogTitle>{description ? <DialogDescription>{description}</DialogDescription> : null}</DialogHeader>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setFailure(null); mutation.mutate(); }}>
        {children}
        {!gate.ok && gate.reason ? <p className="text-xs text-muted-foreground">{gate.reason}</p> : null}
        {summary ? <div role="alert" className="rounded-md border border-destructive/50 p-3 text-sm" data-testid="dialog-error"><p className="font-medium">{summary.headline}</p>
          {summary.items.length ? <ul className="mt-1 list-disc pl-5" data-testid="dialog-missing">{summary.items.map((i) => <li key={i}>{i}</li>)}</ul> : null}</div> : null}
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" disabled={mutation.isPending} onClick={onClose}>Cancel</Button>
          <Button type="submit" className="min-h-11" disabled={!gate.ok || mutation.isPending}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}{submitLabel}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function TextField({ id, label, value, onChange, type = "text", hint }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string }) {
  return <Field id={id} label={label} hint={hint}><Input id={id} type={type} className="min-h-11" value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
}

function VerifyDialog({ record, role, send, onClose }: { record: StaffRecordView; role: Role; send: (method: string, url: string, body: unknown) => Promise<void>; onClose: () => void }) {
  const [f, setF] = useState<VerifyForm>(() => verifyFormDefaults(record));
  const set = <K extends keyof VerifyForm>(k: K, v: VerifyForm[K]) => setF((s) => ({ ...s, [k]: v }));
  const fields = verifyFields(record.kind);
  const gate = verifySubmitGate(f);
  const adminGate = verifyGate(record, role);
  return <FormDialog
    title={`Verify: ${kindLabel(record.kind)}`}
    description="Record the evidence exactly as the issuing institution's document states it. Nothing is verified unless the server accepts the evidence."
    submitLabel={f.decision === "verified" ? "Verify" : "Save decision"}
    gate={adminGate.enabled ? gate : { ok: false, reason: adminGate.reason }}
    onSubmit={() => send("POST", STAFF_GRADUATE_PATHS.verifyRecord(record.id), buildVerifyBody(record.kind, f))}
    onClose={onClose}>
    <Field id="v-decision" label="Decision"><Pick id="v-decision" value={f.decision} onChange={(v) => set("decision", v as VerifyForm["decision"])} options={simple(["verified", "evidence_received", "conflicting", "rejected"])} /></Field>
    <Field id="v-issuer" label="Issuing institution"><Pick id="v-issuer" value={f.issuingInstitution} onChange={(v) => set("issuingInstitution", v)} options={instOptions} allowNone /></Field>
    <TextField id="v-doctype" label="Document type" value={f.documentTypeLabel} onChange={(v) => set("documentTypeLabel", v)} />
    <TextField id="v-docref" label="Document reference" value={f.documentReference} onChange={(v) => set("documentReference", v)} hint="Or attach a verified document from Documents (document id)." />
    <TextField id="v-docid" label="Documents row id (optional)" value={f.documentId} onChange={(v) => set("documentId", v)} />
    <TextField id="v-date" label="Date printed on the document" type="date" value={f.decisionDate} onChange={(v) => set("decisionDate", v)} />
    {fields.outcomes.length ? <Field id="v-outcome" label="Outcome stated by the document"><Pick id="v-outcome" value={f.outcome} onChange={(v) => set("outcome", v)} options={simple(fields.outcomes)} allowNone /></Field> : null}
    {fields.matricola ? <TextField id="v-matricola" label="Matricola" value={f.matricola} onChange={(v) => set("matricola", v)} /> : null}
    {fields.issuingCountry ? <TextField id="v-country" label="Issuing country (ISO code, for example NG)" value={f.issuingCountry} onChange={(v) => set("issuingCountry", v)} hint="Where the degree was issued, not where the student lives." /> : null}
    {fields.effectiveDate ? <TextField id="v-effective" label="Conferral date on the university's document" type="date" value={f.effectiveDate} onChange={(v) => set("effectiveDate", v)} hint="Never the ceremony date." /> : null}
    <Field id="v-consequence" label="Academic consequence (optional)"><Textarea id="v-consequence" rows={2} value={f.academicConsequence} onChange={(e) => set("academicConsequence", e.target.value)} /></Field>
    {f.decision === "conflicting" ? <Field id="v-conflict" label="Conflicting evidence"><Textarea id="v-conflict" rows={2} value={f.conflictingEvidence} onChange={(e) => set("conflictingEvidence", e.target.value)} /></Field> : null}
    <Field id="v-note" label="Note (required)"><Textarea id="v-note" rows={2} maxLength={1000} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
  </FormDialog>;
}

function TrackDialog({ program, record, kind, send, onClose }: { program: StaffGraduateProgramView; record: StaffRecordView | null; kind?: StaffRecordView["kind"]; send: (method: string, url: string, body: unknown) => Promise<void>; onClose: () => void }) {
  const kinds = addableKinds(program);
  const [f, setF] = useState<TrackForm>(() => (record ? trackFormFromRecord(record) : emptyTrackForm(kind ?? kinds[0] ?? "institutional_question")));
  const set = <K extends keyof TrackForm>(k: K, v: TrackForm[K]) => setF((s) => ({ ...s, [k]: v }));
  return <FormDialog
    title={record ? `Update tracking: ${kindLabel(record.kind)}` : "Add a record"}
    description="Tracking never changes an official status and is never blocked by missing evidence."
    submitLabel="Save"
    gate={{ ok: true, reason: null }}
    onSubmit={() => record
      ? send("PATCH", STAFF_GRADUATE_PATHS.trackRecord(record.id), buildTrackBody(f, record.details as Record<string, unknown>))
      : send("POST", STAFF_GRADUATE_PATHS.createRecord(program.program.id), buildTrackBody(f, {}, true))}
    onClose={onClose}>
    {!record ? <Field id="t-kind" label="Record type"><Pick id="t-kind" value={f.kind} onChange={(v) => set("kind", v as TrackForm["kind"])} options={kinds.map((k) => ({ value: k, label: kindLabel(k) }))} /></Field> : null}
    <Field id="t-status" label="Tracking status"><Pick id="t-status" value={f.trackingStatus} onChange={(v) => set("trackingStatus", v)} options={simple(TRACKING_STATUSES)} /></Field>
    <Field id="t-issuer" label="Issuing institution (as stated)"><Pick id="t-issuer" value={f.issuingInstitution} onChange={(v) => set("issuingInstitution", v)} options={instOptions} allowNone /></Field>
    <TextField id="t-doctype" label="Document type" value={f.documentTypeLabel} onChange={(v) => set("documentTypeLabel", v)} />
    <TextField id="t-docref" label="Document reference" value={f.documentReference} onChange={(v) => set("documentReference", v)} />
    {f.kind === "university_registration" ? <TextField id="t-matricola" label="Matricola (stated, not yet verified)" value={f.matricola} onChange={(v) => set("matricola", v)} /> : null}
    {f.kind === "undergraduate_documents" ? <TextField id="t-country" label="Issuing country (ISO code)" value={f.issuingCountry} onChange={(v) => set("issuingCountry", v)} hint="Drives the apostille requirement. Residence does not." /> : null}
    {f.kind === "thesis_topic" ? <TextField id="t-topic" label="Topic" value={f.topic} onChange={(v) => set("topic", v)} /> : null}
    {f.kind === "graduation_procedure" ? <TextField id="t-ceremony" label="Ceremony date (does not set the conferral date)" type="date" value={f.ceremonyDate} onChange={(v) => set("ceremonyDate", v)} /> : null}
    {f.kind === "institutional_question" ? <Field id="t-question" label="Open question or exception"><Textarea id="t-question" rows={3} value={f.question} onChange={(e) => set("question", e.target.value)} /></Field> : null}
    <Field id="t-note" label="Note"><Textarea id="t-note" rows={2} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
  </FormDialog>;
}

function TopicDialog({ record, outcome, send, onClose }: { record: StaffRecordView; outcome: keyof typeof TOPIC_DECISIONS; send: (method: string, url: string, body: unknown) => Promise<void>; onClose: () => void }) {
  return <FormDialog title={`${TOPIC_DECISIONS[outcome]}?`} description={`Topic: ${record.details.topic ?? ""}. An approved topic is locked for the student.`} submitLabel="Confirm" gate={{ ok: true, reason: null }}
    onSubmit={() => send("PATCH", STAFF_GRADUATE_PATHS.trackRecord(record.id), buildTopicDecisionBody(outcome))} onClose={onClose}><span /></FormDialog>;
}

function ResultDialog({ subject, send, onClose }: { subject: SubjectRecord; send: (method: string, url: string, body: unknown) => Promise<void>; onClose: () => void }) {
  const [f, setF] = useState<ResultForm>(() => emptyResultForm(subject.authority));
  const set = <K extends keyof ResultForm>(k: K, v: ResultForm[K]) => setF((s) => ({ ...s, [k]: v }));
  return <FormDialog title={`Record result: ${subject.title}`} description="Grades are recorded as the issuing document prints them. This never creates university credits." submitLabel="Save result" gate={resultGate(f, subject.authority)} onSubmit={() => send("POST", STAFF_GRADUATE_PATHS.recordResult(subject.id), buildResultBody(f))} onClose={onClose}>
    <Field id="r-status" label="Result"><Pick id="r-status" value={f.resultStatus} onChange={(v) => set("resultStatus", v)} options={simple(RESULT_STATUSES)} /></Field>
    <TextField id="r-display" label="Grade as printed (for example 8.9/10)" value={f.gradeDisplay} onChange={(v) => set("gradeDisplay", v)} />
    <div className="grid grid-cols-2 gap-2"><TextField id="r-value" label="Grade value" value={f.gradeValue} onChange={(v) => set("gradeValue", v)} /><TextField id="r-scale" label="Grade scale" value={f.gradeScale} onChange={(v) => set("gradeScale", v)} /></div>
    <Field id="r-issuer" label="Issuing institution"><Pick id="r-issuer" value={f.issuingInstitution} onChange={(v) => set("issuingInstitution", v)} options={instOptions} /></Field>
    <Field id="r-verif" label="Evidence level"><Pick id="r-verif" value={f.verificationStatus} onChange={(v) => set("verificationStatus", v)} options={simple(["institution_stated", "evidence_received", "verified"])} /></Field>
    <TextField id="r-ref" label="Document reference" value={f.documentReference} onChange={(v) => set("documentReference", v)} />
    <Field id="r-kind" label="Kind"><Pick id="r-kind" value={f.kind} onChange={(v) => set("kind", v)} options={simple(["initial", "reassessment", "correction"])} /></Field>
  </FormDialog>;
}

function SubjectDialog({ program, send, onClose }: { program: StaffGraduateProgramView; send: (method: string, url: string, body: unknown) => Promise<void>; onClose: () => void }) {
  const uni = program.program.route === "eneb_unimarconi";
  const [authority, setAuthority] = useState("eneb");
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [assessment, setAssessment] = useState("unknown");
  return <FormDialog title="Add a subject" description="Module codes and credits only if printed on an issued document." submitLabel="Add subject" gate={title.trim() ? { ok: true, reason: null } : { ok: false, reason: "Enter the subject title." }}
    onSubmit={() => send("POST", STAFF_GRADUATE_PATHS.createSubject(program.program.id), { authority, title: title.trim(), moduleCode: code.trim() || null, assessmentType: assessment })} onClose={onClose}>
    {uni ? <Field id="s-auth" label="Authority"><Pick id="s-auth" value={authority} onChange={setAuthority} options={[{ value: "eneb", label: "ENEB subject" }, { value: "unimarconi", label: "University subject" }]} /></Field> : null}
    <TextField id="s-title" label="Title" value={title} onChange={setTitle} />
    <TextField id="s-code" label="Module code (only if printed)" value={code} onChange={setCode} />
    <Field id="s-assess" label="Assessment"><Pick id="s-assess" value={assessment} onChange={setAssessment} options={simple(ASSESSMENT_TYPES)} /></Field>
  </FormDialog>;
}

function CreditDialog({ program, send, onClose }: { program: StaffGraduateProgramView; send: (method: string, url: string, body: unknown) => Promise<void>; onClose: () => void }) {
  const backing = program.records.filter((r) => ["recognition_request", "recognition_decision", "official_transcript", "award_conferral", "eneb_transcript", "eneb_certificate", "eneb_completion", "ui1_ects_certification"].includes(r.kind));
  const [f, setF] = useState<CreditForm>(() => emptyCreditForm(backing.find((r) => r.kind === "recognition_decision")?.id ?? backing[0]?.id ?? ""));
  const set = <K extends keyof CreditForm>(k: K, v: CreditForm[K]) => setF((s) => ({ ...s, [k]: v }));
  return <FormDialog title="Add a credit entry" description="Credits must come from the matching decision, certificate or transcript. An unrecorded decision stays unknown, never zero." submitLabel="Add credit" gate={creditGate(f)} onSubmit={() => send("POST", STAFF_GRADUATE_PATHS.createCredit(program.program.id), buildCreditBody(f))} onClose={onClose}>
    <Field id="c-auth" label="Credit authority"><Pick id="c-auth" value={f.authority} onChange={(v) => set("authority", v)} options={CREDIT_AUTHORITIES.map((a) => ({ value: a, label: CREDIT_AUTHORITY_LABEL[a] }))} /></Field>
    <Field id="c-rec" label="Backing record"><Pick id="c-rec" value={f.recordId} onChange={(v) => set("recordId", v)} options={backing.map((r) => ({ value: r.id, label: `${r.label} (${humanize(r.verificationStatus)})` }))} /></Field>
    <TextField id="c-label" label="Module or block" value={f.label} onChange={(v) => set("label", v)} />
    <div className="grid grid-cols-2 gap-2"><TextField id="c-amount" label="Credits" value={f.amount} onChange={(v) => set("amount", v)} /><Field id="c-unit" label="Unit"><Pick id="c-unit" value={f.unit} onChange={(v) => set("unit", v)} options={simple(["ECTS", "CFU"])} /></Field></div>
    {f.authority === "university_recognized" ? <>
      <Field id="c-outcome" label="Recognition outcome"><Pick id="c-outcome" value={f.recognitionOutcome} onChange={(v) => set("recognitionOutcome", v)} options={simple(RECOGNITION_OUTCOMES)} /></Field>
      <Field id="c-cond" label="Conditions (required when recognized with conditions)"><Textarea id="c-cond" rows={2} value={f.conditions} onChange={(e) => set("conditions", e.target.value)} /></Field></> : null}
  </FormDialog>;
}

function EnrollDialog({ workspace, send, onClose }: { workspace: StaffGraduateWorkspace; send: (method: string, url: string, body: unknown) => Promise<void>; onClose: () => void }) {
  const [f, setF] = useState<EnrollForm>({ offeringId: "", ruleSetId: "", enrollmentContractTitle: "", enrolledAt: new Date().toISOString().slice(0, 10), priorBachelorSource: "unknown" });
  const set = <K extends keyof EnrollForm>(k: K, v: EnrollForm[K]) => setF((s) => ({ ...s, [k]: v }));
  const sets = activeRuleSets(workspace.ruleSets, f.offeringId);
  return <FormDialog title="Enroll in a programme" description="Enrollment creates only the programme record. It creates no university registration, subjects or credits." submitLabel="Enroll"
    gate={enrollGate(f, workspace.ruleSets)} onSubmit={() => send("POST", `/api/admin/students/${encodeURIComponent(workspace.studentId)}/graduate/programs`, buildEnrollBody(f, workspace.ruleSets))} onClose={onClose}>
    <Field id="e-off" label="Offering"><Pick id="e-off" value={f.offeringId} onChange={(v) => setF((s) => ({ ...s, offeringId: v, ruleSetId: "" }))} options={workspace.offerings.map((o) => ({ value: o.id, label: `${o.marketingTitle} (${o.route === "eneb_only" ? "ENEB only" : "university route"})` }))} /></Field>
    <Field id="e-rs" label="Cohort rule set"><Pick id="e-rs" value={f.ruleSetId} onChange={(v) => set("ruleSetId", v)} options={sets.map((r) => ({ value: r.id, label: `${r.cohortLabel}, version ${r.version}` }))} /></Field>
    <TextField id="e-title" label="Contract title (if different)" value={f.enrollmentContractTitle} onChange={(v) => set("enrollmentContractTitle", v)} />
    <TextField id="e-date" label="Enrollment date" type="date" value={f.enrolledAt} onChange={(v) => set("enrolledAt", v)} />
    <Field id="e-bach" label="Prior bachelor's degree"><Pick id="e-bach" value={f.priorBachelorSource} onChange={(v) => set("priorBachelorSource", v)} options={PRIOR_BACHELOR_SOURCES.map((s) => ({ value: s, label: s === "lumiere" ? "Lumière bachelor" : s === "external" ? "Other institution" : "Not known" }))} /></Field>
  </FormDialog>;
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

/**
 * Same error format as apiRequest ("<status>: <body>", parsed by parseApiFailure) but without
 * importing @/lib/queryClient, whose module-level QueryClient breaks the workspace page's tests.
 */
async function apiRequest(method: string, url: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method !== "GET") {
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, credentials: "include", body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
  return res;
}

export default function GraduateProgramReview({ studentId }: { studentId: string }) {
  // The server states the viewer's role; only staff and admin can load this workspace at all.
  const canEdit = true;
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<PanelDialog | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const query = useQuery<StaffGraduateWorkspace>({
    queryKey: STAFF_GRADUATE_QUERY_KEY(studentId),
    queryFn: async () => (await apiRequest("GET", STAFF_GRADUATE_PATHS.workspace(studentId))).json(),
    enabled: !!studentId,
    retry: false,
  });
  // Success is only ever 2xx (apiRequest throws otherwise); then refetch the workspace.
  const send = async (method: string, url: string, body: unknown) => {
    await apiRequest(method, url, body);
    await queryClient.invalidateQueries({ queryKey: STAFF_GRADUATE_QUERY_KEY(studentId) });
    setDialog(null);
    setFeedback("Saved.");
  };
  if (query.isLoading) return <div role="status" aria-live="polite" className="rounded-md border p-6 text-center text-sm text-muted-foreground">Loading graduate programmes…</div>;
  if (query.isError || !query.data) {
    return <section id="workspace-graduate" aria-labelledby="workspace-graduate-heading" className="space-y-2">
      <h2 id="workspace-graduate-heading" className="text-xl font-semibold">Graduate programmes</h2>
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm"><p>Could not load graduate programmes.</p><Button className="mt-3 min-h-11" type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button></div>
    </section>;
  }
  const close = () => setDialog(null);
  const role: Role = query.data.viewerRole === "admin" ? "admin" : "staff";
  return <>
    <GraduateProgramReviewView workspace={query.data} role={role} canEdit={canEdit} feedback={feedback} onDialog={(d) => { setFeedback(null); setDialog(d); }} />
    {dialog?.t === "enroll" ? <EnrollDialog workspace={query.data} send={send} onClose={close} /> : null}
    {dialog?.t === "verify" ? <VerifyDialog record={dialog.record} role={role} send={send} onClose={close} /> : null}
    {dialog?.t === "track" ? <TrackDialog program={dialog.program} record={dialog.record} kind={dialog.kind} send={send} onClose={close} /> : null}
    {dialog?.t === "topic" ? <TopicDialog record={dialog.record} outcome={dialog.outcome} send={send} onClose={close} /> : null}
    {dialog?.t === "subject" ? <SubjectDialog program={dialog.program} send={send} onClose={close} /> : null}
    {dialog?.t === "result" ? <ResultDialog subject={dialog.subject} send={send} onClose={close} /> : null}
    {dialog?.t === "credit" ? <CreditDialog program={dialog.program} send={send} onClose={close} /> : null}
  </>;
}
