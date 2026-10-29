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

export type Lang = "en" | "fr";
export interface StudentRecordInput {
  readonly highSchool: StudentHighSchoolView | null;
  readonly documents: readonly { doc_type: string; status: string; student_message?: string | null; rejection_reason?: string | null; uploaded_at?: string | null }[];
  readonly tickets: readonly { subject: string; status: string; ticket_number?: string | null; updated_at?: string | null; last_staff_reply_at?: string | null }[];
  readonly billing: StudentBillingView | null;
  readonly today: string;
}
export interface StudentRecord { readonly ref: string; readonly label: string; readonly path: string; readonly text: string }

const clip = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const money = (cents: number, cur: string) => `${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const isProposed = (t: string) => /TEST ONLY|APPROVAL PENDING|AWAITING SCHOOL|PROPOSED/i.test(t);
const courseName = (t: string) => t.split(" — ")[0];

export function composeStudentRecords(input: StudentRecordInput): StudentRecord[] {
  const out: StudentRecord[] = [];
  const push = (r: Omit<StudentRecord, "ref">) => out.push({ ...r, ref: `S${out.length + 1}` });
  const hs = input.highSchool;
  if (hs) {
    const c = hs.credits;
    push({ label: "Credits", path: "/high-school", text: `Program requires ${formatHalfUnits(c.requiredHalfUnits)} credits (core ${formatHalfUnits(c.core.requiredHalfUnits)}, electives ${formatHalfUnits(c.elective.requiredHalfUnits)}). Officially earned (confirmed by the school): ${formatHalfUnits(c.earnedHalfUnits)}. Remaining: ${formatHalfUnits(c.remainingHalfUnits)}. Reported by you and waiting for the school: ${formatHalfUnits(c.awaitingConfirmationHalfUnits)}.` });
    const courses = hs.subjects.flatMap((s) => s.courses);
    const electives = courses.filter((x) => x.kind === "elective");
    if (electives.length) push({ label: "Electives", path: "/high-school", text: `Your planned electives: ${electives.map((e) => `${courseName(e.title)} (${formatHalfUnits(e.halfUnits)} credit${isProposed(e.title) ? ", proposed — the school has not approved it yet" : ""})`).join("; ")}.` });
    const open = courses.flatMap((x) => x.tasks.filter((t) => t.status === "not_started" || t.status === "in_progress" || t.status === "retake_required").map((t) => ({ ...t, course: courseName(x.title) })));
    const dated = open.filter((t) => t.dueDate).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    const next = (dated.length ? dated : open).slice(0, 4);
    if (next.length) push({ label: "Next tasks", path: "/high-school", text: `Your next open tasks: ${next.map((t) => `${clip(t.title, 90)} — ${t.course}${t.dueDate ? `, planned by ${t.dueDate}` : ""}${t.overdue ? " (overdue)" : ""}`).join("; ")}.` });
    const current = courses.filter((x) => x.status === "in_progress" || x.status === "awaiting_school").map((x) => `${courseName(x.title)} (${x.status === "in_progress" ? "in progress" : "waiting for the school's result"})`);
    if (current.length) push({ label: "Current courses", path: "/high-school", text: `Courses underway: ${current.join("; ")}.` });
    const p = hs.pace;
    const milestones = hs.milestones ?? [];
    const phase = courses.find((x) => /accelerated weeks/i.test(x.tasks[0]?.title ?? ""));
    push({ label: "Timeline", path: "/high-school", text: phase
      ? "Your plan follows a 16-week accelerated reference counted from the actual start of your program (3 credits planned by week 4, 8 by week 8, 16 by week 13, 21 by week 16; 4 to 6 months is the broader indicative range). These are planning targets, not school deadlines or guarantees."
      : `Your plan started ${hs.enrollment.startedOn ?? "(start not set)"} with a target of ${hs.enrollment.targetCompletionDate ?? "(not set)"} (a target, not a guarantee). Pace: ${p.status.replace("_", " ")}. ${p.nextMilestone ? `Next milestone: ${formatHalfUnits(p.nextMilestone.cumulativeHalfUnits)} cumulative credit(s) planned by ${p.nextMilestone.month}.` : ""}${milestones.length ? ` ${milestones.length} monthly milestones are planned.` : ""}` });
    const g = hs.graduation;
    push({ label: "Graduation", path: "/high-school", text: `Graduation status: ${g.status.replace(/_/g, " ")}. Credits requirement met: ${g.creditsSatisfied ? "yes" : "no"}. Only the school confirms eligibility and issues the diploma.` });
  }
  const docs = input.documents;
  const needsAction = docs.filter((d) => d.status === "rejected" || d.status === "resubmit_requested");
  const pending = docs.filter((d) => d.status === "pending");
  push({ label: "Documents", path: "/documents", text: docs.length === 0 ? "You have no documents on file yet." :
    `Documents: ${docs.length} on file; ${pending.length} waiting for Lumière's review; ${needsAction.length} need a new upload${needsAction.length ? ` (${needsAction.map((d) => `${d.doc_type.replace(/_/g, " ")}${d.student_message || d.rejection_reason ? `: "${clip(d.student_message ?? d.rejection_reason, 120)}"` : ""}`).join("; ")})` : ""}.` });
  const t = input.tickets;
  push({ label: "Support", path: "/support", text: t.length === 0 ? "You have no support requests." :
    `Support requests: ${t.slice(0, 5).map((x) => `"${clip(x.subject, 80)}" is ${x.status.replace(/_/g, " ")}${x.status === "waiting_on_student" ? " (Lumière replied and is waiting for you)" : x.status === "open" ? " (waiting for Lumière)" : ""}`).join("; ")}.` });
  const b = input.billing;
  if (b && b.state === "configured") {
    push({ label: "Billing", path: "/billing", text: `Agreed amount ${money(b.agreedCents, b.currency)}${b.discountCents ? `, adjustment −${money(b.discountCents, b.currency)}` : ""}. Paid (confirmed by Lumière): ${money(b.paidCents, b.currency)}. Remaining: ${money(b.remainingCents, b.currency)}.${b.nextDue ? ` Next payment: ${money(b.nextDue.amountCents, b.currency)} due ${b.nextDue.dueDate}.` : ""}` });
  } else if (b) {
    push({ label: "Billing", path: "/billing", text: "Billing has not been set up on your account yet." });
  }
  return out;
}

