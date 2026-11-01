/**
 * S26 — the signed-in student's OWN record for the Lumière assistant.
 *
 * Scope: only rows owned by the authenticated student (resolved from the session user id, never from
 * request input). Minimal: no names, contact data, guardian details, staff notes, staff-only documents,
 * internal ticket notes or ledger notes. Records are numbered [S1]… so answers can cite them.
 *
 * Used two ways: (1) live mode — appended to the minor-safe prompt as the ONLY personal facts the model
 * may use; (2) no live model — answerFromRecord() returns deterministic, labelled "system facts" for
 * common questions (credits, electives, documents, tickets, balance, timeline, next task, elective
 * changes). Nothing here can change a record.
 */
import { formatHalfUnits, type StudentHighSchoolView } from "@shared/high-school-contract";
import type { StudentBillingView } from "@shared/billing-contract";
import type { StudentJourneyView } from "@shared/s27-contract";
import type { StudentRoadmapView } from "@shared/student-roadmap-contract";
import type { StudentDegreeProgressView } from "@shared/student-degree-progress-view";
import { composeDegreeRecords } from "./degree-record";

export type Lang = "en" | "fr";
export interface StudentRecordInput {
  readonly highSchool: StudentHighSchoolView | null;
  readonly documents: readonly { doc_type: string; status: string; student_message?: string | null; rejection_reason?: string | null; uploaded_at?: string | null }[];
  readonly tickets: readonly { subject: string; status: string; ticket_number?: string | null; updated_at?: string | null; last_staff_reply_at?: string | null }[];
  readonly billing: StudentBillingView | null;
  /** S27: agreement deadlines, checkpoints, sessions and logged pace (student-visible fields only). */
  readonly journey?: StudentJourneyView | null;
  /** S32-A (F03): the student's own published roadmap and canonical degree progress (degree students only). */
  readonly degreeRoadmap?: StudentRoadmapView | null;
  readonly degreeProgress?: StudentDegreeProgressView | null;
  readonly today: string;
}
/**
 * `label` is the stable English key (used for intent mapping); `title` is the same label in the language the record was
 * composed in (shown to the student); `text` is written in that language too.
 */
export interface StudentRecord { readonly ref: string; readonly label: string; readonly path: string; readonly text: string; readonly title?: string }

const clip = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const isProposed = (t: string) => /TEST ONLY|APPROVAL PENDING|AWAITING SCHOOL|PROPOSED/i.test(t);
const courseName = (t: string) => t.split(" — ")[0];

const TITLE_FR: Record<string, string> = {
  Credits: "Crédits", Electives: "Options", "Next tasks": "Prochaines tâches", "Current courses": "Cours en cours", Timeline: "Échéancier",
  Graduation: "Diplomation", Documents: "Documents", Support: "Assistance", Billing: "Facturation", "Program agreement": "Entente du programme",
  Goal: "Objectif", Checkpoints: "Jalons", Pace: "Rythme", "Orientation sessions": "Séances d’orientation",
  "Degree credits": "Crédits du diplôme", "Degree requirements": "Exigences du diplôme",
};
const PACE_FR: Record<string, string> = { on_track: "dans les temps", behind: "en retard", ahead: "en avance", not_configured: "non configuré" };
const GRAD_FR: Record<string, string> = { in_progress: "en cours", eligibility_confirmed: "admissibilité confirmée", diploma_conferred: "diplôme décerné" };
const DOC_FR: Record<string, string> = {
  id_gov: "pièce d’identité", hs_diploma: "diplôme d’études secondaires", hs_transcript: "relevé de notes du secondaire", degree_certificate: "certificat de diplôme",
  college_transcript: "relevé de notes collégial", foreign_eval: "évaluation de diplôme étranger", english_cert: "attestation d’anglais", residency_doc: "preuve de résidence",
  consent_form: "formulaire de consentement", other: "autre document",
};
const TICKET_FR: Record<string, string> = { open: "reçue", in_progress: "avec votre conseiller", waiting_on_student: "en attente de votre réponse", resolved: "résolue", closed: "fermée" };
const CHECKPOINT_FR: Record<string, string> = {
  file_opened: "Dossier ouvert", program_activated: "Programme activé", kickoff_call: "Appel de lancement", language_test: "Test de langue",
  midpoint_check: "Bilan à mi-parcours", readiness_check: "Bilan de préparation au diplôme", closing: "Clôture : relevé de notes et diplôme",
};
const DEADLINE_FR: Record<string, string> = { language_test: "Test de langue", prior_schooling_proof: "Preuve de scolarité antérieure" };

