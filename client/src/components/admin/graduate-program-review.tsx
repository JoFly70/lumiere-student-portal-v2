/**
 * S12 — staff "Graduate programmes" workspace, mounted in the admin student
 * workspace and on the staff graduate page. Styled like the staff profile panel
 * (student-surface tokens, trust-badge tones, a gold "Needs a decision" block).
 *
 * Every record shows three things: what is VERIFIED (issuer, document, date,
 * reviewer), what is only CLAIMED, and the ACTION still required. Verified
 * records collapse to one line. `verified` is only ever shown after a 2xx from
 * the verify endpoint; a 422 keeps the dialog open, lists what is missing at the
 * top and marks the offending fields inline.
 */
import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronDown, CircleDashed, Clock, GraduationCap, Globe2, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getAuthToken, getCsrfToken } from "@/lib/api";
import {
  ASSESSMENT_TYPES,
  EVALUATION_FRAMING,
  INSTITUTIONS,
  INSTITUTION_LABEL,
  PRIOR_BACHELOR_SOURCES,
  RESULT_STATUSES,
  TRACKING_STATUSES,
  CREDIT_AUTHORITIES,
  CREDIT_AUTHORITY_LABEL,
  RECOGNITION_OUTCOMES,
  type StaffGraduateProgramView,
  type StaffGraduateWorkspace,
  type StaffRecordView,
  type SubjectRecord,
} from "@shared/graduate-program-contract";
import {
  STAFF_GRADUATE_PATHS,
  STAFF_GRADUATE_QUERY_KEY,
  TOPIC_DECISIONS,
  ASSESSMENT_LABEL,
  AUTHORITY_NAME,
  DECISION_LABEL,
  EVALUATION_DECISION_LABEL,
  EVALUATION_NOTE,
  EVALUATION_OPTIONS,
  EVIDENCE_LEVEL_LABEL,
  RESULT_KIND_LABEL,
  RESULT_LABEL,
  TRACK_STATE_LABEL,
  activeRuleSets,
  addableKinds,
  buildActionQueue,
  buildCreditBody,
  buildEnrollBody,
  buildEvaluationBody,
  buildEvaluationUpdateBody,
  buildEvaluationVerifyBody,
  buildResultBody,
  buildTopicDecisionBody,
  buildTrackBody,
  buildVerifyBody,
  canDecideTopic,
  canOfferVerify,
  classificationLine,
  creditGate,
  creditGroups,
  emptyCreditForm,
  emptyEvaluationForm,
  emptyEvaluationVerifyForm,
  emptyResultForm,
  emptyTrackForm,
  enrollGate,
  evaluationFormGate,
  evaluationRow,
  evaluationUpdateDefaults,
  evaluationVerifyGate,
  evaluationsOf,
  evaluatorCountryLock,
  failureSummary,
  fieldErrors,
  kindLabel,
  legalizationLine,
  outcomeLabel,
  parseApiFailure,
  programSummary,
  recordBadge,
  recordTriad,
  recordsOfSection,
  resultFormForVerify,
  resultGate,
  ruleSetLine,
  sectionsForRoute,
  setEvaluator,
  studentProgressText,
  subjectAction,
  subjectGroups,
  subjectNeedsVerification,
  subjectResultText,
  titleLines,
  trackFormFromRecord,
  trackNodeTone,
  trackSummary,
  trackingLabel,
  trustBadge,
  unlinkedEvaluationQueue,
  verifyFields,
  verifyFormDefaults,
  verifyGate,
  verifySubmitGate,
  type ApiFailure,
  type CreditForm,
  type EnrollForm,
  type EvaluationForm,
  type EvaluationUpdateForm,
  type EvaluationVerifyForm,
  type GuardScope,
  type QueueItem,
  type QueueTarget,
  type ResultForm,
  type TrackForm,
  type TrustBadge,
  type VerifyForm,
} from "./graduate-program-review-logic";

type Role = "staff" | "admin";
type EvaluationRow = StaffGraduateWorkspace["evaluations"][number];
type DocumentOption = { readonly id: string; readonly fileName: string; readonly status: string };
/** Fixtures may omit documents; dialogs then fall back to a labelled free field. */
type WorkspaceWithDocuments = StaffGraduateWorkspace;

export type PanelDialog =
  | { t: "enroll" }
  | { t: "verify"; program: StaffGraduateProgramView; record: StaffRecordView }
  | { t: "track"; program: StaffGraduateProgramView; record: StaffRecordView | null; kind?: StaffRecordView["kind"] }
  | { t: "topic"; record: StaffRecordView; outcome: keyof typeof TOPIC_DECISIONS }
  | { t: "subject"; program: StaffGraduateProgramView }
  | { t: "result"; program: StaffGraduateProgramView; subject: SubjectRecord; verify?: boolean }
  | { t: "credit"; program: StaffGraduateProgramView }
  | { t: "evaluation"; program?: StaffGraduateProgramView }
  | { t: "evaluation-update"; evaluation: EvaluationRow }
  | { t: "evaluation-verify"; evaluation: EvaluationRow };

const NONE = "__none";

// ---------------------------------------------------------------------------
// Staff-profile look: charcoal seal buttons, gold-soft attention block, trust pills
// ---------------------------------------------------------------------------

const PRIMARY_ACTION = "min-h-11 border-student-seal bg-student-seal px-4 text-student-seal-ink hover:bg-student-seal/90 disabled:border-student-line disabled:bg-student-line disabled:text-student-muted disabled:opacity-100";
const OUTLINE_ACTION = "min-h-11 border-student-line-strong bg-student-card px-4 text-student-ink hover:bg-student-gold-soft";
const CARD = "border-student-line bg-student-card text-student-ink";
const EYEBROW = "text-xs font-medium uppercase tracking-wide text-student-muted";
const INPUT = "min-h-11 border-student-line-strong bg-student-card text-student-ink";

const TONE_CLASS: Record<TrustBadge["tone"], string> = {
  verified: "border-2 border-student-gold-ink bg-student-card text-student-gold-ink",
  pending: "border-st-attention bg-st-attention-soft text-st-attention",
  problem: "border-student-attn bg-student-attn-soft text-student-attn",
  reported: "border-student-line-strong bg-student-card text-student-muted",
};
const TONE_ICON: Record<TrustBadge["tone"], typeof CheckCircle2> = { verified: CheckCircle2, pending: Clock, problem: AlertCircle, reported: CircleDashed };

function TrustPill({ badge }: { badge: TrustBadge }) {
  const Icon = TONE_ICON[badge.tone];
  return <Badge variant="outline" className={`gap-1 whitespace-normal text-left text-xs font-semibold ${TONE_CLASS[badge.tone]}`}><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{badge.label}</Badge>;
}

const FieldErrorsContext = createContext<Record<string, string[]>>({});

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  const errors = useContext(FieldErrorsContext)[id];
  const only = Children.count(children) === 1 && isValidElement(children) ? (children as ReactElement<Record<string, unknown>>) : null;
  const child = errors && only ? cloneElement(only, { "aria-invalid": true, "aria-describedby": `${id}-error` }) : children;
  return <div className="space-y-1">
    <Label htmlFor={id}>{label}</Label>
    {child}
    {hint ? <p className="text-xs text-student-muted">{hint}</p> : null}
    {errors ? <p id={`${id}-error`} className="text-xs font-medium text-student-attn" data-testid="field-error">{errors.join(" ")}</p> : null}
  </div>;
}

type Option = { value: string; label: string };

