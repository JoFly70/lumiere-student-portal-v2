/** Prior study tab: evaluated prior education, transfer claims, official transfer awards. Claims are NOT credit. */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { PRIOR_EDUCATION_STATUSES, formatHalfUnits } from "@shared/high-school-contract";
import { adminHighSchoolApi } from "@/lib/admin-high-school-api";
import {
  CLAIM_DECISION_LABEL, CLAIM_NOT_CREDIT_NOTICE, CLOSED_RECORD_TEXT, acceptedHalfUnitsOf, acceptedSummary, canAwardTransfer, claimBadge, claimBody, claimDecisionGate, creditsLabel, halfUnitSteps, initialClaimDecision, isOpenEnrollment, priorEducationBody,
  resolveClaimBody, statusLabel, transferAwardBody, transferAwardGate, validateClaim, validatePriorEducation, type ClaimDecision,
} from "@/lib/admin-high-school-logic";
import { ActionMessage, EvidenceSelect, FIELD_CLASS, Field, FormPanel, GatedButton, Notice, Pill, RecordButton, SectionCard, SectionHeading, useOpenForm, type OpenForm, type SectionProps } from "./shared";
import { useStaffAction } from "./use-staff-action";
import { useHs } from "./hs-i18n";

type PriorList = NonNullable<SectionProps["state"]["current"]>["priorEducation"];
type Claim = PriorList[number]["claims"][number];

