/** Guardians tab: standing, what staff may discuss, staff-only notes. Authority is verified in the S09 Profile panel. */
import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { adminHighSchoolApi } from "@/lib/admin-high-school-api";
import { GUARDIAN_NO_ACCESS, formatDate, guardianGuidance, guardianNoteBody, noteGate, profileIdentityHref } from "@/lib/admin-high-school-logic";
import { ActionMessage, Field, GatedButton, Notice, Pill, SectionHeading, type SectionProps } from "./shared";
import { useStaffAction } from "./use-staff-action";

type Guardian = SectionProps["state"]["guardians"][number];

function GuardianCard({ g, studentId, eid }: { g: Guardian; studentId: string; eid: string }) {
  const [note, setNote] = useState("");
  const a = useStaffAction(studentId, (b: unknown) => adminHighSchoolApi.guardianNote(studentId, eid, b), "Staff note saved.");
  const guide = guardianGuidance(g);
  const tone = guide.tone === "verified" ? "good" : guide.tone === "pending" ? "warn" : guide.tone === "problem" ? "bad" : "neutral";
  return (
    <Card data-testid="guardian-card">
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{g.fullName}</CardTitle>
          <Pill tone={tone}>{guide.label}</Pill>
        </div>
        <CardDescription>{g.relationship} · Portal access: none</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Staff may discuss</h3><ul className="mt-1 list-disc pl-5 text-sm">{guide.discuss.length ? guide.discuss.map((d) => <li key={d}>{d}</li>) : <li>Nothing</li>}</ul></div>
          <div><h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Staff must not discuss</h3><ul className="mt-1 list-disc pl-5 text-sm">{guide.doNotDiscuss.map((d) => <li key={d}>{d}</li>)}</ul></div>
        </div>
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Staff-only notes (never shown to the student)</h3>
          {g.notes.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">No notes.</p> : (
            <ul className="mt-1 divide-y rounded-md border">{g.notes.map((n) => <li key={`${n.createdAt}${n.note}`} className="px-3 py-2 text-sm"><p>{n.note}</p><p className="text-xs text-muted-foreground">{formatDate(n.createdAt)}</p></li>)}</ul>
          )}
        </div>
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
          <Field id={`gn-${g.contactId}`} label={`Add a note about ${g.fullName}`}><Input id={`gn-${g.contactId}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was discussed and with whom" /></Field>
          <GatedButton id={`gn-${g.contactId}-save`} variant="outline" size="sm" gate={noteGate(note)} pending={a.pending} onClick={() => a.run(guardianNoteBody(g.contactId, note), () => setNote(""))}>Add note</GatedButton>
        </div>
        <ActionMessage message={a.message} />
      </CardContent>
    </Card>
  );
}

export function GuardiansSection({ state, studentId }: SectionProps) {
  const eid = state.current?.enrollment.id ?? "";
  return (
    <section aria-labelledby="hs-guardians-h" className="space-y-5">
      <SectionHeading id="hs-guardians-h" title="Guardian coordination">
        Who staff may talk to about this student, and about what. Listing a contact does not give them authority or an account.
      </SectionHeading>
      <Notice tone="official" testId="guardian-no-access">{GUARDIAN_NO_ACCESS}</Notice>
      <p className="text-sm">Verifying who is a legal guardian happens in <Link href={profileIdentityHref(studentId)} className="font-medium underline">Profile &amp; identity</Link>; this page only reflects the result.</p>
      {state.guardians.length === 0 ? <Card><CardContent className="py-6 text-sm text-muted-foreground">No parents or guardians are listed for this student.</CardContent></Card> : null}
      {!eid && state.guardians.length > 0 ? <Notice>Notes can be added once a high school program exists.</Notice> : null}
      <div className="grid gap-5 xl:grid-cols-2">{state.guardians.map((g) => <GuardianCard key={g.contactId} g={g} studentId={studentId} eid={eid} />)}</div>
    </section>
  );
}