function Pick({ id, value, onChange, options, allowNone, noneLabel = "Not stated", ...aria }: { id: string; value: string; onChange: (v: string) => void; options: readonly Option[]; allowNone?: boolean; noneLabel?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) {
  return <Select value={value === "" ? NONE : value} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
    <SelectTrigger id={id} className={INPUT} {...aria}><SelectValue placeholder="Choose…" /></SelectTrigger>
    <SelectContent>
      {allowNone ? <SelectItem value={NONE}>{noneLabel}</SelectItem> : null}
      {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
    </SelectContent>
  </Select>;
}

const instOptions: Option[] = INSTITUTIONS.map((i) => ({ value: i, label: INSTITUTION_LABEL[i] }));
const labelled = (xs: readonly string[], map: Record<string, string>): Option[] => xs.map((x) => ({ value: x, label: map[x] ?? x.replace(/_/g, " ") }));

// ---------------------------------------------------------------------------
// Read-only view (pure; rendered in tests)
// ---------------------------------------------------------------------------

function RecordActions({ program, rec, role, onDialog, canEdit }: { program: StaffGraduateProgramView; rec: StaffRecordView; role: Role; onDialog?: (d: PanelDialog) => void; canEdit: boolean }) {
  const gate = verifyGate(rec, role);
  if (!canEdit) return null;
  return <div className="flex flex-wrap items-center gap-2">
    {canOfferVerify(rec) ? <Button type="button" size="sm" className={PRIMARY_ACTION} disabled={!gate.enabled} onClick={() => onDialog?.({ t: "verify", program, record: rec })}>Verify…</Button> : null}
    <Button type="button" size="sm" variant="outline" className={OUTLINE_ACTION} onClick={() => onDialog?.({ t: "track", program, record: rec })}>Update tracking…</Button>
    {canDecideTopic(rec) && rec.details.topic ? (Object.keys(TOPIC_DECISIONS) as Array<keyof typeof TOPIC_DECISIONS>).map((o) => <Button key={o} type="button" size="sm" variant="outline" className={OUTLINE_ACTION} disabled={rec.outcome === o} onClick={() => onDialog?.({ t: "topic", record: rec, outcome: o })}>{TOPIC_DECISIONS[o]}…</Button>) : null}
    {!gate.enabled && canOfferVerify(rec) ? <p className="text-xs text-student-muted">{gate.reason}</p> : null}
  </div>;
}

function RecordCard({ program, rec, role, onDialog, canEdit }: { program: StaffGraduateProgramView; rec: StaffRecordView; role: Role; onDialog?: (d: PanelDialog) => void; canEdit: boolean }) {
  const t = recordTriad(rec);
  const badge = recordBadge(rec);
  if (t.verified) {
    // One line when collapsed; the full evidence on expand.
    return <li data-testid="graduate-record" data-kind={rec.kind} data-collapsed="true">
      <details className="group rounded-md border border-student-line bg-student-card">
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden" data-testid="record-oneline">
          <ChevronDown className="h-4 w-4 shrink-0 text-student-muted transition-transform group-open:rotate-180" aria-hidden="true" />
          <span className="font-medium">{rec.label}</span>
          <TrustPill badge={badge} />
          <span className="min-w-0 basis-full break-words text-xs text-student-muted sm:basis-auto sm:flex-1">{t.oneLine}</span>
        </summary>
        <div className="space-y-3 border-t border-student-line px-3 py-3 text-sm" data-testid="triad-verified">
          <p className={EYEBROW}>Verified</p>
          <ul className="space-y-0.5">
            <li>{t.verified.issuer}</li><li>{t.verified.document}</li>
            {t.verified.outcome ? <li>Outcome: {t.verified.outcome}</li> : null}
            {t.verified.decisionDate ? <li>Decision date: {t.verified.decisionDate}</li> : null}
            {t.verified.effectiveDate ? <li>Effective date: {t.verified.effectiveDate}</li> : null}
            <li className="text-student-muted">Reviewed by {t.verified.reviewer ?? "unknown"}{t.verified.reviewedAt ? ` on ${t.verified.reviewedAt}` : ""}</li>
          </ul>
          {rec.academicConsequence ? <p className="text-xs text-student-muted">Consequence: {rec.academicConsequence}</p> : null}
          {rec.note ? <p className="text-xs text-student-muted">Note: {rec.note}</p> : null}
          <RecordActions program={program} rec={rec} role={role} onDialog={onDialog} canEdit={canEdit} />
        </div>
      </details>
    </li>;
  }
  return <li className="space-y-3 rounded-md border border-student-line bg-student-card p-3" data-testid="graduate-record" data-kind={rec.kind}>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{rec.label}</p><TrustPill badge={badge} /></div>
    <div className="grid gap-3 text-sm md:grid-cols-2">
      <div data-testid="triad-claimed"><p className={EYEBROW}>Claimed / reported</p>
        {t.claimed.length ? <ul className="mt-1 space-y-0.5">{t.claimed.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="mt-1 text-student-muted">Nothing reported.</p>}
        {rec.note ? <p className="mt-1 text-xs text-student-muted">Note: {rec.note}</p> : null}
      </div>
      <div data-testid="triad-action"><p className={EYEBROW}>Action required</p>
        {t.action.length ? <ul className="mt-1 list-disc space-y-0.5 pl-4">{t.action.map((a) => <li key={a}>{a}</li>)}</ul> : <p className="mt-1 text-student-muted">Nothing to do yet.</p>}
      </div>
    </div>
    <RecordActions program={program} rec={rec} role={role} onDialog={onDialog} canEdit={canEdit} />
  </li>;
}

function TrackStrip({ p }: { p: StaffGraduateProgramView }) {
  const t = trackSummary(p);
  const row = (name: string, nodes: NonNullable<typeof t.university>, testid: string) => <div data-testid={testid}>
    <p className={EYEBROW}>{name}</p>
    <ol className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7 [&>*]:min-w-0">
      {nodes.map((n) => {
        const tone = trackNodeTone(n.state);
        const Icon = TONE_ICON[tone];
        return <li key={n.key} className={`rounded-md border p-2 text-xs ${TONE_CLASS[tone]}`} data-state={n.state}>
          <p className="flex items-center gap-1 font-semibold"><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{n.label}</span></p>
          <p className="mt-0.5 break-words"><span className="sr-only">{TRACK_STATE_LABEL[n.state]}. </span>{n.detail}</p>
        </li>;
      })}
    </ol>
  </div>;
  return <div className="space-y-3" data-testid="track-summary">
    {row("ENEB track", t.eneb, "track-eneb")}
    {t.university ? row("University track (Unimarconi)", t.university, "track-university") : <div data-testid="track-university"><p className={EYEBROW}>University track (Unimarconi)</p><p className="mt-1 rounded-md border border-student-line p-2 text-xs text-student-muted">Not applicable. This ENEB-only programme has no university registration, recognition or award.</p></div>}
  </div>;
}

function NeedsDecision({ id, items, onRun }: { id: string; items: readonly QueueItem[]; onRun: (t: QueueTarget) => void }) {
  if (!items.length) return <p className="rounded-md border border-student-line px-3 py-2 text-sm text-student-muted" data-testid="needs-decision-empty">Nothing is waiting for a decision on this programme.</p>;
  return <div className="space-y-3 rounded-xl border-2 border-student-gold-ink bg-student-gold-soft p-3 sm:p-4" data-testid="needs-decision" role="group" aria-labelledby={`${id}-nd`}>
    <h4 id={`${id}-nd`} className="flex items-center gap-2 text-base font-semibold"><AlertCircle className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />Needs a decision<Badge className="ml-1 bg-student-seal text-student-seal-ink hover:bg-student-seal">{items.length}</Badge></h4>
    <ol className="space-y-2">
      {items.map((it) => <li key={it.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-student-line bg-student-card p-3 text-student-ink" data-testid="queue-item" data-category={it.category}>
        <div className="min-w-0 flex-1 basis-60"><p className="text-sm font-medium">{it.title}</p><p className="text-xs text-student-muted">{it.detail}</p>{it.disabledReason ? <p className="mt-1 text-xs text-student-muted">{it.disabledReason}</p> : null}</div>
        {it.target.t === "anchor"
          ? <Button asChild variant="outline" className={OUTLINE_ACTION}><a href={`#${it.target.anchor}-${id}`}>{it.actionLabel}</a></Button>
          : <Button type="button" variant={it.category === "tracking" || it.category === "question" || it.category === "record_claimed" ? "outline" : "default"} className={it.category === "tracking" || it.category === "question" || it.category === "record_claimed" ? OUTLINE_ACTION : PRIMARY_ACTION} disabled={!!it.disabledReason} onClick={() => onRun(it.target)}>{it.actionLabel}</Button>}
      </li>)}
    </ol>
  </div>;
}

function SubjectsSection({ p, onDialog, canEdit }: { p: StaffGraduateProgramView; onDialog?: (d: PanelDialog) => void; canEdit: boolean }) {
  const groups = subjectGroups(p);
  const awaiting = p.subjects.filter(subjectNeedsVerification).length;
  return <details id={`subjects-${p.program.id}`} className="rounded-md border border-student-line bg-student-card" open={awaiting > 0} data-testid="subjects-section">
    <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2">
      <span className="text-sm font-semibold">Subjects <span className="font-normal text-student-muted">· {p.subjects.length} recorded{awaiting ? ` · ${awaiting} result${awaiting === 1 ? "" : "s"} not yet verified` : ""}</span></span>
    </summary>
    <div className="space-y-4 border-t border-student-line p-3">
      <p className="text-xs text-student-muted">Subjects are tracked separately from the thesis. A student's own progress report never makes a result official.</p>
      {groups.length === 0 ? <p className="text-sm text-student-muted">No subjects recorded.</p> : groups.map((g) => <div key={g.authority} className="space-y-1">
        <h5 className={EYEBROW}>{g.title}{g.unverified ? ` · ${g.unverified} to verify` : ""}</h5>
        <ul className="divide-y divide-student-line rounded-md border border-student-line">
          {g.subjects.map((s) => {
            const action = subjectAction(s);
            return <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm" data-testid="graduate-subject" data-needs-verification={action ? "true" : "false"}>
              <div className="min-w-0 flex-1 basis-56"><p className="font-medium">{s.title}</p><p className="text-xs text-student-muted">{AUTHORITY_NAME[s.authority]} · {studentProgressText(s.studentProgress)}</p>{action ? <p className="text-xs font-medium text-st-attention">Action: {action}</p> : null}</div>
              <div className="flex flex-wrap items-center gap-2"><span>{subjectResultText(s)}</span><TrustPill badge={s.resultStatus === "none" ? { label: "No result yet", tone: "reported" } : trustBadge(s.verificationStatus)} />
                {canEdit ? <Button type="button" size="sm" variant="outline" className={OUTLINE_ACTION} onClick={() => onDialog?.({ t: "result", program: p, subject: s, verify: !!action })}>{action ? "Verify result…" : s.resultStatus === "none" ? "Record result…" : "Update result…"}</Button> : null}</div>
            </li>;
          })}
        </ul>
      </div>)}
      {canEdit ? <Button type="button" size="sm" variant="outline" className={OUTLINE_ACTION} onClick={() => onDialog?.({ t: "subject", program: p })}>Add subject…</Button> : null}
    </div>
  </details>;
}

function CreditsSection({ p, onDialog, canEdit }: { p: StaffGraduateProgramView; onDialog?: (d: PanelDialog) => void; canEdit: boolean }) {
  const groups = creditGroups(p);
  return <section id={`credits-${p.program.id}`} aria-labelledby={`cr-${p.program.id}`} className="space-y-2 scroll-mt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 id={`cr-${p.program.id}`} className="text-sm font-semibold">Credits by authority <span className="font-normal text-student-muted">· never summed together</span></h4>
      {canEdit && p.program.route === "eneb_unimarconi" ? <Button type="button" size="sm" variant="outline" className={OUTLINE_ACTION} onClick={() => onDialog?.({ t: "credit", program: p })}>Add credit entry…</Button> : null}</div>
    <ul className="grid gap-2 md:grid-cols-2 [&>*]:min-w-0">{groups.map((c) => <li key={c.authority} className="space-y-1 rounded-md border border-student-line bg-student-card p-3 text-sm" data-testid="credit-layer" data-authority={c.authority}>
      <p className="flex flex-wrap items-baseline justify-between gap-x-2"><span className="font-medium">{c.label}</span><span className={c.state === "recorded" ? "font-semibold" : "text-student-muted"}>{c.amountText}</span></p>
      <p className="text-xs text-student-muted">{c.explanation}</p>
      {c.conditionalText ? <p className="text-xs font-medium text-st-attention">{c.conditionalText}</p> : null}
      {c.entries.length ? <ul className="mt-1 divide-y divide-student-line border-t border-student-line">{c.entries.map((e) => <li key={e.id} className="py-1 text-xs" data-testid="credit-entry"><span>{e.text}</span>{e.outcome ? <span className="text-student-muted"> · {e.outcome}</span> : null}{e.conditions ? <span className="block font-medium text-st-attention">Condition: {e.conditions}</span> : null}</li>)}</ul> : null}
    </li>)}</ul>
  </section>;
}

function ProgramCard({ p, role, onDialog, canEdit, evaluations }: { p: StaffGraduateProgramView; role: Role; onDialog?: (d: PanelDialog) => void; canEdit: boolean; evaluations: readonly EvaluationRow[] }) {
  const titles = titleLines(p);
  const cls = classificationLine(p);
  const rs = ruleSetLine(p);
  const leg = legalizationLine(p);
  const sum = programSummary(p);
  const sv = p.studentView;
  const queue = buildActionQueue(p, evaluations, role);
  const run = (t: QueueTarget) => {
    if (t.t === "verify-record") { const r = p.records.find((x) => x.id === t.recordId); if (r) onDialog?.({ t: "verify", program: p, record: r }); }
    else if (t.t === "track-record") { const r = p.records.find((x) => x.id === t.recordId); if (r) onDialog?.({ t: "track", program: p, record: r }); }
    else if (t.t === "verify-evaluation") { const e = evaluations.find((x) => x.id === t.evaluationId); if (e) onDialog?.({ t: "evaluation-verify", evaluation: e }); }
  };
  const headingId = `prog-${p.program.id}`;
  return <Card className={CARD} data-testid="graduate-program" data-route={p.program.route}>
    <CardHeader className="space-y-3 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={headingId} className="text-base font-semibold">{titles.marketing}</h3>
        <Badge variant="outline" className="border-student-line-strong text-student-muted">{p.program.route === "eneb_unimarconi" ? "ENEB + university route" : "ENEB only"}</Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
        {titles.contract ? <div><dt className="inline text-student-muted">Contract title: </dt><dd className="inline">{titles.contract}</dd></div> : null}
        <div data-testid="university-title"><dt className="inline text-student-muted">University title: </dt><dd className="inline">{titles.universityTitle.text}{titles.universityTitle.verified ? " (verified)" : ""}</dd></div>
        <div><dt className="inline text-student-muted">Awarding institution: </dt><dd className="inline">{INSTITUTION_LABEL[p.offering.awardingInstitution]}</dd></div>
        <div data-testid="classification"><dt className="inline text-student-muted">Classification: </dt><dd className="inline">{cls.text} · {cls.verificationText}</dd></div>
        <div><dt className="inline text-student-muted">Cohort: </dt><dd className="inline">{p.program.cohortLabel}</dd></div>
        <div data-testid="ruleset-line"><dt className="inline text-student-muted">Rule set: </dt><dd className="inline">{rs.text}</dd></div>
        <div><dt className="inline text-student-muted">University registration: </dt><dd className="inline">{sv.registration.label}{sv.registration.matricola ? ` (${sv.registration.matricola})` : ""}</dd></div>
      </dl>
      <p className="text-xs text-student-muted" data-testid="program-summary">{sum.verified} official record{sum.verified === 1 ? "" : "s"} verified · {sum.needAction} awaiting verification ({sum.recordsAwaiting} record{sum.recordsAwaiting === 1 ? "" : "s"}, {sum.subjectsAwaiting} subject result{sum.subjectsAwaiting === 1 ? "" : "s"}) · {sum.openQuestions} open question{sum.openQuestions === 1 ? "" : "s"}</p>
      {!rs.current ? <p className="flex items-center gap-1 text-xs font-medium text-st-attention"><ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />A newer rule set exists. This enrollment keeps its pinned terms.</p> : null}
    </CardHeader>
    <CardContent className="space-y-5">
      <NeedsDecision id={p.program.id} items={queue} onRun={run} />
      <TrackStrip p={p} />
      {leg ? <p className="rounded-md border border-student-line bg-student-gold-soft/40 p-2 text-sm" data-testid="legalization-line">{leg.text}</p> : null}

      {sectionsForRoute(p.program.route).map((s) => {
        const recs = recordsOfSection(p, s);
        return <section key={s.key} aria-labelledby={`sec-${p.program.id}-${s.key}`} className="space-y-2">
          <h4 id={`sec-${p.program.id}-${s.key}`} className="text-sm font-semibold">{s.title}</h4>
          {recs.length ? <ul className="space-y-2">{recs.map((r) => <RecordCard key={r.id} program={p} rec={r} role={role} onDialog={onDialog} canEdit={canEdit} />)}</ul> : <p className="text-sm text-student-muted">No record yet.</p>}
        </section>;
      })}
      {canEdit && addableKinds(p).length ? <Button type="button" size="sm" variant="outline" className={OUTLINE_ACTION} onClick={() => onDialog?.({ t: "track", program: p, record: null })}>Add record…</Button> : null}

      <SubjectsSection p={p} onDialog={onDialog} canEdit={canEdit} />
      <CreditsSection p={p} onDialog={onDialog} canEdit={canEdit} />

      <details className="rounded-md border border-student-line" data-testid="student-preview">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium"><ChevronDown className="h-4 w-4" aria-hidden="true" />What the student sees</summary>
        <div className="space-y-2 border-t border-student-line p-3 text-sm">
          <p><span className="text-student-muted">Next step: </span><span className="font-medium">{sv.nextStep.title}</span>. {sv.nextStep.detail}</p>
          <p><span className="text-student-muted">Graduation: </span>{sv.graduation ? sv.graduation.explanation : "Not applicable on an ENEB-only programme."}</p>
          <p><span className="text-student-muted">Progress: </span>{sv.progress.statement}</p>
        </div>
      </details>
    </CardContent>
  </Card>;
}

function EvaluationCard({ e, onDialog, canEdit }: { e: EvaluationRow; onDialog?: (d: PanelDialog) => void; canEdit: boolean }) {
  const v = evaluationRow(e);
  return <li className={`space-y-3 rounded-md border bg-student-card p-3 ${v.preliminary ? "border-dashed border-st-attention" : "border-student-line"}`} data-testid="graduate-evaluation" data-evaluator={e.evaluator} data-preliminary={v.preliminary ? "true" : "false"}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 space-y-1">
        <p className="font-medium" data-testid="evaluation-evaluator">{v.evaluator}</p>
        <p className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="border-student-line-strong text-student-ink" data-testid="evaluation-country">For {v.country}</Badge>
          <Badge variant="outline" className={`whitespace-normal text-left ${v.preliminary ? "border-dashed border-st-attention bg-st-attention-soft text-st-attention" : "border-student-line-strong text-student-ink"}`} data-testid="evaluation-type">{v.typeLabel}</Badge>
        </p>
      </div>
      <TrustPill badge={v.trust} />
    </div>
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      <div><dt className="inline text-student-muted">Qualification evaluated: </dt><dd className="inline">{v.qualification}</dd></div>
      <div><dt className="inline text-student-muted">Intended use: </dt><dd className="inline">{v.use}</dd></div>
      <div><dt className="inline text-student-muted">Status: </dt><dd className="inline">{v.status}</dd></div>
      <div><dt className="inline text-student-muted">Report date: </dt><dd className="inline">{v.reportDate ?? "Not recorded"}</dd></div>
    </dl>
    <div className="text-sm" data-testid="evaluation-conclusion"><p><span className="text-student-muted">Conclusion: </span><span className="font-medium">{v.conclusionLabel}</span></p>
      {v.conclusionText ? <blockquote className="mt-1 border-l-2 border-student-line-strong pl-3 text-student-muted">In the evaluator's words: “{v.conclusionText}”</blockquote> : null}
      <p className="mt-1 text-xs text-student-muted">{e.view.caveat}</p></div>
    <div className="grid gap-3 text-sm md:grid-cols-3">
      <div data-testid="triad-verified"><p className={EYEBROW}>Verified</p>{v.verified ? <p className="mt-1">Checked against {v.verified.reference}. Reviewed by {v.verified.reviewer ?? "unknown"}{v.verified.reviewedAt ? ` on ${v.verified.reviewedAt}` : ""}.</p> : <p className="mt-1 text-student-muted">Nothing verified yet.</p>}</div>
      <div data-testid="triad-claimed"><p className={EYEBROW}>Claimed / reported</p>{v.claimed.length ? <ul className="mt-1 space-y-0.5">{v.claimed.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="mt-1 text-student-muted">{v.verified ? "Nothing outstanding." : "Nothing reported."}</p>}</div>
      <div data-testid="triad-action"><p className={EYEBROW}>Action required</p>{v.action.length ? <ul className="mt-1 list-disc space-y-0.5 pl-4">{v.action.map((a) => <li key={a}>{a}</li>)}</ul> : <p className="mt-1 text-student-muted">Nothing to do.</p>}</div>
    </div>
    {canEdit ? <div className="flex flex-wrap gap-2">
      {v.canVerify ? <Button type="button" size="sm" className={PRIMARY_ACTION} onClick={() => onDialog?.({ t: "evaluation-verify", evaluation: e })}>Verify…</Button> : null}
      <Button type="button" size="sm" variant="outline" className={OUTLINE_ACTION} onClick={() => onDialog?.({ t: "evaluation-update", evaluation: e })}>Update…</Button>
    </div> : null}
  </li>;
}

function EvaluationsBlock({ workspace, onDialog, canEdit }: { workspace: StaffGraduateWorkspace; onDialog?: (d: PanelDialog) => void; canEdit: boolean }) {
  const evaluations = evaluationsOf(workspace);
  const unlinked = unlinkedEvaluationQueue(evaluations, workspace.programs.map((x) => x.program.id));
  return <section id="workspace-evaluations" aria-labelledby="workspace-evaluations-heading" className="space-y-3 scroll-mt-4" data-testid="evaluations-block">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-student-line pb-2">
      <h3 id="workspace-evaluations-heading" className="flex items-center gap-2 text-lg font-semibold"><Globe2 className="h-5 w-5 text-student-gold-ink" aria-hidden="true" />International credential evaluations</h3>
      {canEdit ? <Button type="button" className={PRIMARY_ACTION} onClick={() => onDialog?.({ t: "evaluation" })}>Record evaluation…</Button> : null}
    </div>
    <p className="text-sm text-student-muted" data-testid="evaluation-framing">{EVALUATION_FRAMING}</p>
    <p className="rounded-md border border-student-line bg-student-gold-soft/40 px-3 py-2 text-sm" data-testid="evaluation-note">{EVALUATION_NOTE}</p>
    {unlinked.length ? <NeedsDecision id="evaluations" items={unlinked} onRun={(t) => { if (t.t === "verify-evaluation") { const e = evaluations.find((x) => x.id === t.evaluationId); if (e) onDialog?.({ t: "evaluation-verify", evaluation: e }); } }} /> : null}
    {evaluations.length === 0 ? <p className="rounded-md border border-student-line p-3 text-sm text-student-muted" data-testid="evaluations-empty">No foreign credential evaluation recorded for this student.</p>
      : <ul className="space-y-3">{evaluations.map((e) => <EvaluationCard key={e.id} e={e} onDialog={onDialog} canEdit={canEdit} />)}</ul>}
  </section>;
}

export function GraduateProgramReviewView({ workspace, role = workspace.viewerRole ?? "staff", canEdit = true, onDialog, feedback }: { workspace: StaffGraduateWorkspace; role?: Role; canEdit?: boolean; onDialog?: (d: PanelDialog) => void; feedback?: string | null }) {
  const evaluations = evaluationsOf(workspace);
  return <section id="workspace-graduate" aria-labelledby="workspace-graduate-heading" className="student-surface scroll-mt-4 space-y-5 rounded-2xl border border-student-line p-3 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-student-line pb-3">
      <h2 id="workspace-graduate-heading" className="flex items-center gap-2 text-xl font-semibold"><GraduationCap className="h-5 w-5 text-student-gold-ink" aria-hidden="true" />Graduate programmes</h2>
      {canEdit ? <Button type="button" className={PRIMARY_ACTION} onClick={() => onDialog?.({ t: "enroll" })}>Enroll in a programme…</Button> : null}
    </div>
    <p className="text-sm text-student-muted">ENEB and university records are separate. Only evidence from the right institution makes an official status verified; tracking and student progress are never blocked.</p>
    {feedback ? <div role="status" className="rounded-md border-2 border-student-gold-ink bg-student-card px-3 py-2 text-sm font-medium text-student-gold-ink">{feedback}</div> : null}
    {workspace.programs.length === 0 ? <p className="rounded-md border border-student-line p-4 text-sm text-student-muted" data-testid="graduate-empty">This student is not enrolled in a graduate programme.</p>
      : workspace.programs.map((p) => <ProgramCard key={p.program.id} p={p} role={role} onDialog={onDialog} canEdit={canEdit} evaluations={evaluations} />)}
    <EvaluationsBlock workspace={workspace} onDialog={onDialog} canEdit={canEdit} />
  </section>;
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

type Send = (method: string, url: string, body: unknown) => Promise<void>;

function FormDialog({ title, description, children, submitLabel, gate, onSubmit, onClose, scope = "record" }: { title: string; description?: string; children: ReactNode; submitLabel: string; gate: { ok: boolean; reason: string | null }; onSubmit: () => Promise<void>; onClose: () => void; scope?: GuardScope }) {
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const mutation = useMutation({
    mutationFn: onSubmit,
    onError: (err) => setFailure(parseApiFailure(err)),
  });
  const summary = failure ? failureSummary(failure, scope) : null;
  const errors = useMemo(() => (failure ? fieldErrors(failure.missing, scope) : {}), [failure, scope]);
  // A refusal lists what is missing at the TOP of the form and moves focus there, so it is never below the fold.
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!failure) return;
    errorRef.current?.scrollIntoView({ block: "nearest" });
    errorRef.current?.focus();
  }, [failure]);
  return <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }}>
    <DialogContent className="student-surface max-h-[90dvh] overflow-y-auto border-student-line bg-student-card text-student-ink max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:content-start max-sm:rounded-none max-sm:border-0">
      <DialogHeader><DialogTitle>{title}</DialogTitle>{description ? <DialogDescription className="text-student-muted">{description}</DialogDescription> : null}</DialogHeader>
      <FieldErrorsContext.Provider value={errors}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setFailure(null); mutation.mutate(); }}>
          {summary ? <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-md border border-student-attn bg-student-attn-soft p-3 text-sm text-student-attn outline-none" data-testid="dialog-error"><p className="font-medium">{summary.headline}</p>
            {summary.items.length ? <ul className="mt-1 list-disc pl-5" data-testid="dialog-missing">{summary.items.map((i) => <li key={i}>{i}</li>)}</ul> : null}</div> : null}
          {children}
          {!gate.ok && gate.reason ? <p className="text-xs text-student-muted">{gate.reason}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" className={OUTLINE_ACTION} disabled={mutation.isPending} onClick={onClose}>Cancel</Button>
            <Button type="submit" className={PRIMARY_ACTION} disabled={!gate.ok || mutation.isPending}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}{submitLabel}</Button>
          </DialogFooter>
        </form>
      </FieldErrorsContext.Provider>
    </DialogContent>
  </Dialog>;
}

