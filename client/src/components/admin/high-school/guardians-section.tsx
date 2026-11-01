/** Guardians tab: standing, what staff may discuss, staff-only notes. Authority is verified in the S09 Profile panel. */
import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { adminHighSchoolApi } from "@/lib/admin-high-school-api";
import { GUARDIAN_NO_ACCESS, actorLabel, guardianGuidance, guardianNoteBody, noteGate, profileIdentityHref } from "@/lib/admin-high-school-logic";
import { ActionMessage, Field, FormPanel, GatedButton, Notice, Pill, RecordButton, SectionCard, SectionHeading, useOpenForm, type OpenForm, type SectionProps } from "./shared";
import { useStaffAction } from "./use-staff-action";
import { useHs } from "./hs-i18n";

type Guardian = SectionProps["state"]["guardians"][number];

function GuardianCard({ g, studentId, eid, form }: { g: Guardian; studentId: string; eid: string; form: OpenForm }) {
  const { t, x, date } = useHs();
  const [note, setNote] = useState("");
  const a = useStaffAction(studentId, (b: unknown) => adminHighSchoolApi.guardianNote(studentId, eid, b), t("s32dir.hs.g.noteSaved"));
  const guide = guardianGuidance(g);
  const tone = guide.tone === "verified" ? "good" : guide.tone === "pending" ? "warn" : guide.tone === "problem" ? "bad" : "neutral";
  const id = `note-${g.contactId}`;
  return (
    <SectionCard testId="guardian-card" title={g.fullName} description={t("s32dir.hs.g.access", { rel: g.relationship })} action={<Pill tone={tone}>{x(guide.label)}</Pill>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("s32dir.hs.g.discuss")}</h4><ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm">{guide.discuss.length ? guide.discuss.map((d) => <li key={d}>{x(d)}</li>) : <li>{t("s32dir.hs.g.nothing")}</li>}</ul></div>
        <div><h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("s32dir.hs.g.noDiscuss")}</h4><ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm">{guide.doNotDiscuss.map((d) => <li key={d}>{x(d)}</li>)}</ul></div>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("s32dir.hs.g.notes")}</h4>
          {eid ? <RecordButton form={form} id={id} variant="outline" size="sm">{t("s32dir.hs.g.addNoteBtn")}</RecordButton> : null}
        </div>
        {g.notes.length === 0 ? <p className="text-sm text-muted-foreground">{t("s32dir.hs.g.noNotes")}</p> : (
          <ul className="divide-y rounded-md border">{g.notes.map((n) => <li key={`${n.createdAt}${n.note}`} className="px-3 py-2 text-sm"><p>{n.note}</p><p className="text-xs text-muted-foreground">{t("s32dir.hs.g.noteBy", { date: date(n.createdAt), actor: x(actorLabel(n.actorId)) })}</p></li>)}</ul>
        )}
      </div>
      <FormPanel form={form} id={id} className="space-y-3">
        <Field id={`gn-${g.contactId}`} label={t("s32dir.hs.g.addNoteAbout", { name: g.fullName })}><Input id={`gn-${g.contactId}`} className="w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("s32dir.hs.g.notePh")} /></Field>
        <GatedButton id={`gn-${g.contactId}-save`} gate={noteGate(note)} pending={a.pending} onClick={() => a.run(guardianNoteBody(g.contactId, note), () => { setNote(""); form.close(); })}>{t("s32dir.hs.g.addNote")}</GatedButton>
      </FormPanel>
      <ActionMessage message={a.message} />
    </SectionCard>
  );
}

export function GuardiansSection({ state, studentId, initialOpenForm }: SectionProps) {
  const { t, x } = useHs();
  const isAdmin = useAuth().user?.role === "admin";
  const eid = state.current?.enrollment.id ?? "";
  const form = useOpenForm(initialOpenForm ?? null);
  return (
    <section aria-labelledby="hs-guardians-h" className="space-y-5">
      <SectionHeading id="hs-guardians-h" title={t("s32dir.hs.g.heading")}>
        {t("s32dir.hs.g.desc")}
      </SectionHeading>
      <Notice tone="official" testId="guardian-no-access">{x(GUARDIAN_NO_ACCESS)}</Notice>
      {/* S32-B (SA-06): the decision lives in the Advanced Workspace's Guardian & identity tab (admin). */}
      {isAdmin
        ? <p className="text-sm">{t("s32dir.hs.g.verify.a")}<Link href={profileIdentityHref(studentId)} className="font-medium underline" data-testid="link-guardian-identity">{t("s32dir.hs.g.verify.link")}</Link>{t("s32dir.hs.g.verify.b")}</p>
        : <p className="text-sm" data-testid="guardian-admin-only">{t("s32dir.hs.g.adminOnly")}</p>}
      {state.guardians.length === 0 ? <SectionCard title={t("s32dir.hs.g.none.title")} description={t("s32dir.hs.g.none.desc")} /> : null}
      {!eid && state.guardians.length > 0 ? <Notice>{t("s32dir.hs.g.needProgram")}</Notice> : null}
      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">{state.guardians.map((g) => <GuardianCard key={g.contactId} g={g} studentId={studentId} eid={eid} form={form} />)}</div>
    </section>
  );
}