type Intent = "credits" | "electives" | "elective_change" | "documents" | "support" | "billing" | "timeline" | "next" | "school_approval";
const INTENTS: Array<[Intent, RegExp]> = [
  ["elective_change", /(switch|change|chang|swap|replace|remplac).*(elective|option)|(elective|option).*(switch|change|swap|replace|remplac)/i],
  ["school_approval", /(school|école|ecole).*(approv|accept)|(approv|accept).*(school|école)/i],
  ["electives", /elective|option(s)? (choisie|propos)|mes options|quelles options/i],
  ["credits", /credit|crédit|credits left|reste.*crédit|official|officiel/i],
  ["documents", /document|upload|téléverse|pièce|papier|owe|dois.*fournir/i],
  ["support", /ticket|support|reply|répon|assistance|demande/i],
  ["billing", /pay|paid|balance|tuition|fee|owe.*money|solde|payé|paiement|frais|facture/i],
  ["timeline", /timeline|when.*finish|deadline|date|calendrier|échéance|fin de|based on|basé/i],
  ["next", /what should i (study|do)|today|next|quoi (étudier|faire)|aujourd|prochaine|commencer/i],
];
const MAP: Record<Intent, string[]> = {
  credits: ["Credits", "Graduation"], electives: ["Electives"], elective_change: ["Electives"], school_approval: ["Electives"],
  documents: ["Documents"], support: ["Support"], billing: ["Billing"], timeline: ["Timeline"], next: ["Next tasks", "Current courses"],
};
const LEAD = {
  en: { head: "From your record (system facts, not AI):", change: "You can request a change from the elective's course card (\"Request a change\"). Lumière reviews it, the school must accept the substitute, and only then is a new version of your roadmap published. You cannot change the roadmap yourself, and nothing changes until it is approved.", approval: "If the school has not approved an elective, it stays marked as proposed and earns no credit; Lumière will tell you and help choose another option so you still reach 5 elective credits." },
  fr: { head: "D’après votre dossier (faits du système, pas une IA) :", change: "Vous pouvez demander un changement depuis la fiche de l’option (« Demander un changement »). Lumière l’examine, l’école doit accepter le remplacement, puis une nouvelle version de votre feuille de route est publiée. Vous ne pouvez pas modifier la feuille de route vous-même, et rien ne change avant l’approbation.", approval: "Si l’école n’a pas approuvé une option, elle reste « proposée » et ne donne aucun crédit; Lumière vous en informe et vous aide à en choisir une autre pour atteindre 5 crédits d’options." },
} as const;

/** Deterministic, labelled facts for common personal questions; null when no intent matches. */
export function answerFromRecord(message: string, lang: Lang, records: readonly StudentRecord[]): { text: string; cited: StudentRecord[] } | null {
  const hits = INTENTS.filter(([, re]) => re.test(message)).map(([i]) => i);
  if (!hits.length) return null;
  const labels = [...new Set(hits.flatMap((i) => MAP[i]))];
  const cited = records.filter((r) => labels.includes(r.label));
  const extra: string[] = [];
  if (hits.includes("elective_change")) extra.push(LEAD[lang].change);
  if (hits.includes("school_approval")) extra.push(LEAD[lang].approval);
  if (!cited.length && !extra.length) return null;
  return { text: [LEAD[lang].head, ...cited.map((r) => `• ${r.text} [${r.ref}]`), ...extra].join("\n"), cited };
}

export async function loadOwnStudentRecord(userId: string): Promise<StudentRecord[]> {
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
  return composeStudentRecords({ highSchool, documents, tickets, billing, today });
}
