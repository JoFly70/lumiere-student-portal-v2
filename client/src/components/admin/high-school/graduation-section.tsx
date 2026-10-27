/** Graduation tab: eligibility with blockers, diploma conferral, delivery statuses, financial clearance, archived evidence. */
import { useState } from "react";
import { CheckCircle2, CircleAlert, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { HS_DELIVERY_STATUSES, HS_FINANCIAL_CLEARANCE, formatHalfUnits, type HsDeliveryStatus, type HsFinancialClearance } from "@shared/high-school-contract";
import { adminHighSchoolApi } from "@/lib/admin-high-school-api";
import {
  CLOSED_RECORD_TEXT, DELIVERY_LABEL, FINANCIAL_LABEL, actorLabel, deliveryLocked, deliveryOptions, isClosedEnrollment, financialGate, conferDiplomaBody, confirmEligibilityBody, deliveryBody, evidenceGate, financialClearanceBody, formatDate, graduationGates, remainingHalfUnits, type EvidenceDoc,
} from "@/lib/admin-high-school-logic";
import { ActionMessage, EvidenceSelect, FIELD_CLASS, Field, FormPanel, GatedButton, Notice, RecordButton, SectionCard, SectionHeading, useOpenForm, type OpenForm, type SectionProps } from "./shared";
import { useStaffAction } from "./use-staff-action";

const docName = (docs: readonly EvidenceDoc[], id: string | null) => (id ? docs.find((d) => d.id === id)?.file_name ?? "Verified document" : "Not archived yet");

function useGraduationAction(studentId: string, eid: string, message: string) {
  return useStaffAction(studentId, (b: unknown) => adminHighSchoolApi.graduation(studentId, eid, b), message);
}

function DeliveryRow({ idp, label, current, docId, docs, studentId, eid, action, form, lockedReason }: { idp: string; label: string; current: HsDeliveryStatus; docId: string | null; docs: readonly EvidenceDoc[]; studentId: string; eid: string; action: "set_transcript_status" | "set_diploma_delivery"; form: OpenForm; lockedReason: string | null }) {
  const [value, setValue] = useState<HsDeliveryStatus>(current);
  const a = useGraduationAction(studentId, eid, `${label} status saved.`);
  const options = HS_DELIVERY_STATUSES.filter((s) => deliveryOptions(current, !!docId).includes(s));
  const canChange = !lockedReason && options.length > 1;
  return (
    <div className="space-y-3 py-4 first:pt-0 last:pb-0" data-testid={`${idp}-row`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-sm font-medium">{DELIVERY_LABEL[current]}</p>
        </div>
        {canChange ? <RecordButton form={form} id={idp} variant="outline" size="sm">Update status</RecordButton> : null}
      </div>
      <p className="text-xs text-muted-foreground">Archived evidence: <span className="font-medium text-foreground">{docName(docs, docId)}</span>{!docId && !lockedReason ? ". Issued and delivered can be recorded once the diploma is conferred with the school's documents." : ""}</p>
      {lockedReason ? <p className="text-xs text-muted-foreground" data-testid="closed-record">{lockedReason}</p> : null}
      {canChange ? (
        <FormPanel form={form} id={idp} className="flex flex-wrap items-end gap-3">
          <Field id={`${idp}-status`} label={`${label} status`} className="min-w-[12rem] flex-1">
            <select id={`${idp}-status`} className={FIELD_CLASS} value={value} onChange={(e) => setValue(e.target.value as HsDeliveryStatus)}>
              {options.map((s) => <option key={s} value={s}>{DELIVERY_LABEL[s]}</option>)}
            </select>
          </Field>
          <GatedButton id={`${idp}-save`} size="sm" pending={a.pending} gate={value === current ? { enabled: false, reason: "Unchanged." } : { enabled: true, reason: null }} onClick={() => a.run(deliveryBody(action, value), () => form.close())}>Save</GatedButton>
        </FormPanel>
      ) : null}
      <ActionMessage message={a.message} />
    </div>
  );
}

/** A finished step: ONE status line (what, when, who, evidence). No chip repeats it. */
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

export function GraduationSection({ state, studentId, isAdmin, docs, initialOpenForm }: SectionProps) {
  const cur = state.current;
  const eid = cur?.enrollment.id ?? "";
  const form = useOpenForm(initialOpenForm ?? null);
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
  const closed = isClosedEnrollment(cur.enrollment.status);
  const deliveryClosed = deliveryLocked(cur.enrollment.status) ? `${CLOSED_RECORD_TEXT} Delivery can no longer change.` : null;
  const finGate = financialGate(state, finValue, finNote);
  const confirmGate = !gates.confirm.enabled ? gates.confirm : evidenceGate(eligEvidence, docs, "eligibility");
  const conferGate = !gates.confer.enabled ? gates.confer : !conferDate ? { enabled: false, reason: "Enter the date the school conferred the diploma." } : !evidenceGate(diplomaDoc, docs, "diploma").enabled ? { enabled: false, reason: "Select the verified diploma document." } : evidenceGate(transcriptDoc, docs, "transcript").enabled ? { enabled: true, reason: null } : { enabled: false, reason: "Select the verified transcript document." };
  return (
    <section aria-labelledby="hs-grad-h" className="space-y-5">
      <SectionHeading id="hs-grad-h" title="Graduation">
        The awarding school confirms eligibility and issues the diploma. Here staff record that decision with the school's documents; nothing is conferred by the portal on its own.
      </SectionHeading>

      <SectionCard testId="graduation-status" title="Eligibility"
        description={<><span className="tabular-nums">{formatHalfUnits(credits.earnedHalfUnits)} of {formatHalfUnits(credits.requiredHalfUnits)}</span> credits officially earned (<span className="tabular-nums">{formatHalfUnits(remainingHalfUnits(credits.requiredHalfUnits, credits.earnedHalfUnits))}</span> remaining) · core <span className="tabular-nums">{formatHalfUnits(credits.core.earnedHalfUnits)}/{formatHalfUnits(credits.core.requiredHalfUnits)}</span> · electives <span className="tabular-nums">{formatHalfUnits(credits.elective.earnedHalfUnits)}/{formatHalfUnits(credits.elective.requiredHalfUnits)}</span></>}>
        {g.status === "in_progress" && !closed ? (
          g.blockers.length > 0 ? (
            <div data-testid="graduation-blockers">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium"><CircleAlert className="h-4 w-4" aria-hidden="true" />{g.blockers.length} {g.blockers.length === 1 ? "blocker" : "blockers"} before eligibility can be confirmed</p>
              <ul className="ml-6 list-disc space-y-1 text-sm">{g.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          ) : <p className="flex items-center gap-2 text-sm font-medium" data-testid="graduation-blockers"><CheckCircle2 className="h-4 w-4 text-green-800 dark:text-green-300" aria-hidden="true" />Ready to confirm. No credit blockers.</p>
        ) : closed && g.status !== "diploma_conferred" ? <p className="text-sm text-muted-foreground" data-testid="closed-record">{CLOSED_RECORD_TEXT} Graduation can no longer be recorded for this enrollment.</p>
        : <p className="text-sm text-muted-foreground">All credit requirements were met when eligibility was confirmed.</p>}
      </SectionCard>

      <ol className="space-y-4" aria-label="Graduation steps">
        <li>
          {g.status !== "in_progress" ? (
            <DoneRow testId="confirm-eligibility" title="Step 1 · Eligibility confirmed" when={g.eligibilityConfirmedAt} who={actor(/eligib/i)} evidence={docName(docs, g.eligibilityEvidenceDocumentId)} />
          ) : (
            <SectionCard testId="confirm-eligibility" title="Step 1 · Confirm graduation eligibility"
              description="Record the school's official completion review. Requires every credit area to be met with official credit, and the school's verified confirmation document. Administrator only."
              action={gates.confirm.enabled ? <RecordButton form={form} id="eligibility">Confirm eligibility</RecordButton> : <GatedButton id="ge-save" gate={gates.confirm}>Confirm eligibility</GatedButton>}>
              {gates.confirm.enabled ? (
                <FormPanel form={form} id="eligibility" className="grid gap-4">
                  <EvidenceSelect id="ge-evidence" label="School's eligibility confirmation (verified document)" value={eligEvidence} onChange={setEligEvidence} docs={docs} purpose="eligibility" />
                  <Field id="ge-note" label="Note (optional)"><Input id="ge-note" value={eligNote} onChange={(e) => setEligNote(e.target.value)} /></Field>
                  <ActionMessage message={confirmA.message} />
                  <GatedButton id="ge-save" gate={confirmGate} pending={confirmA.pending} onClick={() => confirmA.run(confirmEligibilityBody(eligEvidence, eligNote), () => form.close())}>Confirm eligibility</GatedButton>
                </FormPanel>
              ) : null}
            </SectionCard>
          )}
        </li>
        <li>
          {g.status === "diploma_conferred" ? (
            <DoneRow testId="confer-diploma" title="Step 2 · Diploma conferred" when={g.diploma.conferredOn} who={actor(/confer|diploma/i)} evidence={`${docName(docs, g.diploma.documentId)} (diploma), ${docName(docs, g.transcript.documentId)} (transcript)`} />
          ) : g.status === "in_progress" ? (
            <div data-testid="confer-diploma" className="flex items-start gap-3 rounded-lg border bg-muted px-4 py-3 text-sm"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><div><p className="font-medium text-foreground">Step 2 · Confer diploma</p><p className="text-foreground/80">{gates.confer.reason}</p></div></div>
          ) : (
            <SectionCard testId="confer-diploma" title="Step 2 · Confer diploma" description="Administrator only. Archives the diploma and the transcript by linking verified Documents."
              action={gates.confer.enabled ? <RecordButton form={form} id="confer">Confer diploma</RecordButton> : <GatedButton id="gc-save" gate={gates.confer}>Confer diploma</GatedButton>}>
              {gates.confer.enabled ? (
                <FormPanel form={form} id="confer" className="grid gap-4">
                  <Field id="gc-date" label="Diploma conferred on"><Input id="gc-date" type="date" value={conferDate} onChange={(e) => setConferDate(e.target.value)} /></Field>
                  <EvidenceSelect id="gc-diploma" label="Diploma (verified document)" value={diplomaDoc} onChange={setDiplomaDoc} docs={docs} purpose="diploma" />
                  <EvidenceSelect id="gc-transcript" label="Official transcript (verified document)" value={transcriptDoc} onChange={setTranscriptDoc} docs={docs} purpose="transcript" />
                  <ActionMessage message={conferA.message} />
                  <GatedButton id="gc-save" gate={conferGate} pending={conferA.pending} onClick={() => conferA.run(conferDiplomaBody(conferDate, diplomaDoc, transcriptDoc), () => form.close())}>Confer diploma</GatedButton>
                </FormPanel>
              ) : null}
            </SectionCard>
          )}
        </li>
      </ol>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <SectionCard testId="delivery-status" title="Transcript and diploma delivery" description="Where each document is in the school's process. Statuses only move forward.">
          <div className="divide-y">
            <DeliveryRow idp="dl-transcript" label="Transcript" current={g.transcript.status} docId={g.transcript.documentId} docs={docs} studentId={studentId} eid={eid} action="set_transcript_status" form={form} lockedReason={deliveryClosed} />
            <DeliveryRow idp="dl-diploma" label="Diploma" current={g.diploma.status} docId={g.diploma.documentId} docs={docs} studentId={studentId} eid={eid} action="set_diploma_delivery" form={form} lockedReason={deliveryClosed} />
          </div>
        </SectionCard>

        <SectionCard testId="financial-clearance" title="Financial clearance"
          description={<>Current: <span className="font-medium text-foreground">{g.financialClearance === null ? "Not available" : FINANCIAL_LABEL[g.financialClearance]}</span>. Set only from authorized billing data; the student sees a neutral status.</>}
          action={closed ? null : <RecordButton form={form} id="financial" variant="outline">Update clearance</RecordButton>}>
          {closed ? <p className="text-sm text-muted-foreground" data-testid="closed-record">{CLOSED_RECORD_TEXT} Financial clearance is locked{g.status === "diploma_conferred" ? " once the diploma is conferred" : ""}.</p> : (
            <FormPanel form={form} id="financial" className="grid gap-4">
              <Field id="fc-value" label="Clearance">
                <select id="fc-value" className={FIELD_CLASS} value={finValue} onChange={(e) => setFinValue(e.target.value as HsFinancialClearance)}>
                  {HS_FINANCIAL_CLEARANCE.map((v) => <option key={v} value={v}>{FINANCIAL_LABEL[v]}</option>)}
                </select>
              </Field>
              <Field id="fc-note" label="Note (required)"><Input id="fc-note" value={finNote} onChange={(e) => setFinNote(e.target.value)} placeholder="Basis for this status" /></Field>
              <ActionMessage message={finA.message} />
              <GatedButton id="fc-save" gate={finGate} pending={finA.pending} onClick={() => finA.run(financialClearanceBody(finValue, finNote), () => { setFinNote(""); form.close(); })}>Save clearance</GatedButton>
            </FormPanel>
          )}
        </SectionCard>
      </div>
    </section>
  );
}