function TextField({ id, label, value, onChange, type = "text", hint, readOnly }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string; readOnly?: boolean }) {
  return <Field id={id} label={label} hint={hint}><Input id={id} type={type} className={`${INPUT}${readOnly ? " bg-student-gold-soft/40" : ""}`} value={value} readOnly={readOnly} aria-readonly={readOnly || undefined} onChange={(e) => onChange(e.target.value)} /></Field>;
}

function TextArea({ id, label, value, onChange, rows = 2, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; rows?: number; hint?: string }) {
  return <Field id={id} label={label} hint={hint}><Textarea id={id} rows={rows} maxLength={1000} className="border-student-line-strong bg-student-card text-student-ink" value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
}

/** A select of the student's documents when the workspace lists them; otherwise a labelled free field. */
function DocumentField({ id, value, onChange, documents }: { id: string; value: string; onChange: (v: string) => void; documents: readonly DocumentOption[] | undefined }) {
  if (documents && documents.length) {
    return <Field id={id} label="Document from Documents (optional)" hint="Attach one of the student's uploaded documents as the evidence."><Pick id={id} value={value} onChange={onChange} allowNone noneLabel="No document attached" options={documents.map((d) => ({ value: d.id, label: `${d.fileName} (${d.status.replace(/_/g, " ")})` }))} /></Field>;
  }
  return <TextField id={id} label="Document from Documents (optional)" value={value} onChange={onChange} hint="Optional. Paste the document's id from the student's Documents tab. Leave empty if you only have a reference." />;
}

