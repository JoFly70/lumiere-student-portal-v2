/**
 * S25 — owner "View as Student" (/admin/students/:studentId/view-as-student). Admin only.
 * Data: GET /api/admin/students/:studentId/view-as-student (shared/view-as-student-contract.ts).
 *
 * READ-ONLY: renders the student's own projections with the student UI components, but outside
 * HsActionsProvider (actions are inert) and with in-preview links disabled, so nothing here can report
 * progress, request a transcript, open a ticket or navigate into student-only routes. The preview language
 * lives in a nested I18nProvider and never changes the owner's own language.
 */
import React, { useEffect, useState, type MouseEvent } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Eye, Loader2, RefreshCw } from "lucide-react";
import { formatHalfUnits } from "@shared/high-school-contract";
import type { ViewAsStudentResponse } from "@shared/view-as-student-contract";
import type { StudentProfileView } from "@shared/student-profile-contract";
import type { StaffBillingView } from "@shared/billing-contract";
import { formatMoney } from "@shared/billing-contract";
import type { SupportTicketDetail, SupportTicketSummary } from "@shared/support-contract";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/api";
import { I18nProvider, LANGUAGES, type Language } from "@/i18n";
import { useDocuments } from "@/hooks/use-documents";
import { useTickets, useTicket } from "@/hooks/use-tickets";
import { STAFF_PROFILE_PATHS, STAFF_PROFILE_QUERY_KEY } from "@/components/admin/student-profile-review-logic";
import { useStaffBilling } from "@/lib/billing-queries";
import { HighSchoolPageView } from "@/components/high-school/high-school-view";
import { HsNoEnrollment } from "@/components/high-school/states";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { CockpitView } from "@/components/cockpit/cockpit-view";
import { summarizeDocuments, type CockpitOps } from "@/components/cockpit/model";
import { deckState } from "@/lib/academic-flight-deck-presentation";
import { CockpitNotConfigured } from "@/pages/high-school-flight-deck";
import "@/styles/flight-deck-preview.css";
import "@/styles/academic-flight-deck.css";
import { AssistantPanelView } from "@/components/academic-assistant";
import { StaffAvatar } from "@/components/staff/staff-ui";

export const viewAsStudentPath = (studentId: string) => `/api/admin/students/${encodeURIComponent(studentId)}/view-as-student`;

