/** Graduation tab: eligibility with blockers, diploma conferral, delivery statuses, financial clearance, archived evidence. */
import { useState } from "react";
import { CheckCircle2, CircleAlert, Lock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HS_DELIVERY_STATUSES, HS_FINANCIAL_CLEARANCE, formatHalfUnits, type HsDeliveryStatus, type HsFinancialClearance } from "@shared/high-school-contract";
import { adminHighSchoolApi } from "@/lib/admin-high-school-api";
import {
  DELIVERY_LABEL, FINANCIAL_LABEL, actorLabel, deliveryOptions, financialGate, conferDiplomaBody, confirmEligibilityBody, deliveryBody, evidenceGate, financialClearanceBody, formatDate, graduationGates, noteGate, remainingHalfUnits, type EvidenceDoc,
} from "@/lib/admin-high-school-logic";
import { ActionMessage, EvidenceSelect, FIELD_CLASS, Field, GatedButton, Notice, Pill, SectionHeading, type SectionProps } from "./shared";
import { useStaffAction } from "./use-staff-action";

const STATUS_LABEL = { in_progress: "In progress", eligibility_confirmed: "Eligibility confirmed", diploma_conferred: "Diploma conferred" } as const;
const docName = (docs: readonly EvidenceDoc[], id: string | null) => (id ? docs.find((d) => d.id === id)?.file_name ?? "Verified document" : "Not archived");

function useGraduationAction(studentId: string, eid: string, message: string) {
  return useStaffAction(studentId, (b: unknown) => adminHighSchoolApi.graduation(studentId, eid, b), message);
}

function DeliveryRow({ idp, label, current, docId, docs, studentId, eid, action }: { idp: string; label: string; current: HsDeliveryStatus; docId: string | null; docs: readonly EvidenceDoc[]; studentId: string; eid: string; action: "set_transcript_status" | "set_diploma_delivery" }) {
  const [value, setValue] = useState<HsDeliveryStatus>(current);
  const a = useGraduationAction(studentId, eid, `${label} status saved.`);
  return (
    <div className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-end gap-3">
        <Field id={`${idp}-status`} label={`${label} status`} className="min-w-[12rem] flex-1">
          <select id={`${idp}-status`} className={FIELD_CLASS} value={value} onChange={(e) => setValue(e.target.value as HsDeliveryStatus)}>
            {HS_DELIVERY_STATUSES.filter((s) => deliveryOptions(current).includes(s)).map((s) => <option key={s} value={s}>{DELIVERY_LABEL[s]}</option>)}
          </select>
        </Field>
        <GatedButton id={`${idp}-save`} variant="outline" size="sm" pending={a.pending} gate={value === current ? { enabled: false, reason: "Unchanged." } : { enabled: true, reason: null }} onClick={() => a.run(deliveryBody(action, value))}>Save</GatedButton>
      </div>
      <p className="text-xs text-muted-foreground">Archived evidence: <span className="font-medium text-foreground">{docName(docs, docId)}</span></p>
      <ActionMessage message={a.message} />
    </div>
  );
}

/** A finished step: one summary row (what, when, who, evidence) instead of a form that can no longer be used. */
function DoneRow({ testId, title, when, who, evidence }: { testId: string; title: string; when: string | null; who: string | null; evidence: string }) {
  return (
    <div data-testid={testId} className="flex items-start gap-3 rounded-lg border border-green-700/30 bg-green-600/5 px-4 py-3 text-sm">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-800 dark:text-green-300" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">{title}{when ? ` on ${formatDate(when)}` : ""}{who ? ` by ${who}` : ""}</p>
        <p className="break-words text-muted-foreground">Evidence: {evidence}</p>
      </div>
    </div>
  );
}