export function composeStudentRecords(input: StudentRecordInput, lang: Lang = "en"): StudentRecord[] {
  const fr = lang === "fr";
  const t = (en: string, frText: string) => (fr ? frText : en);
  const n = (s: string) => (fr ? s.replace(".", ",") : s);
  const money = (cents: number, cur: string) => `${(cents / 100).toLocaleString(fr ? "fr-CA" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
  const out: StudentRecord[] = [];
  const push = (r: Omit<StudentRecord, "ref" | "title">) => out.push({ ...r, ref: `S${out.length + 1}`, title: fr ? TITLE_FR[r.label] ?? r.label : r.label });
  const hs = input.highSchool;
  if (hs) {
    const c = hs.credits;
    const H = (x: number) => n(formatHalfUnits(x));
    push({ label: "Credits", path: "/high-school", text: t(
      `Program requires ${H(c.requiredHalfUnits)} credits (core ${H(c.core.requiredHalfUnits)}, electives ${H(c.elective.requiredHalfUnits)}). Officially earned (confirmed by the school): ${H(c.earnedHalfUnits)}. Remaining: ${H(c.remainingHalfUnits)}. Reported by you and waiting for the school: ${H(c.awaitingConfirmationHalfUnits)}.`,
      `Le programme exige ${H(c.requiredHalfUnits)} crédits (matières obligatoires ${H(c.core.requiredHalfUnits)}, options ${H(c.elective.requiredHalfUnits)}). Crédits officiellement obtenus (confirmés par l’école) : ${H(c.earnedHalfUnits)}. Restants : ${H(c.remainingHalfUnits)}. Déclarés par vous et en attente de l’école : ${H(c.awaitingConfirmationHalfUnits)}.`) });
    const courses = hs.subjects.flatMap((s) => s.courses);
    const electives = courses.filter((x) => x.kind === "elective");
    if (electives.length) push({ label: "Electives", path: "/high-school", text: t(
      `Your planned electives: ${electives.map((e) => `${courseName(e.title)} (${H(e.halfUnits)} credit${isProposed(e.title) ? ", proposed — the school has not approved it yet" : ""})`).join("; ")}.`,
      `Vos options prévues : ${electives.map((e) => `${courseName(e.title)} (${H(e.halfUnits)} crédit${isProposed(e.title) ? ", proposée — l’école ne l’a pas encore approuvée" : ""})`).join(" ; ")}.`) });
    const open = courses.flatMap((x) => x.tasks.filter((k) => k.status === "not_started" || k.status === "in_progress" || k.status === "retake_required").map((k) => ({ ...k, course: courseName(x.title) })));
    const dated = open.filter((k) => k.dueDate).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    const next = (dated.length ? dated : open).slice(0, 4);
    if (next.length) push({ label: "Next tasks", path: "/high-school", text: t(
      `Your next open tasks: ${next.map((k) => `${clip(k.title, 90)} — ${k.course}${k.dueDate ? `, planned by ${k.dueDate}` : ""}${k.overdue ? " (overdue)" : ""}`).join("; ")}.`,
      `Vos prochaines tâches ouvertes : ${next.map((k) => `${clip(k.title, 90)} — ${k.course}${k.dueDate ? `, prévue d’ici le ${k.dueDate}` : ""}${k.overdue ? " (en retard)" : ""}`).join(" ; ")}.`) });
    const current = courses.filter((x) => x.status === "in_progress" || x.status === "awaiting_school").map((x) => `${courseName(x.title)} (${x.status === "in_progress" ? t("in progress", "en cours") : t("waiting for the school's result", "en attente du résultat de l’école")})`);
    if (current.length) push({ label: "Current courses", path: "/high-school", text: t(`Courses underway: ${current.join("; ")}.`, `Cours en cours : ${current.join(" ; ")}.`) });
    const p = hs.pace;
    const milestones = hs.milestones ?? [];
    const phase = courses.find((x) => /accelerated weeks/i.test(x.tasks[0]?.title ?? ""));
    push({ label: "Timeline", path: "/high-school", text: phase
      ? t("Your plan follows a 16-week accelerated reference counted from the actual start of your program (3 credits planned by week 4, 8 by week 8, 16 by week 13, 21 by week 16; 4 to 6 months is the broader indicative range). These are planning targets, not school deadlines or guarantees.",
          "Votre plan suit une référence accélérée de 16 semaines comptées à partir du début réel de votre programme (3 crédits prévus d’ici la semaine 4, 8 d’ici la semaine 8, 16 d’ici la semaine 13, 21 d’ici la semaine 16; de 4 à 6 mois est la fourchette indicative plus large). Ce sont des cibles de planification, pas des échéances de l’école ni des garanties.")
      : t(`Your plan started ${hs.enrollment.startedOn ?? "(start not set)"} with a target of ${hs.enrollment.targetCompletionDate ?? "(not set)"} (a target, not a guarantee). Pace: ${p.status.replace("_", " ")}. ${p.nextMilestone ? `Next milestone: ${formatHalfUnits(p.nextMilestone.cumulativeHalfUnits)} cumulative credit(s) planned by ${p.nextMilestone.month}.` : ""}${milestones.length ? ` ${milestones.length} monthly milestones are planned.` : ""}`,
          `Votre plan a commencé le ${hs.enrollment.startedOn ?? "(début non précisé)"} avec une cible au ${hs.enrollment.targetCompletionDate ?? "(non précisée)"} (une cible, pas une garantie). Rythme : ${PACE_FR[p.status] ?? p.status.replace("_", " ")}. ${p.nextMilestone ? `Prochaine étape : ${H(p.nextMilestone.cumulativeHalfUnits)} crédit(s) cumulatif(s) prévu(s) d’ici ${p.nextMilestone.month}.` : ""}${milestones.length ? ` ${milestones.length} jalons mensuels sont prévus.` : ""}`) });
    const g = hs.graduation;
    push({ label: "Graduation", path: "/high-school", text: t(
      `Graduation status: ${g.status.replace(/_/g, " ")}. Credits requirement met: ${g.creditsSatisfied ? "yes" : "no"}. Only the school confirms eligibility and issues the diploma.`,
      `Statut de diplomation : ${GRAD_FR[g.status] ?? g.status.replace(/_/g, " ")}. Exigence de crédits remplie : ${g.creditsSatisfied ? "oui" : "non"}. Seule l’école confirme l’admissibilité et délivre le diplôme.`) });
  }
  const docs = input.documents;
  const needsAction = docs.filter((d) => d.status === "rejected" || d.status === "resubmit_requested");
  const pending = docs.filter((d) => d.status === "pending");
  const docName = (d: { doc_type: string }) => (fr ? DOC_FR[d.doc_type] ?? d.doc_type.replace(/_/g, " ") : d.doc_type.replace(/_/g, " "));
  const needList = needsAction.map((d) => `${docName(d)}${d.student_message || d.rejection_reason ? `: "${clip(d.student_message ?? d.rejection_reason, 120)}"` : ""}`).join("; ");
  push({ label: "Documents", path: "/documents", text: docs.length === 0 ? t("You have no documents on file yet.", "Vous n’avez encore aucun document au dossier.") : t(
    `Documents: ${docs.length} on file; ${pending.length} waiting for Lumière's review; ${needsAction.length} need a new upload${needsAction.length ? ` (${needList})` : ""}.`,
    `Documents : ${docs.length} au dossier; ${pending.length} en attente de vérification par Lumière; ${needsAction.length} à téléverser de nouveau${needsAction.length ? ` (${needList})` : ""}.`) });
  const tk = input.tickets;
  push({ label: "Support", path: "/support", text: tk.length === 0 ? t("You have no support requests.", "Vous n’avez aucune demande d’assistance.") : t(
    `Support requests: ${tk.slice(0, 5).map((x) => `"${clip(x.subject, 80)}" is ${x.status.replace(/_/g, " ")}${x.status === "waiting_on_student" ? " (Lumière replied and is waiting for you)" : x.status === "open" ? " (waiting for Lumière)" : ""}`).join("; ")}.`,
    `Demandes d’assistance : ${tk.slice(0, 5).map((x) => `« ${clip(x.subject, 80)} » est ${TICKET_FR[x.status] ?? x.status.replace(/_/g, " ")}${x.status === "waiting_on_student" ? " (Lumière a répondu et attend votre réponse)" : x.status === "open" ? " (en attente de Lumière)" : ""}`).join(" ; ")}.`) });
  const b = input.billing;
  if (b && b.state === "configured") {
    push({ label: "Billing", path: "/billing", text: t(
      `Agreed amount ${money(b.agreedCents, b.currency)}${b.discountCents ? `, adjustment −${money(b.discountCents, b.currency)}` : ""}. Paid (confirmed by Lumière): ${money(b.paidCents, b.currency)}. Remaining: ${money(b.remainingCents, b.currency)}.${b.nextDue ? ` Next payment: ${money(b.nextDue.amountCents, b.currency)} due ${b.nextDue.dueDate}.` : ""}`,
      `Montant convenu : ${money(b.agreedCents, b.currency)}${b.discountCents ? `, ajustement −${money(b.discountCents, b.currency)}` : ""}. Payé (confirmé par Lumière) : ${money(b.paidCents, b.currency)}. Solde restant : ${money(b.remainingCents, b.currency)}.${b.nextDue ? ` Prochain paiement : ${money(b.nextDue.amountCents, b.currency)}, dû le ${b.nextDue.dueDate}.` : ""}`) });
  } else if (b) {
    push({ label: "Billing", path: "/billing", text: t("Billing has not been set up on your account yet.", "La facturation n’est pas encore configurée sur votre compte.") });
  }
  composeJourneyRecords(input.journey ?? null, push, lang);
  // S32-A (F03): degree students. Appended last so the S1.. refs of the records above stay stable.
  if (!hs) for (const d of composeDegreeRecords(input.degreeRoadmap ?? null, input.degreeProgress ?? null, lang, input.today)) push({ label: d.label, path: d.path, text: d.text });
  return out;
}