function formatWhen(iso: string | null): string {
  if (!iso) return "None recorded";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "None recorded" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Swallows link clicks inside the preview: the owner stays on this page and no student route is opened. */
function blockNavigation(e: MouseEvent<HTMLDivElement>) {
  const anchor = (e.target as HTMLElement).closest?.("a[href]");
  if (anchor) {
    e.preventDefault();
    e.stopPropagation();
  }
}

export function StaffProgressSummary({ data, language = "en" }: { data: ViewAsStudentResponse; language?: Language }) {
  const copy = PREVIEW_COPY[language];
  const s = data.summary;
  if (!s) return <p className="text-sm text-muted-foreground" data-testid="preview-summary-empty">{copy.noSummary}</p>;
  const items: Array<[string, string, string?]> = [
    [copy.creditsEarned, `${formatHalfUnits(s.creditsEarnedHalfUnits)} / ${formatHalfUnits(s.creditsRequiredHalfUnits)}`],
    [copy.creditsRemaining, formatHalfUnits(s.creditsRemainingHalfUnits)],
    [copy.awaitingSchool, formatHalfUnits(s.awaitingConfirmationHalfUnits), copy.notEarned],
    [copy.coursesUnderway, String(s.coursesUnderway)],
    [copy.studentTasks, String(s.studentReportedTasks), copy.awaitingOfficial],
    [copy.officialResults, String(s.officialResults)],
    [copy.pendingEvidence, String(s.pendingEvidence)],
    [copy.lastActivity, formatWhen(s.lastRecordedActivityAt)],
    [copy.nextMilestone, s.nextMilestone ? `${formatHalfUnits(s.nextMilestone.cumulativeHalfUnits)} ${copy.credits} · ${s.nextMilestone.month}` : copy.notConfigured],
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="preview-summary">
      {items.map(([label, value, note]) => (
        <div key={label} className="rounded-md border bg-card p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
          {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
        </div>
      ))}
      {!s.roadmapPublished ? <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">{copy.noRoadmap}</p> : null}
    </dl>
  );
}

function PreviewDashboard({ data, ops }: { data: ViewAsStudentResponse; ops: CockpitOps }) {
  const p = data.academicProjection;
  if (!p) return <StudentSurface><HsNoEnrollment /></StudentSurface>;
  if (deckState(p) === "not_configured") return <CockpitNotConfigured projection={p} />;
  return (
    <StudentSurface testId="preview-dashboard">
      <div className="fdp fdp-live">
        <CockpitView projection={p} firstName={data.student.displayName.split(" ")[0] ?? null} ops={ops} />
      </div>
    </StudentSurface>
  );
}

const PREVIEW_COPY = {
  en: {
    dashboard: "Dashboard", highSchool: "High school", profile: "Profile", documents: "Documents", support: "Support", billing: "Billing", ai: "Lumière AI", aiNote: "This is the assistant panel the student sees, with the mode the server would give a student session. It is inert here: nothing is sent to the assistant and no conversation is created.",
    profileTitle: "Profile and contacts", identity: "Identity", name: "Name", preferredName: "Preferred name", preferredContact: "Preferred contact", email: "Email", phone: "Phone", address: "Address",
    studentCode: "Student code", timezone: "Time zone",
    loading: "Loading…",
    guardians: "Contacts and guardians", noContacts: "No guardian or contact records are available.", relationship: "Relationship", authority: "Authority status", scopes: "Effective contact scopes",
    docsTitle: "Student documents", fileContents: "File contents are not opened in this preview. Use the workspace Documents section for authorized document review.",
    noDocs: "No documents are recorded.", noProfile: "Profile information is unavailable for this preview.",
    supportTitle: "Support requests", conversation: "Student-visible conversation", noTickets: "No support tickets are recorded.",
    noMessages: "No public messages are recorded for this ticket.", attachments: "Student-visible attachments", noAttachments: "No attachments are visible to the student.",
    billingTitle: "Billing overview", obligation: "Net obligation", paid: "Paid", remaining: "Outstanding", nextDue: "Next due",
    noBilling: "Billing is not configured for this student.", unavailable: "This section could not be loaded.",
    readonly: "Read-only student view. Forms, uploads, replies, payment entry, and account-security actions are not available here.",
    limitations: "Not previewed: the course roadmap screen (use View roadmap in the workspace), document file contents, account security, payment entry, and student write actions. The staff workspace remains the place for authorized document review.",
    openTicket: "Open conversation", selectTicket: "Select a request",
    noSummary: "No high school enrollment, so there is no academic progress to summarize.",
    creditsEarned: "Credits earned (official)", creditsRemaining: "Credits remaining", awaitingSchool: "Reported, awaiting school",
    notEarned: "Not counted as earned", coursesUnderway: "Courses underway", studentTasks: "Student-reported tasks",
    awaitingOfficial: "Awaiting an official result", officialResults: "Official school results", pendingEvidence: "Pending evidence review",
    lastActivity: "Last recorded activity", nextMilestone: "Next milestone", notConfigured: "Not configured", credits: "credits",
    noRoadmap: "No roadmap is published yet; the student sees an empty plan.",
    sourceNote: "From stored records only: official credit comes from school-confirmed awards; student reports never count as earned.",
    chosenLanguage: "Student's chosen language", defaultLanguage: "not saved yet (English by default)",
    returnWorkspace: "Return to staff workspace", languageLabel: "Preview language",
  },
  fr: {
    dashboard: "Tableau de bord", highSchool: "Secondaire", profile: "Profil", documents: "Documents", support: "Assistance", billing: "Facturation", ai: "Lumière IA", aiNote: "Voici le panneau d’assistant que voit l’élève, avec le mode que le serveur donnerait à une session élève. Il est inactif ici : rien n’est envoyé à l’assistant et aucune conversation n’est créée.",
    profileTitle: "Profil et contacts", identity: "Identité", name: "Nom", preferredName: "Nom préféré", preferredContact: "Contact préféré", email: "Courriel", phone: "Téléphone", address: "Adresse",
    studentCode: "Code étudiant", timezone: "Fuseau horaire",
    loading: "Chargement…",
    guardians: "Contacts et tuteurs", noContacts: "Aucun dossier de tuteur ou de contact n'est disponible.", relationship: "Lien", authority: "Statut d'autorité", scopes: "Autorisations de contact effectives",
    docsTitle: "Documents de l'étudiant", fileContents: "Le contenu des fichiers n'est pas ouvert dans cet aperçu. Utilisez la section Documents du dossier pour une vérification autorisée.",
    noDocs: "Aucun document n'est enregistré.", noProfile: "Les informations du profil ne sont pas disponibles dans cet aperçu.",
    supportTitle: "Demandes d'assistance", conversation: "Conversation visible par l'étudiant", noTickets: "Aucun billet d'assistance n'est enregistré.",
    noMessages: "Aucun message public n'est enregistré pour cette demande.", attachments: "Pièces jointes visibles par l'étudiant", noAttachments: "Aucune pièce jointe n'est visible par l'étudiant.",
    billingTitle: "Aperçu de facturation", obligation: "Montant net dû", paid: "Payé", remaining: "Solde restant", nextDue: "Prochaine échéance",
    noBilling: "La facturation n'est pas configurée pour cet étudiant.", unavailable: "Cette section n'a pas pu être chargée.",
    readonly: "Vue étudiant en lecture seule. Les formulaires, téléversements, réponses, paiements et actions de sécurité du compte ne sont pas disponibles ici.",
    limitations: "Non inclus dans l'aperçu : écran du parcours de cours (utilisez Voir le parcours dans le dossier), contenu des fichiers, sécurité du compte, saisie de paiement et actions de modification. Le dossier du personnel reste la source pour la vérification autorisée des documents.",
    openTicket: "Ouvrir la conversation", selectTicket: "Sélectionner une demande",
    noSummary: "Aucune inscription au secondaire : aucune progression scolaire à résumer.",
    creditsEarned: "Crédits obtenus (officiels)", creditsRemaining: "Crédits restants", awaitingSchool: "Déclarés, en attente de l'école",
    notEarned: "Non comptés comme obtenus", coursesUnderway: "Cours en cours", studentTasks: "Tâches déclarées par l'étudiant",
    awaitingOfficial: "En attente d'un résultat officiel", officialResults: "Résultats scolaires officiels", pendingEvidence: "Preuves en attente de vérification",
    lastActivity: "Dernière activité enregistrée", nextMilestone: "Prochain jalon", notConfigured: "Non configuré", credits: "crédits",
    noRoadmap: "Aucun parcours n'est publié; le plan de l'étudiant est vide.",
    sourceNote: "D'après les dossiers enregistrés : seuls les crédits confirmés par l'école comptent; les déclarations de l'étudiant ne sont pas des crédits obtenus.",
    chosenLanguage: "Langue choisie par l'étudiant", defaultLanguage: "non enregistrée (anglais par défaut)",
    returnWorkspace: "Retour au dossier du personnel", languageLabel: "Langue de l'aperçu",
  },
} as const;

function display(value: unknown, fallback = "Not provided"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function PreviewProfile({ profile, loading, failed, copy }: {
  profile?: StudentProfileView;
  loading?: boolean;
  failed?: boolean;
  copy: (typeof PREVIEW_COPY)[Language];
}) {
  if (loading) return <p role="status" className="rounded-md border p-4 text-sm">{copy.loading}</p>;
  if (failed) return <p role="alert" className="rounded-md border p-4 text-sm">{copy.unavailable}</p>;
  if (!profile) return <p className="rounded-md border p-4 text-sm text-muted-foreground">{copy.noProfile}</p>;
  const identity = profile.identity;
  const contact = profile.contact;
  const fullName = [identity.firstName, identity.middleName, identity.lastName].filter(Boolean).join(" ");
  const address = [contact.addressLine1, contact.addressLine2, contact.addressCity, contact.addressState, contact.addressPostal, contact.addressCountry].filter(Boolean).join(", ");
  return (
    <div className="space-y-5" data-testid="preview-profile">
      <div className="flex items-center gap-4">
        {identity.photoUrl
          ? <img src={identity.photoUrl} alt="" className="h-20 w-20 rounded-full border object-cover" data-testid="preview-profile-photo" />
          : <StaffAvatar name={fullName || identity.preferredName || "?"} size="lg" />}
        <h2 className="text-xl font-semibold">{copy.profileTitle}</h2>
      </div>
      <section className="rounded-xl border bg-card p-4">
        <h3 className="font-medium">{copy.identity}</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <PreviewField label={copy.name} value={fullName || identity.preferredName} />
          <PreviewField label={copy.preferredName} value={identity.preferredName} />
          <PreviewField label={copy.email} value={contact.email} />
          <PreviewField label={copy.phone} value={contact.phonePrimary} />
          <PreviewField label={copy.address} value={address} />
          <PreviewField label={copy.preferredContact} value={contact.preferredContactChannel} />
          <PreviewField label={copy.studentCode} value={identity.studentCode} />
          <PreviewField label={copy.timezone} value={contact.timezone} />
        </dl>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h3 className="font-medium">{copy.guardians}</h3>
        {profile.contacts.length ? (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {profile.contacts.map((person) => (
              <li key={person.id} className="rounded-lg border p-3">
                <p className="font-medium">{person.fullName}</p>
                <dl className="mt-2 grid gap-2 text-sm">
                  <PreviewField label={copy.relationship} value={person.relationship} />
                  <PreviewField label={copy.phone} value={person.phone} />
                  <PreviewField label={copy.email} value={person.email} />
                  <PreviewField label={copy.authority} value={person.authorityStatus} />
                  <PreviewField label={copy.scopes} value={person.effectiveScopes.join(", ")} />
                </dl>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-muted-foreground">{copy.noContacts}</p>}
      </section>
    </div>
  );
}

function PreviewField({ label, value }: { label: string; value: unknown }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{display(value)}</dd></div>;
}

function PreviewDocuments({ docs, loading, failed, copy, lang }: {
  docs: ReadonlyArray<Record<string, unknown>> | null;
  loading?: boolean;
  failed?: boolean;
  copy: (typeof PREVIEW_COPY)[Language];
  lang: Language;
}) {
  if (loading) return <p role="status" className="rounded-md border p-4 text-sm">{copy.loading}</p>;
  if (failed) return <p role="alert" className="rounded-md border p-4 text-sm">{copy.unavailable}</p>;
  return (
    <section className="space-y-3" data-testid="preview-documents">
      <h2 className="text-xl font-semibold">{copy.docsTitle}</h2>
      <p className="rounded-md border border-st-attention bg-st-attention-soft p-3 text-sm text-st-attention">{copy.fileContents}</p>
      {!docs?.length ? <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">{copy.noDocs}</p> : (
        <ul className="space-y-2">
          {docs.map((doc, index) => (
            <li key={String(doc.id ?? index)} className="rounded-lg border bg-card p-4">
              <p className="font-medium">{display(doc.file_name, display(doc.doc_type, "Document"))}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {display(doc.doc_type, "Document")} · {display(doc.status, "Status not recorded")}
                {typeof doc.created_at === "string" ? ` · ${new Date(doc.created_at).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US")}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function studentVisibleTicketThread(ticket: Pick<SupportTicketDetail, "ticket_comments" | "ticket_attachments">) {
  const comments = ticket.ticket_comments.filter((comment) => !comment.is_internal);
  const publicCommentIds = new Set(comments.map((comment) => comment.id));
  const attachments = ticket.ticket_attachments.filter((attachment) => !attachment.comment_id || publicCommentIds.has(attachment.comment_id));
  return { comments, attachments };
}

type PreviewTicketSummary = Pick<SupportTicketSummary, "id" | "subject" | "ticket_number" | "status">;

function PreviewSupport({ tickets, loading, failed, copy }: {
  tickets: readonly PreviewTicketSummary[];
  loading?: boolean;
  failed?: boolean;
  copy: (typeof PREVIEW_COPY)[Language];
}) {
  if (loading) return <p role="status" className="rounded-md border p-4 text-sm">{copy.loading}</p>;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedTicket = selectedId ?? tickets[0]?.id ?? null;
  const detailQuery = useTicket(selectedTicket);
  const ticket = (detailQuery.data as { ticket?: SupportTicketDetail } | undefined)?.ticket;
  const thread = ticket ? studentVisibleTicketThread(ticket) : null;
  if (failed) return <p role="alert" className="rounded-md border p-4 text-sm">{copy.unavailable}</p>;
  return (
    <section className="space-y-4" data-testid="preview-support">
      <h2 className="text-xl font-semibold">{copy.supportTitle}</h2>
      {!tickets.length ? <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">{copy.noTickets}</p> : (
        <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)]">
          <ul className="space-y-2">
            {tickets.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setSelectedId(item.id)} aria-pressed={selectedTicket === item.id} className={`w-full rounded-lg border p-3 text-left ${selectedTicket === item.id ? "border-student-gold bg-student-gold-soft/50" : "bg-card"}`}>
                  <span className="block font-medium">{item.subject}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{item.ticket_number} · {item.status}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="rounded-xl border bg-card p-4">
            {detailQuery.isLoading ? <p role="status" className="text-sm text-muted-foreground">{copy.loading}</p>
              : detailQuery.isError ? <p role="alert" className="text-sm">{copy.unavailable}</p>
                : ticket && thread ? (
                  <>
                    <h3 className="font-semibold">{ticket.subject}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{copy.conversation} · {ticket.status}</p>
                    {ticket.resolution_notes ? <p className="mt-3 rounded-md bg-muted p-3 text-sm">{ticket.resolution_notes}</p> : null}
                    <ul className="mt-4 space-y-3">
                      {thread.comments.map((comment) => <li key={comment.id} className="rounded-lg border p-3">
                        <p className="text-xs font-medium text-muted-foreground">{comment.author_name}</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm">{comment.content}</p>
                      </li>)}
                    </ul>
                    {!thread.comments.length ? <p className="mt-3 text-sm text-muted-foreground">{copy.noMessages}</p> : null}
                    <div className="mt-4">
                      <h4 className="text-sm font-medium">{copy.attachments}</h4>
                      {thread.attachments.length ? <ul className="mt-2 space-y-1 text-sm">{thread.attachments.map((file) => <li key={file.id}>{file.file_name}</li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">{copy.noAttachments}</p>}
                    </div>
                  </>
                ) : <p className="text-sm text-muted-foreground">{copy.selectTicket}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function PreviewBilling({ billing, loading, failed, copy, lang }: {
  billing?: StaffBillingView;
  loading?: boolean;
  failed?: boolean;
  copy: (typeof PREVIEW_COPY)[Language];
  lang: Language;
}) {
  if (loading) return <p role="status" className="rounded-md border p-4 text-sm">{copy.loading}</p>;
  if (failed) return <p role="alert" className="rounded-md border p-4 text-sm">{copy.unavailable}</p>;
  const student = billing?.student;
  if (!student || student.state !== "configured") return <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">{copy.noBilling}</p>;
  const money = (cents: number | null) => cents === null ? "—" : formatMoney(cents, student.currency, lang === "fr" ? "fr-FR" : "en-US");
  return (
    <section className="space-y-4" data-testid="preview-billing">
      <h2 className="text-xl font-semibold">{copy.billingTitle}</h2>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <PreviewField label={copy.obligation} value={money(student.netObligationCents)} />
        <PreviewField label={copy.paid} value={money(student.paidCents)} />
        <PreviewField label={copy.remaining} value={money(student.remainingCents)} />
        <PreviewField label={copy.nextDue} value={student.nextDue ? `${money(student.nextDue.amountCents)} · ${new Date(`${student.nextDue.dueDate}T00:00:00Z`).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US")}` : "—"} />
      </dl>
      <p className="text-xs text-muted-foreground">{copy.readonly}</p>
    </section>
  );
}

const noop = () => {};
/** The student's own assistant panel, rendered inert (fieldset disabled; contained so it cannot overlay the page). */
function PreviewAssistant({ data, lang, copy }: { data: ViewAsStudentResponse; lang: Language; copy: (typeof PREVIEW_COPY)[Language] }) {
  return (
    <div className="space-y-3" data-testid="preview-assistant">
      <p className="text-xs text-muted-foreground">{copy.aiNote}</p>
      <fieldset disabled aria-label={copy.ai} className="relative h-[620px] overflow-hidden rounded-xl border" style={{ transform: "translateZ(0)" }}>
        <AssistantPanelView
          language={lang}
          entries={[]}
          status={data.assistant ? { ...data.assistant, suggestions: [...data.assistant.suggestions] } : undefined}
          statusState={data.assistant ? "ready" : "error"}
          pending={false}
          failure={null}
          cooling={false}
          draft=""
          onDraft={noop}
          onSend={noop}
          onRetry={noop}
          onRetryStatus={noop}
          onClear={noop}
          onClose={noop}
        />
      </fieldset>
    </div>
  );
}

export function ViewAsStudentScreen({
  data,
  studentId,
  docs,
  profile,
  profileLoading,
  profileError,
  documentsLoading,
  documentsError,
  tickets = [],
  ticketsLoading,
  ticketsError,
  billing,
  billingLoading,
  billingError,
}: {
  data: ViewAsStudentResponse;
  studentId: string;
  docs: ReadonlyArray<{ status?: string | null; [key: string]: unknown }> | null;
  profile?: StudentProfileView;
  profileLoading?: boolean;
  profileError?: boolean;
  documentsError?: boolean;
  documentsLoading?: boolean;
  tickets?: readonly PreviewTicketSummary[];
  ticketsLoading?: boolean;
  ticketsError?: boolean;
  billing?: StaffBillingView;
  billingLoading?: boolean;
  billingError?: boolean;
}) {
  const [lang, setLang] = useState<Language>(data.student.preferredLanguage ?? "en");
  const copy = PREVIEW_COPY[lang];
  const ops: CockpitOps = {
    documents: docs ? { state: "ready", data: summarizeDocuments(docs) } : { state: "unavailable" },
    support: { state: "unavailable" },
    payments: { state: "unavailable" },
  };
  // The nested provider sets <html lang>; give it back to the owner's language on leave.
  useEffect(() => {
    const ownerLang = document.documentElement.lang;
    return () => {
      document.documentElement.lang = ownerLang;
    };
  }, []);
  const back = `/admin/students/${encodeURIComponent(studentId)}`;
  const saved = data.student.preferredLanguage;
  return (
    <div className="space-y-5" data-testid="view-as-student">
      <div role="status" className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-md border border-st-attention bg-st-attention-soft p-3 text-sm text-st-attention" data-testid="preview-banner">
        <p className="flex items-center gap-2">
          <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span><strong>{lang === "fr" ? "Aperçu en lecture seule" : "Read-only preview"}</strong> {lang === "fr" ? `du portail de ${data.student.displayName}. Aucune donnée n'est modifiée.` : `of ${data.student.displayName}'s portal. Nothing here changes the student's records.`}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label={copy.languageLabel} className="inline-flex rounded-md border">
            {LANGUAGES.map((l) => (
              <button key={l.code} type="button" role="radio" aria-checked={lang === l.code} onClick={() => setLang(l.code)} className={`min-h-10 px-3 text-xs font-semibold ${lang === l.code ? "bg-foreground text-background" : ""}`} data-testid={`preview-language-${l.code}`}>
                {l.short}
              </button>
            ))}
          </div>
          <Link href={back} className="inline-flex min-h-10 items-center gap-2 rounded-md border bg-background px-3 font-medium text-foreground" data-testid="link-exit-preview">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />{copy.returnWorkspace}
          </Link>
        </div>
      </div>

      <section aria-labelledby="preview-summary-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 id="preview-summary-heading" className="text-2xl font-semibold tracking-tight">{lang === "fr" ? "Résumé de progression" : "Progress summary"}</h1>
          <p className="text-sm text-muted-foreground" data-testid="preview-language-saved">
            {copy.chosenLanguage}: {saved ? LANGUAGES.find((l) => l.code === saved)?.label : copy.defaultLanguage}
          </p>
        </div>
        <StaffProgressSummary data={data} language={lang} />
        <p className="text-xs text-muted-foreground">{copy.sourceNote}</p>
      </section>

      <I18nProvider key={lang} initialLanguage={lang}>
        <Tabs defaultValue="dashboard" className="space-y-4">
          <TabsList className="flex h-auto flex-wrap justify-start" aria-label={lang === "fr" ? "Pages du portail étudiant" : "Student portal pages"}>
            <TabsTrigger value="dashboard">{copy.dashboard}</TabsTrigger>
            <TabsTrigger value="high-school">{copy.highSchool}</TabsTrigger>
            <TabsTrigger value="profile">{copy.profile}</TabsTrigger>
            <TabsTrigger value="documents">{copy.documents}</TabsTrigger>
            <TabsTrigger value="support">{copy.support}</TabsTrigger>
            <TabsTrigger value="billing">{copy.billing}</TabsTrigger>
            <TabsTrigger value="ai">{copy.ai}</TabsTrigger>
          </TabsList>
          {/* onClickCapture: in-preview links never navigate; buttons that only toggle the view still work. */}
          <div onClickCapture={blockNavigation} lang={lang} data-testid="preview-surface">
            <TabsContent value="dashboard" className="mt-0"><PreviewDashboard data={data} ops={ops} /></TabsContent>
            <TabsContent value="high-school" className="mt-0">
              {data.highSchool ? <HighSchoolPageView view={data.highSchool} /> : <StudentSurface><HsNoEnrollment /></StudentSurface>}
            </TabsContent>
            <TabsContent value="profile" className="mt-0"><PreviewProfile profile={profile} loading={profileLoading} failed={profileError} copy={copy} /><p className="mt-4 text-xs text-muted-foreground">{copy.readonly}</p></TabsContent>
            <TabsContent value="documents" className="mt-0"><PreviewDocuments docs={docs as ReadonlyArray<Record<string, unknown>> | null} loading={documentsLoading} failed={documentsError} copy={copy} lang={lang} /></TabsContent>
            <TabsContent value="support" className="mt-0"><PreviewSupport tickets={tickets} loading={ticketsLoading} failed={ticketsError} copy={copy} /><p className="mt-4 text-xs text-muted-foreground">{copy.readonly}</p></TabsContent>
            <TabsContent value="ai" className="mt-0"><PreviewAssistant data={data} lang={lang} copy={copy} /></TabsContent>
            <TabsContent value="billing" className="mt-0"><PreviewBilling billing={billing} loading={billingLoading} failed={billingError} copy={copy} lang={lang} /></TabsContent>
          </div>
        </Tabs>
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{copy.limitations}</p>
      </I18nProvider>
    </div>
  );
}

export default function AdminViewAsStudent() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const query = useQuery<ViewAsStudentResponse>({
    queryKey: ["admin-view-as-student", studentId],
    queryFn: () => apiRequest<ViewAsStudentResponse>(viewAsStudentPath(studentId)),
    enabled: !!studentId,
    staleTime: 0,
  });
  const documents = useDocuments(studentId || null);
  const profileQuery = useQuery<StudentProfileView>({
    queryKey: STAFF_PROFILE_QUERY_KEY(studentId),
    queryFn: () => apiRequest<StudentProfileView>(STAFF_PROFILE_PATHS.profile(studentId)),
    enabled: !!studentId,
    retry: false,
  });
  const ticketsQuery = useTickets({ studentId });
  const billingQuery = useStaffBilling(studentId || null);
  if (query.isLoading) return <div role="status" className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading student preview…</div>;
  if (query.isError || !query.data) {
    return (
      <div role="alert" className="mx-auto max-w-md rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
        <AlertCircle className="mx-auto mb-2 h-6 w-6 text-destructive" aria-hidden="true" />
        <p className="font-medium">The student preview could not be loaded.</p>
        <Button className="mt-3" variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Retry</Button>
      </div>
    );
  }
  return <ViewAsStudentScreen
    data={query.data}
    studentId={studentId}
    docs={documents.error ? null : (documents.data ?? null) as ReadonlyArray<{ status?: string | null; [key: string]: unknown }> | null}
    profile={profileQuery.data}
    profileLoading={profileQuery.isLoading}
    profileError={profileQuery.isError}
    documentsLoading={documents.isLoading}
    documentsError={documents.isError}
    tickets={ticketsQuery.data?.tickets}
    ticketsLoading={ticketsQuery.isLoading}
    ticketsError={ticketsQuery.isError}
    billing={billingQuery.data}
    billingLoading={billingQuery.isLoading}
    billingError={billingQuery.isError}
  />;
}
