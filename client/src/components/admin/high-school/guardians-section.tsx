/** Guardians tab: standing, what staff may discuss, staff-only notes. Authority is verified in the S09 Profile panel. */
import { useState } from "react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { adminHighSchoolApi } from "@/lib/admin-high-school-api";
import { GUARDIAN_NO_ACCESS, actorLabel, formatDate, guardianGuidance, guardianNoteBody, noteGate, profileIdentityHref } from "@/lib/admin-high-school-logic";
import { ActionMessage, Field, FormPanel, GatedButton, Notice, Pill, RecordButton, SectionCard, SectionHeading, useOpenForm, type OpenForm, type SectionProps } from "./shared";
import { useStaffAction } from "./use-staff-action";

type Guardian = SectionProps["state"]["guardians"][number];

function GuardianCard({ g, studentId, eid, form }: { g: Guardian; studentId: string; eid: string; form: OpenForm }) {
  const [note, setNote] = useState("");
  const a = useStaffAction(studentId, (b: unknown) => adminHighSchoolApi.guardianNote(studentId, eid, b), "Staff note saved.");
  const guide = guardianGuidance(g);
  const tone = guide.tone === "verified" ? "good" : guide.tone === "pending" ? "warn" : guide.tone === "problem" ? "bad" : "neutral";
  const id = `note-${g.contactId}`;
  return (
    <SectionCard testId="guardian-card" title={g.fullName} description={`${g.relationship} · Portal access: none`} action={<Pill tone={tone}>{guide.label}</Pill>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Staff may discuss</h4><ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm">{guide.discuss.length ? guide.discuss.map((d) => <li key={d}>{d}</li>) : <li>Nothing</li>}</ul></div>
        <div><h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Staff must not discuss</h4><ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm">{guide.doNotDiscuss.map((d) => <li key={d}>{d}</li>)}</ul></div>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Staff-only notes (never shown to the student)</h4>
          {eid ? <RecordButton form={form} id={id} variant="outline" size="sm">Add a note</RecordButton> : null}
        </div>
        {g.notes.length === 0 ? <p className="text-sm text-muted-foreground">No notes.</p> : (
          <ul className="divide-y rounded-md border">{g.notes.map((n) => <li key={`${n.createdAt}${n.note}`} className="px-3 py-2 text-sm"><p>{n.note}</p><p className="text-xs text-muted-foreground">{formatDate(n.createdAt)} · by {actorLabel(n.actorId)}</p></li>)}</ul>
        )}
      </div>
      <FormPanel form={form} id={id} className="space-y-3">
        <Field id={`gn-${g.contactId}`} label={`Add a note about ${g.fullName}`}><Input id={`gn-${g.contactId}`} className="w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was discussed and with whom" /></Field>
        <GatedButton id={`gn-${g.contactId}-save`} gate={noteGate(note)} pending={a.pending} onClick={() => a.run(guardianNoteBody(g.contactId, note), () => { setNote(""); form.close(); })}>Add note</GatedButton>
      </FormPanel>
      <ActionMessage message={a.message} />
    </SectionCard>
  );
}

export function GuardiansSection({ state, studentId, initialOpenForm }: SectionProps) {
  const eid = state.current?.enrollment.id ?? "";
  const form = useOpenForm(initialOpenForm ?? null);
  return (
    <section aria-labelledby="hs-guardians-h" className="space-y-5">
      <SectionHeading id="hs-guardians-h" title="Guardian coordination">
        Who staff may talk to about this student, and about what. Listing a contact does not give them authority or an account.
      </SectionHeading>
      <Notice tone="official" testId="guardian-no-access">{GUARDIAN_NO_ACCESS}</Notice>
      <p className="text-sm">Verifying who is a legal guardian happens in <Link href={profileIdentityHref(studentId)} className="font-medium underline">Profile &amp; identity</Link>; this page only reflects the result.</p>
      {state.guardians.length === 0 ? <SectionCard title="No guardians listed" description="No parents or guardians are listed for this student." /> : null}
      {!eid && state.guardians.length > 0 ? <Notice>Notes can be added once a high school program exists.</Notice> : null}
      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">{state.guardians.map((g) => <GuardianCard key={g.contactId} g={g} studentId={studentId} eid={eid} form={form} />)}</div>
    </section>
  );
}