function VerifyDialog({ record, role, send, onClose, documents }: { record: StaffRecordView; role: Role; send: Send; onClose: () => void; documents?: readonly DocumentOption[] }) {
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
    <Field id="v-decision" label="Decision"><Pick id="v-decision" value={f.decision} onChange={(v) => set("decision", v as VerifyForm["decision"])} options={labelled(["verified", "evidence_received", "conflicting", "rejected"], DECISION_LABEL)} /></Field>
    <Field id="v-issuer" label="Issuing institution"><Pick id="v-issuer" value={f.issuingInstitution} onChange={(v) => set("issuingInstitution", v)} options={instOptions} allowNone /></Field>
    <TextField id="v-doctype" label="Document type" value={f.documentTypeLabel} onChange={(v) => set("documentTypeLabel", v)} />
    <TextField id="v-docref" label="Document reference" value={f.documentReference} onChange={(v) => set("documentReference", v)} hint="Or attach a verified document below." />
    <DocumentField id="v-docid" value={f.documentId} onChange={(v) => set("documentId", v)} documents={documents} />
    <TextField id="v-date" label="Date printed on the document" type="date" value={f.decisionDate} onChange={(v) => set("decisionDate", v)} />
    {fields.outcomes.length ? <Field id="v-outcome" label="Outcome stated by the document"><Pick id="v-outcome" value={f.outcome} onChange={(v) => set("outcome", v)} options={fields.outcomes.map((o) => ({ value: o, label: outcomeLabel(o) }))} allowNone /></Field> : null}
    {fields.matricola ? <TextField id="v-matricola" label="Matricola" value={f.matricola} onChange={(v) => set("matricola", v)} /> : null}
    {fields.issuingCountry ? <TextField id="v-country" label="Issuing country (ISO code, for example NG)" value={f.issuingCountry} onChange={(v) => set("issuingCountry", v)} hint="Where the degree was issued, not where the student lives." /> : null}
    {fields.effectiveDate ? <TextField id="v-effective" label="Conferral date on the university's document" type="date" value={f.effectiveDate} onChange={(v) => set("effectiveDate", v)} hint="Never the ceremony date." /> : null}
    <TextArea id="v-consequence" label="Academic consequence (optional)" value={f.academicConsequence} onChange={(v) => set("academicConsequence", v)} />
    {f.decision === "conflicting" ? <TextArea id="v-conflict" label="Conflicting evidence" value={f.conflictingEvidence} onChange={(v) => set("conflictingEvidence", v)} /> : null}
    <TextArea id="v-note" label="Note (required)" value={f.note} onChange={(v) => set("note", v)} />
  </FormDialog>;
}