function ClaimRow({ studentId, eid, claim, areaLabel, docs, awarded, form, locked }: { studentId: string; eid: string; claim: Claim; areaLabel: string; docs: SectionProps["docs"]; awarded: boolean; form: OpenForm; locked: boolean }) {
  const { t, x, fc, credits } = useHs();
  // The select starts at the SAVED decision ("Change to"): nothing is proposed until staff pick another one.
  const [status, setStatus] = useState<ClaimDecision>(initialClaimDecision(claim.status));
  const [note, setNote] = useState("");
  const [accepted, setAccepted] = useState<number>(claim.acceptedHalfUnits ?? Math.max(1, claim.claimedHalfUnits - 1));
  const cap = acceptedHalfUnitsOf(claim);
  const [awardUnits, setAwardUnits] = useState<number>(Math.max(1, cap));
  const [evidence, setEvidence] = useState("");
  const resolve = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.resolveClaim(studentId, eid, claim.id, body), t("s32dir.hs.pe.claimUpdated"));
  const award = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.transferAward(studentId, eid, body), t("s32dir.hs.pe.awardSaved"));
  const rid = `claim-${claim.id}`;
  const badge = claimBadge(claim.status, awarded);
  const summary = acceptedSummary(claim);
  const decisionGate = claimDecisionGate(claim, status, note, accepted);
  const awardGate = awarded ? { enabled: false, reason: "Credit has already been awarded for this claim." } : transferAwardGate(claim, formatHalfUnits(awardUnits), evidence, docs);
  const canDecide = !locked && claim.status !== "declined" && !awarded;
  const canAward = !locked && canAwardTransfer(claim.status) && !awarded;
  return (
    <li className="space-y-3 px-4 py-4 sm:px-5" data-testid="claim-row">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{claim.courseTitle}</p>
          <p className="text-xs text-muted-foreground">{t("s32dir.hs.pe.claimedLine", { credits: credits(claim.claimedHalfUnits), area: areaLabel })}{summary ? ` · ${x(summary)}` : ""}</p>
          {claim.note ? <p className="mt-1 text-xs">{claim.note}</p> : null}
        </div>
        <div className="flex items-center gap-2" data-testid="claim-current-status">
          <span className="text-xs text-muted-foreground">{t("s32dir.hs.pe.currentStatus")}</span>
          <Pill tone={badge.tone}>{x(badge.label)}</Pill>
        </div>
      </div>
      {canDecide || canAward ? (
        <div className="flex flex-wrap gap-2">
          {canDecide ? <RecordButton form={form} id={`decision-${claim.id}`} variant="outline" size="sm">{t("s32dir.hs.pe.recordDecisionBtn")}</RecordButton> : null}
          {canAward ? <RecordButton form={form} id={`award-${claim.id}`} size="sm">{t("s32dir.hs.pe.recordTransfer")}</RecordButton> : null}
        </div>
      ) : null}
      {canDecide ? (
        <FormPanel form={form} id={`decision-${claim.id}`} className="grid gap-3 md:grid-cols-[14rem_9rem_1fr_auto] md:items-end">
          <Field id={`${rid}-status`} label={t("s32dir.hs.pe.changeTo")} hint={t("s32dir.hs.pe.saved", { label: x(badge.label) })}>
            <select id={`${rid}-status`} className={FIELD_CLASS} value={status} aria-describedby={`${rid}-status-hint`} onChange={(e) => setStatus(e.target.value as ClaimDecision)}>
              {claim.status === "claimed" ? <option value="claimed">{x(CLAIM_DECISION_LABEL.claimed)}</option> : null}
              {(["submitted_to_school", "accepted", "partially_accepted", "declined"] as const).map((v) => <option key={v} value={v}>{x(CLAIM_DECISION_LABEL[v])}</option>)}
            </select>
          </Field>
          {status === "partially_accepted" ? (
            <Field id={`${rid}-accepted`} label={t("s32dir.hs.pe.accepted")}>
              <select id={`${rid}-accepted`} className={FIELD_CLASS} value={accepted} onChange={(e) => setAccepted(Number(e.target.value))}>
                {halfUnitSteps(claim.claimedHalfUnits).map((h) => <option key={h} value={h}>{t("s32dir.hs.pe.ofN", { a: fc(h), b: fc(claim.claimedHalfUnits) })}</option>)}
              </select>
            </Field>
          ) : <div className="hidden md:block" />}
          <Field id={`${rid}-note`} label={t("s32dir.hs.note.req2")}><Input id={`${rid}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("s32dir.hs.pe.schoolTold")} /></Field>
          <GatedButton id={`${rid}-resolve`} size="sm" gate={decisionGate} pending={resolve.pending} onClick={() => resolve.run(resolveClaimBody(status as Exclude<ClaimDecision, "claimed">, note, accepted), () => { setNote(""); form.close(); })}>{t("s32dir.hs.pe.recordDecision")}</GatedButton>
        </FormPanel>
      ) : null}
      <ActionMessage message={resolve.message} />
      {canAward ? (
        <FormPanel form={form} id={`award-${claim.id}`} className="grid gap-3 md:grid-cols-[10rem_1fr_auto] md:items-end">
          <div data-testid="transfer-award-form" className="contents">
            <Field id={`${rid}-credits`} label={t("s32dir.hs.pe.awarded")} hint={t("s32dir.hs.pe.awardedHint", { area: areaLabel, max: fc(cap) })}>
              <select id={`${rid}-credits`} className={FIELD_CLASS} value={awardUnits} aria-describedby={`${rid}-credits-hint`} onChange={(e) => setAwardUnits(Number(e.target.value))}>
                {halfUnitSteps(cap).map((h) => <option key={h} value={h}>{credits(h)}</option>)}
              </select>
            </Field>
            <EvidenceSelect id={`${rid}-evidence`} label={t("s32dir.hs.pe.schoolEval")} value={evidence} onChange={setEvidence} docs={docs} purpose="transferAward" />
            <GatedButton id={`${rid}-award`} size="sm" gate={awardGate} pending={award.pending}
              onClick={() => award.run(transferAwardBody({ claimId: claim.id, areaKey: claim.areaKey, credits: formatHalfUnits(awardUnits), evidenceDocumentId: evidence }), () => form.close())}>{t("s32dir.hs.pe.recordTransfer")}</GatedButton>
          </div>
        </FormPanel>
      ) : null}
      {awarded ? <p className="text-xs font-medium">{t("s32dir.hs.pe.awardedFor")}</p> : null}
      <ActionMessage message={award.message} />
    </li>
  );
}

export function PriorEducationSection({ state, studentId, docs, initialOpenForm }: SectionProps) {
  const { t, x } = useHs();
  const cur = state.current;
  const form = useOpenForm(initialOpenForm ?? null);
  const [school, setSchool] = useState("");
  const [country, setCountry] = useState("");
  const [grades, setGrades] = useState("");
  const [status, setStatus] = useState<string>("reported");
  const [evidence, setEvidence] = useState("");
  const [staffNote, setStaffNote] = useState("");
  const [claimPrior, setClaimPrior] = useState("");
  const [claimTitle, setClaimTitle] = useState("");
  const [claimArea, setClaimArea] = useState("");
  const [claimCredits, setClaimCredits] = useState("1");
  const eid = cur?.enrollment.id ?? "";
  const addPrior = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.recordPriorEducation(studentId, eid, body), t("s32dir.hs.pe.priorSaved"));
  const addClaim = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.addClaim(studentId, eid, body), t("s32dir.hs.pe.claimAdded"));
  if (!cur) {
    return <section aria-labelledby="hs-prior-h"><SectionHeading id="hs-prior-h" title={t("s32dir.hs.pe.heading")} /><Notice>{t("s32dir.hs.pe.needProgram")}</Notice></section>;
  }
  const locked = !isOpenEnrollment(cur.enrollment);
  const areaLabel = (k: string) => cur.template.areas.find((a) => a.key === k)?.label ?? k;
  const awardedClaims = new Set(cur.awards.filter((a) => a.status === "active" && a.claimId).map((a) => a.claimId as string));
  const priorProblem = validatePriorEducation({ schoolName: school, country });
  const claimForm = { priorEducationId: claimPrior || cur.priorEducation[0]?.id || "", courseTitle: claimTitle, areaKey: claimArea, credits: claimCredits };
  const claimProblem = validateClaim(claimForm);
  return (
    <section aria-labelledby="hs-prior-h" className="space-y-5">
      <SectionHeading id="hs-prior-h" title={t("s32dir.hs.pe.heading")}>
        {t("s32dir.hs.pe.desc")}
      </SectionHeading>
      <Notice tone="official" testId="claims-not-credit">{x(CLAIM_NOT_CREDIT_NOTICE)}</Notice>
      {locked ? <Notice tone="info" testId="closed-record">{x(CLOSED_RECORD_TEXT)} {t("s32dir.hs.pe.closed")}</Notice> : null}

      {cur.priorEducation.length === 0 ? <SectionCard title={t("s32dir.hs.pe.none.title")} description={t("s32dir.hs.pe.none.desc")} /> : null}
      {cur.priorEducation.map((p) => (
        <SectionCard key={p.id} testId="prior-education" flush
          title={p.schoolName}
          description={<>{p.country}{p.gradeLevels ? ` · ${p.gradeLevels}` : ""}{p.evidenceDocumentId ? t("s32dir.hs.pe.evidenceOn") : t("s32dir.hs.pe.evidenceOff")}{p.staffNote ? <span className="mt-1 block text-foreground">{p.staffNote}</span> : null}</>}
          action={<Pill>{x(statusLabel(p.status))}</Pill>}>
          {p.claims.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{t("s32dir.hs.pe.noClaims")}</p> : (
            <ul className="divide-y">
              {p.claims.map((c) => <ClaimRow key={c.id} studentId={studentId} eid={eid} claim={c} areaLabel={areaLabel(c.areaKey)} docs={docs} awarded={awardedClaims.has(c.id)} form={form} locked={locked} />)}
            </ul>
          )}
        </SectionCard>
      ))}

      {locked ? null : (
        <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
          <SectionCard title={t("s32dir.hs.pe.record")} description={t("s32dir.hs.pe.record.desc")} action={<RecordButton form={form} id="prior-new">{t("s32dir.hs.pe.record")}</RecordButton>}>
            <FormPanel form={form} id="prior-new" className="grid gap-4">
              <Field id="pe-school" label={t("s32dir.hs.pe.school")}><Input id="pe-school" value={school} onChange={(e) => setSchool(e.target.value)} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="pe-country" label={t("s32dir.hs.pe.country")}><Input id="pe-country" value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
                <Field id="pe-grades" label={t("s32dir.hs.pe.grades")}><Input id="pe-grades" value={grades} onChange={(e) => setGrades(e.target.value)} placeholder={t("s32dir.hs.pe.gradesPh")} /></Field>
              </div>
              <Field id="pe-status" label={t("s32dir.hs.pe.evalStatus")}>
                <select id="pe-status" className={FIELD_CLASS} value={status} onChange={(e) => setStatus(e.target.value)}>
                  {PRIOR_EDUCATION_STATUSES.map((s) => <option key={s} value={s}>{x(statusLabel(s))}</option>)}
                </select>
              </Field>
              <EvidenceSelect id="pe-evidence" label={t("s32dir.hs.pe.transcriptOpt")} value={evidence} onChange={setEvidence} docs={docs} purpose="transferAward" />
              <Field id="pe-note" label={t("s32dir.hs.pe.staffNote")}><Input id="pe-note" value={staffNote} onChange={(e) => setStaffNote(e.target.value)} /></Field>
              <ActionMessage message={addPrior.message} />
              <GatedButton id="pe-save" gate={priorProblem ? { enabled: false, reason: priorProblem } : { enabled: true, reason: null }} pending={addPrior.pending}
                onClick={() => addPrior.run(priorEducationBody({ schoolName: school, country, gradeLevels: grades, status, evidenceDocumentId: evidence, staffNote }), () => { setSchool(""); setCountry(""); setGrades(""); setEvidence(""); setStaffNote(""); form.close(); })}>{t("s32dir.hs.pe.savePrior")}</GatedButton>
            </FormPanel>
          </SectionCard>

          <SectionCard title={t("s32dir.hs.pe.addClaim")} description={t("s32dir.hs.pe.addClaim.desc")} action={<RecordButton form={form} id="claim-new">{t("s32dir.hs.pe.addClaim")}</RecordButton>}>
            <FormPanel form={form} id="claim-new" className="grid gap-4">
              <Field id="tc-prior" label={t("s32dir.hs.pe.priorSchool")}>
                <select id="tc-prior" className={FIELD_CLASS} value={claimForm.priorEducationId} onChange={(e) => setClaimPrior(e.target.value)}>
                  {cur.priorEducation.length === 0 ? <option value="">{t("s32dir.hs.pe.recordFirst")}</option> : null}
                  {cur.priorEducation.map((p) => <option key={p.id} value={p.id}>{p.schoolName}</option>)}
                </select>
              </Field>
              <Field id="tc-title" label={t("s32dir.hs.pe.courseTitle")}><Input id="tc-title" value={claimTitle} onChange={(e) => setClaimTitle(e.target.value)} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="tc-area" label={t("s32dir.hs.pe.wouldCount")}>
                  <select id="tc-area" className={FIELD_CLASS} value={claimArea} onChange={(e) => setClaimArea(e.target.value)}>
                    <option value="">{t("s32dir.hs.pe.chooseArea")}</option>
                    {cur.template.areas.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </select>
                </Field>
                <Field id="tc-credits" label={t("s32dir.hs.pe.claimedCredits")} hint={t("s32dir.hs.pe.creditsHint")}><Input id="tc-credits" inputMode="decimal" value={claimCredits} onChange={(e) => setClaimCredits(e.target.value)} aria-describedby="tc-credits-hint" /></Field>
              </div>
              <ActionMessage message={addClaim.message} />
              <GatedButton id="tc-save" gate={claimProblem ? { enabled: false, reason: claimProblem } : { enabled: true, reason: null }} pending={addClaim.pending}
                onClick={() => addClaim.run(claimBody(claimForm), () => { setClaimTitle(""); setClaimCredits("1"); form.close(); })}>{t("s32dir.hs.pe.saveClaim")}</GatedButton>
            </FormPanel>
          </SectionCard>
        </div>
      )}
    </section>
  );
}
