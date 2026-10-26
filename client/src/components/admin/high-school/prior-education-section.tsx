/** Prior study tab: evaluated prior education, transfer claims, official transfer awards. Claims are NOT credit. */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PRIOR_EDUCATION_STATUSES, formatHalfUnits } from "@shared/high-school-contract";
import { adminHighSchoolApi } from "@/lib/admin-high-school-api";
import {
  CLAIM_NOT_CREDIT_NOTICE, acceptedHalfUnitsOf, acceptedSummary, canAwardTransfer, claimBadge, claimBody, claimDecisionGate, creditsLabel, halfUnitSteps, initialClaimDecision, priorEducationBody,
  resolveClaimBody, statusLabel, transferAwardBody, transferAwardGate, validateClaim, validatePriorEducation, type ClaimDecision,
} from "@/lib/admin-high-school-logic";
import { ActionMessage, EvidenceSelect, FIELD_CLASS, Field, GatedButton, Notice, Pill, SectionHeading, type SectionProps } from "./shared";
import { useStaffAction } from "./use-staff-action";

type PriorList = NonNullable<SectionProps["state"]["current"]>["priorEducation"];
type Claim = PriorList[number]["claims"][number];

function ClaimRow({ studentId, eid, claim, areaLabel, docs, awarded }: { studentId: string; eid: string; claim: Claim; areaLabel: string; docs: SectionProps["docs"]; awarded: boolean }) {
  const [status, setStatus] = useState<ClaimDecision>(initialClaimDecision(claim.status));
  const [note, setNote] = useState("");
  const [accepted, setAccepted] = useState<number>(claim.acceptedHalfUnits ?? Math.max(1, claim.claimedHalfUnits - 1));
  const cap = acceptedHalfUnitsOf(claim);
  const [awardUnits, setAwardUnits] = useState<number>(Math.max(1, cap));
  const [evidence, setEvidence] = useState("");
  const resolve = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.resolveClaim(studentId, eid, claim.id, body), "Claim updated. No credit was awarded.");
  const award = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.transferAward(studentId, eid, body), "Official transfer credit recorded.");
  const rid = `claim-${claim.id}`;
  const badge = claimBadge(claim.status, awarded);
  const summary = acceptedSummary(claim);
  const decisionGate = claimDecisionGate(claim, status, note, accepted);
  const awardGate = awarded ? { enabled: false, reason: "Credit has already been awarded for this claim." } : transferAwardGate(claim, formatHalfUnits(awardUnits), evidence, docs);
  return (
    <li className="space-y-3 px-4 py-4" data-testid="claim-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{claim.courseTitle}</p>
          <p className="text-xs text-muted-foreground">Claimed {creditsLabel(claim.claimedHalfUnits)} toward {areaLabel}{summary ? ` · ${summary}` : ""}</p>
          {claim.note ? <p className="mt-1 text-xs">{claim.note}</p> : null}
        </div>
        <Pill tone={badge.tone}>{badge.label}</Pill>
      </div>
      {claim.status !== "declined" && !awarded ? (
        <div className="grid gap-3 rounded-md bg-muted/40 p-3 md:grid-cols-[13rem_9rem_1fr_auto] md:items-end">
          <Field id={`${rid}-status`} label="School's decision">
            <select id={`${rid}-status`} className={FIELD_CLASS} value={status} onChange={(e) => setStatus(e.target.value as ClaimDecision)}>
              <option value="submitted_to_school">Submitted to school</option>
              <option value="accepted">Accepted</option>
              <option value="partially_accepted">Partially accepted</option>
              <option value="declined">Declined</option>
            </select>
          </Field>
          {status === "partially_accepted" ? (
            <Field id={`${rid}-accepted`} label="Credits accepted">
              <select id={`${rid}-accepted`} className={FIELD_CLASS} value={accepted} onChange={(e) => setAccepted(Number(e.target.value))}>
                {halfUnitSteps(claim.claimedHalfUnits).map((h) => <option key={h} value={h}>{formatHalfUnits(h)} of {formatHalfUnits(claim.claimedHalfUnits)}</option>)}
              </select>
            </Field>
          ) : <div className="hidden md:block" />}
          <Field id={`${rid}-note`} label="Note (required)"><Input id={`${rid}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the school told us" /></Field>
          <GatedButton id={`${rid}-resolve`} variant="outline" size="sm" gate={decisionGate} pending={resolve.pending} onClick={() => resolve.run(resolveClaimBody(status, note, accepted), () => setNote(""))}>Record decision</GatedButton>
        </div>
      ) : null}
      <ActionMessage message={resolve.message} />
      {canAwardTransfer(claim.status) && !awarded ? (
        <div className="grid gap-3 rounded-md border border-dashed p-3 md:grid-cols-[10rem_1fr_auto] md:items-end" data-testid="transfer-award-form">
          <Field id={`${rid}-credits`} label="Credits awarded" hint={`Counts toward ${areaLabel}; at most ${formatHalfUnits(cap)}.`}>
            <select id={`${rid}-credits`} className={FIELD_CLASS} value={awardUnits} aria-describedby={`${rid}-credits-hint`} onChange={(e) => setAwardUnits(Number(e.target.value))}>
              {halfUnitSteps(cap).map((h) => <option key={h} value={h}>{formatHalfUnits(h)} {h === 2 ? "credit" : "credits"}</option>)}
            </select>
          </Field>
          <EvidenceSelect id={`${rid}-evidence`} label="School's evaluation (verified document)" value={evidence} onChange={setEvidence} docs={docs} purpose="transferAward" />
          <GatedButton id={`${rid}-award`} size="sm" gate={awardGate} pending={award.pending}
            onClick={() => award.run(transferAwardBody({ claimId: claim.id, areaKey: claim.areaKey, credits: formatHalfUnits(awardUnits), evidenceDocumentId: evidence }))}>Record transfer credit</GatedButton>
        </div>
      ) : null}
      {awarded ? <p className="text-xs font-medium">Official transfer credit recorded for this claim.</p> : null}
      <ActionMessage message={award.message} />
    </li>
  );
}

export function PriorEducationSection({ state, studentId, docs }: SectionProps) {
  const cur = state.current;
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
  const addPrior = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.recordPriorEducation(studentId, eid, body), "Prior education recorded. No credit was awarded.");
  const addClaim = useStaffAction(studentId, (body: unknown) => adminHighSchoolApi.addClaim(studentId, eid, body), "Transfer claim added. No credit was awarded.");
  if (!cur) {
    return <section aria-labelledby="hs-prior-h"><SectionHeading id="hs-prior-h" title="Prior study and transfer claims" /><Notice>Create the high school program first; prior study is recorded against it.</Notice></section>;
  }
  const areaLabel = (k: string) => cur.template.areas.find((a) => a.key === k)?.label ?? k;
  const awardedClaims = new Set(cur.awards.filter((a) => a.status === "active" && a.claimId).map((a) => a.claimId as string));
  const priorProblem = validatePriorEducation({ schoolName: school, country });
  const claimForm = { priorEducationId: claimPrior || cur.priorEducation[0]?.id || "", courseTitle: claimTitle, areaKey: claimArea, credits: claimCredits };
  const claimProblem = validateClaim(claimForm);
  return (
    <section aria-labelledby="hs-prior-h" className="space-y-5">
      <SectionHeading id="hs-prior-h" title="Prior study and transfer claims">
        Record evaluated prior education and the courses that might transfer. Resolve each claim as the awarding school decides.
      </SectionHeading>
      <Notice tone="official" testId="claims-not-credit">{CLAIM_NOT_CREDIT_NOTICE}</Notice>

      {cur.priorEducation.length === 0 ? <Card><CardContent className="py-6 text-sm text-muted-foreground">No prior education recorded yet.</CardContent></Card> : null}
      {cur.priorEducation.map((p) => (
        <Card key={p.id} data-testid="prior-education">
          <CardHeader className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{p.schoolName}</CardTitle>
              <Pill>{statusLabel(p.status)}</Pill>
            </div>
            <CardDescription>{p.country}{p.gradeLevels ? ` · ${p.gradeLevels}` : ""}{p.evidenceDocumentId ? " · evidence on file (verified document)" : " · no evidence document linked"}</CardDescription>
            {p.staffNote ? <p className="text-sm">{p.staffNote}</p> : null}
          </CardHeader>
          <CardContent className="p-0">
            {p.claims.length === 0 ? <p className="px-6 pb-4 text-sm text-muted-foreground">No transfer claims for this school.</p> : (
              <ul className="divide-y border-t">
                {p.claims.map((c) => <ClaimRow key={c.id} studentId={studentId} eid={eid} claim={c} areaLabel={areaLabel(c.areaKey)} docs={docs} awarded={awardedClaims.has(c.id)} />)}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Record prior education</CardTitle><CardDescription>A school the student attended before.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <Field id="pe-school" label="School name"><Input id="pe-school" value={school} onChange={(e) => setSchool(e.target.value)} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="pe-country" label="Country"><Input id="pe-country" value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
              <Field id="pe-grades" label="Grade levels (optional)"><Input id="pe-grades" value={grades} onChange={(e) => setGrades(e.target.value)} placeholder="e.g. Grades 9-10" /></Field>
            </div>
            <Field id="pe-status" label="Evaluation status">
              <select id="pe-status" className={FIELD_CLASS} value={status} onChange={(e) => setStatus(e.target.value)}>
                {PRIOR_EDUCATION_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </Field>
            <EvidenceSelect id="pe-evidence" label="Transcript or evaluation (optional, verified)" value={evidence} onChange={setEvidence} docs={docs} purpose="transferAward" />
            <Field id="pe-note" label="Staff note (optional)"><Input id="pe-note" value={staffNote} onChange={(e) => setStaffNote(e.target.value)} /></Field>
            <ActionMessage message={addPrior.message} />
            <GatedButton id="pe-save" variant="outline" gate={priorProblem ? { enabled: false, reason: priorProblem } : { enabled: true, reason: null }} pending={addPrior.pending}
              onClick={() => addPrior.run(priorEducationBody({ schoolName: school, country, gradeLevels: grades, status, evidenceDocumentId: evidence, staffNote }), () => { setSchool(""); setCountry(""); setGrades(""); setEvidence(""); setStaffNote(""); })}>Save prior education</GatedButton>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Add a transfer claim</CardTitle><CardDescription>A course that may transfer. Still not credit.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <Field id="tc-prior" label="Prior school">
              <select id="tc-prior" className={FIELD_CLASS} value={claimForm.priorEducationId} onChange={(e) => setClaimPrior(e.target.value)}>
                {cur.priorEducation.length === 0 ? <option value="">Record a prior school first</option> : null}
                {cur.priorEducation.map((p) => <option key={p.id} value={p.id}>{p.schoolName}</option>)}
              </select>
            </Field>
            <Field id="tc-title" label="Course title"><Input id="tc-title" value={claimTitle} onChange={(e) => setClaimTitle(e.target.value)} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="tc-area" label="Would count toward">
                <select id="tc-area" className={FIELD_CLASS} value={claimArea} onChange={(e) => setClaimArea(e.target.value)}>
                  <option value="">Choose an area…</option>
                  {cur.template.areas.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
              </Field>
              <Field id="tc-credits" label="Claimed credits" hint="0.5, 1, 1.5 …"><Input id="tc-credits" inputMode="decimal" value={claimCredits} onChange={(e) => setClaimCredits(e.target.value)} aria-describedby="tc-credits-hint" /></Field>
            </div>
            <ActionMessage message={addClaim.message} />
            <GatedButton id="tc-save" variant="outline" gate={claimProblem ? { enabled: false, reason: claimProblem } : { enabled: true, reason: null }} pending={addClaim.pending}
              onClick={() => addClaim.run(claimBody(claimForm), () => { setClaimTitle(""); setClaimCredits("1"); })}>Add claim</GatedButton>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