function TrackDialog({ program, record, kind, send, onClose, documents }: { program: StaffGraduateProgramView; record: StaffRecordView | null; kind?: StaffRecordView["kind"]; send: Send; onClose: () => void; documents?: readonly DocumentOption[] }) {
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
    <Field id="t-status" label="Tracking status"><Pick id="t-status" value={f.trackingStatus} onChange={(v) => set("trackingStatus", v)} options={TRACKING_STATUSES.map((t) => ({ value: t, label: trackingLabel(t) }))} /></Field>
    <Field id="t-issuer" label="Issuing institution (as stated)"><Pick id="t-issuer" value={f.issuingInstitution} onChange={(v) => set("issuingInstitution", v)} options={instOptions} allowNone /></Field>
    <TextField id="t-doctype" label="Document type" value={f.documentTypeLabel} onChange={(v) => set("documentTypeLabel", v)} />
    <TextField id="t-docref" label="Document reference" value={f.documentReference} onChange={(v) => set("documentReference", v)} />
    <DocumentField id="t-docid" value={f.documentId} onChange={(v) => set("documentId", v)} documents={documents} />
    {f.kind === "university_registration" ? <TextField id="t-matricola" label="Matricola (stated, not yet verified)" value={f.matricola} onChange={(v) => set("matricola", v)} /> : null}
    {f.kind === "undergraduate_documents" ? <TextField id="t-country" label="Issuing country (ISO code)" value={f.issuingCountry} onChange={(v) => set("issuingCountry", v)} hint="Drives the apostille requirement. Residence does not." /> : null}
    {f.kind === "thesis_topic" ? <TextField id="t-topic" label="Topic" value={f.topic} onChange={(v) => set("topic", v)} /> : null}
    {f.kind === "graduation_procedure" ? <TextField id="t-ceremony" label="Ceremony date (does not set the conferral date)" type="date" value={f.ceremonyDate} onChange={(v) => set("ceremonyDate", v)} /> : null}
    {f.kind === "institutional_question" ? <TextArea id="t-question" label="Open question or exception" rows={3} value={f.question} onChange={(v) => set("question", v)} /> : null}
    <TextArea id="t-note" label="Note" value={f.note} onChange={(v) => set("note", v)} />
  </FormDialog>;
}