/** True when the records describe a bachelor's (degree) student. */
export const hasDegreeRecords = (records: readonly StudentRecord[]) => records.some((r) => r.label === "Degree credits" || r.label === "Degree requirements");
/** True when the records describe a high-school student. */
export const hasHighSchoolRecords = (records: readonly StudentRecord[]) => records.some((r) => r.label === "Credits" || r.label === "Graduation");

const listOf = (xs: readonly string[], none: string) => (xs.length ? xs.join(", ") : none);
const n2 = (x: number) => String(x).replace(".", ",");

function ruleFr(rule: string): string {
  const m = /^(\d+) days? after (signing|activation)$/i.exec(rule.trim());
  return m ? `${m[1]} jours après ${/sign/i.test(m[2]) ? "la signature" : "l’activation"}` : rule;
}

/** S27 records: student-safe wording, no internal notes, no staff fields. Appended after the S1.. records so earlier refs stay stable. */
function composeJourneyRecords(j: StudentJourneyView | null, push: (r: Omit<StudentRecord, "ref" | "title">) => void, lang: Lang): void {
  if (!j) return;
  const fr = lang === "fr";
  const t = (en: string, frText: string) => (fr ? frText : en);
  const a = j.agreement;
  if (a) {
    const dl = a.deadlines.map((d) => {
      const label = fr ? DEADLINE_FR[d.key] ?? d.label : d.label;
      const rule = fr ? ruleFr(d.rule) : d.rule;
      const state = d.status === "done" ? t(`done${d.doneOn ? ` on ${d.doneOn}` : ""}`, `fait${d.doneOn ? ` le ${d.doneOn}` : ""}`)
        : d.status === "waived" ? t("waived", "dispensé")
        : d.dueOn ? t(`due ${d.dueOn}${d.daysLeft !== null ? (d.daysLeft < 0 ? `, ${-d.daysLeft} day(s) overdue` : `, ${d.daysLeft} day(s) left`) : ""}`,
                      `à remettre le ${d.dueOn}${d.daysLeft !== null ? (d.daysLeft < 0 ? `, en retard de ${-d.daysLeft} jour(s)` : `, ${d.daysLeft} jour(s) restant(s)`) : ""}`)
        : t("date not set yet", "date non fixée pour l’instant");
      return `${label} (${rule}): ${state}${d.detail ? `; ${d.detail}` : ""}`;
    });
    push({ label: "Program agreement", path: "/journey", text: t(
      `Your program agreement${a.signedOn ? ` was signed on ${a.signedOn}` : " is not signed yet"}${a.activatedOn ? ` and activated on ${a.activatedOn}` : ""}. Lumière support ${a.supportEndsOn ? `runs until ${a.supportEndsOn} (${a.supportMonthsLeft} month(s) left)` : `lasts ${a.supportMonths} months from activation`}; school platform access lasts up to ${a.accessMonths} months from activation${a.accessEndsOn ? ` (until ${a.accessEndsOn})` : ""}. Deadlines: ${dl.join("; ")}.`,
      `Votre entente de programme${a.signedOn ? ` a été signée le ${a.signedOn}` : " n’est pas encore signée"}${a.activatedOn ? ` et activée le ${a.activatedOn}` : ""}. L’accompagnement Lumière ${a.supportEndsOn ? `se poursuit jusqu’au ${a.supportEndsOn} (${a.supportMonthsLeft} mois restant(s))` : `dure ${a.supportMonths} mois à partir de l’activation`}; l’accès à la plateforme de l’école dure jusqu’à ${a.accessMonths} mois à partir de l’activation${a.accessEndsOn ? ` (jusqu’au ${a.accessEndsOn})` : ""}. Échéances : ${dl.join(" ; ")}.`) });
    if (a.goal) push({ label: "Goal", path: "/journey", text: t(
      `Your post-secondary goal: ${clip(a.goal.field, 80)} in ${clip(a.goal.region, 60)}${a.goal.targets.length ? `. Target programs: ${a.goal.targets.slice(0, 4).map((x) => `${clip(x.name, 80)} (${clip(x.city, 40)}, ${clip(x.track, 40)})`).join("; ")}` : ""}.`,
      `Votre objectif postsecondaire : ${clip(a.goal.field, 80)} — ${clip(a.goal.region, 60)}${a.goal.targets.length ? `. Programmes visés : ${a.goal.targets.slice(0, 4).map((x) => `${clip(x.name, 80)} (${clip(x.city, 40)}, ${clip(x.track, 40)})`).join(" ; ")}` : ""}.`) });
  }
  const label = (c: { key: string; label: string }) => (fr ? CHECKPOINT_FR[c.key] ?? c.label : c.label);
  const done = j.checkpoints.filter((c) => c.status === "done").map(label);
  const next = j.checkpoints.find((c) => c.status === "next");
  const upcoming = j.checkpoints.filter((c) => c.status === "upcoming").map(label);
  const none = t("none", "aucun");
  push({ label: "Checkpoints", path: "/journey", text: t(
    `Your Lumière checkpoints. Done: ${listOf(done, none)}. Next: ${next ? `${label(next)}${next.plannedOn ? `, planned ${next.plannedOn}` : ""}` : "none"}. Coming up: ${listOf(upcoming, none)}.`,
    `Vos jalons Lumière. Terminés : ${listOf(done, none)}. Prochain : ${next ? `${label(next)}${next.plannedOn ? `, prévu le ${next.plannedOn}` : ""}` : "aucun"}. À venir : ${listOf(upcoming, none)}.`) });
  const p = j.pace;
  if (p) {
    const exams = t(`Exams logged this week: ${p.examsThisWeek}${p.weeklyExamLimit ? ` of ${p.weeklyExamLimit}` : ""}.`, `Examens consignés cette semaine : ${p.examsThisWeek}${p.weeklyExamLimit ? ` sur ${p.weeklyExamLimit}` : ""}.`);
    push({ label: "Pace", path: "/journey", text: p.itemsLogged28d === 0
      ? t(`You have not logged any work in the last 28 days${p.lastLoggedOn ? ` (last logged ${p.lastLoggedOn})` : ""}. ${exams}`, `Vous n’avez consigné aucun travail au cours des 28 derniers jours${p.lastLoggedOn ? ` (dernière consignation le ${p.lastLoggedOn})` : ""}. ${exams}`)
      : t(`From the work you logged in the last 28 days (${p.itemsLogged28d} item(s), last on ${p.lastLoggedOn}): about ${p.creditsPerWeek} credit(s) per week${p.estimatedFinishOn ? `, which would reach the remaining credits around ${p.estimatedFinishOn}` : ""}. This is an estimate from your own reports; credits count only once the school confirms them. ${p.stale ? "Nothing was logged in the last 7 days. " : ""}${exams}`,
          `D’après le travail consigné au cours des 28 derniers jours (${p.itemsLogged28d} élément(s), dernier le ${p.lastLoggedOn}) : environ ${n2(p.creditsPerWeek ?? 0)} crédit(s) par semaine${p.estimatedFinishOn ? `, ce qui atteindrait les crédits restants vers le ${p.estimatedFinishOn}` : ""}. C’est une estimation fondée sur vos propres déclarations; les crédits ne comptent qu’une fois confirmés par l’école. ${p.stale ? "Rien n’a été consigné au cours des 7 derniers jours. " : ""}${exams}`) });
  }
  if (a) {
    const upcomingSessions = j.sessions.filter((s) => s.status === "requested" || s.status === "confirmed");
    const stFr: Record<string, string> = { requested: "demandée", confirmed: "confirmée" };
    push({ label: "Orientation sessions", path: "/journey", text: t(
      `Orientation sessions: ${a.orientationSessionsUsed} of ${a.orientationSessionsIncluded} used.${upcomingSessions.length ? ` Upcoming: ${upcomingSessions.slice(0, 3).map((s) => `${s.slotAt.slice(0, 16).replace("T", " ")} (${s.status})`).join("; ")}.` : ""}${a.orientationSessionsUsed >= a.orientationSessionsIncluded ? " No sessions left." : ""}`,
      `Séances d’orientation : ${a.orientationSessionsUsed} sur ${a.orientationSessionsIncluded} utilisée(s).${upcomingSessions.length ? ` À venir : ${upcomingSessions.slice(0, 3).map((s) => `${s.slotAt.slice(0, 16).replace("T", " ")} (${stFr[s.status] ?? s.status})`).join(" ; ")}.` : ""}${a.orientationSessionsUsed >= a.orientationSessionsIncluded ? " Il ne reste aucune séance." : ""}`) });
  }
}

