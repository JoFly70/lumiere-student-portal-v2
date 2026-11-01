/** Graduation tab: eligibility with blockers, diploma conferral, delivery statuses, financial clearance, archived evidence. */
import { useState } from "react";
import { CheckCircle2, CircleAlert, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { HS_DELIVERY_STATUSES, HS_FINANCIAL_CLEARANCE, formatHalfUnits, type HsDeliveryStatus, type HsFinancialClearance } from "@shared/high-school-contract";
import { adminHighSchoolApi } from "@/lib/admin-high-school-api";
import {
  CLOSED_RECORD_TEXT, DELIVERY_LABEL, FINANCIAL_LABEL, actorLabel, deliveryLocked, deliveryOptions, isClosedEnrollment, financialGate, conferDiplomaBody, confirmEligibilityBody, deliveryBody, evidenceGate, financialClearanceBody, graduationGates, remainingHalfUnits, type EvidenceDoc,
} from "@/lib/admin-high-school-logic";
import { ActionMessage, EvidenceSelect, FIELD_CLASS, Field, FormPanel, GatedButton, Notice, RecordButton, SectionCard, SectionHeading, useOpenForm, type OpenForm, type SectionProps } from "./shared";
import { useStaffAction } from "./use-staff-action";
import { useHs } from "./hs-i18n";

const docName = (docs: readonly EvidenceDoc[], id: string | null, fallback = "Verified document", none = "Not archived yet") => (id ? docs.find((d) => d.id === id)?.file_name ?? fallback : none);

function useGraduationAction(studentId: string, eid: string, message: string) {
  return useStaffAction(studentId, (b: unknown) => adminHighSchoolApi.graduation(studentId, eid, b), message);
}

function DeliveryRow({ idp, label, current, docId, docs, studentId, eid, action, form, lockedReason }: { idp: string; label: string; current: HsDeliveryStatus; docId: string | null; docs: readonly EvidenceDoc[]; studentId: string; eid: string; action: "set_transcript_status" | "set_diploma_delivery"; form: OpenForm; lockedReason: string | null }) {
  const { t, x } = useHs();
  const [value, setValue] = useState<HsDeliveryStatus>(current);
  const a = useGraduationAction(studentId, eid, t("s32dir.hs.gr.statusSaved", { label }));
  const docLabel = docName(docs, docId, x("Verified document"), x("Not archived yet"));
  const options = HS_DELIVERY_STATUSES.filter((s) => deliveryOptions(current, !!docId).includes(s));
  const canChange = !lockedReason && options.length > 1;
  return (
    <div className="space-y-3 py-4 first:pt-0 last:pb-0" data-testid={`${idp}-row`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-sm font-medium">{x(DELIVERY_LABEL[current])}</p>
        </div>
        {canChange ? <RecordButton form={form} id={idp} variant="outline" size="sm">{t("s32dir.hs.gr.updateStatus")}</RecordButton> : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("s32dir.hs.gr.archived")}<span className="font-medium text-foreground">{docLabel}</span>{!docId && !lockedReason ? t("s32dir.hs.gr.archivedHint") : ""}</p>
      {lockedReason ? <p className="text-xs text-muted-foreground" data-testid="closed-record">{lockedReason}</p> : null}
      {canChange ? (
        <FormPanel form={form} id={idp} className="flex flex-wrap items-end gap-3">
          <Field id={`${idp}-status`} label={t("s32dir.hs.gr.statusOf", { label })} className="min-w-[12rem] flex-1">
            <select id={`${idp}-status`} className={FIELD_CLASS} value={value} onChange={(e) => setValue(e.target.value as HsDeliveryStatus)}>
              {options.map((s) => <option key={s} value={s}>{x(DELIVERY_LABEL[s])}</option>)}
            </select>
          </Field>
          <GatedButton id={`${idp}-save`} size="sm" pending={a.pending} gate={value === current ? { enabled: false, reason: x("Unchanged.") } : { enabled: true, reason: null }} onClick={() => a.run(deliveryBody(action, value), () => form.close())}>{t("s32dir.hs.gr.save")}</GatedButton>
        </FormPanel>
      ) : null}
      <ActionMessage message={a.message} />
    </div>
  );
}

/** A finished step: ONE status line (what, when, who, evidence). No chip repeats it. */
function DoneRow({ testId, title, when, who, evidence }: { testId: string; title: string; when: string | null; who: string | null; evidence: string }) {
  const { t, date } = useHs();
  return (
    <div data-testid={testId} className="flex items-start gap-3 rounded-lg border border-st-applied/30 bg-st-applied/5 px-4 py-3 text-sm">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-st-applied" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">{title}{when ? t("s32dir.hs.gr.on", { date: date(when) }) : ""}{who ? t("s32dir.hs.gr.by", { who }) : ""}</p>
        <p className="break-words text-muted-foreground">{t("s32dir.hs.gr.evidence", { e: evidence })}</p>
      </div>
    </div>
  );
}

export function GraduationSection({ state, studentId, isAdmin, docs, initialOpenForm }: SectionProps) {
  const { t, x, fc } = useHs();
  const doc = (id: string | null) => docName(docs, id, x("Verified document"), x("Not archived yet"));
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
  const confirmA = useGraduationAction(studentId, eid, t("s32dir.hs.gr.eligSaved"));
  const conferA = useGraduationAction(studentId, eid, t("s32dir.hs.gr.conferSaved"));
  const finA = useGraduationAction(studentId, eid, t("s32dir.hs.gr.finSaved"));
  if (!cur) return <section aria-labelledby="hs-grad-h"><SectionHeading id="hs-grad-h" title={t("s32dir.hs.tab.graduation")} /><Notice>{t("s32dir.hs.createFirst")}</Notice></section>;
  const g = cur.graduation;
  const actor = (types: RegExp) => x(actorLabel(state.events.find((e) => types.test(e.type))?.actorId));
  const gates = graduationGates(state, isAdmin);
  const credits = cur.credits;
  const closed = isClosedEnrollment(cur.enrollment.status);
  const deliveryClosed = deliveryLocked(cur.enrollment.status) ? `${x(CLOSED_RECORD_TEXT)} ${t("s32dir.hs.gr.deliveryClosed")}` : null;
  const finGate = financialGate(state, finValue, finNote);
  const confirmGate = !gates.confirm.enabled ? gates.confirm : evidenceGate(eligEvidence, docs, "eligibility");
  const conferGate = !gates.confer.enabled ? gates.confer : !conferDate ? { enabled: false, reason: "Enter the date the school conferred the diploma." } : !evidenceGate(diplomaDoc, docs, "diploma").enabled ? { enabled: false, reason: "Select the verified diploma document." } : evidenceGate(transcriptDoc, docs, "transcript").enabled ? { enabled: true, reason: null } : { enabled: false, reason: "Select the verified transcript document." };
  return (
    <section aria-labelledby="hs-grad-h" className="space-y-5">
      <SectionHeading id="hs-grad-h" title={t("s32dir.hs.tab.graduation")}>
        {t("s32dir.hs.gr.desc")}
      </SectionHeading>

      <SectionCard testId="graduation-status" title={t("s32dir.hs.gr.el.title")}
        description={<><span className="tabular-nums">{t("s32dir.hs.pe.ofN", { a: fc(credits.earnedHalfUnits), b: fc(credits.requiredHalfUnits) })}</span>{t("s32dir.hs.gr.el.a")}<span className="tabular-nums">{fc(remainingHalfUnits(credits.requiredHalfUnits, credits.earnedHalfUnits))}</span>{t("s32dir.hs.gr.el.b")}<span className="tabular-nums">{fc(credits.core.earnedHalfUnits)}/{fc(credits.core.requiredHalfUnits)}</span>{t("s32dir.hs.gr.el.c")}<span className="tabular-nums">{fc(credits.elective.earnedHalfUnits)}/{fc(credits.elective.requiredHalfUnits)}</span></>}>
        {g.status === "in_progress" && !closed ? (
          g.blockers.length > 0 ? (
            <div data-testid="graduation-blockers">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium"><CircleAlert className="h-4 w-4" aria-hidden="true" />{t(g.blockers.length === 1 ? "s32dir.hs.gr.blockers.one" : "s32dir.hs.gr.blockers.other", { n: g.blockers.length })}</p>
              <ul className="ml-6 list-disc space-y-1 text-sm">{g.blockers.map((b) => <li key={b}>{x(b)}</li>)}</ul>
            </div>
          ) : <p className="flex items-center gap-2 text-sm font-medium" data-testid="graduation-blockers"><CheckCircle2 className="h-4 w-4 text-st-applied" aria-hidden="true" />{t("s32dir.hs.gr.ready")}</p>
        ) : closed && g.status !== "diploma_conferred" ? <p className="text-sm text-muted-foreground" data-testid="closed-record">{x(CLOSED_RECORD_TEXT)} {t("s32dir.hs.gr.closedGrad")}</p>
        : <p className="text-sm text-muted-foreground">{t("s32dir.hs.gr.allMet")}</p>}
      </SectionCard>

      <ol className="space-y-4" aria-label={t("s32dir.hs.gr.stepsAria")}>
        <li>
          {g.status !== "in_progress" ? (
            <DoneRow testId="confirm-eligibility" title={t("s32dir.hs.gr.step1.done")} when={g.eligibilityConfirmedAt} who={actor(/eligib/i)} evidence={doc(g.eligibilityEvidenceDocumentId)} />
          ) : (
            <SectionCard testId="confirm-eligibility" title={t("s32dir.hs.gr.step1.title")}
              description={t("s32dir.hs.gr.step1.desc")}
              action={gates.confirm.enabled ? <RecordButton form={form} id="eligibility">{t("s32dir.hs.gr.confirm")}</RecordButton> : <GatedButton id="ge-save" gate={gates.confirm}>{t("s32dir.hs.gr.confirm")}</GatedButton>}>
              {gates.confirm.enabled ? (
                <FormPanel form={form} id="eligibility" className="grid gap-4">
                  <EvidenceSelect id="ge-evidence" label={t("s32dir.hs.gr.eligDoc")} value={eligEvidence} onChange={setEligEvidence} docs={docs} purpose="eligibility" />
                  <Field id="ge-note" label={t("s32dir.hs.note.opt")}><Input id="ge-note" value={eligNote} onChange={(e) => setEligNote(e.target.value)} /></Field>
                  <ActionMessage message={confirmA.message} />
                  <GatedButton id="ge-save" gate={confirmGate} pending={confirmA.pending} onClick={() => confirmA.run(confirmEligibilityBody(eligEvidence, eligNote), () => form.close())}>{t("s32dir.hs.gr.confirm")}</GatedButton>
                </FormPanel>
              ) : null}
            </SectionCard>
          )}
        </li>
        <li>
          {g.status === "diploma_conferred" ? (
            <DoneRow testId="confer-diploma" title={t("s32dir.hs.gr.step2.done")} when={g.diploma.conferredOn} who={actor(/confer|diploma/i)} evidence={t("s32dir.hs.gr.evidenceBoth", { a: doc(g.diploma.documentId), b: doc(g.transcript.documentId) })} />
          ) : g.status === "in_progress" ? (
            <div data-testid="confer-diploma" className="flex items-start gap-3 rounded-lg border bg-muted px-4 py-3 text-sm"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><div><p className="font-medium text-foreground">{t("s32dir.hs.gr.step2.title")}</p><p className="text-foreground/80">{x(gates.confer.reason)}</p></div></div>
          ) : (
            <SectionCard testId="confer-diploma" title={t("s32dir.hs.gr.step2.title")} description={t("s32dir.hs.gr.step2.desc")}
              action={gates.confer.enabled ? <RecordButton form={form} id="confer">{t("s32dir.hs.gr.confer")}</RecordButton> : <GatedButton id="gc-save" gate={gates.confer}>{t("s32dir.hs.gr.confer")}</GatedButton>}>
              {gates.confer.enabled ? (
                <FormPanel form={form} id="confer" className="grid gap-4">
                  <Field id="gc-date" label={t("s32dir.hs.p.hg.conferred")}><Input id="gc-date" type="date" value={conferDate} onChange={(e) => setConferDate(e.target.value)} /></Field>
                  <EvidenceSelect id="gc-diploma" label={t("s32dir.hs.docDiploma")} value={diplomaDoc} onChange={setDiplomaDoc} docs={docs} purpose="diploma" />
                  <EvidenceSelect id="gc-transcript" label={t("s32dir.hs.gr.officialTranscript")} value={transcriptDoc} onChange={setTranscriptDoc} docs={docs} purpose="transcript" />
                  <ActionMessage message={conferA.message} />
                  <GatedButton id="gc-save" gate={conferGate} pending={conferA.pending} onClick={() => conferA.run(conferDiplomaBody(conferDate, diplomaDoc, transcriptDoc), () => form.close())}>{t("s32dir.hs.gr.confer")}</GatedButton>
                </FormPanel>
              ) : null}
            </SectionCard>
          )}
        </li>
      </ol>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <SectionCard testId="delivery-status" title={t("s32dir.hs.gr.delivery.title")} description={t("s32dir.hs.gr.delivery.desc")}>
          <div className="divide-y">
            <DeliveryRow idp="dl-transcript" label={t("s32dir.hs.gr.transcript")} current={g.transcript.status} docId={g.transcript.documentId} docs={docs} studentId={studentId} eid={eid} action="set_transcript_status" form={form} lockedReason={deliveryClosed} />
            <DeliveryRow idp="dl-diploma" label={t("s32dir.hs.gr.diploma")} current={g.diploma.status} docId={g.diploma.documentId} docs={docs} studentId={studentId} eid={eid} action="set_diploma_delivery" form={form} lockedReason={deliveryClosed} />
          </div>
        </SectionCard>

        <SectionCard testId="financial-clearance" title={t("s32dir.hs.gr.fin.title")}
          description={<>{t("s32dir.hs.gr.fin.a")}<span className="font-medium text-foreground">{g.financialClearance === null ? x("Not available") : x(FINANCIAL_LABEL[g.financialClearance])}</span>{t("s32dir.hs.gr.fin.b")}</>}
          action={closed ? null : <RecordButton form={form} id="financial" variant="outline">{t("s32dir.hs.gr.fin.update")}</RecordButton>}>
          {closed ? <p className="text-sm text-muted-foreground" data-testid="closed-record">{x(CLOSED_RECORD_TEXT)} {g.status === "diploma_conferred" ? t("s32dir.hs.gr.fin.lockedConferred") : t("s32dir.hs.gr.fin.locked")}</p> : (
            <FormPanel form={form} id="financial" className="grid gap-4">
              <Field id="fc-value" label={t("s32dir.hs.gr.fin.clearance")}>
                <select id="fc-value" className={FIELD_CLASS} value={finValue} onChange={(e) => setFinValue(e.target.value as HsFinancialClearance)}>
                  {HS_FINANCIAL_CLEARANCE.map((v) => <option key={v} value={v}>{x(FINANCIAL_LABEL[v])}</option>)}
                </select>
              </Field>
              <Field id="fc-note" label={t("s32dir.hs.note.req2")}><Input id="fc-note" value={finNote} onChange={(e) => setFinNote(e.target.value)} placeholder={t("s32dir.hs.gr.fin.basisPh")} /></Field>
              <ActionMessage message={finA.message} />
              <GatedButton id="fc-save" gate={finGate} pending={finA.pending} onClick={() => finA.run(financialClearanceBody(finValue, finNote), () => { setFinNote(""); form.close(); })}>{t("s32dir.hs.gr.fin.save")}</GatedButton>
            </FormPanel>
          )}
        </SectionCard>
      </div>
    </section>
  );
}