function TopicDialog({ record, outcome, send, onClose }: { record: StaffRecordView; outcome: keyof typeof TOPIC_DECISIONS; send: Send; onClose: () => void }) {
  return <FormDialog title={`${TOPIC_DECISIONS[outcome]}?`} description={`Topic: ${record.details.topic ?? ""}. An approved topic is locked for the student.`} submitLabel="Confirm" gate={{ ok: true, reason: null }}
    onSubmit={() => send("PATCH", STAFF_GRADUATE_PATHS.trackRecord(record.id), buildTopicDecisionBody(outcome))} onClose={onClose}><span /></FormDialog>;
}

function ResultDialog({ subject, verify, send, onClose }: { subject: SubjectRecord; verify?: boolean; send: Send; onClose: () => void }) {
  const [f, setF] = useState<ResultForm>(() => (verify ? resultFormForVerify(subject) : emptyResultForm(subject.authority)));
  const set = <K extends keyof ResultForm>(k: K, v: ResultForm[K]) => setF((s) => ({ ...s, [k]: v }));
  return <FormDialog title={`${verify ? "Verify result" : "Record result"}: ${subject.title}`} description={verify ? `Compare with the ${subject.authority === "eneb" ? "ENEB transcript" : "university exam record"}. Set the evidence level to Verified only after checking it. This never creates university credits.` : "Grades are recorded as the issuing document prints them. This never creates university credits."} submitLabel={verify ? "Save checked result" : "Save result"} gate={resultGate(f, subject.authority)} onSubmit={() => send("POST", STAFF_GRADUATE_PATHS.recordResult(subject.id), buildResultBody(f))} onClose={onClose}>
    <Field id="r-status" label="Result"><Pick id="r-status" value={f.resultStatus} onChange={(v) => set("resultStatus", v)} options={labelled(RESULT_STATUSES, RESULT_LABEL)} /></Field>
    <TextField id="r-display" label="Grade as printed (for example 8.9/10)" value={f.gradeDisplay} onChange={(v) => set("gradeDisplay", v)} />
    <div className="grid grid-cols-2 gap-2"><TextField id="r-value" label="Grade value" value={f.gradeValue} onChange={(v) => set("gradeValue", v)} /><TextField id="r-scale" label="Grade scale" value={f.gradeScale} onChange={(v) => set("gradeScale", v)} /></div>
    <Field id="r-issuer" label="Issuing institution"><Pick id="r-issuer" value={f.issuingInstitution} onChange={(v) => set("issuingInstitution", v)} options={instOptions} /></Field>
    <Field id="r-verif" label="Evidence level"><Pick id="r-verif" value={f.verificationStatus} onChange={(v) => set("verificationStatus", v)} options={labelled(["institution_stated", "evidence_received", "verified"], EVIDENCE_LEVEL_LABEL)} /></Field>
    <TextField id="r-ref" label="Document reference" value={f.documentReference} onChange={(v) => set("documentReference", v)} />
    <Field id="r-kind" label="What this entry is"><Pick id="r-kind" value={f.kind} onChange={(v) => set("kind", v)} options={labelled(["initial", "reassessment", "correction"], RESULT_KIND_LABEL)} /></Field>
  </FormDialog>;
}