export function GraduationSection({ state, studentId, isAdmin, docs }: SectionProps) {
  const cur = state.current;
  const eid = cur?.enrollment.id ?? "";
  const [eligEvidence, setEligEvidence] = useState("");
  const [eligNote, setEligNote] = useState("");
  const [conferDate, setConferDate] = useState("");
  const [diplomaDoc, setDiplomaDoc] = useState("");
  const [transcriptDoc, setTranscriptDoc] = useState("");
  const [finValue, setFinValue] = useState<HsFinancialClearance>(state.current?.graduation.financialClearance ?? "unknown");
  const [finNote, setFinNote] = useState("");
  const confirmA = useGraduationAction(studentId, eid, "Graduation eligibility confirmed.");
  const conferA = useGraduationAction(studentId, eid, "Diploma conferred and evidence archived.");
  const finA = useGraduationAction(studentId, eid, "Financial clearance saved.");
  if (!cur) return <section aria-labelledby="hs-grad-h"><SectionHeading id="hs-grad-h" title="Graduation" /><Notice>Create the high school program first.</Notice></section>;
  const g = cur.graduation;
  const actor = (types: RegExp) => actorLabel(state.events.find((e) => types.test(e.type))?.actorId);
  const gates = graduationGates(state, isAdmin);
  const credits = cur.credits;
  const confirmGate = !gates.confirm.enabled ? gates.confirm : evidenceGate(eligEvidence, docs, "eligibility");
  const conferGate = !gates.confer.enabled ? gates.confer : !conferDate ? { enabled: false, reason: "Enter the date the school conferred the diploma." } : !evidenceGate(diplomaDoc, docs, "diploma").enabled ? { enabled: false, reason: "Select the verified diploma document." } : evidenceGate(transcriptDoc, docs, "transcript").enabled ? { enabled: true, reason: null } : { enabled: false, reason: "Select the verified transcript document." };
  return (
    <section aria-labelledby="hs-grad-h" className="space-y-5">
      <SectionHeading id="hs-grad-h" title="Graduation">
        The awarding school confirms eligibility and issues the diploma. Here staff record that decision with the school's documents; nothing is conferred by the portal on its own.
      </SectionHeading>

      <Card data-testid="graduation-status">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div><CardTitle className="text-base">Eligibility</CardTitle><CardDescription>{formatHalfUnits(credits.earnedHalfUnits)} of {formatHalfUnits(credits.requiredHalfUnits)} credits officially earned ({formatHalfUnits(remainingHalfUnits(credits.requiredHalfUnits, credits.earnedHalfUnits))} remaining) · core {formatHalfUnits(credits.core.earnedHalfUnits)}/{formatHalfUnits(credits.core.requiredHalfUnits)} · electives {formatHalfUnits(credits.elective.earnedHalfUnits)}/{formatHalfUnits(credits.elective.requiredHalfUnits)}</CardDescription></div>
          <Pill tone={g.status === "diploma_conferred" ? "good" : g.status === "eligibility_confirmed" ? "official" : "warn"}>{STATUS_LABEL[g.status]}</Pill>
        </CardHeader>
        <CardContent className="space-y-3">
          {g.blockers.length > 0 ? (
            <div data-testid="graduation-blockers">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium"><CircleAlert className="h-4 w-4" aria-hidden="true" />{g.blockers.length} {g.blockers.length === 1 ? "blocker" : "blockers"} before eligibility can be confirmed</p>
              <ul className="ml-6 list-disc space-y-1 text-sm">{g.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          ) : g.status === "in_progress" ? <p className="flex items-center gap-2 text-sm font-medium" data-testid="graduation-blockers"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />No blockers. Eligibility can be confirmed.</p> : null}
        </CardContent>
      </Card>

      <ol className="space-y-4" aria-label="Graduation steps">
        <li>
          {g.status !== "in_progress" ? (
            <DoneRow testId="confirm-eligibility" title="Eligibility confirmed" when={g.eligibilityConfirmedAt} who={actor(/eligib/i)} evidence={docName(docs, g.eligibilityEvidenceDocumentId)} />
          ) : (
            <Card data-testid="confirm-eligibility">
              <CardHeader><CardTitle className="text-base">Step 1 · Confirm graduation eligibility</CardTitle><CardDescription>Record the school's official completion review. Requires every credit and result to be official. Administrator only.</CardDescription></CardHeader>
              <CardContent className="grid gap-4">
                <EvidenceSelect id="ge-evidence" label="School's eligibility confirmation (verified document)" value={eligEvidence} onChange={setEligEvidence} docs={docs} purpose="eligibility" />
                <Field id="ge-note" label="Note (optional)"><Input id="ge-note" value={eligNote} onChange={(e) => setEligNote(e.target.value)} /></Field>
                <ActionMessage message={confirmA.message} />
                <GatedButton id="ge-save" gate={confirmGate} pending={confirmA.pending} onClick={() => confirmA.run(confirmEligibilityBody(eligEvidence, eligNote))}>Confirm eligibility</GatedButton>
              </CardContent>
            </Card>
          )}
        </li>
        <li>
          {g.status === "diploma_conferred" ? (
            <DoneRow testId="confer-diploma" title="Diploma conferred" when={g.diploma.conferredOn} who={actor(/confer|diploma/i)} evidence={`${docName(docs, g.diploma.documentId)} (diploma), ${docName(docs, g.transcript.documentId)} (transcript)`} />
          ) : g.status === "in_progress" ? (
            <div data-testid="confer-diploma" className="flex items-start gap-2 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><div><p className="font-medium text-foreground">Step 2 · Confer diploma</p><p>{gates.confer.reason}</p></div></div>
          ) : (
            <Card data-testid="confer-diploma">
              <CardHeader><CardTitle className="text-base">Step 2 · Confer diploma</CardTitle><CardDescription>Administrator only. Archives the diploma and the transcript by linking verified Documents.</CardDescription></CardHeader>
              <CardContent className="grid gap-4">
                <Field id="gc-date" label="Diploma conferred on"><Input id="gc-date" type="date" value={conferDate} onChange={(e) => setConferDate(e.target.value)} /></Field>
                <EvidenceSelect id="gc-diploma" label="Diploma (verified document)" value={diplomaDoc} onChange={setDiplomaDoc} docs={docs} purpose="diploma" />
                <EvidenceSelect id="gc-transcript" label="Official transcript (verified document)" value={transcriptDoc} onChange={setTranscriptDoc} docs={docs} purpose="transcript" />
                <ActionMessage message={conferA.message} />
                <GatedButton id="gc-save" gate={conferGate} pending={conferA.pending} onClick={() => conferA.run(conferDiplomaBody(conferDate, diplomaDoc, transcriptDoc))}>Confer diploma</GatedButton>
              </CardContent>
            </Card>
          )}
        </li>
      </ol>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card data-testid="delivery-status">
          <CardHeader><CardTitle className="text-base">Transcript and diploma delivery</CardTitle><CardDescription>Where each document is in the school's process.</CardDescription></CardHeader>
          <CardContent className="divide-y">
            <DeliveryRow idp="dl-transcript" label="Transcript" current={g.transcript.status} docId={g.transcript.documentId} docs={docs} studentId={studentId} eid={eid} action="set_transcript_status" />
            <DeliveryRow idp="dl-diploma" label="Diploma" current={g.diploma.status} docId={g.diploma.documentId} docs={docs} studentId={studentId} eid={eid} action="set_diploma_delivery" />
          </CardContent>
        </Card>

        <Card data-testid="financial-clearance">
          <CardHeader>
            <CardTitle className="text-base">Financial clearance</CardTitle>
            <CardDescription>Current: <span className="font-medium text-foreground">{g.financialClearance === null ? "Not available" : FINANCIAL_LABEL[g.financialClearance]}</span>. Set only from authorized billing data; the student sees a neutral status.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field id="fc-value" label="Clearance">
              <select id="fc-value" className={FIELD_CLASS} value={finValue} onChange={(e) => setFinValue(e.target.value as HsFinancialClearance)}>
                {HS_FINANCIAL_CLEARANCE.map((v) => <option key={v} value={v}>{FINANCIAL_LABEL[v]}</option>)}
              </select>
            </Field>
            <Field id="fc-note" label="Note (required)"><Input id="fc-note" value={finNote} onChange={(e) => setFinNote(e.target.value)} placeholder="Basis for this status" /></Field>
            <ActionMessage message={finA.message} />
            <GatedButton id="fc-save" variant="outline" gate={financialGate(state, finValue, finNote)} pending={finA.pending} onClick={() => finA.run(financialClearanceBody(finValue, finNote), () => setFinNote(""))}>Save clearance</GatedButton>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