type Intent = "credits" | "electives" | "elective_change" | "documents" | "support" | "billing" | "timeline" | "next" | "school_approval" | "program" | "urgent" | "track" | "graduation" | "roadmap";
/**
 * Matched against the FOLDED message (lower case, accents removed, ’ -> '). `not` removes a false positive
 * ("Which documents do I owe?" is Documents, not Billing).
 */
const INTENTS: Array<[Intent, RegExp, RegExp?]> = [
  ["elective_change", /(switch|chang|swap|replac|remplac|modifi).*(elective|option)|(elective|option).*(switch|chang|swap|replac|remplac|modifi)/],
  ["school_approval", /(school|ecole).*(approv|accept)|(approv|accept).*(school|ecole)/],
  ["electives", /elective|options? (choisie|propos|prevue)|mes options|quelles options/],
  ["credits", /credit|official|officiel|still need|me faut|il me reste|me manque|remaining|restant|earned|acquis|encore ouvert|prevus/],
  ["graduation", /graduat|diplom|residen|requirement|exigence|upper.?level|finish my degree|terminer mon|obtenir mon/],
  ["documents", /document|upload|televers|piece|papier|fournir/],
  ["support", /ticket|support|reply|repon|assistance|soutien|demande|help request/],
  ["billing", /\bpay|paid|balance|tuition|\bfees?\b|solde|paiement|frais|facture|invoice|billing|facturation|amount due|montant/],
  ["billing", /\bowe\b|\bowing\b|combien (je )?dois|je dois|dois-je payer|devoir de l'argent|ce que je dois/, /document|fournir/],
  ["program", /language test|test de langue|checkpoint|etape|orientation|session|pace|rythme|goal|objectif|universit|accompagnement|how long.*support|prior schooling|scolarite|agreement|contrat|entente/],
  ["timeline", /timeline|when.*finish|deadline|date|calendrier|echeance|fin de|based on|base sur|finish|terminer|schedule|horaire/],
  ["next", /what should i (study|do)|today|next|quoi (etudier|faire)|aujourd|prochain|commencer|(next|prochain|when|quand|upcoming|a venir).*exam|exam.*(when|quand|date|next|prochain)|^\W*exam(en)?s?\W*$|to do|a faire|\btasks?\b|\btaches?\b|devoirs?/],
  ["urgent", /urgent|priorit|most important|plus important|asap|right now|en premier/],
  ["track", /on track|behind|ahead|dans les temps|en retard|a jour|en avance|how am i doing|ou en suis|ou j'en suis|avancement|progress/],
  ["roadmap", /feuille de route|roadmap|my plan|mon plan|mon parcours|my pathway/],
];
const MAP: Record<Intent, string[]> = {
  credits: ["Credits", "Degree credits", "Graduation"], graduation: ["Graduation", "Degree requirements", "Degree credits"],
  electives: ["Electives"], elective_change: ["Electives"], school_approval: ["Electives"],
  documents: ["Documents"], support: ["Support"], billing: ["Billing"], timeline: ["Timeline", "Degree credits"],
  program: ["Program agreement", "Checkpoints", "Pace", "Goal", "Orientation sessions"], next: ["Next tasks", "Current courses"],
  urgent: ["Next tasks", "Program agreement"], track: ["Timeline", "Pace", "Degree credits"],
  roadmap: ["Timeline", "Credits", "Degree credits", "Current courses", "Next tasks"],
};
const LEAD = {
  en: { head: "From your record (system facts, not AI):", change: "On your High School page, find the elective in your course list and choose \"Request a change\". Lumière reviews it, the school must accept the substitute, and only then is a new version of your roadmap published. You cannot change the roadmap yourself, and nothing changes until it is approved.", approval: "If the school has not approved an elective, it stays marked as proposed and earns no credit; Lumière will tell you and help choose another option so you still reach 5 elective credits." },
  fr: { head: "D’après votre dossier (faits du système, pas une IA) :", change: "Sur votre page Études secondaires, repérez l’option dans la liste de vos cours et choisissez « Demander un changement ». Lumière l’examine, l’école doit accepter le remplacement, puis une nouvelle version de votre feuille de route est publiée. Vous ne pouvez pas modifier la feuille de route vous-même, et rien ne change avant l’approbation.", approval: "Si l’école n’a pas approuvé une option, elle reste « proposée » et ne donne aucun crédit; Lumière vous en informe et vous aide à en choisir une autre pour atteindre 5 crédits d’options." },
} as const;

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'");

/** Deterministic, labelled facts for common personal questions; null when no intent matches. */
export function answerFromRecord(message: string, lang: Lang, records: readonly StudentRecord[]): { text: string; cited: StudentRecord[] } | null {
  const m = fold(message);
  const hits = [...new Set(INTENTS.filter(([, re, not]) => re.test(m) && !(not && not.test(m))).map(([i]) => i))];
  if (!hits.length) return null;
  const labels = [...new Set(hits.flatMap((i) => MAP[i]))];
  const cited = records.filter((r) => labels.includes(r.label));
  const extra: string[] = [];
  if (hits.includes("elective_change")) extra.push(LEAD[lang].change);
  if (hits.includes("school_approval")) extra.push(LEAD[lang].approval);
  if (!cited.length && !extra.length) return null;
  return { text: [LEAD[lang].head, ...cited.map((r) => `• ${r.text} [${r.ref}]`), ...extra].join("\n"), cited };
}

export async function loadOwnStudentRecord(userId: string, lang: Lang = "en"): Promise<StudentRecord[]> {
  const { getStudentByUserId } = await import("../student-service");
  const student = await getStudentByUserId(userId);
  if (!student) return [];
  const today = new Date().toISOString().slice(0, 10);
  let highSchool: StudentHighSchoolView | null = null;
  try {
    const { defaultHighSchoolService: hs } = await import("../high-school-service.default");
    highSchool = await hs.getStudentView(student.id);
  } catch { highSchool = null; }
  let documents: StudentRecordInput["documents"] = [];
  try {
    const { listStudentDocuments } = await import("../document-service");
    documents = (await listStudentDocuments(student.id)).filter((d: any) => d.doc_type !== "chat_attachment" && d.visibility !== "staff_only");
  } catch { documents = []; }
  let tickets: StudentRecordInput["tickets"] = [];
  try {
    const { supabaseAdmin } = await import("../../lib/supabase");
    const { data } = await supabaseAdmin.from("support_tickets").select("subject,status,ticket_number,updated_at").eq("reporter_id", userId).order("updated_at", { ascending: false }).limit(5);
    tickets = data ?? [];
  } catch { tickets = []; }
  let billing: StudentBillingView | null = null;
  try {
    const { defaultBillingService } = await import("../billing-service.default");
    billing = await defaultBillingService.getStudentView(student.id);
  } catch { billing = null; }
  let journey: StudentJourneyView | null = null;
  try {
    const { defaultProgramJourneyService } = await import("../program-journey/service.default");
    journey = await defaultProgramJourneyService.getJourney(student.id);
  } catch { journey = null; }
  // S32-A (F03): the student's own published degree roadmap and canonical degree progress (same loaders the student
  // pages use; the studentId is the one resolved from the session user above, never from request input).
  let degreeRoadmap: StudentRoadmapView | null = null;
  try {
    const { defaultStudentRoadmapService } = await import("../student-roadmap-service.default");
    degreeRoadmap = await defaultStudentRoadmapService.getStudentView(student.id);
  } catch { degreeRoadmap = null; }
  let degreeProgress: StudentDegreeProgressView | null = null;
  try {
    const { loadStudentDegreeProgressView } = await import("../../routes/student-degree-progress");
    degreeProgress = await loadStudentDegreeProgressView(student.id);
  } catch { degreeProgress = null; }
  return composeStudentRecords({ highSchool, documents, tickets, billing, journey, degreeRoadmap, degreeProgress, today }, lang);
}