function SubjectDialog({ program, send, onClose }: { program: StaffGraduateProgramView; send: Send; onClose: () => void }) {
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
    <Field id="s-assess" label="Assessment"><Pick id="s-assess" value={assessment} onChange={setAssessment} options={labelled(ASSESSMENT_TYPES, ASSESSMENT_LABEL)} /></Field>
  </FormDialog>;
}

const RECOGNITION_LABEL: Record<string, string> = { recognized: "Recognised", recognized_with_conditions: "Recognised with conditions", not_recognized: "Not recognised" };

function CreditDialog({ program, send, onClose }: { program: StaffGraduateProgramView; send: Send; onClose: () => void }) {
  const backing = program.records.filter((r) => ["recognition_request", "recognition_decision", "official_transcript", "award_conferral", "eneb_transcript", "eneb_certificate", "eneb_completion", "ui1_ects_certification"].includes(r.kind));
  const [f, setF] = useState<CreditForm>(() => emptyCreditForm(backing.find((r) => r.kind === "recognition_decision")?.id ?? backing[0]?.id ?? ""));
  const set = <K extends keyof CreditForm>(k: K, v: CreditForm[K]) => setF((s) => ({ ...s, [k]: v }));
  return <FormDialog title="Add a credit entry" description="Credits must come from the matching decision, certificate or transcript. An unrecorded decision stays unknown, never zero." submitLabel="Add credit" gate={creditGate(f)} onSubmit={() => send("POST", STAFF_GRADUATE_PATHS.createCredit(program.program.id), buildCreditBody(f))} onClose={onClose}>
    <Field id="c-auth" label="Credit authority"><Pick id="c-auth" value={f.authority} onChange={(v) => set("authority", v)} options={CREDIT_AUTHORITIES.map((a) => ({ value: a, label: CREDIT_AUTHORITY_LABEL[a] }))} /></Field>
    <Field id="c-rec" label="Backing record"><Pick id="c-rec" value={f.recordId} onChange={(v) => set("recordId", v)} options={backing.map((r) => ({ value: r.id, label: `${r.label} (${trustBadge(r.verificationStatus).label.toLowerCase()})` }))} /></Field>
    <TextField id="c-label" label="Module or block" value={f.label} onChange={(v) => set("label", v)} />
    <div className="grid grid-cols-2 gap-2"><TextField id="c-amount" label="Credits" value={f.amount} onChange={(v) => set("amount", v)} /><Field id="c-unit" label="Unit"><Pick id="c-unit" value={f.unit} onChange={(v) => set("unit", v)} options={[{ value: "ECTS", label: "ECTS" }, { value: "CFU", label: "CFU" }]} /></Field></div>
    {f.authority === "university_recognized" ? <>
      <Field id="c-outcome" label="Recognition outcome"><Pick id="c-outcome" value={f.recognitionOutcome} onChange={(v) => set("recognitionOutcome", v)} options={labelled(RECOGNITION_OUTCOMES, RECOGNITION_LABEL)} /></Field>
      <TextArea id="c-cond" label="Conditions (required when recognised with conditions)" value={f.conditions} onChange={(v) => set("conditions", v)} /></> : null}
  </FormDialog>;
}

function EnrollDialog({ workspace, send, onClose }: { workspace: StaffGraduateWorkspace; send: Send; onClose: () => void }) {
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

export function EvaluationFields({ f, set, setEval, programs, documents, status = true }: { f: EvaluationForm; set: <K extends keyof EvaluationForm>(k: K, v: EvaluationForm[K]) => void; setEval: (v: string) => void; programs: readonly StaffGraduateProgramView[]; documents?: readonly DocumentOption[]; status?: boolean }) {
  const lock = evaluatorCountryLock(f.evaluator);
  return <>
    <Field id="ev-program" label="Graduate programme (optional)" hint="The programme whose award was evaluated, when it is in the portal."><Pick id="ev-program" value={f.programId} onChange={(v) => set("programId", v)} allowNone noneLabel="Not linked to a programme" options={programs.map((p) => ({ value: p.program.id, label: `${p.offering.marketingTitle} · ${p.program.cohortLabel}` }))} /></Field>
    <Field id="ev-evaluator" label="Evaluator"><Pick id="ev-evaluator" value={f.evaluator} onChange={setEval} options={EVALUATION_OPTIONS.evaluators} /></Field>
    {f.evaluator === "other" || f.evaluator === "enic_naric_other" ? <TextField id="ev-name" label={f.evaluator === "other" ? "Evaluator name (required)" : "Centre name"} value={f.evaluatorName} onChange={(v) => set("evaluatorName", v)} /> : null}
    <TextField id="ev-country" label="Destination country (ISO code, for example US)" value={lock ?? f.destinationCountry} readOnly={!!lock} onChange={(v) => set("destinationCountry", v.toUpperCase())} hint={lock ? `This evaluator reports for one country only. The country is fixed to ${lock}.` : "The country the evaluation is for."} />
    <TextField id="ev-qualification" label="Qualification evaluated (exactly as submitted)" value={f.qualificationEvaluated} onChange={(v) => set("qualificationEvaluated", v)} />
    <Field id="ev-institution" label="Awarding institution"><Pick id="ev-institution" value={f.awardingInstitution} onChange={(v) => set("awardingInstitution", v)} options={instOptions} /></Field>
    <Field id="ev-use" label="Intended use"><Pick id="ev-use" value={f.intendedUse} onChange={(v) => set("intendedUse", v)} options={EVALUATION_OPTIONS.uses} /></Field>
    <Field id="ev-type" label="Type of result"><Pick id="ev-type" value={f.evaluationType} onChange={(v) => set("evaluationType", v)} options={EVALUATION_OPTIONS.types} /></Field>
    {status ? <Field id="ev-status" label="Status"><Pick id="ev-status" value={f.status} onChange={(v) => set("status", v)} options={EVALUATION_OPTIONS.statuses} /></Field> : null}
    <TextField id="ev-date" label="Date on the evaluation or tool result" type="date" value={f.reportDate} onChange={(v) => set("reportDate", v)} />
    <TextField id="ev-ref" label="Report reference" value={f.reportReference} onChange={(v) => set("reportReference", v)} />
    <DocumentField id="ev-docid" value={f.documentId} onChange={(v) => set("documentId", v)} documents={documents} />
    <Field id="ev-conclusion" label="Evaluator's conclusion"><Pick id="ev-conclusion" value={f.conclusion} onChange={(v) => set("conclusion", v)} options={EVALUATION_OPTIONS.conclusions} /></Field>
    <TextArea id="ev-conclusion-text" label="Evaluator's exact wording" rows={3} value={f.conclusionText} onChange={(v) => set("conclusionText", v)} />
    <TextArea id="ev-note" label="Note" value={f.note} onChange={(v) => set("note", v)} />
  </>;
}

function EvaluationDialog({ workspace, program, send, onClose }: { workspace: WorkspaceWithDocuments; program?: StaffGraduateProgramView; send: Send; onClose: () => void }) {
  const [f, setF] = useState<EvaluationForm>(() => emptyEvaluationForm(program ?? (workspace.programs.length === 1 ? workspace.programs[0] : undefined)));
  const set = <K extends keyof EvaluationForm>(k: K, v: EvaluationForm[K]) => setF((s) => ({ ...s, [k]: v }));
  return <FormDialog scope="evaluation" title="Record an international evaluation" description="An evaluation is evidence about how another country reads the award. It never changes ENEB or university rules, credits or graduation." submitLabel="Record evaluation" gate={evaluationFormGate(f)}
    onSubmit={() => send("POST", STAFF_GRADUATE_PATHS.recordEvaluation(workspace.studentId), buildEvaluationBody(f))} onClose={onClose}>
    <EvaluationFields f={f} set={set} setEval={(v) => setF((s) => setEvaluator(s, v))} programs={workspace.programs} documents={workspace.documents} />
  </FormDialog>;
}

function EvaluationUpdateDialog({ evaluation, send, onClose, documents }: { evaluation: EvaluationRow; send: Send; onClose: () => void; documents?: readonly DocumentOption[] }) {
  const verified = evaluation.verificationStatus === "verified";
  const [f, setF] = useState<EvaluationUpdateForm>(() => evaluationUpdateDefaults(evaluation));
  const set = <K extends keyof EvaluationUpdateForm>(k: K, v: EvaluationUpdateForm[K]) => setF((s) => ({ ...s, [k]: v }));
  const v = evaluationRow(evaluation);
  return <FormDialog scope="evaluation" title={`Update: ${v.evaluator} · ${evaluation.destinationCountry}`} description={verified ? "This evaluation is verified. Only its status and note can change." : "Update what the evaluator has returned. Nothing is verified until you verify it."} submitLabel="Save" gate={{ ok: true, reason: null }}
    onSubmit={() => send("PATCH", STAFF_GRADUATE_PATHS.updateEvaluation(evaluation.id), buildEvaluationUpdateBody(f, verified))} onClose={onClose}>
    <p className="rounded-md border border-student-line p-2 text-sm">{v.qualification}</p>
    <Field id="ev-status" label="Status"><Pick id="ev-status" value={f.status} onChange={(x) => set("status", x)} options={EVALUATION_OPTIONS.statuses} /></Field>
    {!verified ? <>
      <TextField id="ev-date" label="Date on the evaluation or tool result" type="date" value={f.reportDate} onChange={(x) => set("reportDate", x)} />
      <TextField id="ev-ref" label="Report reference" value={f.reportReference} onChange={(x) => set("reportReference", x)} />
      <DocumentField id="ev-docid" value={f.documentId} onChange={(x) => set("documentId", x)} documents={documents} />
      <Field id="ev-conclusion" label="Evaluator's conclusion"><Pick id="ev-conclusion" value={f.conclusion} onChange={(x) => set("conclusion", x)} options={EVALUATION_OPTIONS.conclusions} /></Field>
      <TextArea id="ev-conclusion-text" label="Evaluator's exact wording" rows={3} value={f.conclusionText} onChange={(x) => set("conclusionText", x)} />
    </> : null}
    <TextArea id="ev-note" label="Note" value={f.note} onChange={(x) => set("note", x)} />
  </FormDialog>;
}

function EvidenceRow({ id, label, value }: { id: string; label: string; value: string }) {
  const errors = useContext(FieldErrorsContext)[id];
  return <div className={`rounded-md border p-2 text-sm ${errors ? "border-student-attn bg-student-attn-soft" : "border-student-line"}`} data-testid="evidence-row" data-invalid={errors ? "true" : undefined}>
    <p className={EYEBROW}>{label}</p><p>{value}</p>
    {errors ? <p className="mt-1 text-xs font-medium text-student-attn" data-testid="field-error">{errors.join(" ")}</p> : null}
  </div>;
}

function EvaluationVerifyDialog({ evaluation, send, onClose, onEdit }: { evaluation: EvaluationRow; send: Send; onClose: () => void; onEdit: () => void }) {
  const [f, setF] = useState<EvaluationVerifyForm>(emptyEvaluationVerifyForm);
  const set = <K extends keyof EvaluationVerifyForm>(k: K, v: EvaluationVerifyForm[K]) => setF((s) => ({ ...s, [k]: v }));
  const v = evaluationRow(evaluation);
  return <FormDialog scope="evaluation" title={`Verify: ${v.evaluator} · ${evaluation.destinationCountry}`} description="Compare what is recorded with the evaluator's own report. Nothing is verified unless the server accepts the evidence." submitLabel={f.decision === "verified" ? "Verify" : "Save decision"} gate={evaluationVerifyGate(f)}
    onSubmit={() => send("POST", STAFF_GRADUATE_PATHS.verifyEvaluation(evaluation.id), buildEvaluationVerifyBody(f))} onClose={onClose}>
    <div className="space-y-2" data-testid="evidence-checklist">
      <EvidenceRow id="ev-status" label="Status" value={v.status} />
      <EvidenceRow id="ev-country" label="Destination country" value={v.country} />
      <EvidenceRow id="ev-date" label="Report date" value={v.reportDate ?? "Not recorded"} />
      <EvidenceRow id="ev-ref" label="Report reference" value={evaluation.reportReference ?? (evaluation.documentId ? "Attached report" : "Not recorded")} />
      <EvidenceRow id="ev-conclusion" label="Conclusion" value={v.conclusionLabel} />
      <EvidenceRow id="ev-conclusion-text" label="Evaluator's wording" value={v.conclusionText ?? "Not recorded"} />
      <Button type="button" variant="outline" size="sm" className={OUTLINE_ACTION} onClick={onEdit}>Fix these details…</Button>
    </div>
    <Field id="evv-decision" label="Decision"><Pick id="evv-decision" value={f.decision} onChange={(x) => set("decision", x as EvaluationVerifyForm["decision"])} options={labelled(["verified", "conflicting", "rejected"], EVALUATION_DECISION_LABEL)} /></Field>
    {f.decision === "conflicting" ? <TextArea id="ev-conflict" label="Conflicting evidence" value={f.conflictingEvidence} onChange={(x) => set("conflictingEvidence", x)} /> : null}
    <TextArea id="evv-note" label="Note (required)" value={f.note} onChange={(x) => set("note", x)} />
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
  const ws: WorkspaceWithDocuments = query.data;
  const docs = ws.documents;
  return <>
    <GraduateProgramReviewView workspace={ws} role={role} canEdit={canEdit} feedback={feedback} onDialog={(d) => { setFeedback(null); setDialog(d); }} />
    {dialog?.t === "enroll" ? <EnrollDialog workspace={ws} send={send} onClose={close} /> : null}
    {dialog?.t === "verify" ? <VerifyDialog record={dialog.record} role={role} send={send} onClose={close} documents={docs} /> : null}
    {dialog?.t === "track" ? <TrackDialog program={dialog.program} record={dialog.record} kind={dialog.kind} send={send} onClose={close} documents={docs} /> : null}
    {dialog?.t === "topic" ? <TopicDialog record={dialog.record} outcome={dialog.outcome} send={send} onClose={close} /> : null}
    {dialog?.t === "subject" ? <SubjectDialog program={dialog.program} send={send} onClose={close} /> : null}
    {dialog?.t === "result" ? <ResultDialog subject={dialog.subject} verify={dialog.verify} send={send} onClose={close} /> : null}
    {dialog?.t === "credit" ? <CreditDialog program={dialog.program} send={send} onClose={close} /> : null}
    {dialog?.t === "evaluation" ? <EvaluationDialog workspace={ws} program={dialog.program} send={send} onClose={close} /> : null}
    {dialog?.t === "evaluation-update" ? <EvaluationUpdateDialog evaluation={dialog.evaluation} send={send} onClose={close} documents={docs} /> : null}
    {dialog?.t === "evaluation-verify" ? <EvaluationVerifyDialog evaluation={dialog.evaluation} send={send} onClose={close} onEdit={() => setDialog({ t: "evaluation-update", evaluation: (dialog as { evaluation: EvaluationRow }).evaluation })} /> : null}
  </>;
}
